import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const tempDir = mkdtempSync(path.join(tmpdir(), 'ptd-pages-test-'));

test.after(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

test('scripts/pages-build.mjs builds static pages without errors', () => {
  const out = execFileSync('node', ['scripts/pages-build.mjs', tempDir], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  assert.match(out, /Pages build complete/);
});

test('both Chinese and English pages and style.css exist and are non-empty', () => {
  const zhPath = path.join(tempDir, 'index.html');
  const enPath = path.join(tempDir, 'en', 'index.html');
  const cssPath = path.join(tempDir, 'style.css');

  assert.ok(existsSync(zhPath), 'index.html exists');
  assert.ok(existsSync(enPath), 'en/index.html exists');
  assert.ok(existsSync(cssPath), 'style.css exists');

  assert.ok(statSync(zhPath).size > 1000, 'index.html is non-empty');
  assert.ok(statSync(enPath).size > 1000, 'en/index.html is non-empty');
  assert.ok(statSync(cssPath).size > 500, 'style.css is non-empty');
});

test('no {{ placeholder remains in generated pages', () => {
  const zhHtml = readFileSync(path.join(tempDir, 'index.html'), 'utf8');
  const enHtml = readFileSync(path.join(tempDir, 'en', 'index.html'), 'utf8');

  assert.doesNotMatch(zhHtml, /\{\{[^}]+\}\}/, 'index.html should have no remaining placeholders');
  assert.doesNotMatch(enHtml, /\{\{[^}]+\}\}/, 'en/index.html should have no remaining placeholders');
});

