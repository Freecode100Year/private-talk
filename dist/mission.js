// 秘密任务 (Secret mission): a game of getting others to say things.
//
// For eight minutes every player has a secret mission: get one other player
// (the target) to write a given word in the chat. Each page draws its own
// mission at random and sends only a commitment to it (a hash of target, word
// and a random salt), so nobody else, the page that started the game
// included, knows it. When the target's message has the word, the page says
// so and shows the mission, and every page checks the commitment and the
// message for itself: 3 points, and a new mission is drawn.
//
// Anyone may try to catch a player by guessing their word. The guessed page
// answers by itself: a right guess shows the mission (checked against the
// commitment; 2 points to the guesser, the mission is lost), a wrong one
// costs the guesser a point. A page made to deny a right guess is caught
// out when the mission is shown later, at the latest when the game ends.
// Nothing is kept afterwards.

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const GAME_MS = 8 * 60000;
export const ANSWER_MS = 20000;   // for a guessed page to answer
export const POINTS = { done: 3, caught: 2, wrong: -1, cheat: -5 };

// Words people say anyway, so that getting someone to say one takes a little
// steering but not much.
const WORDS = {
  'zh-Hans': ['周末', '咖啡', '电影', '火锅', '作业', '旅行', '下雨', '生日', '老板', '睡觉', '猫', '狗', '手机', '奶茶', '加班', '早餐', '地铁', '音乐', '游泳', '跑步',
    '饺子', '月亮', '大海', '冬天', '夏天', '考试', '医生', '朋友', '妈妈', '红色', '蓝色', '冰淇淋', '蛋糕', '火车', '飞机', '书店', '公园', '照片', '电脑', '游戏',
    '下班', '外卖', '面条', '西瓜', '感冒', '头发', '眼镜', '雨伞', '钥匙', '钱包', '水果', '巧克力', '啤酒', '茶', '星星', '太阳', '花', '树', '山', '雪'],
  'zh-Hant': ['週末', '咖啡', '電影', '火鍋', '作業', '旅行', '下雨', '生日', '老闆', '睡覺', '貓', '狗', '手機', '奶茶', '加班', '早餐', '捷運', '音樂', '游泳', '跑步',
    '餃子', '月亮', '大海', '冬天', '夏天', '考試', '醫生', '朋友', '媽媽', '紅色', '藍色', '冰淇淋', '蛋糕', '火車', '飛機', '書店', '公園', '照片', '電腦', '遊戲',
    '下班', '外送', '麵', '西瓜', '感冒', '頭髮', '眼鏡', '雨傘', '鑰匙', '錢包', '水果', '巧克力', '啤酒', '茶', '星星', '太陽', '花', '樹', '山', '雪'],
  en: ['weekend', 'coffee', 'movie', 'pizza', 'homework', 'holiday', 'rain', 'birthday', 'boss', 'sleep', 'cat', 'dog', 'phone', 'tea', 'breakfast', 'train', 'music', 'swim', 'run', 'beach',
    'moon', 'winter', 'summer', 'exam', 'doctor', 'friend', 'mom', 'red', 'blue', 'ice cream', 'cake', 'plane', 'park', 'photo', 'computer', 'game', 'lunch', 'noodles', 'cold', 'hair',
    'glasses', 'umbrella', 'keys', 'wallet', 'fruit', 'chocolate', 'beer', 'star', 'sun', 'flower', 'tree', 'mountain', 'snow', 'book', 'dance', 'cook', 'bus', 'money', 'garden', 'song']
};
export function wordsFor(lang) {
  if (lang === 'zh-TW' || lang === 'zh-Hant') return WORDS['zh-Hant'];
  if (String(lang).startsWith('zh')) return WORDS['zh-Hans'];
  return WORDS.en;
}

const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const gameId = () => hex(crypto.getRandomValues(new Uint8Array(6)));

// Words compare without case or surrounding spaces.
export const norm = (w) => String(w).trim().toLowerCase().normalize('NFKC');
// Whether a chat message counts as saying word: anywhere in it for words in
// scripts without spaces, as a whole word otherwise.
export function says(text, word) {
  const t = norm(text), w = norm(word);
  if (!w) return false;
  if (!/^[\p{Script=Latin}\d ]+$/u.test(w)) return t.includes(w);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(t);
}

async function digest(gid, n, target, word, salt) {
  const data = new TextEncoder().encode(`private-talk/mission|${gid}|${n}|${target}|${norm(word)}|${salt}`);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}
// This page (player n) draws a mission: { target, word, salt, h }.
export async function draw(gid, n, players, lang, avoid = []) {
  const others = players.filter((x) => x !== n);
  const words = wordsFor(lang).filter((w) => !avoid.includes(w));
  const target = others[rand(others.length)];
  const word = words[rand(words.length)];
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { target, word, salt, h: await digest(gid, n, target, word, salt) };
}
// Whether a shown mission matches player n's commitment h.
export async function check(gid, n, h, target, word, salt) {
  if (!Number.isInteger(target) || typeof word !== 'string' || !word || word.length > 40 || typeof salt !== 'string' || !/^[0-9a-f]{32}$/.test(salt) || typeof h !== 'string') return false;
  return (await digest(gid, n, target, word, salt)) === h;
}

