// 暗号潜伏 (Undercover): a party game played in the room.
//
// Most players get the same word; one, the spy, gets a similar one. Nobody is
// told which side they are on. In turn each describes their word in one
// message without saying it; then everyone talks for a minute and votes one
// player out. The others win when the spy is voted out; the spy wins when
// only two players are left.
//
// Since 2.20 there is no dealer who knows the cards. The starter writes the
// cards (n−1 with the common word, one with the spy's, each marked with its
// side) and the players deal them among themselves with commutative
// encryption (sra.js): everyone encrypts and shuffles in turn, then everyone
// but the owner removes their layer from each card. Nobody, the starter
// included, learns who holds the spy's card; the starter knows the two words
// and so, from their own card, their own side (and nothing more). Votes are
// committed (a hash) and shown together, so nobody counts them in secret.
// A player voted out shows their key, which proves their card; at the end
// those still in show theirs. The starter's page only calls time.
//
// Nothing is kept: the game is gone with the room, or when the starter leaves.

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;
export const SAY_MS = 45000;   // time for one description
export const TALK_MS = 60000;  // free talk before the vote
export const VOTE_MS = 30000;  // time to vote
export const PASS_MS = 25000;  // for one player's turn in the deal
export const SHOW_MS = 20000;  // for votes or keys to be shown

// Word pairs: [the majority's word, the spy's word]; which is which is chosen
// at random for each game.
const PAIRS = {
  'zh-Hans': [
    ['苹果', '梨'], ['饺子', '包子'], ['咖啡', '奶茶'], ['猫', '老虎'], ['眼镜', '隐形眼镜'],
    ['地铁', '火车'], ['雨伞', '雨衣'], ['钢琴', '吉他'], ['月亮', '太阳'], ['牙刷', '梳子'],
    ['蜡烛', '手电筒'], ['图书馆', '书店'], ['医生', '护士'], ['口罩', '围巾'], ['蜂蜜', '糖'],
    ['足球', '篮球'], ['婚礼', '生日派对'], ['枕头', '被子'], ['电梯', '楼梯'], ['冰箱', '空调'],
    ['蝴蝶', '蜜蜂'], ['西瓜', '哈密瓜'], ['手表', '闹钟'], ['邮票', '明信片'], ['海豚', '鲨鱼'],
    ['面包', '蛋糕'], ['魔术师', '小丑'], ['沙漠', '海滩'], ['照相机', '望远镜'], ['火锅', '烧烤'],
    ['筷子', '叉子'], ['寿司', '饭团'], ['作家', '记者'], ['钥匙', '锁'], ['彩虹', '极光'],
    ['自行车', '滑板车'], ['公园', '花园'], ['外卖', '快递'], ['毛笔', '钢笔'], ['春节', '中秋节']
  ],
  'zh-Hant': [
    ['蘋果', '梨'], ['餃子', '包子'], ['咖啡', '奶茶'], ['貓', '老虎'], ['眼鏡', '隱形眼鏡'],
    ['地鐵', '火車'], ['雨傘', '雨衣'], ['鋼琴', '吉他'], ['月亮', '太陽'], ['牙刷', '梳子'],
    ['蠟燭', '手電筒'], ['圖書館', '書店'], ['醫生', '護士'], ['口罩', '圍巾'], ['蜂蜜', '糖'],
    ['足球', '籃球'], ['婚禮', '生日派對'], ['枕頭', '被子'], ['電梯', '樓梯'], ['冰箱', '冷氣'],
    ['蝴蝶', '蜜蜂'], ['西瓜', '哈密瓜'], ['手錶', '鬧鐘'], ['郵票', '明信片'], ['海豚', '鯊魚'],
    ['麵包', '蛋糕'], ['魔術師', '小丑'], ['沙漠', '海灘'], ['照相機', '望遠鏡'], ['火鍋', '燒烤'],
    ['筷子', '叉子'], ['壽司', '飯糰'], ['作家', '記者'], ['鑰匙', '鎖'], ['彩虹', '極光'],
    ['腳踏車', '滑板車'], ['公園', '花園'], ['外送', '快遞'], ['毛筆', '鋼筆'], ['春節', '中秋節']
  ],
  en: [
    ['apple', 'pear'], ['coffee', 'tea'], ['cat', 'tiger'], ['glasses', 'contact lenses'], ['subway', 'train'],
    ['umbrella', 'raincoat'], ['piano', 'guitar'], ['moon', 'sun'], ['toothbrush', 'comb'], ['candle', 'flashlight'],
    ['library', 'bookshop'], ['doctor', 'nurse'], ['honey', 'sugar'], ['football', 'basketball'], ['wedding', 'birthday party'],
    ['pillow', 'blanket'], ['elevator', 'stairs'], ['fridge', 'air conditioner'], ['butterfly', 'bee'], ['watermelon', 'melon'],
    ['watch', 'alarm clock'], ['stamp', 'postcard'], ['dolphin', 'shark'], ['bread', 'cake'], ['magician', 'clown'],
    ['desert', 'beach'], ['camera', 'telescope'], ['chopsticks', 'fork'], ['sushi', 'sandwich'], ['writer', 'journalist'],
    ['key', 'lock'], ['rainbow', 'northern lights'], ['bicycle', 'scooter'], ['park', 'garden'], ['pen', 'pencil'],
    ['pizza', 'burger'], ['snow', 'rain'], ['castle', 'palace'], ['violin', 'cello'], ['lion', 'wolf']
  ]
};

