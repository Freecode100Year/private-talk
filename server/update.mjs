// Offline updater for the 隐匿对话 offline packages: no internet needed.
//
//   update <new package> [--force] [--unsigned]   install a newer version
//   update --rollback                             go back to the version before
//   update --import <old folder>                  bring certificates and settings
//                                                 over from a 2.2.x folder
//
// A package folder looks like this; the updater only replaces app/ and node/
// and the start scripts, and keeps the previous ones in previous/:
//   app/  node/  lan-certs/  config.env  PLATFORM  start-lan.*  update.*  status.*
//
// Steps: check the signature (the package's .sig file, made by the release
// key in app/server/release-key.pem of the version installed now) → unpack
// to a staging folder → start the new version on a spare port with test
// certificates and check it answers → swap it in, keeping the old one for
// --rollback. Rooms live in memory, so stop the server before updating; a
// rollback brings back the program and settings, not conversations.
import { createPublicKey, verify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, chmodSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArchive, ArchiveError } from './archive.mjs';
import { parseEnvFile, KNOWN } from './config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STAGING = join(ROOT, '.update-staging');
const PREVIOUS = join(ROOT, 'previous');
// What a version consists of; everything else in the folder (lan-certs,
// config.env, previous/) belongs to this installation and is kept.
const PARTS = ['app', 'node', 'start-lan.cmd', 'start-lan.sh', 'update.cmd', 'update.sh', 'status.cmd', 'status.sh', '使用说明.txt', 'config.env.example', 'PLATFORM'];

class Stop extends Error {}
const say = (s = '') => console.log(s);