const GID = /^[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const isNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 25;

// Applies one game event to the state s (see game.js apply). Mission states
// have type 'sm'; their events have kinds starting with 'sm-', and 'abort'.
// The page checks shown missions before calling this and passes ok:
//   sm-done: the commitment matches, and the message mid is from the target,
//     came after the commitment and says the word;
//   sm-ans (yes) and sm-show: the commitment matches (for sm-ans, with the
//     guessed word).
export function apply(s, g, from, now) {
  if (!g || typeof g !== 'object' || typeof g.k !== 'string') return { s, note: null };
  if (g.k === 'sm-new') {
    if (s && s.phase !== 'over') return { s, note: null };
    const players = Array.isArray(g.players) ? g.players : [];
    if (!GID.test(g.gid ?? '') || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS || !players.every(isNumber) || !players.includes(from) || new Set(players).size !== players.length) return { s, note: null };
    const zero = Object.fromEntries(players.map((n) => [n, 0]));
    const next = { type: 'sm', gid: g.gid, dealer: from, players: players.slice(), phase: 'play', deadline: now + GAME_MS, missions: {}, guesses: {}, score: zero, done: { ...zero } };
    return { s: next, note: { k: 'sm-new', by: from, players: next.players } };
  }
  if (!s || s.type !== 'sm' || g.gid !== s.gid) return { s, note: null };
  const fromDealer = from === s.dealer;
  const playing = s.players.includes(from);
  const mine = s.missions[from];
  const add = (score, n, p) => ({ ...score, [n]: score[n] + p });
  // A mission shown with a word that was guessed and denied before: cheat.
  const denied = (n, word) => (s.missions[n]?.denied ?? []).some((w) => norm(w) === norm(word));
  if (s.phase === 'play') {
    if (g.k === 'sm-pick' && playing && !mine && HASH.test(g.h ?? '')) {
      return { s: { ...s, missions: { ...s.missions, [from]: { h: g.h, denied: [] } } }, note: null };
    }
    if (g.k === 'sm-done' && mine && g.h === mine.h && g.ok === true) {
      const missions = { ...s.missions };
      delete missions[from];
      const guesses = { ...s.guesses };
      delete guesses[from];
      if (denied(from, g.word)) return { s: { ...s, missions, guesses, score: add(s.score, from, POINTS.cheat) }, note: { k: 'sm-cheat', n: from, word: g.word } };
      return { s: { ...s, missions, guesses, score: add(s.score, from, POINTS.done), done: add(s.done, from, 1) }, note: { k: 'sm-done', n: from, target: g.target, word: g.word } };
    }
    if (g.k === 'sm-guess' && playing && s.missions[g.n] && g.n !== from && !s.guesses[g.n] && typeof g.word === 'string' && g.word.trim() && g.word.length <= 40) {
      return { s: { ...s, guesses: { ...s.guesses, [g.n]: { by: from, word: g.word.trim(), at: now } } }, note: { k: 'sm-guess', by: from, n: g.n, word: g.word.trim() } };
    }
    const guess = s.guesses[from];
    if (g.k === 'sm-ans' && guess && mine) {
      const guesses = { ...s.guesses };
      delete guesses[from];
      if (g.yes === true && g.ok === true && norm(g.word) === norm(guess.word)) {
        const missions = { ...s.missions };
        delete missions[from];
        return { s: { ...s, missions, guesses, score: add(s.score, guess.by, POINTS.caught) }, note: { k: 'sm-caught', n: from, by: guess.by, target: g.target, word: g.word } };
      }
      if (g.yes === false) {
        const missions = { ...s.missions, [from]: { ...mine, denied: [...mine.denied, guess.word] } };
        return { s: { ...s, missions, guesses, score: add(s.score, guess.by, POINTS.wrong) }, note: { k: 'sm-wrong', n: from, by: guess.by, word: guess.word } };
      }
      return { s, note: null };
    }
    if (g.k === 'sm-void' && fromDealer && s.guesses[g.n]) {
      const guesses = { ...s.guesses };
      delete guesses[g.n];
      return { s: { ...s, guesses }, note: { k: 'sm-void', n: g.n } };
    }
    if (g.k === 'sm-end' && fromDealer) {
      const top = Math.max(...s.players.map((n) => s.score[n]));
      return { s: { ...s, phase: 'over', guesses: {}, end: { winners: s.players.filter((n) => s.score[n] === top), score: s.score, done: s.done } }, note: { k: 'sm-end' } };
    }
  }
  // After the end every page shows the mission it still had.
  if (g.k === 'sm-show' && s.phase === 'over' && s.end && mine && !mine.shown && g.ok === true) {
    const missions = { ...s.missions, [from]: { ...mine, shown: true } };
    if (denied(from, g.word)) {
      const score = add(s.score, from, POINTS.cheat);
      return { s: { ...s, missions, score, end: { ...s.end, score } }, note: { k: 'sm-cheat', n: from, word: g.word } };
    }
    return { s: { ...s, missions }, note: { k: 'sm-show', n: from, target: g.target, word: g.word } };
  }
  if (g.k === 'abort' && fromDealer && s.phase !== 'over') return { s: { ...s, phase: 'over', end: null }, note: { k: 'abort' } };
  return { s, note: null };
}

// What the dealer's page sends, if anything: the end when time is up; a
// guess that went unanswered for ANSWER_MS is dropped.
export function dealerMove(s, now) {
  if (s.phase !== 'play') return null;
  if (now >= s.deadline) return { k: 'sm-end', gid: s.gid };
  const stale = Object.entries(s.guesses).find(([, x]) => now - x.at >= ANSWER_MS);
  return stale ? { k: 'sm-void', gid: s.gid, n: Number(stale[0]) } : null;
}

export function newGame(players) {
  return { k: 'sm-new', gid: gameId(), players: players.slice().sort((a, b) => a - b) };
}
