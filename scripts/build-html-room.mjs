// HTML Room builder (docs/html-room/protocol.md §5).
//
//   node scripts/build-html-room.mjs template [--check]
//       Bundles the client into one inline script, computes the CSP hashes and
//       writes dist/hr-template.html. --check fails if the file is not up to
//       date (CI). The script and style are the same in every room file, so
//       their SHA-256 is printed and recorded in docs/html-room/hashes.json.
//
//   node scripts/build-html-room.mjs room --relay wss://chat.example.org [--relay …]
//        [--name 名称] [--random-pass | --pass-env VAR] [--out room.html] [--web https://site/]
//       Makes one room: a new 256-bit secret (locked under an opening
//       passphrase if asked), the room file, and optionally the #hr1= link
//       for the web entry. The passphrase is printed only when it was
//       generated here. Nothing about the room is written anywhere else.
//
// No bundler dependency: the client is a handful of this project's own ES
// modules, each inlined as a function scope, with their imports and exports
// rewritten. Anything the rewriter does not recognise stops the build.
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
export const ENTRY = 'hr-file.js';
export const TEMPLATE = join(DIST, 'hr-template.html');
export const HASHES = join(ROOT, 'docs/html-room/hashes.json');

const sha256b64 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');

// ---- the module inliner ---------------------------------------------------------

const IMPORT = /^import\s+(?:\{([^}]*)\}|\*\s+as\s+([A-Za-z_$][\w$]*))\s+from\s+'(\.[^']+)';[ \t]*$/gm;
const EXPORT_DECL = /^export\s+((?:async\s+)?function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\};?[ \t]*$/gm;

function rewrite(code, file) {
  const deps = [];
  const names = [];
  let out = code.replace(IMPORT, (_, list, star, from) => {
    const dep = normalize(join(dirname(file), from)).split(sep).join('/');
    deps.push(dep);
    if (star) return `const ${star} = __m[${JSON.stringify(dep)}];`;
    const parts = list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!m) throw new Error(`${file}: cannot read import "${s}"`);
      return m[2] ? `${m[1]}: ${m[2]}` : m[1];
    });
    return `const { ${parts.join(', ')} } = __m[${JSON.stringify(dep)}];`;
  });
  out = out.replace(EXPORT_DECL, (_, kind, name) => { names.push([name, name]); return `${kind} ${name}`; });
  out = out.replace(EXPORT_LIST, (_, list) => {
    for (const s of list.split(',').map((x) => x.trim()).filter(Boolean)) {
      const m = s.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!m) throw new Error(`${file}: cannot read export "${s}"`);
      names.push([m[2] ?? m[1], m[1]]);
    }
    return '';
  });
  if (/^\s*(import|export)\b/m.test(out)) throw new Error(`${file}: an import or export the builder does not understand`);
  const ret = names.map(([as, local]) => (as === local ? local : `${as}: ${local}`)).join(', ');
  return { deps, body: `${out}\nreturn { ${ret} };` };
}

// bundle(entry): one classic script. Modules run in dependency order, each in
// its own function scope (two modules may both have a `hex`, say).
export function bundle(entry = ENTRY) {
  const order = [];
  const seen = new Map();
  const visit = (file, stack = []) => {
    if (stack.includes(file)) throw new Error(`import cycle: ${[...stack, file].join(' → ')}`);
    if (seen.has(file)) return;
    const r = rewrite(readFileSync(join(DIST, file), 'utf8'), file);
    seen.set(file, r);
    for (const d of r.deps) visit(d, [...stack, file]);
    order.push(file);
  };
  visit(entry);
  const parts = order.map((f) => `__m[${JSON.stringify(f)}] = (() => {\n${seen.get(f).body}\n})();`);
  const js = `(() => {\n'use strict';\nconst __m = Object.create(null);\n${parts.join('\n')}\n})();\n`;
  // Nothing in the script may end or confuse its block.
  if (/<\/script|<!--|<script/i.test(js)) throw new Error('the bundle contains text that would end its <script> block');
  return { js, modules: order };
}

// ---- the template -----------------------------------------------------------------

