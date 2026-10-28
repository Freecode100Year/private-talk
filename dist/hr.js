// The HTML Room web entry (docs/html-room/protocol.md §7), served by the site
// itself under its ordinary CSP (script-src 'self', connect-src 'self').
//   hr.html#hr1=…  opens the room in the link, connecting to this site's /hr/
//   hr.html        makes a new room: the file to send, and the link
// The room secret in the link is read first and the address bar is cleared
// at once, before anything else runs; it is never stored or sent anywhere.
const hash = location.hash;
if (hash) history.replaceState(null, '', location.pathname + location.search);

const { boot, errorScreen } = await import('./hr-room.js');
const Core = await import('./hr-core.js');

const BASE = location.pathname.replace(/[^/]*$/, '');
const socketBase = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${BASE}`;
const el = (tag, opts = {}, ...kids) => {
  const e = document.createElement(tag);
  if (opts.cls) e.className = opts.cls;
  if (opts.text !== undefined) e.textContent = opts.text;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) e.setAttribute(k, v);
  for (const k of kids) if (k) e.append(k);
  return e;
};

if (hash.startsWith(Core.FRAGMENT_PREFIX)) {
  boot({ mode: 'web', parsed: Core.configFromHash(hash), socketBase }).catch(() => errorScreen('无法打开这个房间', '页面出现了意外错误。'));
} else {
  maker();
}

// A relay address for the room file: this site, if a file opened anywhere
// can reach it (wss://, or ws:// on this machine).
function defaultRelay() {
  const r = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${BASE}`;
  return Core.checkRelay(r) ? r : '';
}

function maker() {
  document.getElementById('pt-boot')?.remove();
  const main = el('main', { attrs: { id: 'pt-app' } });
  document.body.append(main);
  const name = el('input', { attrs: { id: 'mk-name', maxlength: String(Core.MAX_NAME), placeholder: '可不填，例如：周五晚饭' } });
  const relay = el('input', { attrs: { id: 'mk-relay', value: defaultRelay(), placeholder: 'wss://chat.example.org/' } });
  const pass = el('input', { attrs: { id: 'mk-pass', autocomplete: 'off', spellcheck: 'false', placeholder: `不填则文件本身就是钥匙；填写至少 ${Core.MIN_PASS_CHARS} 个字符` } });
  const gen = el('button', { text: '随机生成', attrs: { type: 'button', id: 'mk-gen' } });
  gen.addEventListener('click', () => { pass.value = Core.randomPass(); });
  const make = el('button', { text: '创建房间', attrs: { type: 'submit', id: 'mk-make' } });
  const note = el('p', { cls: 'warn', attrs: { role: 'alert', id: 'mk-error' } });
  note.hidden = true;
  const out = el('div', { attrs: { id: 'mk-out' } });
  const form = el('form', { cls: 'card' },
    el('h1', { text: '创建 HTML 房间' }),
    el('p', { text: '生成一个只属于这个房间的 HTML 文件。收到同一个文件的人打开它，不用注册、不用输入暗号，就在同一个端到端加密的房间里。' }),
    el('label', { text: '房间名称（只显示在页面上，不发送给中继）', attrs: { for: 'mk-name' } }), name,
    el('label', { text: '中继地址（打开文件的浏览器要能连到它）', attrs: { for: 'mk-relay' } }), relay,
    el('label', { text: '打开口令（可选，建议用随机生成的）', attrs: { for: 'mk-pass' } }), el('div', { cls: 'row' }, pass, gen),
    el('p', { cls: 'fine', text: '口令的强度决定文件被转发平台截获时能否被破解：文件里有加密后的密钥，拿到文件的人可以离线反复猜口令。6 位数字几分钟内就能猜出；“随机生成”的 12 位口令约 60 位强度。口令请当面或电话告知。' }),
    make, note, out,
    el('p', { cls: 'note', text: '房间在你的浏览器里生成，密钥不会发送给本站。但生成器本身是本站下发的代码；对本站不放心，可以用项目里的命令行工具 scripts/build-html-room.mjs 在自己电脑上生成。' }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    note.hidden = true;
    out.replaceChildren();
    const relays = relay.value.split(/[\s,]+/).filter(Boolean);
    const p = pass.value.trim();
    if (p && Array.from(p).length < Core.MIN_PASS_CHARS) return fail(`打开口令至少需要 ${Core.MIN_PASS_CHARS} 个字符。`);
    if (!relays.length || !relays.every((r) => Core.checkRelay(r))) return fail('中继地址无效：需要 wss:// 开头（本机测试可用 ws://localhost）。');
    if (name.value.length > Core.MAX_NAME) return fail('房间名称过长。');
    make.disabled = true;
    make.textContent = '正在生成……';
    try {
      const config = await Core.makeConfig({ name: name.value, relays, pass: p || null });
      const template = await (await fetch('hr-template.html', { cache: 'no-store' })).text();
      const html = Core.fillTemplate(template, config);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const a = el('a', { text: '下载房间文件', attrs: { href: url, download: 'private-talk-room.html', id: 'mk-download' } });
      const link = `${location.origin}${location.pathname}${Core.fragmentFor(config)}`;
      const copy = el('button', { text: '复制网页链接', attrs: { type: 'button', id: 'mk-copy' } });
      copy.addEventListener('click', () => navigator.clipboard?.writeText(link).then(() => { copy.textContent = '已复制'; }, () => {}));
      out.append(
        el('p', { cls: p ? 'note' : 'warn', text: p ? '文件受口令保护。把文件发给对方，口令另外当面或电话告诉对方。' : '这个文件本身就是房间钥匙：拿到文件的人都能进入。请勿通过会读取文件的社交软件发送。' }),
        el('p', {}, a),
        el('p', { cls: 'fine', text: '手机打不开 HTML 文件时，可以用网页链接进入（同样包含房间钥匙，同样不要随意转发）。网页模式依赖本站下发的代码。' }),
        el('p', { cls: 'out', attrs: { id: 'mk-link' }, text: link }), copy);
    } catch {
      fail('生成失败，请重试。');
    } finally {
      make.disabled = false;
      make.textContent = '创建房间';
    }
  });
  function fail(text) { note.textContent = text; note.hidden = false; }
  main.append(form);
}
