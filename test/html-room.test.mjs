// HTML Room protocol (docs/html-room/protocol.md): derivation against known
// answers, configuration checks, the safe JSON block, the opening passphrase,
// frames sealed with the room key, storage, the template, and a whole room
// of Group members run in memory for nonces, tampering, replays, other rooms
// and receipts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hkdfSync, createHash, createCipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as Core from '../dist/hr-core.js';
import { Group, step } from '../dist/group.js';
import { envelope, checkEnvelope, checkKeys, newSeen } from '../dist/state.js';

const ch = (n) => String.fromCharCode(n);
const BS = ch(92);
const MS = Uint8Array.from({ length: 32 }, (_, i) => i);
const KAT = {
  access: '3b2fef5bc3101a05cda84d2c23afa7fb60b625318f7b9c294f1eb3144e7d82c9',
  roomId: 'ebd90a0af8117dc5fea74f7dff8d88b17d85faa25b304f578aa55dc57bcbb2bf',
  key: 'e2f20755efe99c2daf4d0ec4e5775a3054501b49fed4dc6f98e06132919c9332',
  bind: '4e6f220de834d897a88da6b31bf17a2ae52f29ae2664b2edf653af4de933c3c0'
};
const relay = 'wss://chat.example.org';
const good = () => ({ v: 1, name: '房间', relays: [relay], secret: Core.toB64url(MS) });

// ---- derivation ---------------------------------------------------------------

test('HKDF known-answer vectors (protocol.md §1.1), matched by an independent HKDF', async () => {
  const salt = Buffer.alloc(32);
  const ind = (label) => Buffer.from(hkdfSync('sha256', Buffer.from(MS), salt, Buffer.from(label), 32)).toString('hex');
  assert.equal(ind(Core.LABELS.access), KAT.access);
  assert.equal(ind(Core.LABELS.key), KAT.key);
  assert.equal(ind(Core.LABELS.bind), KAT.bind);
  assert.equal(createHash('sha256').update(Buffer.from(KAT.access, 'hex')).digest('hex'), KAT.roomId);
  const r = await Core.deriveHrRoom(MS);
  assert.equal(r.access, KAT.access);
  assert.equal(r.roomId, KAT.roomId);
  assert.equal(Buffer.from(r.bind).toString('hex'), KAT.bind);
  // The key is not extractable: check it by what it encrypts.
  const iv = new Uint8Array(12), pt = new TextEncoder().encode('kat');
  const web = Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, r.key, pt));
  const c = createCipheriv('aes-256-gcm', Buffer.from(KAT.key, 'hex'), Buffer.from(iv));
  const ref = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
  assert.deepEqual(web, ref);
  assert.equal(Core.toB64url(MS), 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
});

test('the room id is not the key, and different secrets give different rooms', async () => {
  const a = await Core.deriveHrRoom(MS);
  const b = await Core.deriveHrRoom(Core.newSecret());
  assert.notEqual(a.roomId, b.roomId);
  assert.notEqual(a.roomId, KAT.key);
  assert.notEqual(a.access, a.roomId);
  await assert.rejects(Core.deriveHrRoom(new Uint8Array(31)));
});

// ---- configuration ---------------------------------------------------------------

test('checkConfig accepts the two documented shapes', async () => {
  assert.ok(Core.checkConfig(good()).ok);
  const locked = await Core.makeConfig({ name: 'x', relays: [relay], pass: 'correct horse', iter: 100000 });
  assert.ok(Core.checkConfig(locked).ok);
  assert.equal(locked.secret, undefined);
});