function versionOf(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'app', 'package.json'), 'utf8')).version; } catch { return null; }
}
function platformOf(dir) {
  try { return readFileSync(join(dir, 'PLATFORM'), 'utf8').trim(); } catch { return null; }
}
function newer(a, b) {
  const pa = a.split(/[.-]/).map((x) => Number(x) || 0), pb = b.split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
function settings() {
  const f = join(ROOT, 'config.env');
  try { return existsSync(f) ? parseEnvFile(readFileSync(f, 'utf8')) : {}; } catch { return {}; }
}
function nodeIn(dir) {
  for (const p of ['node/node.exe', 'node/bin/node']) if (existsSync(join(dir, p))) return join(dir, p);
  return process.execPath;
}

// Windows sometimes holds a file a moment longer (virus scanners): retry.
function move(from, to) {
  for (let i = 0; ; i++) {
    try { renameSync(from, to); return; } catch (e) {
      if (i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

function portInUse(port) {
  return new Promise((done) => {
    const s = connect({ host: '127.0.0.1', port }, () => { s.destroy(); done(true); });
    s.on('error', () => done(false));
    s.setTimeout(1500, () => { s.destroy(); done(false); });
  });
}
function freePort() {
  return new Promise((done, fail) => {
    const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); });
    s.on('error', fail);
  });
}

function checkSignature(file, buf, unsigned) {
  const sigFile = `${file}.sig`;
  if (!existsSync(sigFile)) {
    if (unsigned) { say('⚠ 没有签名文件，按 --unsigned 跳过签名检查。只在你自己构建的包上这样做。'); return; }
    throw new Stop(`找不到签名文件 ${basename(sigFile)}。\n  请把发布页上与安装包同名的 .sig 文件一起拷过来，放在安装包旁边。`);
  }
  const keyFile = join(ROOT, 'app', 'server', 'release-key.pem');
  if (!existsSync(keyFile)) throw new Stop('当前版本没有发布公钥（app/server/release-key.pem），无法核对签名。');
  const sig = Buffer.from(readFileSync(sigFile, 'utf8').trim(), 'base64');
  if (!verify(null, buf, createPublicKey(readFileSync(keyFile)), sig)) {
    throw new Stop('签名不对：这个安装包不是本项目发布的，或者在传递中被改动过。不要安装它。');
  }
  say('✓ 签名正确（由本项目的发布密钥签名）');
}

function unpack(entries) {
  const tops = new Set(entries.map((e) => e.path.split('/')[0]));
  if (tops.size !== 1) throw new Stop('安装包结构不对：应该只有一个顶层文件夹。');
  const top = [...tops][0];
  rmSync(STAGING, { recursive: true, force: true });
  mkdirSync(STAGING, { recursive: true });
  for (const e of entries) {
    const rel = e.path.slice(top.length + 1);
    if (!rel) continue;
    const out = join(STAGING, rel);
    if (e.dir) { mkdirSync(out, { recursive: true }); continue; }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, e.data());
    if (process.platform !== 'win32') {
      const exec = (e.mode & 0o111) || /(^|\/)(node\/bin\/node|[^/]+\.sh)$/.test(rel);
      chmodSync(out, exec ? 0o755 : 0o644);
    }
  }
}

// Starts the staged version on a spare port with throwaway certificates and
// the installation's settings, and waits for it to answer.
async function trial() {
  const port = await freePort();
  const temp = mkdtempSync(join(tmpdir(), 'private-talk-trial-'));
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LAN_CERTS: join(temp, 'certs'), LAN_NAMES: '' };
  if (existsSync(join(ROOT, 'config.env'))) env.CONFIG_FILE = join(ROOT, 'config.env');
  const child = spawn(nodeIn(STAGING), [join(STAGING, 'app', 'server', 'lan.mjs')], { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((done) => child.on('exit', done));
  const get = (path) => new Promise((done) => {
    https.get({ host: '127.0.0.1', port, path, rejectUnauthorized: false, timeout: 2000 }, (r) => {
      let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => done({ status: r.statusCode, body: b }));
    }).on('error', () => done(null)).on('timeout', function () { this.destroy(); });
  });
  try {
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) break;
      const h = await get('/healthz');
      if (h?.status === 200) {
        const page = await get('/');
        if (page?.status === 200 && page.body.includes('app.js')) return JSON.parse(h.body).version;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Stop(`新版本试运行失败，没有安装。\n${log.trim().split('\n').slice(-8).map((l) => `  | ${l}`).join('\n')}`);
  } finally {
    child.kill();
    await exited;
    rmSync(temp, { recursive: true, force: true });
  }
}

// Moves the version parts of `from` into `to` (both folders).
function moveParts(from, to) {
  mkdirSync(to, { recursive: true });
  for (const p of PARTS) if (existsSync(join(from, p))) move(join(from, p), join(to, p));
}

async function install(file, { force, unsigned }) {
  const current = versionOf(ROOT);
  const platform = platformOf(ROOT);
  if (!current || !platform) throw new Stop('这个文件夹不是 2.3 以后的离线包，没法在这里更新。\n  请解压新版本到新文件夹，再在新文件夹里运行 update --import <旧文件夹>。');
  if (!existsSync(file)) throw new Stop(`找不到文件 ${file}`);
  say(`当前版本 ${current}（${platform}）`);
  say(`安装包   ${basename(file)}`);
  const buf = readFileSync(file);
  checkSignature(file, buf, unsigned);

  const port = Number(process.env.PORT || settings().PORT) || 8443;
  if (await portInUse(port)) throw new Stop(`端口 ${port} 上有程序在运行：请先关闭正在运行的隐匿对话窗口（或停止服务），再更新。`);

  let entries;
  try { entries = readArchive(buf); } catch (e) { throw e instanceof ArchiveError ? new Stop(`安装包损坏或格式不对：${e.message}`) : e; }
  unpack(entries);
  const next = versionOf(STAGING), nextPlatform = platformOf(STAGING);
  if (!next || !nextPlatform) throw new Stop('安装包里没有 app/package.json 或 PLATFORM，不是 2.3 以后的离线包。');
  if (nextPlatform !== platform) throw new Stop(`平台不符：这里是 ${platform}，安装包是 ${nextPlatform}。请下载 private-talk-${platform} 的包。`);
  if (!newer(next, current) && !force) throw new Stop(`安装包版本 ${next} 不比当前的 ${current} 新。确实要装的话加 --force。`);

  say(`试运行 ${next}…`);
  await trial();
  say('✓ 新版本试运行正常');

  rmSync(PREVIOUS, { recursive: true, force: true });
  moveParts(ROOT, PREVIOUS);
  try {
    moveParts(STAGING, ROOT);
  } catch (e) {
    moveParts(PREVIOUS, ROOT);
    throw new Stop(`替换文件时出错，已恢复原来的版本：${e.message}`);
  }
  rmSync(STAGING, { recursive: true, force: true });
  say('');
  say(`✓ 已更新：${current} → ${next}`);
  say('  证书（lan-certs）和设置（config.env）原样保留，各设备不用重新装证书。');
  say('  现在可以用 start-lan 启动。如果新版本有问题，运行 update --rollback 回到 ' + current + '。');
  say('  注意：更新会断开当时的所有聊天，房间和消息不会恢复，大家重新打开房间链接即可。');
}

async function rollback() {
  const prev = versionOf(PREVIOUS);
  if (!prev) throw new Stop('没有上一个版本可以回退（previous 文件夹不存在）。');
  const port = Number(process.env.PORT || settings().PORT) || 8443;
  if (await portInUse(port)) throw new Stop(`端口 ${port} 上有程序在运行：请先关闭正在运行的隐匿对话，再回退。`);
  const current = versionOf(ROOT);
  const swap = join(ROOT, '.rollback-swap');
  rmSync(swap, { recursive: true, force: true });
  moveParts(ROOT, swap);
  moveParts(PREVIOUS, ROOT);
  rmSync(PREVIOUS, { recursive: true, force: true });
  move(swap, PREVIOUS);
  say(`✓ 已回退：${current} → ${prev}。再运行一次 update --rollback 可以回到 ${current}。`);
}

// From a 2.2.x folder (no updater yet): copy its certificates, and the
// settings written as "set X=Y" in its start script, into this folder.
function importOld(old, { force }) {
  old = resolve(old);
  if (!existsSync(old) || !statSync(old).isDirectory()) throw new Stop(`找不到文件夹 ${old}`);
  const certs = join(old, 'lan-certs');
  if (existsSync(join(certs, 'ca.crt'))) {
    if (existsSync(join(ROOT, 'lan-certs', 'ca.crt')) && !force) throw new Stop('这个文件夹已经有 lan-certs 了。确实要用旧的覆盖，加 --force。');
    rmSync(join(ROOT, 'lan-certs'), { recursive: true, force: true });
    cpSync(certs, join(ROOT, 'lan-certs'), { recursive: true });
    say('✓ 已复制证书 lan-certs（各设备已装的证书继续有效）');
  } else say('旧文件夹里没有 lan-certs，跳过证书。');
  const found = {};
  for (const name of ['start-lan.cmd', 'start-lan.sh', 'config.env']) {
    const f = join(old, name);
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.trim().match(/^(?:set\s+|export\s+)?"?([A-Z_]+)=([^"]*)"?\s*$/i);
      if (m && KNOWN.includes(m[1].toUpperCase())) found[m[1].toUpperCase()] = m[2].trim();
    }
  }
  if (Object.keys(found).length) {
    const target = join(ROOT, 'config.env');
    const merged = { ...(existsSync(target) ? parseEnvFile(readFileSync(target, 'utf8')) : {}), ...found };
    writeFileSync(target, `# 从 ${old} 导入\n${Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
    say(`✓ 已导入设置到 config.env：${Object.keys(found).join(' ')}`);
  }
  say('完成。用 start-lan 启动新版本；确认没问题后可以删掉旧文件夹。');
}

function usage() {
  say('用法：');
  say('  update <新版本安装包>        例如 update D:\\U盘\\private-talk-win-x64.zip（.sig 签名文件放在旁边）');
  say('                               Windows 上也可以把安装包直接拖到 update.cmd 上');
  say('  update --rollback            回到更新前的版本');
  say('  update --import <旧文件夹>   从 2.2 及更早的文件夹导入证书和设置');
  const dir = join(ROOT, 'updates');
  if (existsSync(dir)) {
    const found = readdirSync(dir).filter((n) => /^private-talk-.*\.(zip|tar\.gz)$/.test(n));
    if (found.length) say(`\nupdates 文件夹里找到：${found.join('、')}`);
  }
}

const args = process.argv.slice(2);
const flags = { force: args.includes('--force'), unsigned: args.includes('--unsigned') };
const rest = args.filter((a) => !a.startsWith('--'));
try {
  if (args.includes('--rollback')) await rollback();
  else if (args.includes('--import')) {
    if (!rest[0]) throw new Stop('请给出旧文件夹的路径：update --import <旧文件夹>');
    importOld(rest[0], flags);
  } else if (rest[0]) await install(resolve(rest[0]), flags);
  else {
    const dir = join(ROOT, 'updates');
    const found = existsSync(dir) ? readdirSync(dir).filter((n) => /^private-talk-.*\.(zip|tar\.gz)$/.test(n)) : [];
    if (found.length === 1) await install(join(dir, found[0]), flags);
    else usage();
  }
} catch (e) {
  rmSync(STAGING, { recursive: true, force: true });
  if (e instanceof Stop) { console.error(`\n✗ ${e.message}`); process.exit(1); }
  throw e;
}