export function buildTemplate() {
  const { MARK_CONNECT, MARK_CONFIG } = loadCore();
  const { js, modules } = bundle();
  const css = readFileSync(join(DIST, 'hr.css'), 'utf8');
  if (/<\/style/i.test(css)) throw new Error('hr.css contains </style');
  if (js.includes(MARK_CONNECT) || js.includes(MARK_CONFIG) || css.includes(MARK_CONNECT) || css.includes(MARK_CONFIG)) throw new Error('a template marker appears in the script or style');
  const scriptHash = sha256b64(js);
  const styleHash = sha256b64(css);
  const csp = [
    "default-src 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
    "frame-src 'none'", "worker-src 'none'", "manifest-src 'none'", "media-src 'none'",
    "img-src 'none'", "font-src 'none'",
    `connect-src ${MARK_CONNECT}`,
    `style-src 'sha256-${styleHash}'`, `script-src 'sha256-${scriptHash}'`
  ].join('; ');
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>隐匿对话 · 房间</title>
<style>${css}</style>
</head>
<body>
<div id="pt-boot"><p>正在打开加密聊天室……</p><p>如果这段文字一直不消失，说明当前打开方式不能运行本页面。请用系统浏览器（Chrome、Edge、Firefox、Safari）打开这个文件；如果仍然不行，请向房间创建者索取网页版链接。</p></div>
<script id="pt-room-config" type="application/json">${MARK_CONFIG}</script>
<script>${js}</script>
</body>
</html>
`;
  return { html, scriptHash, styleHash, modules, bytes: Buffer.byteLength(html) };
}

const core = await import(new URL('../dist/hr-core.js', import.meta.url));
const loadCore = () => core;

// ---- command line -----------------------------------------------------------------

function args(list) {
  const out = { relay: [] };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '--relay') out.relay.push(list[++i]);
    else if (a === '--name') out.name = list[++i];
    else if (a === '--out') out.out = list[++i];
    else if (a === '--web') out.web = list[++i];
    else if (a === '--pass-env') out.passEnv = list[++i];
    else if (a === '--random-pass') out.randomPass = true;
    else if (a === '--check') out.check = true;
    else throw new Error(`unknown option ${a}`);
  }
  return out;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = args(rest);
  if (cmd === 'template') {
    const t = buildTemplate();
    const record = JSON.stringify({ protocol: 'hr1', script: `sha256-${t.scriptHash}`, style: `sha256-${t.styleHash}`, modules: t.modules }, null, 2) + '\n';
    if (o.check) {
      let ok = true;
      try { ok = readFileSync(TEMPLATE, 'utf8') === t.html && readFileSync(HASHES, 'utf8') === record; } catch { ok = false; }
      if (!ok) { console.error('dist/hr-template.html is out of date: run node scripts/build-html-room.mjs template'); process.exit(1); }
      console.log(`hr-template.html up to date · script sha256-${t.scriptHash}`);
      return;
    }
    writeFileSync(TEMPLATE, t.html);
    mkdirSync(dirname(HASHES), { recursive: true });
    writeFileSync(HASHES, record);
    console.log(`wrote ${relative(ROOT, TEMPLATE)} (${t.bytes} bytes)`);
    console.log(`script sha256-${t.scriptHash}`);
    console.log(`style  sha256-${t.styleHash}`);
    return;
  }
  if (cmd === 'room') {
    if (!o.relay.length) throw new Error('at least one --relay wss://… is needed');
    let pass = null;
    if (o.randomPass) pass = core.randomPass();
    else if (o.passEnv) {
      pass = process.env[o.passEnv];
      if (!pass) throw new Error(`environment variable ${o.passEnv} is empty`);
      if (Array.from(pass).length < core.MIN_PASS_CHARS) throw new Error(`the opening passphrase needs at least ${core.MIN_PASS_CHARS} characters`);
    }
    const config = await core.makeConfig({ name: o.name ?? '', relays: o.relay, pass });
    const template = readFileSync(TEMPLATE, 'utf8');
    const html = core.fillTemplate(template, config);
    const out = o.out ?? 'room.html';
    writeFileSync(out, html);
    console.log(`wrote ${out} (${Buffer.byteLength(html)} bytes)${pass ? ', locked' : ''}`);
    if (o.randomPass) console.log(`opening passphrase: ${pass}   (tell it by voice or in person, not in the same app as the file)`);
    if (!pass) console.log('this file holds the whole room key: do not send it through an app that can read files');
    if (o.web) {
      const base = new URL('hr.html', o.web.endsWith('/') ? o.web : `${o.web}/`);
      console.log(`web link: ${base.href}${core.fragmentFor(config)}`);
    }
    return;
  }
  console.error('usage: build-html-room.mjs template [--check] | room --relay wss://… [--name …] [--random-pass | --pass-env VAR] [--out file] [--web https://site/]');
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
