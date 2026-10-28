import test from "node:test";
import assert from "node:assert/strict";
import { MahjongJudge, isWinningHand } from "../src/mahjong.js";
const act = (j, n, a) =>
  j.handle(n, { gid: j.view(n).gid, revision: j.view(n).revision, ...a }, 0);
test("winning shapes and missing suit", () => {
  const h = [0, 1, 2, 4, 8, 12, 16, 20, 24, 28, 32, 36, 37, 38];
  assert.equal(isWinningHand(h, 2), true);
  assert.equal(isWinningHand(h, 0), false);
  assert.equal(isWinningHand(h.slice(1), 2), false);
});
test("four unique seats, secrecy and revisions", () => {
  let j = new MahjongJudge();
  assert.deepEqual(j.start([1, 1, 2, 3], 0), []);
  j.start([1, 2, 3, 4], 0);
  assert.equal(j.view(1).hand.length, 14);
  assert.equal(j.view(9).hand.length, 0);
  assert.equal("wall" in j.view(1), false);
  let r = j.view(1).revision;
  act(j, 1, { k: "suit", suit: 0 });
  j.handle(2, { gid: j.view(2).gid, revision: r, k: "suit", suit: 1 }, 0);
  assert.equal(j.view(2).missingSuit, null);
  assert.deepEqual(act(j, 2, { k: "suit", suit: 1, extra: 1 }), []);
});
test("complete timeout rounds preserve 108 tiles and restore", () => {
  for (let run = 0; run < 8; run++) {
    let j = new MahjongJudge();
    j.start([1, 2, 3, 4], 0);
    let n = 0;
    while (j.on && n++ < 700) {
      j.tick(j.deadline);
      j = new MahjongJudge(j.toJSON());
    }
    assert.ok(n < 700);
    assert.equal(j.view(1).phase, "over");
    const s = j.toJSON();
    let ids = [
      ...s.wall,
      ...Object.values(s.hands).flat(),
      ...s.discards.map((d) => d.card),
      ...Object.values(s.melds).flatMap((ms) => ms.flatMap((m) => m.cards)),
    ];
    assert.equal(ids.length, 108);
    assert.equal(new Set(ids).size, 108);
  }
});
function fixture() {
  let j = new MahjongJudge();
  j.start([1, 2, 3, 4], 0);
  let s = j.toJSON();
  s.phase = "response";
  s.turn = 1;
  s.missing = { 1: 2, 2: 2, 3: 2, 4: 2 };
  s.discards = [{ from: 1, card: 0 }];
  s.pending = { kind: "discard", from: 1, card: 0, answers: {} };
  s.hands = {
    1: [80],
    2: [1, 2, 3, 4, 8, 12, 16, 20, 24, 28, 32, 36, 37],
    3: [5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19, 38],
    4: [81],
  };
  return new MahjongJudge(s);
}
test("response windows wait and prioritize win over pung; duplicates fail", () => {
  let j = fixture();
  assert.ok(j.view(2).can.includes("pong"));
  assert.ok(j.view(2).can.includes("hu"));
  act(j, 2, { k: "hu" });
  let r = j.view(2).revision;
  assert.deepEqual(act(j, 2, { k: "hu" }), []);
  assert.equal(j.view(2).revision, r);
  j.tick(j.deadline);
  assert.ok(j.view(1).winners.includes(2));
  assert.equal(j.view(1).scores[1], -1);
  assert.equal(j.view(1).scores[2], 1);
});
test("wrong hand and wrong missing suit discard do not mutate", () => {
  let j = new MahjongJudge();
  j.start([1, 2, 3, 4], 0);
  for (let p = 1; p <= 4; p++) act(j, p, { k: "suit", suit: 0 });
  let s = j.toJSON();
  assert.deepEqual(act(j, 1, { k: "discard", card: 999 }), []);
  assert.deepEqual(j.toJSON(), s);
  let h = j.view(1).hand;
  if (
    h.some((c) => Math.floor(c / 36) === 0) &&
    h.some((c) => Math.floor(c / 36) !== 0)
  ) {
    assert.deepEqual(
      act(j, 1, {
        k: "discard",
        card: h.find((c) => Math.floor(c / 36) !== 0),
      }),
      [],
    );
  }
});
test("simultaneous winners are resolved together", () => {
  let j = fixture(),
    s = j.toJSON();
  s.hands[3] = [1, 2, 3, 4, 8, 12, 16, 20, 24, 28, 32, 36, 37];
  j = new MahjongJudge(s);
  act(j, 2, { k: "hu" });
  assert.deepEqual(j.view(1).winners, []);
  act(j, 3, { k: "hu" });
  assert.deepEqual(j.view(1).winners, [2, 3]);
  assert.equal(j.view(1).scores[1], -2);
});
test("robbing added kong leaves original pung intact", () => {
  let j = fixture(),
    s = j.toJSON();
  s.pending.kind = "rob";
  s.discards = [];
  s.hands[1] = [0, 80];
  s.melds[1] = [{ kind: "pong", cards: [1, 2, 3], from: 4 }];
  j = new MahjongJudge(s);
  assert.deepEqual(j.view(2).can, ["hu", "pass"]);
  act(j, 2, { k: "hu" });
  j.tick(j.deadline);
  assert.equal(j.view(1).melds[1][0].kind, "pong");
  assert.equal(j.view(1).hand.includes(0), false);
  assert.equal(j.view(1).discards[0].card, 0);
});
test("prototype and unknown actions are ignored", () => {
  let j = new MahjongJudge();
  j.start([1, 2, 3, 4], 0);
  for (const k of ["__proto__", "constructor", "nope"])
    assert.deepEqual(act(j, 1, { k }), []);
});
test("concealed kongs and reconnect projections remain private", () => {
  let j = new MahjongJudge();
  j.start([1, 2, 3, 4], 0);
  let s = j.toJSON();
  s.melds[1] = [{ kind: "concealedKong", cards: [0, 1, 2, 3] }];
  j = new MahjongJudge(s);
  assert.deepEqual(j.view(2).melds[1][0].cards, [null, null, null, null]);
  assert.deepEqual(j.view(1).melds[1][0].cards, [0, 1, 2, 3]);
  let out = j.members([2], 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].to, 2);
  assert.deepEqual(
    out[0].msg.state.hand,
    s.hands[2].sort((a, b) => a - b),
  );
  assert.equal(j.toJSON().players.length, 4);
  assert.deepEqual(j.members([], 0), []);
  assert.equal(j.toJSON(), null);
});
test("malformed action keys never throw", () => {
  const j = new MahjongJudge();
  j.start([1, 2, 3, 4], 0);
  assert.deepEqual(act(j, 1, { k: { toString: null } }), []);
});
test("spectator membership receives safe projections and retains seats", () => {
  const j = new MahjongJudge();
  j.start([1, 2, 3, 4], 0);
  const out = j.members([9], 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].to, 9);
  assert.deepEqual(out[0].msg.state.hand, []);
  assert.equal(j.toJSON().players.length, 4);
});
test("winning evaluator rejects duplicate or invalid physical IDs", () => {
  for (const h of [
    [0, 0],
    [-1, 0],
    [108, 109],
    [1.5, 2],
  ])
    assert.equal(isWinningHand(h, 2), false);
});
test("shuffle never uses Math.random", () => {
  const original = Math.random;
  Math.random = () => {
    throw Error("insecure random");
  };
  try {
    const j = new MahjongJudge();
    assert.equal(j.start([1, 2, 3, 4], 0).length, 4);
  } finally {
    Math.random = original;
  }
});
test("winning evaluator accounts for exposed meld count", () => {
  assert.equal(isWinningHand([0, 1], 2), false);
  assert.equal(isWinningHand([0, 1], 2, 4), true);
  assert.equal(isWinningHand([0, 1], 2, 3), false);
});
test("game getter exposes internal lifecycle for coordinator", () => {
  const j = new MahjongJudge();
  assert.equal(j.game, null);
  j.start([1, 2, 3, 4], 0);
  assert.deepEqual(j.game.players, [1, 2, 3, 4]);
  j.members([], 0);
  assert.equal(j.game, null);
});