test('checkConfig refuses unknown fields, wrong versions, odd types and lengths', () => {
  const bad = (c, code) => assert.equal(Core.checkConfig(c).code, code, JSON.stringify(c).slice(0, 80));
  bad({ ...good(), extra: 1 }, 'shape');
  bad({ ...good(), v: 2 }, 'version');
  bad({ ...good(), v: '1' }, 'version');
  bad({ ...good(), v: null }, 'shape');
  bad([], 'shape');
  bad(null, 'shape');
  bad({ ...good(), name: 'x'.repeat(41) }, 'name');
  bad({ ...good(), name: 7 }, 'name');
  for (const c of [0, 0x1b, 0x7f, 0x85, 0x2028, 0x2029, 0x202e, 0x2066, 0xfeff]) bad({ ...good(), name: `a${ch(c)}b` }, 'name');
  bad({ ...good(), relays: [] }, 'relays');
  bad({ ...good(), relays: [relay, relay] }, 'relays');
  bad({ ...good(), relays: Array(5).fill(0).map((_, i) => `wss://r${i}.example`) }, 'relays');
  bad({ ...good(), secret: 'A'.repeat(42) }, 'secret');
  bad({ ...good(), secret: 'A'.repeat(43) + '=' }, 'secret');
  bad({ ...good(), secret: '+'.repeat(43) }, 'secret');
  const { secret, ...noSecret } = good();
  bad(noSecret, 'shape');
  bad({ ...good(), lock: { kdf: Core.KDF, iter: 600000, salt: 'A'.repeat(22), iv: 'A'.repeat(16), ct: 'A'.repeat(64) } }, 'shape');
  const lock = { kdf: Core.KDF, iter: 600000, salt: 'A'.repeat(22), iv: 'A'.repeat(16), ct: 'A'.repeat(64) };
  const base = { v: 1, name: '', relays: [relay] };
  assert.ok(Core.checkConfig({ ...base, lock }).ok);
  bad({ ...base, lock: { ...lock, extra: 1 } }, 'lock');
  bad({ ...base, lock: { ...lock, kdf: 'scrypt' } }, 'lock');
  bad({ ...base, lock: { ...lock, iter: 1000 } }, 'lock');
  bad({ ...base, lock: { ...lock, iter: 1e9 } }, 'lock');
  bad({ ...base, lock: { ...lock, ct: 'A'.repeat(63) } }, 'lock');
});

test('relay addresses: wss anywhere, ws only on this machine, nothing that could leak or break CSP', () => {
  for (const ok of ['wss://chat.example.org', 'wss://chat.example.org/', 'wss://chat.example.org:8443/', 'wss://a.b/k7Qp2xVm9aLd/', 'ws://localhost:8080', 'ws://127.0.0.1:9/', 'ws://[::1]:8080', 'wss://例え.jp']) {
    assert.ok(Core.checkRelay(ok), ok);
  }
  for (const no of ['ws://chat.example.org', 'https://chat.example.org', 'http://127.0.0.1', 'wss://u:p@chat.example.org', 'wss://chat.example.org/?a=1', 'wss://chat.example.org/#x', 'wss://chat.example.org/a/b/', 'wss://chat.example.org/a', "wss://a.b/'none'/", 'wss://a.b; script-src *', 'javascript:alert(1)', '', 'wss://' + 'a'.repeat(300)]) {
    assert.equal(Core.checkRelay(no), null, no);
  }
  assert.equal(Core.checkRelay('wss://例え.jp').origin, 'wss://xn--r8jz45g.jp');
  assert.equal(Core.relaySocketUrl('wss://a.b/k7Qp2xVm9aLd/', 'f'.repeat(64)), `wss://a.b/k7Qp2xVm9aLd/hr/${'f'.repeat(64)}`);
  assert.equal(Core.relaySocketUrl('ws://localhost:8080', 'f'.repeat(64)), `ws://localhost:8080/hr/${'f'.repeat(64)}`);
});

// ---- the configuration block -----------------------------------------------------

