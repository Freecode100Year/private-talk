// 麻将·血战入门: numbered suits only; one point wins, no kong payments.
const type = (id) => Math.floor(id / 4),
  suit = (id) => Math.floor(type(id) / 9);
const clone = (x) => JSON.parse(JSON.stringify(x));
export function isWinningHand(hand, missingSuit, meldCount = 0) {
  if (
    !Array.isArray(hand) ||
    !Number.isInteger(meldCount) ||
    meldCount < 0 ||
    meldCount > 4 ||
    hand.length !== 14 - 3 * meldCount ||
    new Set(hand).size !== hand.length ||
    hand.some((id) => !Number.isInteger(id) || id < 0 || id > 107)
  )
    return false;
  if (hand.length % 3 !== 2 || hand.some((c) => suit(c) === missingSuit))
    return false;
  const c = Array(27).fill(0);
  for (const id of hand) c[type(id)]++;
  if (hand.length === 14 && c.every((n) => n % 2 === 0)) return true;
  const groups = () => {
    let i = c.findIndex((n) => n);
    if (i < 0) return true;
    if (c[i] >= 3) {
      c[i] -= 3;
      if (groups()) {
        c[i] += 3;
        return true;
      }
      c[i] += 3;
    }
    if (i % 9 < 7 && c[i + 1] && c[i + 2]) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      let ok = groups();
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
      if (ok) return true;
    }
    return false;
  };
  for (let i = 0; i < 27; i++)
    if (c[i] >= 2) {
      c[i] -= 2;
      let ok = groups();
      c[i] += 2;
      if (ok) return true;
    }
  return false;
}
export class MahjongJudge {
  constructor(saved = null) {
    this.s = saved ? clone(saved) : null;
    this.audience = null;
  }
  get game() {
    return this.s;
  }
  get on() {
    return !!this.s && this.s.phase !== "over";
  }
  get deadline() {
    return this.s?.deadline || 0;
  }
  start(players, now = Date.now()) {
    if (
      this.on ||
      !Array.isArray(players) ||
      players.length !== 4 ||
      new Set(players).size !== 4 ||
      players.some((n) => !Number.isSafeInteger(n) || n <= 0)
    )
      return [];
    const wall = Array.from({ length: 108 }, (_, i) => i);
    for (let i = 107; i > 0; i--) {
      const limit = Math.floor(4294967296 / (i + 1)) * (i + 1);
      let value;
      do {
        value = crypto.getRandomValues(new Uint32Array(1))[0];
      } while (value >= limit);
      const k = value % (i + 1);
      [wall[i], wall[k]] = [wall[k], wall[i]];
    }
    this.s = {
      gid: globalThis.crypto.randomUUID(),
      revision: 1,
      phase: "suit",
      players: [...players],
      turn: players[0],
      deadline: now + 30000,
      wall,
      hands: {},
      melds: {},
      missing: {},
      scores: {},
      discards: [],
      winners: [],
      pending: null,
      last: null,
    };
    for (const p of players) {
      this.s.hands[p] = wall.splice(0, p === players[0] ? 14 : 13);
      this.s.melds[p] = [];
      this.s.missing[p] = null;
      this.s.scores[p] = 0;
    }
    return this.out();
  }
  out() {
    return (this.audience ?? this.s.players).map((to) => ({
      to,
      msg: { type: "cards", game: "mj", state: this.view(to) },
    }));
  }
  next(p) {
    let s = this.s,
      i = s.players.indexOf(p);
    do {
      i = (i + 1) % 4;
    } while (s.winners.includes(s.players[i]));
    return s.players[i];
  }
  eligible(p) {
    let s = this.s,
      q = s.pending;
    if (!q || p === q.from || s.winners.includes(p)) return [];
    const h = s.hands[p],
      a = [];
    if (isWinningHand([...h, q.card], s.missing[p], s.melds[p].length))
      a.push("hu");
    if (
      q.kind !== "rob" &&
      suit(q.card) !== s.missing[p] &&
      !h.some((c) => suit(c) === s.missing[p])
    ) {
      let n = h.filter((c) => type(c) === type(q.card)).length;
      if (n >= 3) a.push("kong");
      if (n >= 2) a.push("pong");
    }
    return a.length ? [...a, "pass"] : [];
  }
  kongs(p) {
    let s = this.s,
      h = s.hands[p];
    if (h.some((c) => suit(c) === s.missing[p])) return [];
    return h.filter(
      (c, i) =>
        h.findIndex((x) => type(x) === type(c)) === i &&
        (h.filter((x) => type(x) === type(c)).length === 4 ||
          s.melds[p].some(
            (m) => m.kind === "pong" && type(m.cards[0]) === type(c),
          )),
    );
  }
  view(p) {
    let s = this.s;
    if (!s) return null;
    let seated = s.players.includes(p),
      can = [],
      choices = [];
    if (seated) {
      if (s.phase === "suit" && s.missing[p] === null) {
        can = ["suit"];
        choices = [0, 1, 2];
      } else if (s.phase === "response" && !Object.hasOwn(s.pending.answers, p))
        can = this.eligible(p);
      else if (s.phase === "play" && s.turn === p) {
        can = ["discard"];
        if (isWinningHand(s.hands[p], s.missing[p], s.melds[p].length))
          can.push("hu");
        choices = this.kongs(p);
        if (choices.length) can.push("kong");
      } else if (s.phase === "over") can = ["next"];
    }
    return {
      type: "mj",
      gid: s.gid,
      revision: s.revision,
      phase: s.phase,
      players: [...s.players],
      turn: s.turn,
      deadline: s.deadline,
      hand: seated ? [...s.hands[p]].sort((a, b) => a - b) : [],
      counts: Object.fromEntries(s.players.map((n) => [n, s.hands[n].length])),
      scores: { ...s.scores },
      can,
      choices,
      missingSuit: seated ? s.missing[p] : null,
      missingSuits: { ...s.missing },
      melds: Object.fromEntries(
        s.players.map((n) => [
          n,
          s.melds[n].map((m) =>
            m.kind === "concealedKong" && n !== p
              ? { kind: m.kind, cards: [null, null, null, null] }
              : clone(m),
          ),
        ]),
      ),
      discards: clone(s.discards),
      winners: [...s.winners],
      last: clone(s.last),
      pending: s.pending
        ? { from: s.pending.from, card: s.pending.card, kind: s.pending.kind }
        : null,
      wallCount: s.wall.length,
    };
  }
  toJSON() {
    return clone(this.s);
  }
  members(list, now = Date.now()) {
    if (!this.s) return [];
    if (!Array.isArray(list)) return [];
    if (!list.length) {
      this.s = null;
      return [];
    }
    this.audience = [...new Set(list)];
    return this.out();
  }
  draw(p, now) {
    let s = this.s;
    if (!s.wall.length) {
      s.phase = "over";
      s.deadline = 0;
      return;
    }
    s.turn = p;
    s.hands[p].push(s.wall.pop());
    s.phase = "play";
    s.deadline = now + 30000;
  }
  win(p, from) {
    let s = this.s;
    s.winners.push(p);
    if (from === p) {
      for (const n of s.players)
        if (n !== p && !s.winners.includes(n)) {
          s.scores[n]--;
          s.scores[p]++;
        }
    } else {
      s.scores[from]--;
      s.scores[p]++;
    }
    s.last = { kind: "hu", player: p, from };
  }
  window(q, now) {
    let s = this.s;
    s.pending = { ...q, answers: {} };
    s.phase = "response";
    s.deadline = now + 12000;
    if (!s.players.some((p) => this.eligible(p).length)) this.resolve(now);
  }
  resolve(now) {
    let s = this.s,
      q = s.pending;
    let hu = s.players.filter((p) => q.answers[p] === "hu");
    if (hu.length) {
      if (q.kind === "rob") {
        s.hands[q.from].splice(s.hands[q.from].indexOf(q.card), 1);
        s.discards.push({ from: q.from, card: q.card });
      }
      for (const p of hu) this.win(p, q.from);
      s.pending = null;
      if (s.winners.length >= 3) {
        s.phase = "over";
        s.deadline = 0;
      } else this.draw(this.next(q.from), now);
      return;
    }
    if (q.kind === "rob") {
      let m = s.melds[q.from].find(
        (m) => m.kind === "pong" && type(m.cards[0]) === type(q.card),
      );
      s.hands[q.from].splice(s.hands[q.from].indexOf(q.card), 1);
      m.kind = "kong";
      m.cards.push(q.card);
      s.pending = null;
      this.draw(q.from, now);
      return;
    }
    let p = this.next(q.from),
      claim = null;
    for (let i = 0; i < 3; i++) {
      if (["pong", "kong"].includes(q.answers[p])) {
        claim = p;
        break;
      }
      p = this.next(p);
    }
    s.pending = null;
    if (claim !== null) {
      let kind = q.answers[claim],
        h = s.hands[claim],
        cards = h
          .filter((c) => type(c) === type(q.card))
          .slice(0, kind === "kong" ? 3 : 2);
      s.hands[claim] = h.filter((c) => !cards.includes(c));
      s.discards.pop();
      s.melds[claim].push({ kind, cards: [...cards, q.card], from: q.from });
      s.turn = claim;
      s.phase = "play";
      s.deadline = now + 30000;
      if (kind === "kong") this.draw(claim, now);
    } else this.draw(this.next(q.from), now);
  }
  handle(p, a, now = Date.now()) {
    let s = this.s;
    if (
      !s ||
      !a ||
      typeof a !== "object" ||
      Array.isArray(a) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(a)) ||
      typeof a.k !== "string" ||
      a.gid !== s.gid ||
      a.revision !== s.revision ||
      !s.players.includes(p)
    )
      return [];
    const keys = {
      suit: ["suit"],
      discard: ["card"],
      kong: ["card"],
      hu: [],
      pong: [],
      pass: [],
      next: [],
    };
    if (
      !Array.isArray(keys[a.k]) ||
      Object.keys(a).some(
        (k) => !["gid", "revision", "k", ...keys[a.k]].includes(k),
      ) ||
      !this.view(p).can.includes(a.k)
    )
      return [];
    if (a.k === "next") return this.start(s.players, now);
    if (a.k === "suit") {
      if (![0, 1, 2].includes(a.suit)) return [];
      s.missing[p] = a.suit;
      if (s.players.every((n) => s.missing[n] !== null)) s.phase = "play";
    } else if (s.phase === "response") {
      if (Object.hasOwn(a, "card")) return [];
      s.pending.answers[p] = a.k;
      const participants = s.players.filter((n) => this.eligible(n).length);
      if (participants.every((n) => Object.hasOwn(s.pending.answers, n)))
        this.resolve(now);
    } else if (a.k === "hu") {
      this.win(p, p);
      if (s.winners.length >= 3) {
        s.phase = "over";
        s.deadline = 0;
      } else this.draw(this.next(p), now);
    } else if (a.k === "discard") {
      const h = s.hands[p];
      if (
        !Number.isInteger(a.card) ||
        !h.includes(a.card) ||
        (h.some((c) => suit(c) === s.missing[p]) &&
          suit(a.card) !== s.missing[p])
      )
        return [];
      h.splice(h.indexOf(a.card), 1);
      s.discards.push({ from: p, card: a.card });
      s.last = { kind: "discard", player: p, card: a.card };
      this.window({ kind: "discard", from: p, card: a.card }, now);
    } else if (a.k === "kong") {
      if (!this.kongs(p).includes(a.card)) return [];
      const cards = s.hands[p].filter((c) => type(c) === type(a.card));
      if (cards.length === 4) {
        s.hands[p] = s.hands[p].filter((c) => !cards.includes(c));
        s.melds[p].push({ kind: "concealedKong", cards });
        this.draw(p, now);
      } else this.window({ kind: "rob", from: p, card: a.card }, now);
    }
    s.revision++;
    if (s.phase === "suit" || s.phase === "play") s.deadline = now + 30000;
    return this.out();
  }
  tick(now = Date.now()) {
    if (!this.on || now < this.deadline) return [];
    let s = this.s;
    if (s.phase === "response") {
      for (const p of s.players)
        if (this.eligible(p).length && !Object.hasOwn(s.pending.answers, p))
          s.pending.answers[p] = "pass";
      this.resolve(now);
      s.revision++;
      return this.out();
    }
    let p =
      s.phase === "suit"
        ? s.players.find((n) => s.missing[n] === null)
        : s.turn;
    let a;
    if (s.phase === "suit") {
      let counts = [0, 0, 0];
      s.hands[p].forEach((c) => counts[suit(c)]++);
      a = { k: "suit", suit: counts.indexOf(Math.min(...counts)) };
    } else {
      let h = s.hands[p];
      a = {
        k: "discard",
        card: h.find((c) => suit(c) === s.missing[p]) ?? h[0],
      };
    }
    return this.handle(p, { gid: s.gid, revision: s.revision, ...a }, now);
  }
}
