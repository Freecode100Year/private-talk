// Game modes directory (dist/modes.js): shared by the frontend and the server.
// Every mode represents a distinct way to play:
//   { id, game, players: [min, max], settings, public: boolean, group?: string, board?: string }
//
// Rules for id: lowercase letters and digits only, length <= 12.

import { BOARDS, boardsFor } from './werewolf.js';

// The 23 werewolf boards mapped to mode ids (all <= 12 characters).
const WW_BOARDS = [
  // 入门 (6–8 人)
  { id: 'ww6', board: 'b6', group: 'intro' },
  { id: 'ww7', board: 'b7', group: 'intro' },
  { id: 'ww8', board: 'b8', group: 'intro' },
  // 特殊
  { id: 'ww8hunters', board: 'b8hunters', group: 'special' },
  // 标准 (9–11 人)
  { id: 'ww9', board: 'b9', group: 'standard' },
  { id: 'ww9guard', board: 'b9guard', group: 'standard' },
  { id: 'ww10', board: 'b10', group: 'standard' },
  { id: 'ww10idiot', board: 'b10idiot', group: 'standard' },
  { id: 'ww11', board: 'b11', group: 'standard' },
  // 12 人进阶 (全部 14 个板子)
  { id: 'ww12', board: 'b12', group: 'advanced' },
  { id: 'ww12guard', board: 'b12guard', group: 'advanced' },
  { id: 'ww12king', board: 'b12king', group: 'advanced' },
  { id: 'ww12white', board: 'b12white', group: 'advanced' },
  { id: 'ww12hidden', board: 'b12hidden', group: 'advanced' },
  { id: 'ww12beauty', board: 'b12beauty', group: 'advanced' },
  { id: 'ww12knight', board: 'b12knight', group: 'advanced' },
  { id: 'ww12gargoyle', board: 'b12gargoyle', group: 'advanced' },
  { id: 'ww12apoth', board: 'b12apothecary', group: 'advanced' },
  { id: 'ww12cupid', board: 'b12cupid', group: 'advanced' },
  { id: 'ww12dreamer', board: 'b12dreamer', group: 'advanced' },
  { id: 'ww12magician', board: 'b12magician', group: 'advanced' },
  { id: 'ww12bigwolf', board: 'b12bigwolf', group: 'advanced' },
  { id: 'ww12thief', board: 'b12thief', group: 'advanced' }
];

export const WW_TIERS = [6, 7, 8, 9, 10, 11, 12];

const wwModes = WW_BOARDS.map((item) => {
  const b = BOARDS[item.board];
  const n = b ? b.n : 6;
  return {
    id: item.id,
    game: 'ww',
    players: [n, n],
    settings: { board: item.board, sheriff: b && b.sheriff !== undefined ? !!b.sheriff : n >= 12 },
    public: true,
    group: item.group,
    board: item.board
  };
});

const otherModes = [
  { id: 'gd', game: 'gd', players: [4, 4], settings: {}, public: true, publicOnly: true },
  { id: 'mj', game: 'mj', players: [4, 4], settings: {}, public: true, publicOnly: true },
  // 暗号潜伏：经典 (4–8)
  { id: 'spy', game: 'spy', players: [4, 8], settings: {}, public: true },
  // 骗子骰：经典 (2–8)、1 点万能 (2–8)
  { id: 'ld', game: 'ld', players: [2, 8], settings: { wild: false }, public: true },
  { id: 'ldwild', game: 'ld', players: [2, 8], settings: { wild: true }, public: true },
  // 密约交易所 (2–8)
  { id: 'tr', game: 'tr', players: [2, 8], settings: {}, public: true },
  // 秘密任务 (3–8)
  { id: 'sm', game: 'sm', players: [3, 8], settings: {}, public: true },
  // 密电逃脱 (2–8，只在私密房间，公开桌不提供)
  { id: 'esc', game: 'esc', players: [2, 8], settings: {}, public: false }
];

export const MODES = wwModes.concat(otherModes);

export const MODES_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));

export function modeOf(id) {
  if (typeof id !== 'string') return null;
  return MODES_BY_ID[id] || null;
}

export function isPublicMode(id) {
  const m = modeOf(id);
  return !!(m && m.public);
}

export function modesFor(game) {
  return MODES.filter((m) => m.game === game);
}

export function publicModes() {
  return MODES.filter((m) => m.public);
}

// Maps legacy public table specifications to default mode.
export function defaultModeFor(game, seats = 0) {
  if (game === 'ww') {
    const list = boardsFor(seats);
    const targetBoard = list.length ? list[0] : (seats ? 'b' + seats : 'b6');
    const found = wwModes.find((m) => m.settings.board === targetBoard);
    return found || wwModes[0];
  }
  if (game === 'gd' || game === 'mj') return modeOf(game);
  if (game === 'spy') return modeOf('spy');
  if (game === 'ld') return modeOf('ld');
  if (game === 'tr') return modeOf('tr');
  if (game === 'sm') return modeOf('sm');
  if (game === 'esc') return modeOf('esc');
  return null;
}

// Automatically formats role composition from BOARDS[boardId]:
// e.g. "9 人 · 3 狼人 预言家 女巫 猎人 3 村民"
export function boardRoleSummary(boardId, roleNameFn, peopleWord = '人') {
  const b = BOARDS[boardId];
  if (!b) return '';
  const counts = new Map();
  for (const r of b.cards) {
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  const parts = [];
  counts.forEach((n, r) => {
    const name = roleNameFn ? roleNameFn(r) : r;
    parts.push(n > 1 ? `${n} ${name}` : name);
  });
  return `${b.n} ${peopleWord} · ${parts.join(' ')}`;
}