test('safeJson: </script>, tags and line separators cannot end or confuse the block', () => {
  const names = ['</script><script>alert(1)</script>', '<!--', '<b>x</b>&amp;', `a${ch(0x2028)}b${ch(0x2029)}c`, '"; alert(1); //', BS + 'u003C'];
  for (const name of names) {
    const s = Core.safeJson({ name });
    assert.ok(!/[<>&/]/.test(s), s);
    assert.ok(!s.includes(ch(0x2028)) && !s.includes(ch(0x2029)), 'separators escaped');
    assert.deepEqual(JSON.parse(s), { name });
  }
  assert.equal(Core.safeJson('</'), `"${BS}u003C${BS}u002F"`);
});

test('parseConfigText: corrupt JSON, oversize and a round trip', () => {
  assert.equal(Core.parseConfigText('{"v":1,').code, 'json');
  assert.equal(Core.parseConfigText(null).code, 'json');
  assert.equal(Core.parseConfigText('x'.repeat(10000)).code, 'size');
  assert.deepEqual(Core.parseConfigText(Core.safeJson(good())).config, good());
});

test('fillTemplate puts the relay origins in connect-src and the config in its block, nothing else', async () => {
  const template = readFileSync(new URL('../dist/hr-template.html', import.meta.url), 'utf8');
  const c = { ...good(), name: '</script><img src=x onerror=alert(1)>'.slice(0, 40), relays: ['wss://a.example/k7Qp2xVm9aLd/', 'ws://localhost:8080'] };
  const html = Core.fillTemplate(template, c);
  assert.match(html, /connect-src wss:\/\/a\.example ws:\/\/localhost:8080;/);
  assert.equal(html.split('</script>').length - 1, 2, 'exactly two script blocks end');
  assert.equal((html.match(/<script/g) || []).length, 2);
  const block = html.match(/<script id="pt-room-config" type="application\/json">([^<]*)<\/script>/)[1];
  assert.deepEqual(JSON.parse(block), c);
  // Everything else is the same in every room file.
  const other = Core.fillTemplate(template, { ...good(), relays: ['wss://b.example'] });
  const strip = (h) => h.replace(/connect-src [^;]*;/, '').replace(/(<script id="pt-room-config" type="application\/json">)[^<]*/, '$1');
  assert.equal(strip(html), strip(other));
  assert.throws(() => Core.fillTemplate(template, { ...good(), extra: 1 }));
  assert.throws(() => Core.fillTemplate('no markers', good()));
});

test('the template is up to date and its CSP hashes are those of its script and style', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  execFileSync(process.execPath, ['scripts/build-html-room.mjs', 'template', '--check'], { cwd: root, stdio: 'pipe' });
  const t = readFileSync(new URL('../dist/hr-template.html', import.meta.url), 'utf8');
  const script = t.match(/<script>([\s\S]*)<\/script>\n<\/body>/)[1];
  const style = t.match(/<style>([\s\S]*?)<\/style>/)[1];
  const h = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
  assert.ok(t.includes(`script-src 'sha256-${h(script)}'`));
  assert.ok(t.includes(`style-src 'sha256-${h(style)}'`));
  const csp = t.match(/content="([^"]+)"/)[1];
  for (const d of ["default-src 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'", "img-src 'none'", "worker-src 'none'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/unsafe-|wss:\s|https:/.test(csp), 'no unsafe-*, no scheme wildcards');
  assert.ok(!/ style="| on[a-z]+="/i.test(t), 'no inline style or handler attributes');
  const recorded = JSON.parse(readFileSync(new URL('../docs/html-room/hashes.json', import.meta.url), 'utf8'));
  assert.equal(recorded.script, `sha256-${h(script)}`);
  // The client never uses these.
  for (const banned of ['eval(', 'new Function', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'localStorage', 'sessionStorage', 'indexedDB']) {
    for (const f of ['hr-core.js', 'hr-room.js', 'hr-file.js', 'hr.js']) {
      assert.ok(!readFileSync(new URL(`../dist/${f}`, import.meta.url), 'utf8').includes(banned), `${f} uses ${banned}`);
    }
  }
});

// ---- #hr1= ------------------------------------------------------------------------

