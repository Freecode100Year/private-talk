// Shared coordination for the two server-judged public card tables. Full
// state is saved only by the server; every network message is a seat's view.
import { GuandanJudge } from './guandan.js';
import { MahjongJudge } from './mahjong.js';

const JUDGES = { gd: GuandanJudge, mj: MahjongJudge };
export const isCardGame = kind => Object.hasOwn(JUDGES, kind);

export class CardTable {
  constructor(saved = null) {
    this.kind = isCardGame(saved?.kind) ? saved.kind : null;
    this.judge = this.kind ? new JUDGES[this.kind](saved.judge) : null;
  }
  get on() { return !!this.judge?.on; }
  get deadline() { return this.on ? this.judge.deadline : 0; }
  toJSON() { return this.judge ? { kind: this.kind, judge: this.judge.toJSON() } : null; }
  sync(mode, here, now, blocked = false) {
    if (this.on) return this.judge.members(here, now);
    if (!isCardGame(mode?.game) || blocked) return [];
    if (this.kind !== mode.game) {
      this.kind = mode.game;
      this.judge = new JUDGES[this.kind]();
    }
    if (!this.judge.game && here.length >= 4) return this.judge.start(here.slice(0, 4), now).concat(this.judge.members(here, now));
    return this.judge.members(here, now);
  }
  handle(n, action, now) {
    if (!this.judge?.game?.players?.includes(n)) return [];
    const out = this.judge.handle(n, action, now);
    if (out.length) return out;
    return [{ to: n, msg: { type: 'cards-error', code: 'illegal-action' } },
      { to: n, msg: { type: 'cards', game: this.kind, state: this.judge.view(n) } }];
  }
  tick(now) { return this.judge ? this.judge.tick(now) : []; }
}
