// 隐匿对话 on a LAN or intranet: `npm run lan` (or `node server/lan.mjs`).
// Makes sure there is a certificate for this machine's LAN addresses (see
// lancert.mjs), then starts the server on HTTPS.
//
// Environment, besides the server's own:
//   LAN_CERTS   where the certificates live (default ./lan-certs)
//   LAN_NAMES   extra names or addresses to include, comma separated, e.g.
//               chat.lan,192.168.1.20 (needed in Docker without host networking)
//   PORT        default 8443
import { resolve } from 'node:path';
import { createSocket } from 'node:dgram';
import { ensure, lanAddresses } from './lancert.mjs';
import { loadConfigFile, checkConfig, ConfigError } from './config.mjs';

// Settings saved in config.env (next to the start script) apply here too.
try {
  const file = loadConfigFile();
  if (file) console.log(`使用设置文件 ${file}`);
  checkConfig(process.env, { port: 8443 });
} catch (e) {
  if (!(e instanceof ConfigError)) throw e;
  console.error(`设置有误，没有启动：${e.message}`);
  process.exit(2);
}

// The address of the interface that carries the default route, found by
// "connecting" a UDP socket (no packet is sent). Used when the system will
// not list interfaces, as on Android.
function routeAddress() {
  return new Promise((done) => {
    const sock = createSocket('udp4');
    sock.on('error', () => { sock.close(); done(null); });
    sock.connect(53, '192.0.2.1', () => { const a = sock.address().address; sock.close(); done(a); });
  });
}

const dir = resolve(process.env.LAN_CERTS || 'lan-certs');
const extra = (process.env.LAN_NAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!lanAddresses().length) {
  const a = await routeAddress();
  if (a) extra.push(a);
}
process.env.PORT ||= '8443';
const port = process.env.PORT;
// A certificate from the organisation's own CA (TLS_CERT/TLS_KEY in
// config.env) is used as it is; otherwise this machine makes its own.
if (process.env.TLS_CERT && process.env.TLS_KEY) {
  console.log(`使用指定的证书 ${process.env.TLS_CERT}`);
  console.log(`同一网络里的人用浏览器打开 https://证书上的名字:${port}/`);
} else {
  await ownCertificate();
}

async function ownCertificate() {
  const { caCrt, crt, key, sans, refused } = ensure(dir, extra);
  process.env.TLS_CERT = crt;
  process.env.TLS_KEY = key;
  // The server certificate lasts 397 days; check twice a day and make a new
  // one when it gets near the end or the machine's addresses change. The
  // server picks the new files up without a restart.
  setInterval(() => { try { ensure(dir, extra); } catch (e) { console.error(`证书续期失败：${e.message}`); } }, 12 * 3600e3).unref();

  const shown = sans.filter((n) => n !== 'localhost' && n !== '127.0.0.1');
  console.log('');
  console.log('隐匿对话（局域网 / 内网）');
  console.log('同一网络里的人用浏览器打开：');
  for (const n of shown.length ? shown : sans) console.log(`  https://${n.includes(':') ? `[${n}]` : n}:${port}/`);
  if (refused.length) console.log(`没有放进证书（不是局域网地址）：${refused.join(', ')}`);
  if (!shown.length) console.log('没找到局域网地址：请在系统网络设置里查看本机 IP，然后用 LAN_NAMES=那个IP 重新启动。');
  console.log('');
  console.log('第一次打开会提示“连接不是私密连接”：这是本机自己签发的证书。');
  console.log('  · 点“高级”→“继续前往”即可使用（加密照样有效）；');
  console.log(`  · 或者把 ${caCrt} 安装为受信任的证书，以后就不再提示。`);
  console.log('    这个证书只能为局域网地址和 .local/.lan 名称签发，无法冒充任何公网网站。');
  console.log('');
}
await import('./server.mjs');