test('fragment round trip, and bad fragments', () => {
  const f = Core.fragmentFor(good());
  assert.ok(f.startsWith('#hr1='));
  assert.deepEqual(Core.configFromHash(f).config, good());
  assert.equal(Core.configFromHash('#abc'), null);
  assert.equal(Core.configFromHash('#hr1=***').code, 'json');
  assert.equal(Core.configFromHash('#hr1=' + Core.toB64url(new TextEncoder().encode('{"v":3}'))).code, 'version');
});

// ---- opening passphrase -----------------------------------------------------------

test('lock and unlock; a wrong passphrase, a changed name or relay list gives nothing', async () => {
  const c = await Core.makeConfig({ name: '晚饭', relays: [relay], pass: 'correct horse battery', iter: 100000 });
  const ms = await Core.unlockSecret(c, 'correct horse battery');
  assert.equal(ms.length, 32);
  assert.equal(await Core.unlockSecret(c, 'correct horse batterz'), null);
  assert.equal(await Core.unlockSecret({ ...c, name: '午饭' }, 'correct horse battery'), null);
  assert.equal(await Core.unlockSecret({ ...c, relays: ['wss://evil.example'] }, 'correct horse battery'), null);
  // NFC: the same passphrase typed with a combining accent opens it too.
  const d = await Core.makeConfig({ name: '', relays: [relay], pass: 'caf' + ch(0xe9) + '-long', iter: 100000 });
  assert.ok(await Core.unlockSecret(d, 'cafe' + ch(0x301) + '-long'));
  await assert.rejects(Core.lockSecret(MS, 'short', '', [relay]));
  assert.equal(c.lock.iter, 100000);
  assert.equal((await Core.makeConfig({ name: '', relays: [relay], pass: 'xxxxxxxx' })).lock.iter, Core.LOCK_ITERATIONS);
});