// The word list for an interface language: Chinese pages get Chinese words,
// every other language English ones.
export function pairsFor(lang) {
  if (lang === 'zh-TW' || lang === 'zh-Hant') return PAIRS['zh-Hant'];
  if (String(lang).startsWith('zh')) return PAIRS['zh-Hans'];
  return PAIRS.en;
}

const pick = (list) => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length];
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const gameId = () => hex(crypto.getRandomValues(new Uint8Array(6)));

// The starter's cards for a new game, as text ("C|word" or "S|word"), one
// per player, and the speaking order. The deal itself is sra.js.
export function deal(players, lang) {
  const [a, b] = pick(pairsFor(lang));
  const [civ, spyWord] = crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? [a, b] : [b, a];
  const cards = players.map((_, i) => (i === 0 ? `S|${spyWord}` : `C|${civ}`));
  return { gid: gameId(), players: players.slice().sort((x, y) => x - y), order: shuffle(players), cards };
}
// A card's text as { side: 'spy' | 'civ', word }, or null.
export function readCard(text) {
  const m = /^([SC])\|(.{1,40})$/u.exec(text ?? '');
  return m ? { side: m[1] === 'S' ? 'spy' : 'civ', word: m[2] } : null;
}

// A vote committed: the hash of (game, round, voter, choice, salt).
async function digest(gid, r, n, c, salt) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`private-talk/vote|${gid}|${r}|${n}|${c}|${salt}`))));
}
export async function commitVote(gid, r, n, c) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { c, salt, h: await digest(gid, r, n, c, salt) };
}
export async function checkVote(gid, r, n, h, c, salt) {
  return Number.isInteger(c) && typeof salt === 'string' && /^[0-9a-f]{32}$/.test(salt) && (await digest(gid, r, n, c, salt)) === h;
}

