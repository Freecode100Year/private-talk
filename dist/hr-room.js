// HTML Room client (docs/html-room/protocol.md). One module for both ways
// in: the room file (hr-file.js, every script inline, CSP by hash) and the
// #hr1= web entry (hr.js). Inside the room it is protocol v3.2 exactly as
// app.js runs it: Group (group.js) for keys and messages, checkEnvelope and
// checkKeys (state.js) for sender, age and replays. What differs: the keys
// come from a Master Secret (hr-core.js), frames sealed with the room key
// carry an AAD naming the room, the sender and the kind of frame, only
// signed v3.2 messages are accepted, and own messages show their delivery
// state step by step.
//
// The page is built with createElement and textContent only: no HTML is ever
// parsed from a string, no inline styles or handlers (the CSP allows neither).
import { Group } from './group.js';
import { envelope, checkEnvelope, checkKeys, newSeen, checkMessage, badge, MAX_SKEW } from './state.js';
import {
  checkEnvironment, ENV_MESSAGE, parseConfigText, secretOf, unlockSecret, deriveHrRoom, relaySocketUrl,
  sealFrame, openFrame, Delivery, MAX_NAME
} from './hr-core.js';

const CLOSE_LEFT = 4000, CLOSE_FULL = 4001, CLOSE_LOCKED = 4002, CLOSE_BUSY = 4003, CLOSE_REPLACED = 4005, CLOSE_REMOVED = 4006, CLOSE_DENIED = 4007, CLOSE_CAPACITY = 4008;
const CLOSE_RESTART = 1012;
const PING = '{"type":"ping"}';
const ACK_WAIT = 8000;       // a sent message should come back from the relay within this
const KEYS_WAIT = 8000;      // how long a message waits for keys to be exchanged
const HEARTBEAT = 25000;
const SILENCE = 60000;
const SEEN_EVERY = 1500, SEEN_MAX = 60;
const HELD_MAX = 20, HELD_MS = 30000;

const TEXT = {
  fileOpen: '此文件包含完整房间密钥：任何拿到这个文件的人都能进入房间、看到之后的消息。请勿通过未加密的社交软件（微信、QQ、邮箱等）直接发送。',
  fileLocked: '此文件受打开口令保护。口令请当面或电话告知，不要和文件通过同一个软件发送。',
  web: '网页模式依赖当前网页提供方交付的客户端代码；如需减少对网页提供方的信任，请使用经过验证的离线客户端。',
  memory: '本页面不保存聊天记录，关闭或刷新即清除。在线成员列表是尽力而为的信息。',
  denied: '中继拒绝了这个房间的进入凭证：文件可能已被改动，或中继不是这个房间配置的那一个。',
  full: '房间已满（最多 25 人）。',
  locked: '房间已被房主锁定，暂时不能进入。',
  busy: '加入过于频繁，请稍后再试。',
  capacity: '中继当前连接数已满，请稍后再试。',
  removed: '你已被房主移出房间。',
  replaced: '这个房间在另一个标签页或设备上用同一身份重新连接了，本页已断开。',
  oldRelay: '这个中继不支持 HTML Room（缺少 /hr/ 路径或协议版本过旧）。',
  left: '你已离开房间。本页面没有保存任何内容。'
};

// ---- DOM helpers ---------------------------------------------------------------

function el(tag, opts = {}, ...children) {
  const e = document.createElement(tag);
  if (opts.cls) e.className = opts.cls;
  if (opts.text !== undefined) e.textContent = opts.text;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) {
    if (/^on/i.test(k) || k === 'style') throw new Error('not allowed');
    e.setAttribute(k, v);
  }
  for (const c of children) if (c) e.append(c);
  return e;
}

let root = null;
function screen(...children) {
  root.replaceChildren(...children);
}

function shell() {
  document.getElementById('pt-boot')?.remove();
  root = document.getElementById('pt-app');
  if (!root) {
    root = el('main', { attrs: { id: 'pt-app' } });
    document.body.append(root);
  }
}

export function errorScreen(title, detail, action) {
  screen(el('section', { cls: 'card' },
    el('h1', { text: title }),
    detail ? el('p', { text: detail }) : null,
    action ?? null));
}

// ---- boot ------------------------------------------------------------------------

