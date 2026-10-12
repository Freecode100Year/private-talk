// CI check: fetch a page over HTTPS trusting only the given CA file, so the
// LAN certificate chain (and its name) is verified by Node's TLS on every OS.
//   node scripts/check-https.mjs <ca.crt> <url> [text that must appear]
import https from 'node:https';
import { readFileSync } from 'node:fs';
const [ca, url, expect] = process.argv.slice(2);
https.get(url, { ca: readFileSync(ca) }, (res) => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (d) => { body += d; });
  res.on('end', () => {
    if (res.statusCode !== 200) { console.error(`${url}: HTTP ${res.statusCode}`); process.exit(1); }
    if (expect && !body.includes(expect)) { console.error(`${url}: "${expect}" not found`); process.exit(1); }
    console.log(`${url}: OK, certificate verified`);
  });
}).on('error', (e) => { console.error(`${url}: ${e.code || e.message}`); process.exit(1); });
