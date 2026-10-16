// Settings for the Node server: environment variables, plus an optional
// config.env file (KEY=VALUE lines) so a setup survives restarts and
// upgrades without retyping. Variables already set in the environment win.
// Every value is checked at start-up; a wrong one stops the server with a
// clear message instead of being quietly replaced by a default.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENTRY } from '../src/rules.js';

export const KNOWN = ['PORT', 'HOST', 'JOIN_LIMIT', 'MAX_CONNECTIONS', 'TRUST_PROXY', 'TLS_CERT', 'TLS_KEY', 'LAN_CERTS', 'LAN_NAMES', 'ENTRY_PATH'];

export function parseEnvFile(text) {
  const out = {};
  for (const [i, raw] of text.replace(/^﻿/, '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+|set\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) throw new ConfigError(`config.env 第 ${i + 1} 行看不懂：${line}`);
    out[m[1].toUpperCase()] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

export class ConfigError extends Error {}

// Reads CONFIG_FILE, or config.env in the working folder, if there is one.
export function loadConfigFile(env = process.env) {
  const file = resolve(env.CONFIG_FILE || 'config.env');
  if (!existsSync(file)) {
    if (env.CONFIG_FILE) throw new ConfigError(`找不到配置文件 ${file}`);
    return null;
  }
  const values = parseEnvFile(readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(values)) {
    if (!KNOWN.includes(k)) throw new ConfigError(`config.env 里有不认识的设置 ${k}（可用：${KNOWN.join(' ')}）`);
    if (env[k] === undefined) env[k] = v;
  }
  return file;
}

function int(env, name, def, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!/^\d+$/.test(raw.trim()) || Number(raw) < min || Number(raw) > max) throw new ConfigError(`${name}=${raw} 不对：应为 ${min}–${max} 的整数`);
  return Number(raw);
}

// checkConfig(env, defaults) -> the settings the server uses.
export function checkConfig(env = process.env, { port = 8080, joinLimit = 30 } = {}) {
  const c = {
    port: int(env, 'PORT', port, 1, 65535),
    host: env.HOST || undefined,
    joinLimit: int(env, 'JOIN_LIMIT', joinLimit, 1, 100000),
    maxConnections: int(env, 'MAX_CONNECTIONS', 2000, 1, 1000000),
    trustProxy: env.TRUST_PROXY === '1',
    tlsCert: env.TLS_CERT || null,
    tlsKey: env.TLS_KEY || null,
    entry: null,
  };
  if (env.ENTRY_PATH) {
    const e = `/${env.ENTRY_PATH.trim().replace(/^\/+|\/+$/g, '')}/`;
    if (!ENTRY.test(e)) throw new ConfigError(`ENTRY_PATH=${env.ENTRY_PATH} 不对：应为 8–64 个字母、数字、- 或 _，例如 ENTRY_PATH=k7Qp2xVm9aLd`);
    c.entry = e;
  }
  if (env.TRUST_PROXY !== undefined && !['', '0', '1'].includes(env.TRUST_PROXY)) throw new ConfigError(`TRUST_PROXY=${env.TRUST_PROXY} 不对：应为 1 或 0`);
  if (!!c.tlsCert !== !!c.tlsKey) throw new ConfigError('TLS_CERT 和 TLS_KEY 要一起设置（证书和私钥）');
  for (const f of [c.tlsCert, c.tlsKey]) if (f && !existsSync(f)) throw new ConfigError(`找不到文件 ${f}`);
  return c;
}
