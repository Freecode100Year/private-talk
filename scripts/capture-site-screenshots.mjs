import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const siteDir = path.join(rootDir, '_site');
const outDir = path.join(rootDir, 'docs', 'screenshots');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0].split('#')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(siteDir, reqPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(8097, '127.0.0.1', async () => {
  console.log('HTTP server running on http://127.0.0.1:8097');

  let browser;
  try {
    browser = await chromium.launch();

    // 1. Mobile 360x740
    {
      const context = await browser.newContext({
        viewport: { width: 360, height: 740 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        locale: 'zh-CN'
      });
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:8097/', { waitUntil: 'networkidle' });
      const png = path.join(outDir, 'site-home.png');
      await page.screenshot({ path: png });
      execFileSync('python3', [
        '-c',
        `from PIL import Image; import os; i = Image.open('${png}'); i.save('${outDir}/site-home.webp', 'WEBP', quality=78, method=6); os.remove('${png}')`
      ]);
      console.log('Saved site-home.webp (360x740)');
      await context.close();
    }

    // 2. Desktop 1366x850
    {
      const context = await browser.newContext({
        viewport: { width: 1366, height: 850 },
        deviceScaleFactor: 1,
        locale: 'zh-CN'
      });
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:8097/', { waitUntil: 'networkidle' });
      const png = path.join(outDir, 'site-home-desktop.png');
      await page.screenshot({ path: png });
      execFileSync('python3', [
        '-c',
        `from PIL import Image; import os; i = Image.open('${png}'); i.save('${outDir}/site-home-desktop.webp', 'WEBP', quality=78, method=6); os.remove('${png}')`
      ]);
      console.log('Saved site-home-desktop.webp (1366x850)');
      await context.close();
    }
  } catch (err) {
    console.error('Screenshot error:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close(() => {
      console.log('HTTP server closed.');
    });
  }
});
