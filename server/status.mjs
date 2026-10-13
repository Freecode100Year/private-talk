// What this installation is and whether it is running: version, settings,
// certificates and their expiry, and a check of the running server. Prints
// nothing secret (no private keys); safe to copy into a support request.
//   status            (from the package folder: status.cmd / status.sh)
import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { join, resolve } from 'node:path';
import { loadConfigFile, checkConfig, ConfigError } from './config.mjs';
import { VERSION } from './version.mjs';

const say = (k, v) => console.log(k ? `${k}：${v}` : `  ${v}`);
const read = (f) => { try { return readFileSync(f, 'utf8').trim(); } catch { return null; } };

console.log('隐匿对话 状态');
say('版本', VERSION);
say('平台', read('PLATFORM') ?? '（不是离线包文件夹）');
const prev = read(join('previous', 'app', 'package.json'));
if (prev) say('可回退到', JSON.parse(prev).version);
say('Node.js', process.version);

let config = null;
try {
  const file = loadConfigFile();
  say('设置文件', file ?? '没有（全部用默认值）');
  config = checkConfig(process.env, { port: 8443 });
  say('端口', config.port);
  if (process.env.LAN_NAMES) say('LAN_NAMES', process.env.LAN_NAMES);
} catch (e) {
  if (!(e instanceof ConfigError)) throw e;
  say('设置', `✗ 有误：${e.message}`);
}

const certs = resolve(process.env.LAN_CERTS || 'lan-certs');
for (const [label, f] of [['CA 证书', 'ca.crt'], ['服务器证书', 'server.crt']]) {
  const p = join(certs, f);
  if (!existsSync(p)) { say(label, '还没有（第一次启动时生成）'); continue; }
  const c = new X509Certificate(readFileSync(p));
  const days = Math.floor((new Date(c.validTo) - Date.now()) / 86400e3);
  say(label, `${days < 0 ? '✗ 已过期' : days < 30 ? `⚠ 还有 ${days} 天过期` : `有效，还有 ${days} 天`}（到 ${new Date(c.validTo).toISOString().slice(0, 10)}）`);
  if (f === 'server.crt') say('证书包含', (c.subjectAltName || '').replace(/(DNS:|IP Address:)/g, '').replace(/,\s*/g, ' '));
}

if (config) {
  const lan = existsSync(certs) || !!config.tlsCert;
  const req = (lan ? https : http).get({ host: '127.0.0.1', port: config.port, path: '/healthz', rejectUnauthorized: false, timeout: 3000 }, (r) => {
    let b = '';
    r.on('data', (d) => { b += d; });
    r.on('end', () => {
      let v = '';
      try { v = JSON.parse(b).version; } catch {}
      say('运行状态', r.statusCode === 200 ? `✓ 正在运行（${v}）` : `✗ 有响应但不正常：HTTP ${r.statusCode}`);
      if (v && v !== VERSION) say('', `⚠ 正在运行的是 ${v}，不是这个文件夹里的 ${VERSION}：请重启。`);
    });
  });
  req.on('timeout', () => req.destroy());
  req.on('error', () => say('运行状态', `没有在端口 ${config.port} 运行`));
}
