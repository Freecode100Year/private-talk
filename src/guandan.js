// IDs preserve both physical copies. Suits: clubs, diamonds, hearts, spades.
const info = (id) => {
  const x = id % 54;
  return {
    rank: x < 52 ? (x % 13) + 2 : x === 52 ? 15 : 16,
    suit: x < 52 ? Math.floor(x / 13) : -1,
  };
};
const power = (r, l) => (r >= 15 ? r + 3 : r === l ? 17 : r);
export function classifyGuandan(cards, level = 2, kind = null) {
  if (
    !Array.isArray(cards) ||
    !cards.length ||
    new Set(cards).size !== cards.length ||
    cards.some((x) => !Number.isInteger(x) || x < 0 || x > 107)
  )
    return null;
  const cs = cards.map(info),
    n = cs.length,
    w = cs.filter((c) => c.suit === 2 && c.rank === level).length,
    normal = cs.filter((c) => !(c.suit === 2 && c.rank === level));
  const accepts = (type) => kind === null || kind === type;
  const result = (type, value) => ({ type, value, size: n });
  if (accepts("fourjokers") && n === 4 && cs.every((c) => c.rank >= 15))
    return result("fourjokers", 100);
  if (accepts("single") && n === 1)
    return result("single", power(cs[0].rank, level));
  const fit = (groups) => {
    const counts = new Map();
    for (const c of normal) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
    let missing = 0;
    for (const [r, count] of groups) {
      const have = counts.get(r) || 0;
      if (have > count) return false;
      missing += count - have;
      counts.delete(r);
    }
    return counts.size === 0 && missing === w;
  };
  for (const [type, count] of [
    ["pair", 2],
    ["triple", 3],
  ])
    if (accepts(type) && n === count)
      for (const r of Array.from({ length: 15 }, (_, i) => i + 2).sort(
        (a, b) => power(b, level) - power(a, level),
      ))
        if ((r < 15 || !w) && fit([[r, count]]))
          return result(type, power(r, level));
  if (accepts("bomb") && n >= 4 && n <= 10)
    for (let r = 14; r >= 2; r--)
      if (fit([[r, n]])) return result("bomb", power(r, level));
  if (accepts("fullhouse") && n === 5)
    for (const r of Array.from({ length: 13 }, (_, i) => i + 2).sort(
      (a, b) => power(b, level) - power(a, level),
    ))
      for (let p = 14; p >= 2; p--)
        if (
          r !== p &&
          fit([
            [r, 3],
            [p, 2],
          ])
        )
          return result("fullhouse", power(r, level));
  for (const [type, length, multiple] of [
    ["straight", 5, 1],
    ["threepairs", 3, 2],
    ["twotriples", 2, 3],
  ])
    if (
      (accepts(type) || (type === "straight" && accepts("straightflush"))) &&
      n === length * multiple
    ) {
      for (let end = 14; end >= length + 1; end--) {
        const ranks = Array.from({ length }, (_, i) => end - length + 1 + i);
        if (fit(ranks.map((r) => [r, multiple]))) {
          if (
            accepts("straightflush") &&
            type === "straight" &&
            normal.every((c) => c.suit === normal[0]?.suit)
          )
            return result("straightflush", end);
          if (accepts(type)) return result(type, end);
        }
      } // A2345 / AA2233 etc, A acts below 2.
      const ranks = [
        14,
        ...Array.from({ length: length - 1 }, (_, i) => i + 2),
      ];
      if (
        fit(ranks.map((r) => [r, multiple])) &&
        (accepts(type) ||
          (accepts("straightflush") &&
            type === "straight" &&
            normal.every((c) => c.suit === normal[0]?.suit)))
      )
        return result(
          accepts("straightflush") &&
            type === "straight" &&
            normal.every((c) => c.suit === normal[0]?.suit)
            ? "straightflush"
            : type,
          length,
        );
    }
  return null;
}
export function compareGuandan(a, b) {
  if (!a) return -1;
  if (!b) return 1;
  const tier = (x) =>
    x.type === "fourjokers"
      ? 100
      : x.type === "straightflush"
        ? 5.5
        : x.type === "bomb"
          ? x.size
          : 0;
  const ta = tier(a),
    tb = tier(b);
  if (ta || tb) return ta !== tb ? ta - tb : a.value - b.value;
  return a.type === b.type && a.size === b.size ? a.value - b.value : -1;
}
const clone = (x) => JSON.parse(JSON.stringify(x));
export class GuandanJudge {
  constructor(saved = null) {
    this.s = saved ? clone(saved) : null;
    this.audience = [];
  }
  get game() {
    return this.s;
  }
  get on() {
    return !!this.s && this.s.phase !== "end";
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
      players.some((n) => !Number.isInteger(n) || n <= 0)
    )
      return [];
    this.audience = [...players];
    this.s = {
      gid: crypto.randomUUID(),
      revision: 0,
      players: [...players],
      phase: "play",
      turn: players[0],
      deadline: now + 30000,
      hands: {},
      scores: Object.fromEntries(players.map((n) => [n, 0])),
      levels: [2, 2],
      level: 2,
      finished: [],
      lastPlay: null,
      passed: [],
      pile: [],
      round: 1,
      exchanges: [],
    };
    this.deal();
    return this.emit();
  }
  deal() {
    const d = Array.from({ length: 108 }, (_, i) => i);
    for (let i = 107; i > 0; i--) {
      let v;
      const limit = Math.floor(4294967296 / (i + 1)) * (i + 1);
      do {
        v = crypto.getRandomValues(new Uint32Array(1))[0];
      } while (v >= limit);
      const k = v % (i + 1);
      [d[i], d[k]] = [d[k], d[i]];
    }
    this.s.players.forEach(
      (p, i) => (this.s.hands[p] = d.slice(i * 27, i * 27 + 27)),
    );
  }
  emit() {
    return [...new Set([...this.s.players, ...this.audience])].map((n) => ({
      to: n,
      msg: { type: "cards", game: "gd", state: this.view(n) },
    }));
  }
  view(n) {
    if (!this.s) return null;
    const s = this.s,
      seated = s.players.includes(n);
    let can = [];
    if (seated) {
      if (s.phase === "end") can = ["next"];
      else if (s.turn === n)
        can =
          s.phase === "play"
            ? s.lastPlay
              ? ["play", "pass"]
              : ["play"]
            : [s.phase];
    }
    return {
      type: "gd",
      gid: s.gid,
      revision: s.revision,
      phase: s.phase,
      players: [...s.players],
      turn: s.turn,
      deadline: s.deadline,
      hand: seated ? [...s.hands[n]] : [],
      counts: Object.fromEntries(s.players.map((p) => [p, s.hands[p].length])),
      scores: { ...s.scores },
      can,
      lastPlay: clone(s.lastPlay),
      finished: [...s.finished],
      level: s.level,
      levels: [...s.levels],
      round: s.round,
      exchanges: clone(s.exchanges),
    };
  }
  toJSON() {
    return clone(this.s);
  }
  members(list, now) {
    if (!Array.isArray(list)) return [];
    if (!list.length) {
      this.s = null;
      this.audience = [];
      return [];
    }
    this.audience = [...list];
    return this.s ? this.emit() : [];
  }
  nextSeat(n) {
    let i = this.s.players.indexOf(n);
    do {
      i = (i + 1) % 4;
    } while (this.s.finished.includes(this.s.players[i]));
    return this.s.players[i];
  }
  handle(n, a, now = Date.now()) {
    const s = this.s;
    if (
      !s ||
      !a ||
      a.gid !== s.gid ||
      a.revision !== s.revision ||
      !s.players.includes(n)
    )
      return [];
    const schema = {
      play: ["cards", "kind"],
      pass: [],
      tribute: ["card"],
      return: ["card"],
      next: [],
    };
    if (
      typeof a.k !== "string" ||
      !Object.hasOwn(schema, a.k) ||
      (Object.getPrototypeOf(a) !== Object.prototype &&
        Object.getPrototypeOf(a) !== null) ||
      Object.keys(a).some(
        (k) => !["gid", "revision", "k", ...schema[a.k]].includes(k),
      ) ||
      (Object.hasOwn(a, "kind") && typeof a.kind !== "string")
    )
      return [];
    if (s.phase === "end") {
      if (a.k !== "next") return [];
      this.newRound(now);
      return this.emit();
    }
    if (n !== s.turn) return [];
    if (s.phase === "tribute" || s.phase === "return") {
      if (a.k !== s.phase || !s.hands[n].includes(a.card)) return [];
      const ex = s.exchanges.find((e) =>
        s.phase === "tribute"
          ? e.given === undefined
          : e.returned === undefined,
      );
      if (s.phase === "tribute") {
        const eligible = s.hands[n].filter(
          (id) => !(info(id).suit === 2 && info(id).rank === s.level),
        );
        const high = Math.max(
          ...eligible.map((id) => power(info(id).rank, s.level)),
        );
        if (
          power(info(a.card).rank, s.level) !== high ||
          !eligible.includes(a.card)
        )
          return [];
        ex.given = a.card;
        s.hands[n].splice(s.hands[n].indexOf(a.card), 1);
        s.hands[ex.to].push(a.card);
      } else {
        const low = s.hands[n].filter(
          (c) => info(c).rank <= 10 && info(c).rank !== s.level,
        );
        if (
          low.length
            ? !low.includes(a.card)
            : power(info(a.card).rank, s.level) !==
              Math.min(...s.hands[n].map((c) => power(info(c).rank, s.level)))
        )
          return [];
        ex.returned = a.card;
        s.hands[n].splice(s.hands[n].indexOf(a.card), 1);
        s.hands[ex.from].push(a.card);
      }
      this.advanceExchange();
    } else if (a.k === "play") {
      if (
        !Array.isArray(a.cards) ||
        a.cards.some((c) => !s.hands[n].includes(c))
      )
        return [];
      let c;
      if (a.kind) c = classifyGuandan(a.cards, s.level, a.kind);
      else {
        const matching = s.lastPlay
          ? classifyGuandan(a.cards, s.level, s.lastPlay.combo.type)
          : null;
        c =
          matching && compareGuandan(matching, s.lastPlay.combo) > 0
            ? matching
            : classifyGuandan(a.cards, s.level);
      }
      if (!c || compareGuandan(c, s.lastPlay?.combo) <= 0) return [];
      s.hands[n] = s.hands[n].filter((id) => !a.cards.includes(id));
      s.pile.push(...a.cards);
      s.lastPlay = { player: n, cards: [...a.cards], combo: c };
      s.passed = [];
      if (!s.hands[n].length) s.finished.push(n);
      if (s.finished.length === 3) {
        s.finished.push(s.players.find((p) => !s.finished.includes(p)));
        this.finish();
      } else s.turn = this.nextSeat(n);
    } else if (a.k === "pass" && s.lastPlay) {
      s.passed.push(n);
      const eligible = s.players.filter(
        (p) => !s.finished.includes(p) && p !== s.lastPlay.player,
      );
      if (eligible.every((p) => s.passed.includes(p))) {
        const leader = s.lastPlay.player;
        s.turn = s.finished.includes(leader) ? this.partner(leader) : leader;
        if (s.finished.includes(s.turn)) s.turn = this.nextSeat(leader);
        s.lastPlay = null;
        s.passed = [];
      } else s.turn = this.nextSeat(n);
    } else return [];
    s.revision++;
    s.deadline = now + 30000;
    return this.emit();
  }
  partner(p) {
    return this.s.players[(this.s.players.indexOf(p) + 2) % 4];
  }
  finish() {
    const s = this.s,
      first = s.finished[0],
      mate = this.partner(first),
      pos = s.finished.indexOf(mate),
      gain = pos === 1 ? 3 : pos === 2 ? 2 : 1,
      team = s.players.indexOf(first) % 2;
    s.levels[team] = Math.min(14, s.levels[team] + gain);
    s.winner = first;
    s.level = s.levels[team];
    s.players.forEach(
      (p) => (s.scores[p] += s.players.indexOf(p) % 2 === team ? gain : 0),
    );
    s.phase = "end";
    s.turn = null;
  }
  newRound(now) {
    const s = this.s,
      order = [...s.finished];
    s.round++;
    this.deal();
    s.finished = [];
    s.lastPlay = null;
    s.passed = [];
    s.pile = [];
    s.exchanges =
      this.partner(order[0]) === order[1]
        ? [
            { from: order[3], to: order[0] },
            { from: order[2], to: order[1] },
          ]
        : [{ from: order[3], to: order[0] }];
    const payers = s.exchanges.map((e) => e.from);
    const big = payers
      .flatMap((p) => s.hands[p])
      .filter((c) => info(c).rank === 16).length;
    if (big === 2) s.exchanges = [];
    s.phase = s.exchanges.length ? "tribute" : "play";
    s.turn = s.exchanges[0]?.from || order[0];
    s.revision++;
    s.deadline = now + 30000;
  }
  advanceExchange() {
    const s = this.s,
      next = s.exchanges.find((e) => e.given === undefined);
    if (next) {
      s.phase = "tribute";
      s.turn = next.from;
      return;
    }
    const ret = s.exchanges.find((e) => e.returned === undefined);
    if (ret) {
      s.phase = "return";
      s.turn = ret.to;
      return;
    }
    s.phase = "play";
    s.turn = s.exchanges[0].from;
  }
  tick(now = Date.now()) {
    const s = this.s;
    if (!this.on || now < s.deadline) return [];
    const n = s.turn,
      a = { gid: s.gid, revision: s.revision };
    if (s.phase === "play") {
      if (s.lastPlay) a.k = "pass";
      else {
        a.k = "play";
        a.cards = [
          s.hands[n].reduce((best, c) =>
            power(info(c).rank, s.level) < power(info(best).rank, s.level)
              ? c
              : best,
          ),
        ];
      }
    } else {
      a.k = s.phase;
      const h = s.hands[n];
      if (s.phase === "tribute")
        a.card = h
          .filter((c) => !(info(c).suit === 2 && info(c).rank === s.level))
          .sort(
            (a, b) =>
              power(info(b).rank, s.level) - power(info(a).rank, s.level),
          )[0];
      else
        a.card =
          h.filter((c) => info(c).rank <= 10 && info(c).rank !== s.level)[0] ??
          [...h].sort(
            (a, b) =>
              power(info(a).rank, s.level) - power(info(b).rank, s.level),
          )[0];
    }
    return this.handle(n, a, now);
  }
}