test('APK links are correctly extracted from README.md and inserted', () => {
  const readme = readFileSync(path.join(rootDir, 'README.md'), 'utf8');
  const zhHtml = readFileSync(path.join(tempDir, 'index.html'), 'utf8');
  const enHtml = readFileSync(path.join(tempDir, 'en', 'index.html'), 'utf8');

  const onlineMatch = readme.match(/https:\/\/github\.com\/Freecode100Year\/private-talk\/releases\/download\/android-online-[^\s\)\"]+\.apk/);
  const offlineMatch = readme.match(/https:\/\/github\.com\/Freecode100Year\/private-talk\/releases\/download\/android-offline-[^\s\)\"]+\.apk/);

  assert.ok(onlineMatch, 'README.md contains online APK link');
  assert.ok(offlineMatch, 'README.md contains offline APK link');

  assert.ok(zhHtml.includes(onlineMatch[0]), 'index.html contains online APK link');
  assert.ok(zhHtml.includes(offlineMatch[0]), 'index.html contains offline APK link');
  assert.ok(enHtml.includes(onlineMatch[0]), 'en/index.html contains online APK link');
  assert.ok(enHtml.includes(offlineMatch[0]), 'en/index.html contains offline APK link');
});

test('no external http(s) stylesheets, scripts, or images', () => {
  const files = [path.join(tempDir, 'index.html'), path.join(tempDir, 'en', 'index.html')];

  for (const f of files) {
    const html = readFileSync(f, 'utf8');

    // No external stylesheets
    const cssLinks = html.matchAll(/<link\b[^>]*?\brel=["']stylesheet["'][^>]*?>/gi);
    for (const link of cssLinks) {
      assert.doesNotMatch(link[0], /href=["']https?:\/\//i, `${f}: stylesheet link must be local`);
    }

    // No external img src
    const imgTags = html.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>/gi);
    for (const img of imgTags) {
      assert.doesNotMatch(img[1], /^https?:\/\//i, `${f}: image src must be local: ${img[1]}`);
    }

    // No external script tags
    const scriptTags = html.matchAll(/<script\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>/gi);
    for (const script of scriptTags) {
      assert.doesNotMatch(script[1], /^https?:\/\//i, `${f}: script src must not be external: ${script[1]}`);
    }
  }
});

test('all local links and images resolve to existing files', () => {
  const files = [path.join(tempDir, 'index.html'), path.join(tempDir, 'en', 'index.html')];

  for (const f of files) {
    const html = readFileSync(f, 'utf8');
    const dir = path.dirname(f);
    const refRegex = /<(?:a|link|img|source)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;

    for (const match of html.matchAll(refRegex)) {
      const rawRef = match[1].trim();
      if (!rawRef || /^(?:https?:\/\/|mailto:|data:|#)/i.test(rawRef)) continue;

      const cleanRef = rawRef.split('#')[0].split('?')[0];
      if (!cleanRef) continue;

      let targetPath = path.resolve(dir, cleanRef);
      if (cleanRef.endsWith('/') || (existsSync(targetPath) && statSync(targetPath).isDirectory())) {
        targetPath = path.join(targetPath, 'index.html');
      }

      assert.ok(existsSync(targetPath), `${f}: broken local link "${rawRef}" -> "${targetPath}"`);
    }
  }
});

test('meta tags: Content-Security-Policy, referrer, and canonical links', () => {
  const zhHtml = readFileSync(path.join(tempDir, 'index.html'), 'utf8');
  const enHtml = readFileSync(path.join(tempDir, 'en', 'index.html'), 'utf8');

  const requiredCsp = "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'";

  for (const [name, html] of [['index.html', zhHtml], ['en/index.html', enHtml]]) {
    assert.ok(
      html.includes(`content="${requiredCsp}"`),
      `${name} must contain exact CSP meta tag`
    );
    assert.ok(
      html.includes('<meta name="referrer" content="no-referrer">'),
      `${name} must contain referrer meta tag`
    );
  }

  assert.ok(
    zhHtml.includes('<link rel="canonical" href="https://freecode100year.github.io/private-talk/">'),
    'index.html canonical must point to root'
  );
  assert.ok(
    enHtml.includes('<link rel="canonical" href="https://freecode100year.github.io/private-talk/en/">'),
    'en/index.html canonical must point to en/'
  );
});

test('images have loading="lazy" and width/height attributes', () => {
  const files = [path.join(tempDir, 'index.html'), path.join(tempDir, 'en', 'index.html')];

  for (const f of files) {
    const html = readFileSync(f, 'utf8');
    const imgTags = html.matchAll(/<img\b([^>]*?)>/gi);

    for (const match of imgTags) {
      const attrs = match[1];
      assert.match(attrs, /\bloading=["']lazy["']/, `${f}: img must have loading="lazy": ${match[0]}`);
      assert.match(attrs, /\bwidth=["']\d+["']/, `${f}: img must have width attribute: ${match[0]}`);
      assert.match(attrs, /\bheight=["']\d+["']/, `${f}: img must have height attribute: ${match[0]}`);
    }
  }
});

test('Chrome 83 CSS compatibility: no flex gap, no aspect-ratio, no :is/:where', () => {
  const rawCss = readFileSync(path.join(tempDir, 'style.css'), 'utf8');
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

  // No aspect-ratio
  assert.doesNotMatch(css, /\baspect-ratio\s*:/, 'CSS must not use aspect-ratio (Chrome 88)');

  // No :is() or :where()
  assert.doesNotMatch(css, /:(is|where)\(/, 'CSS must not use :is() or :where() (Chrome 88)');

  // No flex gap: check all CSS blocks
  // Split css into blocks: selector { declarations }
  const cleanCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blockRegex = /([^{}]+)\{([^{}]+)\}/g;

  for (const match of cleanCss.matchAll(blockRegex)) {
    const selector = match[1].trim();
    const decls = match[2];

    const isFlex = /\bdisplay\s*:\s*(?:inline-)?flex\b/.test(decls);
    const hasGap = /\b(?:row-|column-)?gap\s*:/.test(decls);

    assert.ok(
      !(isFlex && hasGap),
      `CSS block "${selector}" uses flex and gap together, which fails on Chrome 83`
    );

    // If gap is used, it should be grid
    if (hasGap) {
      const isGrid = /\bdisplay\s*:\s*(?:inline-)?grid\b/.test(decls);
      assert.ok(
        isGrid,
        `CSS block "${selector}" uses gap without display: grid`
      );
    }
  }
});

test('Chrome 83 JS compatibility: no modern syntax in pages or output', () => {
  const LATER = [
    [/(\|\||&&|\?\?)=/, 'logical assignment (Chrome 85)'],
    [/\.replaceAll\(/, 'String.replaceAll (Chrome 85)'],
    [/\.at\(-?\d/, 'Array/String.at (Chrome 92)'],
    [/Object\.hasOwn\(/, 'Object.hasOwn (Chrome 93)'],
    [/structuredClone\(/, 'structuredClone (Chrome 98)'],
    [/\.findLast(Index)?\(/, 'findLast (Chrome 97)'],
    [/#[a-zA-Z_]\w*\s*(=|\()/, 'private class members (Chrome 84/91)'],
    [/\bstatic\s*\{/, 'class static blocks (Chrome 94)']
  ];

  // Check all HTML files in tempDir
  const scanDir = (dir) => {
    for (const f of readdirSync(dir)) {
      const full = path.join(dir, f);
      if (statSync(full).isDirectory()) {
        scanDir(full);
      } else if (f.endsWith('.html') || f.endsWith('.js')) {
        const code = readFileSync(full, 'utf8').replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/gm, '');
        for (const [re, what] of LATER) {
          assert.doesNotMatch(code, re, `${full}: ${what}`);
        }
      }
    }
  };

  scanDir(tempDir);
});
