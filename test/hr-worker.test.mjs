// The same /hr/ and /ws/ probes against the Cloudflare Worker, run locally
// by wrangler dev (workerd). Slow to start, so only with HR_WORKER_TEST=1;
// otherwise these are reported as skipped ("未验证"), never as passed.
import { before, after } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hrRelaySuite } from './fixtures/hr-relay-suite.mjs';

const on = process.env.HR_WORKER_TEST === '1';
const PORT = 18900 + Math.floor(Math.random() * 90);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let dev;
if (on) {
  before(async () => {
    const bin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
    dev = spawn(process.execPath, [bin, 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    await new Promise((done, fail) => {
      const t = setTimeout(() => fail(new Error('wrangler dev did not start in 90 s')), 90000);
      const look = (d) => { if (String(d).includes('Ready on')) { clearTimeout(t); setTimeout(done, 500); } };
      dev.stdout.on('data', look); dev.stderr.on('data', look);
      dev.on('exit', (c) => fail(new Error(`wrangler exited ${c}`)));
    });
  }, { timeout: 100000 });
  // The whole process group: wrangler starts workerd as a child.
  after(() => { try { process.kill(-dev.pid); } catch { dev?.kill(); } });
}
hrRelaySuite('worker', PORT, on ? { oldCloses: false } : { skip: '未验证：设置 HR_WORKER_TEST=1 用 wrangler dev 运行' });
