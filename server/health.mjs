// Health check for Docker and service managers: asks this machine's server
// for /healthz on its own port, HTTP or HTTPS as configured. Exit 0 = healthy.
import http from 'node:http';
import https from 'node:https';
import { loadConfigFile } from './config.mjs';

try { loadConfigFile(); } catch {}
const tls = !!(process.env.TLS_CERT || process.env.LAN_CERTS);
const port = Number(process.env.PORT) || (tls ? 8443 : 8080);
const req = (tls ? https : http).get({ host: '127.0.0.1', port, path: '/healthz', rejectUnauthorized: false, timeout: 3000 }, (res) => {
  let body = '';
  res.on('data', (d) => { body += d; });
  res.on('end', () => {
    if (res.statusCode === 200) { console.log(body); process.exit(0); }
    console.error(`unhealthy: HTTP ${res.statusCode}`); process.exit(1);
  });
});
req.on('timeout', () => req.destroy(new Error('timeout')));
req.on('error', (e) => { console.error(`unhealthy: ${e.code || e.message}`); process.exit(1); });