// source: { mode: 'file' | 'web', text?: string (file), parsed?: result (web), socketBase?: string (web) }
export async function boot(source) {
  shell();
  const parsed = source.parsed ?? parseConfigText(source.text);
  const locked = parsed?.ok && !!parsed.config.lock;
  const env = await checkEnvironment(globalThis, { pbkdf2: locked });
  if (!env.ok) {
    errorScreen('无法打开加密聊天室', ENV_MESSAGE, el('p', { cls: 'fine', text: `缺少：${env.missing.join('、')}` }));
    return { error: 'env', missing: env.missing };
  }
  if (!parsed?.ok) {
    errorScreen('无法打开这个房间', parsed?.message ?? '房间配置缺失。');
    return { error: parsed?.code ?? 'missing' };
  }
  const config = parsed.config;
  if (!locked) return enter(source, config, secretOf(config));
  return unlockScreen(source, config);
}

function unlockScreen(source, config) {
  const input = el('input', { attrs: { type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', id: 'pt-pass', 'aria-label': '打开口令' } });
  const note = el('p', { cls: 'warn', attrs: { role: 'alert' } });
  note.hidden = true;
  const button = el('button', { text: '解锁并进入', attrs: { type: 'submit' } });
  const form = el('form', { cls: 'card', attrs: { id: 'pt-unlock' } },
    el('h1', { text: roomTitle(config) }),
    el('p', { text: '这个房间文件受打开口令保护。请输入房间创建者另行告诉你的口令。' }),
    input, button, note,
    el('p', { cls: 'fine', text: TEXT.fileLocked }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    note.hidden = true;
    button.textContent = '正在解锁……';
    const ms = await unlockSecret(config, input.value);
    if (!ms) {
      button.disabled = false;
      button.textContent = '解锁并进入';
      note.textContent = '口令不正确，或文件已被改动。';
      note.hidden = false;
      input.select();
      return;
    }
    input.value = '';
    enter(source, config, ms);
  });
  screen(form);
  input.focus();
  return { locked: true };
}

const roomTitle = (config) => (config.name ? config.name.slice(0, MAX_NAME) : '未命名房间');

async function enter(source, config, ms) {
  const keys = await deriveHrRoom(ms);
  ms.fill(0);
  const sockets = source.mode === 'web'
    ? [`${source.socketBase}hr/${keys.roomId}`]
    : config.relays.map((r) => relaySocketUrl(r, keys.roomId));
  const room = new Room({ source, config, keys, sockets });
  room.start();
  return { room };
}

// ---- the room ------------------------------------------------------------------------

class Room {
  constructor({ source, config, keys, sockets }) {
    Object.assign(this, { source, config, sockets });
    this.key = keys.key;
    this.bind = keys.bind;
    this.roomId = keys.roomId;
    this.access = keys.access;
    this.relay = 0;
    this.failedRelays = new Set();
    this.you = 0;
    this.resume = null;
    this.group = null;
    this.present = null;
    this.ws = null;
    this.session = 0;
    this.joinedOnce = false;
    this.retries = 0;
    this.seen = newSeen();
    this.own = new Map();        // chain position → { plain, d: Delivery, row }
    this.early = new Map();      // chain position → Set of members whose receipt came first
    this.held = [];
    this.seenQueue = [];
    this.keysHello = false;
    this.keysSentAt = 0;
    this.lastHeard = 0;
    this.askedKeysAt = 0;
    this.lastBad = 0;
    this.verified = false;
  }

  // ---- screen ----
  start() {
    const c = this.config;
    const banner = this.source.mode === 'web' ? TEXT.web : c.lock ? TEXT.fileLocked : TEXT.fileOpen;
    this.ui = {
      title: el('h1', { text: roomTitle(c) }),
      status: el('span', { cls: 'status', attrs: { id: 'pt-status', role: 'status' }, text: '正在准备密钥……' }),
      members: el('ul', { cls: 'members', attrs: { id: 'pt-members', 'aria-label': '在线成员' } }),
      safety: el('p', { cls: 'safety', attrs: { id: 'pt-safety' } }),
      log: el('ol', { cls: 'log', attrs: { id: 'pt-log', 'aria-live': 'polite' } }),
      input: el('textarea', { attrs: { id: 'pt-input', rows: '2', maxlength: '2000', placeholder: '输入消息，回车发送（Shift+回车换行）', 'aria-label': '消息' } }),
      send: el('button', { text: '发送', attrs: { id: 'pt-send', type: 'submit' } }),
      leave: el('button', { cls: 'quiet', text: '离开', attrs: { id: 'pt-leave', type: 'button' } })
    };
    this.ui.safety.hidden = true;
    const form = el('form', { cls: 'compose', attrs: { id: 'pt-compose' } }, this.ui.input, this.ui.send);
    form.addEventListener('submit', (e) => { e.preventDefault(); this.sendFromInput(); });
    this.ui.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.sendFromInput(); }
    });
    this.ui.leave.addEventListener('click', () => this.leave());
    screen(el('section', { cls: 'room' },
      el('header', {}, el('div', { cls: 'top' }, this.ui.title, this.ui.leave), this.ui.status),
      el('p', { cls: this.source.mode === 'file' && !c.lock ? 'warn' : 'note', attrs: { id: 'pt-banner' }, text: banner }),
      el('details', { cls: 'side' }, el('summary', { text: '成员与安全码' }), this.ui.members, this.ui.safety,
        el('p', { cls: 'fine', text: TEXT.memory })),
      this.ui.log,
      form));
    this.timers = [
      setInterval(() => this.heartbeat(), HEARTBEAT),
      setInterval(() => this.sweep(), 5000),
      setInterval(() => this.scheduledRekey(), 30000)
    ];
    this.connect();
  }

  setStatus(text, ok = false) {
    this.ui.status.textContent = text;
    this.ui.status.classList.toggle('ok', ok);
  }

  system(text) {
    this.ui.log.append(el('li', { cls: 'sys', text }));
    this.scroll();
  }

  scroll() { this.ui.log.scrollTop = this.ui.log.scrollHeight; }

  bubble(from, at, text, mine) {
    const time = new Date(Number.isFinite(at) ? at : Date.now());
    const meta = el('span', { cls: 'meta', text: `${mine ? '你' : badge(from)} · ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}` });
    const body = el('span', { cls: 'text', text });
    const state = mine ? el('span', { cls: 'state' }) : null;
    const row = el('li', { cls: mine ? 'msg mine' : 'msg' }, meta, body, state);
    if (!mine) row.dataset.from = String(from);
    this.ui.log.append(row);
    this.scroll();
    return row;
  }

  showDelivery(entry) {
    const s = entry.row.querySelector('.state');
    s.textContent = entry.d.label() + (entry.d.state === 'failed' && entry.d.reason ? `：${entry.d.reason}` : '');
    entry.row.dataset.state = entry.d.state;
  }

  renderMembers() {
    const list = this.present ?? [];
    this.ui.members.replaceChildren(...list.map((n) => el('li', { text: n === this.you ? `${badge(n)}（你）` : badge(n) })));
  }

  async showSafety() {
    const g = this.group, present = this.present;
    const ready = g && present && present.length > 1 && present.every((n) => n === this.you || g.peers.get(n)?.recv);
    if (!ready) { this.ui.safety.hidden = true; return; }
    const code = await g.safetyCode(present);
    if (g !== this.group) return;
    const pq = g.quantumSafe(present) ? ' · 含抗量子 ML-KEM' : '';
    this.ui.safety.textContent = `安全码 ${code}${pq}。通过电话或当面与其他成员核对：一致说明没有人被调包。`;
    this.ui.safety.hidden = false;
  }

  // ---- connection ----
  connect() {
    clearTimeout(this.retryTimer);
    const url = this.sockets[this.relay];
    this.setStatus(this.joinedOnce ? '正在重新连接……' : '正在连接中继……');
    let opened = false;
    const protocols = ['pt2', `a${this.access}`, ...(this.resume ? [`r${this.resume}`] : [])];
    let sock;
    try { sock = new WebSocket(url, protocols); } catch { return this.connectFailed(url); }
    this.ws = sock;
    this.lastHeard = Date.now();
    const session = this.session;
    let queue = Promise.resolve();
    sock.onopen = () => { opened = true; };
    sock.onmessage = (e) => {
      if (this.ws !== sock) return;
      this.lastHeard = Date.now();
      queue = queue.then(() => this.handle(e.data, sock, session)).catch(() => {});
    };
    sock.onclose = (e) => {
      if (this.ws !== sock) return;
      const code = e.code;
      const stops = { [CLOSE_FULL]: TEXT.full, [CLOSE_BUSY]: TEXT.busy, [CLOSE_REMOVED]: TEXT.removed, [CLOSE_DENIED]: TEXT.denied, [CLOSE_CAPACITY]: TEXT.capacity, [CLOSE_REPLACED]: TEXT.replaced };
      if (stops[code]) return this.stop(stops[code]);
      if (code === CLOSE_LOCKED) {
        if (!this.joinedOnce) return this.stop(TEXT.locked);
        this.setStatus('房间已锁定，等待重新进入……');
        return this.retry(10000);
      }
      if (code === CLOSE_RESTART) { this.system('中继正在重启，稍后自动重连。'); return this.retry(3000); }
      if (!opened) return this.connectFailed(url);
      if (code === 1008) this.system('发送过快，连接被中继断开，正在重连。');
      else this.system('连接中断，正在重连……');
      this.retry(Math.min(15000, 1000 * 2 ** this.retries++));
    };
  }

  // The connection never opened: the relay is down, unreachable, or (for a
  // self-hosted wss://) its certificate is not trusted, which the browser
  // does not tell the page. Try the next relay, if there is one.
  connectFailed(url) {
    if (!this.failedRelays.has(url)) {
      this.failedRelays.add(url);
      const host = (() => { try { return new URL(url).host; } catch { return url; } })();
      let hint = `无法连接中继 ${host}。`;
      if (url.startsWith('wss://')) hint += `如果这是局域网或自建的中继、使用自签名证书，请先在浏览器新标签页打开 https://${host}/ 并选择信任该证书，然后回到本页面；也可以改用有有效证书的域名。`;
      if (this.sockets.length > 1) hint += '正在尝试下一个中继。';
      this.system(hint);
    }
    this.relay = (this.relay + 1) % this.sockets.length;
    this.retry(Math.min(15000, 1000 * 2 ** this.retries++));
  }

  retry(delay) {
    this.setStatus('连接已断开，等待重连……');
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), delay * (0.75 + Math.random() * 0.5));
  }

  stop(text) {
    this.setStatus(text);
    this.system(text);
    this.ws = null;
    this.present = null;
    this.renderMembers();
    this.ui.safety.hidden = true;
    for (const entry of this.own.values()) if (entry.d.state === 'queued' || entry.d.state === 'sending') { entry.d.failed('连接已结束'); this.showDelivery(entry); }
  }

  heartbeat() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastHeard > SILENCE) {
      this.system('很久没有收到中继的消息，正在重新连接。');
      this.connect();
      try { ws.close(); } catch {}
      return;
    }
    try { ws.send(PING); } catch {}
  }

  current(sock, session) { return this.ws === sock && this.session === session; }

  // ---- frames in ----
  async handle(data, sock, session, again = false) {
    const ok = () => this.current(sock, session);
    if (!ok()) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      if (msg.hr !== 1 || msg.v !== 3) {
        try { sock.close(CLOSE_LEFT); } catch {}
        return this.stop(TEXT.oldRelay);
      }
      const before = this.you;
      this.you = msg.you;
      this.resume = typeof msg.resume === 'string' ? msg.resume : null;
      this.retries = 0;
      this.present = null;
      this.setStatus('已连接，正在交换密钥……');
      if (!this.joinedOnce) this.system(`已进入房间，你是 ${badge(this.you)}。消息端到端加密，中继只转发密文。`);
      else if (before !== this.you) this.system(`已重新连接，你现在是 ${badge(this.you)}。`);
      else this.system('已重新连接。');
      if (!this.joinedOnce && typeof msg.now === 'number' && Math.abs(msg.now - Date.now()) > MAX_SKEW / 2) {
        this.system(`本机时钟与中继相差约 ${Math.round(Math.abs(msg.now - Date.now()) / 60000)} 分钟：消息按本机时间检查，时钟偏差过大时可能被拒收。`);
      }
      this.joinedOnce = true;
      if (!this.group || this.group.me !== this.you) {
        this.group = await Group.create(this.key, this.bind, this.you);
        this.early.clear();
        this.seenQueue = [];
      } else await this.group.rekey();
      if (!ok()) return;
      this.sendKeys(true);
    } else if (msg.type === 'members' && Array.isArray(msg.members)) {
      const list = msg.members.filter((n) => Number.isInteger(n));
      const g = this.group;
      const gone = g ? [...g.peers.keys()].filter((n) => !list.includes(n)) : [];
      for (const n of gone) g.forget(n);
      if (gone.length) await g.rekey();
      if (!ok()) return;
      const was = this.present;
      this.present = list;
      if (was) {
        for (const n of list) if (!was.includes(n) && n !== this.you) this.system(`${badge(n)} 进入了房间。`);
        for (const n of was) if (!list.includes(n) && n !== this.you) this.system(`${badge(n)} 离开了房间（或暂时断线）。`);
      }
      this.renderMembers();
      this.sendKeys(false);
      this.updateReady();
    } else if (msg.type === 'key') {
      const g = this.group;
      if (!g || msg.from === this.you || !Number.isInteger(msg.from)) return;
      try {
        const plain = await openFrame(this.key, this.roomId, 'key', msg.from, msg);
        const a = checkKeys(plain, msg, this.seen, Date.now());
        if (!ok() || !a) return;
        const peer = await g.receive(a, msg.from);
        if (peer?.lost) this.askForKeys();
      } catch { return this.bad(); }
      if (!ok()) return;
      for (const n of g.takeChanged()) this.system(`${badge(n)} 的签名密钥变了：可能换了设备或页面，请重新核对安全码。`);
      const ready = this.held.filter((h) => h.from === msg.from);
      this.held = this.held.filter((h) => h.from !== msg.from);
      for (const h of ready) await this.handle(h.data, h.sock, h.session, true);
      this.sendKeys(false);
      this.updateReady();
    } else if (msg.type === 'msg') {
      await this.gotMessage(msg, data, sock, session, again);
    } else if (msg.type === 'seen') {
      if (msg.from === this.you || !Number.isInteger(msg.from)) return;
      try {
        const plain = await openFrame(this.key, this.roomId, 'seen', msg.from, msg);
        const r = checkKeys(plain, msg, this.seen, Date.now(), 'seen');
        if (ok() && r && r.v === 'hr1' && Array.isArray(r.l)) this.gotSeen(msg.from, r.l);
      } catch { this.bad(); }
    } else if (msg.type === 'wait') {
      const ms = Math.min(60000, Math.max(500, Number(msg.ms) || 6000));
      const p = this.pending;
      if (p && p.sock === sock && sock.readyState === WebSocket.OPEN) {
        // Sealed already (its place in the chain is taken): the same frame again.
        clearTimeout(p.timer);
        p.timer = setTimeout(() => this.resend(p), ms);
        this.system(`发送太快，${Math.ceil(ms / 1000)} 秒后自动重发。`);
      }
    } else if (msg.type === 'lock') {
      this.system(msg.locked ? '房主锁定了房间：新成员暂时不能进入。' : '房主解除了房间锁定。');
    } else if (msg.type === 'removed' && Number.isInteger(msg.n)) {
      this.system(`${badge(msg.n)} 被房主移出了房间。`);
    }
  }

  async gotMessage(msg, data, sock, session, again) {
    if (!Number.isInteger(msg.from) || typeof msg.h !== 'string') return this.bad();
    if (msg.from === this.you) {
      // This page's own message back from the relay: it is on its way to everyone.
      const entry = this.own.get(msg.h);
      if (!entry || !checkEnvelope(entry.plain, msg, this.seen, Date.now())) return;
      if (this.pending?.h === msg.h) { clearTimeout(this.pending.timer); this.pending = null; }
      entry.d.relayed();
      for (const n of this.early.get(msg.h) ?? []) entry.d.ack(n);
      this.early.delete(msg.h);
      this.showDelivery(entry);
      return;
    }
    const g = this.group;
    let opened;
    try {
      if (!g) throw new Error('no key');
      opened = await g.open(msg, msg.from);
    } catch (e) {
      if (!this.current(sock, session)) return;
      if (!again && /no key|out of step/.test(e?.message)) {
        this.held.push({ data, from: msg.from, sock, session, at: Date.now() });
        if (this.held.length > HELD_MAX) { this.held.shift(); this.bad(); }
        this.askForKeys();
        return;
      }
      return this.bad();
    }
    if (!this.current(sock, session)) return;
    // HTML Room pages are all 3.2: an unsigned message is never theirs.
    if (!opened.signed) return this.bad();
    const got = checkEnvelope(opened.text, msg, this.seen, Date.now());
    if (!got || got.g || got.f || got.q !== undefined) return this.bad();
    if (opened.missed) this.system(`${badge(msg.from)} 有 ${opened.missed} 条消息没有送到这里。`);
    this.bubble(msg.from, msg.at, got.text, false);
    this.queueSeen(msg.from, msg.h);
  }

  bad() {
    if (Date.now() - this.lastBad > 10000) this.system('收到一条无法验证的消息，已丢弃。');
    this.lastBad = Date.now();
  }

  sweep() {
    const now = Date.now();
    if (this.held.some((h) => now - h.at > HELD_MS)) this.bad();
    this.held = this.held.filter((h) => now - h.at <= HELD_MS && h.sock === this.ws);
  }

  async scheduledRekey() {
    const g = this.group;
    if (g && this.ws?.readyState === WebSocket.OPEN && g.due()) { await g.rekey(); if (this.group === g) this.sendKeys(false); }
  }

  // ---- keys ----
  askForKeys() {
    if (Date.now() - this.askedKeysAt > 3000) { this.askedKeysAt = Date.now(); this.sendKeys(true); }
  }

  sendKeys(hello) {
    if (hello) this.keysHello = true;
    clearTimeout(this.keysTimer);
    this.keysTimer = setTimeout(async () => {
      this.keysSentAt = Date.now();
      const g = this.group, sock = this.ws, session = this.session;
      if (!g || !sock || sock.readyState !== WebSocket.OPEN || (!this.present && !this.keysHello)) return;
      const to = g.owed(this.present ?? []);
      if (!to.length && !this.keysHello) return;
      const hi = this.keysHello;
      this.keysHello = false;
      const frames = [];
      for (const plain of await g.announceAll(to, hi)) {
        frames.push(JSON.stringify({ type: 'key', ...(await sealFrame(this.key, this.roomId, 'key', this.you, plain)) }));
      }
      if (session !== this.session || this.ws !== sock || this.group !== g || sock.readyState !== WebSocket.OPEN) return;
      for (const f of frames) sock.send(f);
      this.updateReady();
    }, Math.max(150, this.keysSentAt + 1000 - Date.now()));
  }

  updateReady() {
    const g = this.group, present = this.present;
    if (!g || !present) return;
    const others = present.filter((n) => n !== this.you);
    const all = others.every((n) => g.peers.get(n)?.recv) && g.ready(present, true);
    if (!others.length) this.setStatus('已连接 · 房间里暂时只有你', true);
    else if (all) this.setStatus(`已连接 · ${present.length} 人在线 · 端到端加密已就绪`, true);
    else this.setStatus(`已连接 · ${present.length} 人在线 · 正在交换密钥……`);
    this.showSafety();
  }

  // ---- receipts (protocol.md §4.3) ----
  queueSeen(from, h) {
    this.seenQueue.push([from, h]);
    if (!this.seenTimer) this.seenTimer = setTimeout(() => this.flushSeen(), SEEN_EVERY);
  }

  async flushSeen() {
    this.seenTimer = null;
    const sock = this.ws;
    const list = this.seenQueue.splice(0, SEEN_MAX);
    if (this.seenQueue.length) this.seenTimer = setTimeout(() => this.flushSeen(), SEEN_EVERY);
    if (!list.length || !sock || sock.readyState !== WebSocket.OPEN) return;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    const plain = JSON.stringify({ kind: 'seen', v: 'hr1', id, from: this.you, t: Date.now(), l: list });
    const frame = JSON.stringify({ type: 'seen', ...(await sealFrame(this.key, this.roomId, 'seen', this.you, plain)) });
    if (this.ws === sock && sock.readyState === WebSocket.OPEN) sock.send(frame);
  }

  gotSeen(from, list) {
    for (const item of list.slice(0, SEEN_MAX)) {
      if (!Array.isArray(item) || item[0] !== this.you || typeof item[1] !== 'string') continue;
      const entry = this.own.get(item[1]);
      // Counted once the relay has echoed the message; before that, kept.
      if (entry && entry.d.state !== 'sending' && entry.d.state !== 'queued') { if (entry.d.ack(from)) this.showDelivery(entry); continue; }
      if (entry) entry.d.ack(from);
      if (!this.early.has(item[1])) this.early.set(item[1], new Set());
      this.early.get(item[1]).add(from);
      while (this.early.size > 50) this.early.delete(this.early.keys().next().value);
    }
  }

  // ---- sending ----
  sendFromInput() {
    const text = checkMessage(this.ui.input.value);
    if (!text) {
      if (this.ui.input.value.trim()) this.system('消息过长：最多 500 字。');
      return;
    }
    this.ui.input.value = '';
    this.send(text);
  }

  async send(text) {
    const d = new Delivery();
    const row = this.bubble(this.you, Date.now(), text, true);
    const entry = { plain: null, d, row };
    this.showDelivery(entry);
    // Queued until connected and every member present holds this page's chain.
    const until = Date.now() + KEYS_WAIT;
    const ready = () => this.group && this.present && this.ws?.readyState === WebSocket.OPEN && this.group.ready(this.present, true);
    while (!ready() && Date.now() < until && this.ws) await new Promise((r) => setTimeout(r, 100));
    if (!ready()) {
      d.failed(this.ws?.readyState === WebSocket.OPEN ? '与其他成员的密钥交换尚未完成，请稍后重发' : '尚未连接到中继');
      return this.showDelivery(entry);
    }
    const g = this.group, sock = this.ws;
    const plain = envelope(this.you, text);
    const out = await g.seal(plain);
    entry.plain = plain;
    d.sealed(this.present.filter((n) => n !== this.you));
    this.own.set(out.h, entry);
    while (this.own.size > 50) this.own.delete(this.own.keys().next().value);
    row.dataset.h = out.h;
    if (g.due()) { await g.rekey(); this.sendKeys(false); }
    const frame = JSON.stringify({ type: 'msg', iv: out.iv, ct: out.ct, h: out.h });
    if (sock.readyState !== WebSocket.OPEN || this.ws !== sock) { d.failed('连接已断开'); return this.showDelivery(entry); }
    sock.send(frame);
    this.showDelivery(entry);
    const p = { h: out.h, frame, sock, entry };
    if (this.pending) { clearTimeout(this.pending.timer); }
    this.pending = p;
    p.timer = setTimeout(() => this.noEcho(p), ACK_WAIT);
  }

  resend(p) {
    if (this.pending !== p) return;
    if (this.ws !== p.sock || p.sock.readyState !== WebSocket.OPEN) { this.noEcho(p); return; }
    p.sock.send(p.frame);
    p.timer = setTimeout(() => this.noEcho(p), ACK_WAIT);
  }

  noEcho(p) {
    if (this.pending === p) this.pending = null;
    if (p.entry.d.state === 'sending') { p.entry.d.failed('中继没有回传这条消息'); this.showDelivery(p.entry); }
  }

  // ---- leaving ----
  leave() {
    this.session++;
    clearTimeout(this.retryTimer);
    clearTimeout(this.keysTimer);
    clearTimeout(this.seenTimer);
    for (const t of this.timers) clearInterval(t);
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(CLOSE_LEFT, 'leave'); } catch {}
    // Dropping references is what a page can do; it cannot make the browser
    // overwrite the memory.
    this.key = this.bind = this.access = this.group = null;
    this.own.clear(); this.early.clear(); this.held = []; this.seen.clear();
    // The room file still holds its configuration, so it can be entered
    // again; a web page forgets the link it was opened with.
    if (this.source.mode === 'web') {
      this.source.parsed = null;
      return errorScreen('已离开房间', `${TEXT.left}要再次进入，请重新打开房间链接。`);
    }
    const again = el('button', { text: '重新进入', attrs: { type: 'button', id: 'pt-again' } });
    again.addEventListener('click', () => boot(this.source));
    errorScreen('已离开房间', TEXT.left, again);
  }
}
