// Builds dist/help.html from docs/manual/user.md, so the user manual is part
// of the site itself and readable on intranets with no internet access.
//   node scripts/build-help.mjs          write dist/help.html
//   node scripts/build-help.mjs --check  fail if dist/help.html is out of date
// A small Markdown subset: headings, paragraphs, lists, tables, code, links,
// bold and inline code, which is all the manual uses.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const REPO = 'https://github.com/Freecode100Year/private-talk/blob/main/docs/manual/';

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  const codes = [];
  let s = escape(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/!\[([^\]]*)\]\(images\/([\w.-]+)\)/g, '<img src="manual-images/$2" alt="$1" loading="lazy" />');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const url = /^https?:/.test(href) ? href : REPO + href;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  s = s.replace(/&lt;(https?:[^&\s]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const slug = (t) => t.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

export function render(md) {
  // Windows checkouts may have CRLF line ends; every branch below must move
  // on by at least one line, so odd input can never loop forever.
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${escape(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4}) (.+)$/);
    if (h) {
      const n = h[1].length;
      out.push(`<h${n} id="${escape(slug(h[2]))}">${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push('<table><thead><tr>' + cells(head).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    const list = line.match(/^\s*(-|\d+\.) /);
    if (list) {
      const ordered = list[1] !== '-';
      const items = [];
      for (; i < lines.length && /^\s*(-|\d+\.) /.test(lines[i]); i++) {
        let item = lines[i].replace(/^\s*(-|\d+\.) /, '');
        while (i + 1 < lines.length && /^ {2,}\S/.test(lines[i + 1]) && !/^\s*(-|\d+\.) /.test(lines[i + 1])) item += ' ' + lines[++i].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (line.startsWith('>')) {
      const body = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++) body.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
      continue;
    }
    // A paragraph: this line, whatever it starts with, and the plain lines after it.
    const para = [lines[i++].trim()];
    for (; i < lines.length && lines[i].trim() && !/^(#{1,4} |```|\||\s*-\s|\s*\d+\.\s|>)/.test(lines[i]); i++) para.push(lines[i].trim());
    out.push(`<p>${inline(para.join(''))}</p>`);
  }
  return out.join('\n');
}

export function page() {
  const md = readFileSync(new URL('docs/manual/user.md', root), 'utf8');
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="referrer" content="no-referrer" />
    <title>使用说明 · 隐匿对话</title>
    <link rel="stylesheet" href="help.css" />
  </head>
  <body>
    <!-- Generated from docs/manual/user.md by scripts/build-help.mjs. Do not edit. -->
    <nav><a href="./">← 返回隐匿对话</a></nav>
    <main>
${render(md)}
    </main>
  </body>
</html>
`;
}

// Screenshots used by the manual are served from dist/manual-images/.
export function imagesInSync() {
  const src = new URL('docs/manual/images/', root);
  const dst = new URL('dist/manual-images/', root);
  return readdirSync(src).every((f) => {
    try { return readFileSync(new URL(f, dst)).equals(readFileSync(new URL(f, src))); } catch { return false; }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = new URL('dist/help.html', root);
  const html = page();
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== html || !imagesInSync()) { console.error('dist/help.html is out of date: run node scripts/build-help.mjs'); process.exit(1); }
  } else {
    writeFileSync(target, html);
    const dst = new URL('dist/manual-images/', root);
    mkdirSync(dst, { recursive: true });
    for (const f of readdirSync(new URL('docs/manual/images/', root))) copyFileSync(new URL(`docs/manual/images/${f}`, root), new URL(f, dst));
  }
}