test('randomPass: 12 characters from an unambiguous set, about 60 bits', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = Core.randomPass();
    assert.match(p, /^[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}$/);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

// ---- frames sealed with the room key ----------------------------------------------------

test('sealFrame/openFrame: the AAD binds room, kind and sender', async () => {
  const r = await Core.deriveHrRoom(MS);
  const f = await Core.sealFrame(r.key, r.roomId, 'seen', 3, '{"kind":"seen"}');
  assert.equal(await Core.openFrame(r.key, r.roomId, 'seen', 3, f), '{"kind":"seen"}');
  await assert.rejects(Core.openFrame(r.key, r.roomId, 'seen', 4, f), 'relabelled sender');
  await assert.rejects(Core.openFrame(r.key, r.roomId, 'key', 3, f), 'other kind');
  await assert.rejects(Core.openFrame(r.key, 'a'.repeat(64), 'seen', 3, f), 'other room id');
  const other = await Core.deriveHrRoom(Core.newSecret());
  await assert.rejects(Core.openFrame(other.key, r.roomId, 'seen', 3, f), 'other room key');
  const ct = Buffer.from(f.ct, 'base64'); ct[0] ^= 1;
  await assert.rejects(Core.openFrame(r.key, r.roomId, 'seen', 3, { iv: f.iv, ct: ct.toString('base64') }), 'flipped bit');
  // Padded to a size class like every other frame.
  assert.equal(Buffer.from(f.ct, 'base64').length, 256 + 16);
});

// ---- storage ---------------------------------------------------------------------------

const roomA = 'a'.repeat(64), roomB = 'b'.repeat(64);
function fakeStorage(fail) {
  const m = new Map();
  return {
    getItem: (k) => { if (fail === 'get') throw new DOMException('no', 'SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (fail === 'quota') throw new DOMException('full', 'QuotaExceededError'); if (fail === 'get') throw new DOMException('no', 'SecurityError'); m.set(k, v); },
    removeItem: (k) => m.delete(k),
    m
  };
}

test('storage: memory by default, key format, rooms kept apart', () => {
  const s = Core.createStorage(roomA);
  assert.equal(s.persistent, false);
  s.set('draft', 'x');
  assert.equal(s.get('draft'), 'x');
  assert.equal(Core.storageKey(roomA, 'draft'), `pt_hr_v1_${roomA}_draft`);
  assert.throws(() => Core.storageKey('nothex', 'draft'));
  assert.throws(() => Core.storageKey(roomA, '../x'));
  const back = fakeStorage();
  const a = Core.createStorage(roomA, back), b = Core.createStorage(roomB, back);
  a.set('state', { n: 1 });
  assert.equal(b.get('state'), null);
  assert.deepEqual(a.get('state'), { n: 1 });
  assert.deepEqual([...back.m.keys()], [`pt_hr_v1_${roomA}_state`]);
});

test('storage: SecurityError, QuotaExceededError and corrupt data fall back to memory', () => {
  const sec = Core.createStorage(roomA, fakeStorage('get'));
  sec.set('x', 1);
  assert.equal(sec.persistent, false);
  assert.equal(sec.reason, 'security');
  assert.equal(sec.get('x'), 1);
  const q = Core.createStorage(roomA, fakeStorage('quota'));
  q.set('x', 2);
  assert.equal(q.reason, 'quota');
  assert.equal(q.get('x'), 2);
  const broken = fakeStorage();
  broken.m.set(`pt_hr_v1_${roomA}_x`, '{not json');
  const c = Core.createStorage(roomA, broken);
  assert.equal(c.get('x'), null);
  assert.equal(c.reason, 'corrupt');
  assert.match(Core.PERSIST_WARNING, /不支持持久保存/);
});

// ---- environment ----------------------------------------------------------------------

test('checkEnvironment names what is missing and probes the algorithms', async () => {
  assert.deepEqual(await Core.checkEnvironment(globalThis, { pbkdf2: true }), { ok: true, missing: [] });
  const r = await Core.checkEnvironment({ crypto: { getRandomValues: () => {} }, WebSocket: function () {}, TextEncoder, BigInt });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['subtle']);
  const noEcdh = { ...crypto.subtle, generateKey: (alg, ...rest) => (alg.name === 'ECDH' ? Promise.reject(new Error('no')) : crypto.subtle.generateKey(alg, ...rest)) };
  for (const k of ['importKey', 'deriveBits', 'encrypt', 'sign']) noEcdh[k] = crypto.subtle[k].bind(crypto.subtle);
  const r2 = await Core.checkEnvironment({ crypto: { getRandomValues: crypto.getRandomValues.bind(crypto), subtle: noEcdh }, WebSocket: function () {}, TextEncoder, BigInt });
  assert.deepEqual(r2.missing, ['ECDH']);
  assert.match(Core.ENV_MESSAGE, /当前打开方式不支持安全聊天/);
});

// ---- a whole room in memory ---------------------------------------------------------------

// Members exchange announcements through sealFrame/openFrame and checkKeys,
// as hr-room.js does, until everyone holds everyone's chain.
async function makeRoom(n, ms = Core.newSecret()) {
  const keys = await Core.deriveHrRoom(ms);
  const members = [];
  for (let i = 1; i <= n; i++) members.push({ n: i, g: await Group.create(keys.key, keys.bind, i), seen: newSeen() });
  const present = members.map((m) => m.n);
  const deliver = async (from, plain) => {
    const frame = await Core.sealFrame(keys.key, keys.roomId, 'key', from.n, plain);
    for (const to of members) {
      if (to === from) continue;
      const a = checkKeys(await Core.openFrame(keys.key, keys.roomId, 'key', from.n, frame), { from: from.n }, to.seen, Date.now());
      if (a) await to.g.receive(a, from.n);
    }
  };
  for (const m of members) for (const p of await m.g.announceAll([], true)) await deliver(m, p);
  for (let round = 0; round < 6 && !members.every((m) => m.g.ready(present, true)); round++) {
    for (const m of members) for (const p of await m.g.announceAll(m.g.owed(present), false)) await deliver(m, p);
  }
  assert.ok(members.every((m) => m.g.ready(present, true)), 'keys exchanged');
  return { keys, members, present };
}

async function sendMsg(m, text) {
  const plain = envelope(m.n, text);
  const out = await m.g.seal(plain);
  return { type: 'msg', from: m.n, at: Date.now(), iv: out.iv, ct: out.ct, h: out.h };
}

async function readMsg(to, msg) {
  const o = await to.g.open(msg, msg.from);
  assert.ok(o.signed);
  return checkEnvelope(o.text, msg, to.seen, Date.now());
}

test('multi-sender: every message key and nonce is used once across all senders', async () => {
  const { members } = await makeRoom(3);
  const mks = new Set(), ivs = new Set();
  let count = 0;
  for (let i = 0; i < 40; i++) {
    for (const m of members) {
      const { mk } = await step(m.g.mine.ck);
      mks.add(Buffer.from(mk).toString('hex'));
      const msg = await sendMsg(m, `m${i}`);
      ivs.add(msg.iv);
      count++;
      // Everyone else reads it.
      for (const to of members) if (to !== m) assert.equal((await readMsg(to, msg)).text, `m${i}`);
    }
  }
  assert.equal(mks.size, count, 'no message key repeats');
  assert.equal(ivs.size, count, 'no IV repeats');
  // Each sender starts its own chain: no two start from the same key.
  const starts = new Set(members.map((m) => Buffer.from(m.g.mine.ck).toString('hex')));
  assert.equal(starts.size, 3);
});

test('AAD and envelope tampering: chain position, sender label, ciphertext', async () => {
  const { members: [a, b, c] } = await makeRoom(3);
  const msg = await sendMsg(a, 'hello');
  await assert.rejects(b.g.open({ ...msg, h: msg.h.replace(/\.0$/, '.1') }, 1), 'another chain position');
  const ct = Buffer.from(msg.ct, 'base64'); ct[3] ^= 0x40;
  await assert.rejects(b.g.open({ ...msg, ct: ct.toString('base64') }, 1), 'flipped ciphertext');
  // The relay labels it as from C: C's chain cannot open it (and C's own
  // signature would be needed).
  await assert.rejects(b.g.open({ ...msg, from: 3 }, 3));
  // A sealed sender that disagrees with the relay's label is refused.
  const o = await b.g.open(msg, 1);
  assert.equal(checkEnvelope(o.text, { ...msg, from: 3 }, newSeen(), Date.now()), null);
  assert.equal(checkEnvelope(o.text, msg, b.seen, Date.now()).text, 'hello');
  void c;
});

test('replays: the same message twice, and an old one, are refused', async () => {
  const { members: [a, b] } = await makeRoom(2);
  const m1 = await sendMsg(a, 'one');
  const m2 = await sendMsg(a, 'two');
  assert.equal((await readMsg(b, m1)).text, 'one');
  assert.equal((await readMsg(b, m2)).text, 'two');
  await assert.rejects(b.g.open(m1, 1), /out of step/);
  await assert.rejects(b.g.open(m2, 1), /out of step/);
  // Even if a chain could open it again, the id is remembered.
  const plain = envelope(1, 'again');
  const seen = newSeen();
  assert.ok(checkEnvelope(plain, { from: 1, at: Date.now() }, seen, Date.now()));
  assert.equal(checkEnvelope(plain, { from: 1, at: Date.now() }, seen, Date.now()), null);
  // And one sealed eleven minutes ago is too old.
  const old = envelope(1, 'old', Date.now() - 11 * 60 * 1000);
  assert.equal(checkEnvelope(old, { from: 1, at: Date.now() }, newSeen(), Date.now()), null);
});

test('another room’s messages and announcements are refused', async () => {
  const one = await makeRoom(2);
  const two = await makeRoom(2);
  const msg = await sendMsg(one.members[0], 'room one');
  await assert.rejects(two.members[1].g.open(msg, 1));
  const ann = (await one.members[0].g.announceAll([2], true))[0];
  const frame = await Core.sealFrame(one.keys.key, one.keys.roomId, 'key', 1, ann);
  await assert.rejects(Core.openFrame(two.keys.key, two.keys.roomId, 'key', 1, frame));
  await assert.rejects(Core.openFrame(one.keys.key, two.keys.roomId, 'key', 1, frame), 'right key, wrong room id');
});

test('a member who left cannot read after the rekey', async () => {
  const { keys, members: [a, b, c] } = await makeRoom(3);
  a.g.forget(3); b.g.forget(3);
  await a.g.rekey(); await b.g.rekey();
  for (const [from, to] of [[a, b], [b, a]]) {
    for (const p of await from.g.announceAll(from.g.owed([1, 2]), false)) {
      const f = await Core.sealFrame(keys.key, keys.roomId, 'key', from.n, p);
      const x = checkKeys(await Core.openFrame(keys.key, keys.roomId, 'key', from.n, f), { from: from.n }, to.seen, Date.now());
      await to.g.receive(x, from.n);
    }
  }
  const msg = await sendMsg(a, 'after');
  assert.equal((await readMsg(b, msg)).text, 'after');
  await assert.rejects(c.g.open(msg, 1));
});

// ---- delivery receipts -----------------------------------------------------------------------

test('receipts: forged, repeated, early, late, out of order, from strangers', async () => {
  const { keys } = await makeRoom(2);
  const seal = (from, l, id = Math.random().toString(16).slice(2, 18).padEnd(16, '0')) => Core.sealFrame(keys.key, keys.roomId, 'seen', from, JSON.stringify({ kind: 'seen', v: 'hr1', id, from, t: Date.now(), l }));
  const seen = newSeen();
  const read = async (relayedFrom, f) => checkKeys(await Core.openFrame(keys.key, keys.roomId, 'seen', relayedFrom, f), { from: relayedFrom }, seen, Date.now(), 'seen');
  // Forged: sealed as 2 but relayed as 3 (AAD), or sealed claiming 3 while the relay says 2.
  const f2 = await seal(2, [[1, '0.0']]);
  await assert.rejects(read(3, f2));
  const lie = await Core.sealFrame(keys.key, keys.roomId, 'seen', 2, JSON.stringify({ kind: 'seen', v: 'hr1', id: 'abcdefabcdef0123', from: 3, t: Date.now(), l: [] }));
  assert.equal(await read(2, lie), null);
  // The same receipt replayed.
  assert.ok(await read(2, f2));
  assert.equal(await read(2, f2), null);

  // Counting, with targets 2 and 3.
  const d = new Core.Delivery();
  assert.equal(d.label(), '排队中');
  d.sealed([2, 3]);
  assert.equal(d.label(), '发送中');
  d.ack(3);                          // came before the relay echo
  assert.equal(d.state, 'sending');
  d.relayed();
  assert.equal(d.label(), '部分成员已确认 1/2');
  assert.equal(d.ack(3), false);     // repeated
  assert.equal(d.ack(9), false);     // not a target (joined after sending)
  assert.equal(d.label(), '部分成员已确认 1/2');
  d.ack(2);
  assert.equal(d.label(), '全部目标成员已确认');
  // Nobody else present: the relay echo is as far as it goes.
  const alone = new Core.Delivery();
  alone.sealed([]);
  alone.relayed();
  assert.match(alone.label(), /已提交中继/);
  const lost = new Core.Delivery();
  lost.sealed([2]);
  lost.failed('timeout');
  assert.equal(lost.label(), '发送失败');
  lost.relayed(); lost.ack(2);
  assert.equal(lost.label(), '发送失败');
  const late = new Core.Delivery();
  late.sealed([2]); late.relayed();
  assert.equal(late.label(), '已提交中继');
});
