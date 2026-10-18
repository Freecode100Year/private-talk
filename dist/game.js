// 暗号潜伏 (Undercover): a party game played in the room.
//
// Most players get the same word; one, the spy, gets a similar one. Nobody is
// told which side they are on. In turn each describes their word in one
// message without saying it; then everyone talks for a minute and votes one
// player out. The others win when the spy is voted out; the spy wins when
// only two players are left.
//
// The page that starts a game deals: it picks the words, chooses the spy and
// sends each player their card sealed for them alone (Group.sealFor, inside
// the room's usual encryption), and later counts the votes, which are sealed
// for the dealer only, so they stay hidden until everyone's are in. The game
// state below is built the same way on every page from the same messages
// (the relay passes them on in one order), and only the dealer's page can
// move it on past a timeout. The dealer's page knows every card: a dealer who
// reads their own browser's memory could cheat. It is a party game.
//
// Nothing is kept: the game is gone with the room, or when the dealer leaves.

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;
export const SAY_MS = 45000;   // time for one description
export const TALK_MS = 60000;  // free talk before the vote
export const VOTE_MS = 30000;  // time to vote

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

const gameId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

// The dealer's secret part of a new game: who the spy is and both words.
// Returns { deal: { gid, players, order }, secret: { spy, words: { civ, spy } },
// cards: Map(player → word) }.
export function deal(players, lang) {
  const [a, b] = pick(pairsFor(lang));
  const [civ, spyWord] = crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? [a, b] : [b, a];
  const spy = pick(players);
  const cards = new Map(players.map((n) => [n, n === spy ? spyWord : civ]));
  return { deal: { gid: gameId(), players: players.slice().sort((x, y) => x - y), order: shuffle(players) }, secret: { spy, words: { civ, spy: spyWord } }, cards };
}

const GID = /^[0-9a-f]{12}$/;
const isNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 25;

// Whose turn it is to describe, or 0.
export const speaker = (s) => (s?.phase === 'say' ? s.speakers[s.turn] ?? 0 : 0);

// Applies one game event (the g field of a message from member `from`) to the
// state s (null when no game runs) and returns { s, note }: the new state and
// what happened, for the page to say. Events that do not fit are ignored
// (note null). `now` is when the message arrived here.
export function apply(s, g, from, now) {
  if (!g || typeof g !== 'object' || typeof g.k !== 'string') return { s, note: null };
  if (g.k === 'new') {
    if (s && s.phase !== 'over') return { s, note: null };
    const players = Array.isArray(g.players) ? g.players : [];
    const order = Array.isArray(g.order) ? g.order : [];
    if (!GID.test(g.gid ?? '') || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS || !players.every(isNumber) || !players.includes(from)) return { s, note: null };
    if (new Set(players).size !== players.length || order.length !== players.length || !order.every((n) => players.includes(n))) return { s, note: null };
    const next = { gid: g.gid, dealer: from, players: players.slice(), alive: players.slice(), order: order.slice(), round: 1, phase: 'say', speakers: order.slice(), turn: 0, deadline: now + SAY_MS, voted: [], said: {} };
    return { s: next, note: { k: 'new', by: from, players: next.players } };
  }
  if (!s || s.phase === 'over' || g.gid !== s.gid) return { s, note: null };
  const fromDealer = from === s.dealer;
  if ((g.k === 'say' && s.phase === 'say' && from === speaker(s)) || (g.k === 'skip' && fromDealer && s.phase === 'say' && g.n === speaker(s))) {
    const n = speaker(s);
    const next = { ...s, turn: s.turn + 1, deadline: now + SAY_MS };
    if (next.turn >= next.speakers.length) Object.assign(next, { phase: 'talk', deadline: now + TALK_MS });
    return { s: next, note: { k: g.k, n, talk: next.phase === 'talk' } };
  }
  if (g.k === 'vote' && fromDealer && s.phase === 'talk') {
    return { s: { ...s, phase: 'vote', deadline: now + VOTE_MS, voted: [] }, note: { k: 'vote' } };
  }
  if (g.k === 'ballot' && s.phase === 'vote' && s.alive.includes(from) && !s.voted.includes(from) && g.r === s.round) {
    return { s: { ...s, voted: [...s.voted, from] }, note: { k: 'ballot', n: from } };
  }
  if (g.k === 'result' && fromDealer && (s.phase === 'vote' || g.end)) {
    const out = s.alive.includes(g.out) ? g.out : 0;
    const votes = g.votes && typeof g.votes === 'object' ? g.votes : {};
    const alive = s.alive.filter((n) => n !== out);
    if (g.end && typeof g.end === 'object') {
      const end = { winner: g.end.winner === 'spy' ? 'spy' : 'civ', spy: g.end.spy, words: g.end.words ?? {}, why: g.end.why ?? '' };
      return { s: { ...s, alive, phase: 'over', end }, note: { k: 'result', out, votes, end } };
    }
    const order = s.order.filter((n) => alive.includes(n));
    return { s: { ...s, alive, round: s.round + 1, phase: 'say', speakers: order, turn: 0, deadline: now + SAY_MS, voted: [] }, note: { k: 'result', out, votes } };
  }
  if (g.k === 'abort' && fromDealer) {
    return { s: { ...s, phase: 'over', end: null }, note: { k: 'abort' } };
  }
  return { s, note: null };
}

// The dealer's count: ballots maps voter → choice (a player still in, or
// nothing). The one with the most votes is out; a tie puts nobody out.
// Returns { out, votes, end } for a 'result' event.
export function count(s, secret, ballots) {
  const votes = {};
  const tally = new Map();
  for (const [voter, choice] of ballots) {
    if (!s.alive.includes(voter) || !s.alive.includes(choice) || voter === choice) continue;
    votes[voter] = choice;
    tally.set(choice, (tally.get(choice) ?? 0) + 1);
  }
  const top = Math.max(0, ...tally.values());
  const leaders = [...tally].filter(([, v]) => v === top).map(([n]) => n);
  const out = top > 0 && leaders.length === 1 ? leaders[0] : 0;
  return { out, votes, end: ending(s.alive.filter((n) => n !== out), secret, out) };
}

// Whether the game is over once `out` has gone: the spy voted out (or gone
// from the room), or only two players left with the spy among them.
export function ending(alive, secret, out = 0, why = '') {
  const reveal = { spy: secret.spy, words: secret.words };
  if (out === secret.spy || !alive.includes(secret.spy)) return { winner: 'civ', ...reveal, why: why || 'caught' };
  if (alive.length <= 2) return { winner: 'spy', ...reveal, why: why || 'survived' };
  return null;
}