const GID = /^[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const isNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 25;
const isDeck = (d, n) => Array.isArray(d) && d.length === n && d.every((x) => typeof x === 'string' && x.length === 256);

// Whose turn it is to describe, or 0.
export const speaker = (s) => (s?.phase === 'say' ? s.speakers[s.turn] ?? 0 : 0);
// Whose turn it is in the deal (encrypt and shuffle, or remove a layer), or 0.
export const dealer = (s) => (s?.phase === 'deal' || s?.phase === 'strip' ? s.passers[s.step] ?? 0 : 0);
// Which card is player n's: the index in seat order.
export const cardOf = (s, n) => s.players.indexOf(n);

// The game ends: once the spy is known to be out (civ), or when the last
// ones still in have shown their cards.
function finish(s, why, winner, now) {
  const words = {};
  for (const c of Object.values(s.revealed)) if (c) words[c.side] = c.word;
  const spy = Number(Object.keys(s.revealed).find((n) => s.revealed[n]?.side === 'spy') ?? 0);
  const end = { winner, spy, words, why };
  return { s: { ...s, phase: 'over', end, deadline: now }, note: { k: 'end', end } };
}
// After a vote (with `out` gone, or nobody): next round, or the last two.
function onward(s, now, note) {
  if (s.alive.length <= 2) return { s: { ...s, phase: 'final', deadline: now + SHOW_MS }, note: { ...note, final: true } };
  const order = s.order.filter((n) => s.alive.includes(n));
  return { s: { ...s, round: s.round + 1, phase: 'say', speakers: order, turn: 0, deadline: now + SAY_MS, ballots: {}, opened: {} }, note };
}
// Everyone's shown vote is in: who is out.
function count(s, now) {
  const votes = {};
  const tally = new Map();
  for (const [v, c] of Object.entries(s.opened)) {
    const voter = Number(v);
    if (c === null || !s.alive.includes(c) || c === voter) continue;
    votes[voter] = c;
    tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  const top = Math.max(0, ...tally.values());
  const leaders = [...tally].filter(([, x]) => x === top).map(([n]) => n);
  const out = top > 0 && leaders.length === 1 ? leaders[0] : 0;
  const note = { k: 'result', out, votes };
  if (!out) return onward(s, now, note);
  return { s: { ...s, phase: 'confess', out, deadline: now + SHOW_MS }, note };
}
// The final reveal is in (or out of time).
function decide(s, now) {
  const spyIn = s.alive.some((n) => s.revealed[n]?.side === 'spy');
  return finish(s, spyIn ? 'survived' : 'left', spyIn ? 'spy' : 'civ', now);
}

// Applies one game event (the g field of a message from member `from`) to the
// state s (null when no game runs) and returns { s, note }: the new state and
// what happened, for the page to say. Events that do not fit are ignored
// (note null). `now` is when the message arrived here. The page checks what
// it can before: for 'open', ok (the vote matches its commitment); for
// 'key', card (the sender's card read with the key shown, or null).
export function apply(s, g, from, now) {
  if (!g || typeof g !== 'object' || typeof g.k !== 'string') return { s, note: null };
  if (g.k === 'new') {
    if (s && s.phase !== 'over') return { s, note: null };
    const players = Array.isArray(g.players) ? g.players : [];
    const order = Array.isArray(g.order) ? g.order : [];
    if (!GID.test(g.gid ?? '') || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS || !players.every(isNumber) || !players.includes(from)) return { s, note: null };
    if (new Set(players).size !== players.length || order.length !== players.length || !order.every((n) => players.includes(n)) || !isDeck(g.deck, players.length)) return { s, note: null };
    const sorted = players.slice().sort((a, b) => a - b);
    // The starter has encrypted and shuffled; then the others, in seat order.
    const passers = [from, ...sorted.filter((n) => n !== from)];
    const next = { gid: g.gid, dealer: from, players: sorted, alive: sorted.slice(), order: order.slice(), passers, step: 1, deck: g.deck, round: 1, phase: 'deal', deadline: now + PASS_MS, speakers: [], turn: 0, ballots: {}, opened: {}, revealed: {}, out: 0 };
    return { s: next, note: { k: 'new', by: from, players: sorted } };
  }
  // After the end everyone shows their card, so everyone sees both words.
  if (s && s.phase === 'over' && s.end && g.k === 'key' && g.gid === s.gid && s.players.includes(from) && !(from in s.revealed)) {
    const card = g.card && (g.card.side === 'spy' || g.card.side === 'civ') && typeof g.card.word === 'string' ? { side: g.card.side, word: g.card.word } : null;
    const words = { ...s.end.words, ...(card && !s.end.words[card.side] ? { [card.side]: card.word } : {}) };
    const next = { ...s, revealed: { ...s.revealed, [from]: card }, end: { ...s.end, words, spy: s.end.spy || (card && card.side === 'spy' ? from : 0) } };
    return { s: next, note: { k: 'words', end: next.end } };
  }
  if (!s || s.phase === 'over' || g.gid !== s.gid) return { s, note: null };
  const fromDealer = from === s.dealer;
  if ((g.k === 'shuf' && s.phase === 'deal') || (g.k === 'strip' && s.phase === 'strip')) {
    if (from !== dealer(s) || !isDeck(g.deck, s.players.length)) return { s, note: null };
    const step = s.step + 1;
    if (step < s.passers.length) return { s: { ...s, deck: g.deck, step, deadline: now + PASS_MS }, note: null };
    if (s.phase === 'deal') return { s: { ...s, deck: g.deck, phase: 'strip', step: 0, deadline: now + PASS_MS }, note: null };
    return { s: { ...s, deck: g.deck, phase: 'say', speakers: s.order.slice(), turn: 0, step: 0, deadline: now + SAY_MS }, note: { k: 'dealt' } };
  }
  if ((g.k === 'say' && s.phase === 'say' && from === speaker(s)) || (g.k === 'skip' && fromDealer && s.phase === 'say' && g.n === speaker(s))) {
    const n = speaker(s);
    const next = { ...s, turn: s.turn + 1, deadline: now + SAY_MS };
    if (next.turn >= next.speakers.length) Object.assign(next, { phase: 'talk', deadline: now + TALK_MS });
    return { s: next, note: { k: g.k, n, talk: next.phase === 'talk' } };
  }
  if (g.k === 'vote' && fromDealer && s.phase === 'talk') {
    return { s: { ...s, phase: 'vote', deadline: now + VOTE_MS, ballots: {}, opened: {} }, note: { k: 'vote' } };
  }
  if (g.k === 'ballot' && s.phase === 'vote' && s.alive.includes(from) && !s.ballots[from] && g.r === s.round && HASH.test(g.h ?? '')) {
    const ballots = { ...s.ballots, [from]: g.h };
    const next = { ...s, ballots };
    if (s.alive.every((n) => ballots[n])) return { s: { ...next, phase: 'open', deadline: now + SHOW_MS }, note: { k: 'ballot', n: from, open: true } };
    return { s: next, note: { k: 'ballot', n: from } };
  }
  if (g.k === 'open' && s.phase === 'open' && s.ballots[from] && !(from in s.opened) && g.r === s.round) {
    const opened = { ...s.opened, [from]: g.ok === true ? g.c : null };
    const next = { ...s, opened };
    if (Object.keys(s.ballots).every((n) => n in opened)) return count(next, now);
    return { s: next, note: null };
  }
  if (g.k === 'key' && ((s.phase === 'confess' && from === s.out) || (s.phase === 'final' && s.alive.includes(from) && !(from in s.revealed)))) {
    const card = g.card && (g.card.side === 'spy' || g.card.side === 'civ') && typeof g.card.word === 'string' ? { side: g.card.side, word: g.card.word } : null;
    const revealed = { ...s.revealed, [from]: card };
    if (s.phase === 'confess') {
      const alive = s.alive.filter((n) => n !== from);
      const note = { k: 'shown', n: from, card };
      if (card?.side === 'spy') { const r = finish({ ...s, alive, revealed }, 'caught', 'civ', now); return { s: r.s, note: { ...note, end: r.s.end } }; }
      return onward({ ...s, alive, revealed, out: 0 }, now, note);
    }
    const next = { ...s, revealed };
    if (s.alive.every((n) => n in revealed)) { const r = decide(next, now); return { s: r.s, note: { k: 'shown', n: from, card, end: r.s.end } }; }
    return { s: next, note: { k: 'shown', n: from, card } };
  }
  // The starter's page calls time.
  if (g.k === 'time' && fromDealer && g.phase === s.phase && g.r === s.round) {
    if (s.phase === 'deal' || s.phase === 'strip') return { s: { ...s, phase: 'over', end: null }, note: { k: 'stuck', n: dealer(s) } };
    if (s.phase === 'vote') return { s: { ...s, phase: 'open', deadline: now + SHOW_MS }, note: { k: 'ballot', open: true } };
    if (s.phase === 'open') return count({ ...s, opened: Object.fromEntries(Object.keys(s.ballots).map((n) => [n, n in s.opened ? s.opened[n] : null])) }, now);
    if (s.phase === 'confess') return onward({ ...s, alive: s.alive.filter((n) => n !== s.out), revealed: { ...s.revealed, [s.out]: null }, out: 0 }, now, { k: 'shown', n: s.out, card: null });
    if (s.phase === 'final') { const r = decide(s, now); return { s: r.s, note: { k: 'end', end: r.s.end } }; }
  }
  if (g.k === 'abort' && fromDealer) {
    return { s: { ...s, phase: 'over', end: null }, note: { k: 'abort' } };
  }
  return { s, note: null };
}

// What the starter's page sends, if anything: a speaker out of time is
// skipped, talk ends in a vote, other phases are called when time is up.
export function dealerMove(s, now) {
  if (!s || s.phase === 'over' || now < s.deadline) return null;
  if (s.phase === 'say') return { k: 'skip', gid: s.gid, n: speaker(s) };
  if (s.phase === 'talk') return { k: 'vote', gid: s.gid };
  return { k: 'time', gid: s.gid, phase: s.phase, r: s.round };
}
