import test from "node:test";
import assert from "node:assert/strict";
import {
  GuandanJudge,
  classifyGuandan,
  compareGuandan,
} from "../src/guandan.js";
test("classification and wildcard", () => {
  assert.equal(classifyGuandan([0, 54], 2).type, "pair");
  assert.equal(classifyGuandan([26, 1], 2).type, "pair");
  assert.equal(classifyGuandan([52, 53, 106, 107], 2).type, "fourjokers");
  assert.equal(classifyGuandan([0, 1, 2, 3, 4], 2).type, "straightflush");
  assert.ok(
    compareGuandan(
      classifyGuandan([52, 53, 106, 107], 2),
      classifyGuandan([0, 1, 2, 3, 4], 2),
    ) > 0,
  );
});
test("security, conservation, restore and complete autoplay", () => {
  let j = new GuandanJudge();
  assert.deepEqual(j.start([1, 1, 2, 3], 0), []);
  j.start([1, 2, 3, 4], 0);
  assert.equal(new Set([1, 2, 3, 4].flatMap((n) => j.view(n).hand)).size, 108);
  assert.equal(j.view(9).hand.length, 0);
  assert.deepEqual(j.view(9).can, []);
  let v = j.view(1),
    s = JSON.stringify(j.toJSON());
  j.handle(2, { gid: v.gid, revision: v.revision, k: "play", cards: [999] }, 1);
  assert.equal(JSON.stringify(j.toJSON()), s);
  j = new GuandanJudge(JSON.parse(s));
  assert.deepEqual(j.view(1), v);
  j.members([1, 9], 2);
  assert.equal(j.view(2).hand.length, 27);
  let steps = 0;
  while (j.view(1).phase === "play" && steps++ < 1000) j.tick(j.deadline + 1);
  assert.ok(steps < 1000);
  assert.equal(j.view(1).phase, "end");
  assert.equal(j.view(1).finished.length, 4);
  v = j.view(1);
  j.handle(1, { gid: v.gid, revision: v.revision, k: "next" }, j.deadline + 1);
  assert.ok(["play", "tribute"].includes(j.view(1).phase));
});
test("all major shapes and bomb ordering", () => {
  const c = (x) => classifyGuandan(x, 2);
  assert.equal(c([1, 55, 14]).type, "triple");
  assert.equal(c([1, 55, 14, 2, 56]).type, "fullhouse");
  assert.equal(c([1, 55, 2, 56, 3, 57]).type, "threepairs");
  assert.equal(c([1, 55, 14, 2, 56, 15]).type, "twotriples");
  assert.equal(c([1, 55, 14, 68]).type, "bomb");
  assert.ok(compareGuandan(c([0, 1, 2, 3, 4]), c([1, 55, 14, 68])) > 0);
  assert.equal(c([1, 1]), null);
  assert.equal(c([108]), null);
});
test("reject stale, out of turn, injection and duplicates; reconnect spectator is safe", () => {
  const j = new GuandanJudge();
  j.start([1, 2, 3, 4], 0);
  let v = j.view(1);
  const action = {
    gid: v.gid,
    revision: v.revision,
    k: "play",
    cards: [v.hand[0]],
  };
  assert.deepEqual(j.handle(2, action, 1), []);
  assert.deepEqual(
    j.handle(1, { ...action, cards: [v.hand[0], v.hand[0]] }, 1),
    [],
  );
  assert.deepEqual(
    j.handle(1, { ...action, cards: [j.view(2).hand[0]] }, 1),
    [],
  );
  assert.ok(j.handle(1, action, 1).length);
  assert.deepEqual(j.handle(1, action, 2), []);
  const spectator = j.members([9], 3).find((m) => m.to === 9).msg.state;
  assert.deepEqual(spectator.hand, []);
  assert.equal("hands" in spectator, false);
  assert.equal("pile" in spectator, false);
});
test("several hands including tribute conserve every physical card", () => {
  const j = new GuandanJudge();
  j.start([1, 2, 3, 4], 0);
  for (let r = 0; r < 4; r++) {
    let steps = 0;
    while (j.view(1).phase !== "end" && steps++ < 1000) j.tick(j.deadline + 1);
    assert.ok(steps < 1000);
    const v = j.view(1);
    j.handle(
      1,
      { gid: v.gid, revision: v.revision, k: "next" },
      j.deadline + 1,
    );
    const ids = [1, 2, 3, 4].flatMap((n) => j.view(n).hand);
    assert.equal(ids.length, 108);
    assert.equal(new Set(ids).size, 108);
  }
});
test("deterministic timeout autoplay and 接风", () => {
  const j = new GuandanJudge();
  j.start([1, 2, 3, 4], 0);
  let saved = j.toJSON();
  saved.hands = { 1: [1], 2: [2, 3], 3: [4, 5], 4: [6, 7] };
  saved.turn = 1;
  saved.lastPlay = null;
  saved.finished = [];
  saved.pile = [];
  const k = new GuandanJudge(saved);
  let v = k.view(1);
  k.handle(1, { gid: v.gid, revision: v.revision, k: "play", cards: [1] }, 1);
  for (const p of [2, 3, 4]) {
    v = k.view(p);
    k.handle(p, { gid: v.gid, revision: v.revision, k: "pass" }, 2);
  }
  assert.equal(k.view(1).turn, 3);
  assert.equal(k.view(1).lastPlay, null);
  const run = () => {
    const x = new GuandanJudge(saved);
    let steps = 0;
    while (x.view(1).phase !== "end" && steps++ < 100) x.tick(x.deadline + 1);
    assert.ok(steps < 100);
    return x.view(1).finished;
  };
  assert.deepEqual(run(), run());
});
test("highest fullhouse interpretation, requested shape, empty room and strict schema", () => {
  assert.equal(classifyGuandan([0, 54, 12, 66, 26], 2).value, 17);
  assert.equal(
    classifyGuandan([11, 65, 12, 66, 26, 80], 2, "twotriples").type,
    "twotriples",
  );
  const j = new GuandanJudge();
  j.start([1, 2, 3, 4], 0);
  const v = j.view(1);
  assert.deepEqual(
    j.handle(
      1,
      {
        gid: v.gid,
        revision: v.revision,
        k: "play",
        cards: [v.hand[0]],
        extra: 1,
      },
      0,
    ),
    [],
  );
  j.members([], 0);
  assert.equal(j.toJSON(), null);
});
test("ambiguous six-card response uses preceding shape and explicit lead kind", () => {
  const j = new GuandanJudge();
  assert.equal(j.game, null);
  j.start([1, 2, 3, 4], 0);
  let s = j.toJSON();
  s.hands[1] = [11, 65, 12, 66, 26, 80, 1];
  s.turn = 1;
  s.lastPlay = {
    player: 4,
    cards: [],
    combo: { type: "twotriples", size: 6, value: 12 },
  };
  const k = new GuandanJudge(s),
    v = k.view(1);
  assert.ok(
    k.handle(
      1,
      {
        gid: v.gid,
        revision: v.revision,
        k: "play",
        cards: [11, 65, 12, 66, 26, 80],
      },
      1,
    ).length,
  );
  assert.equal(k.view(1).lastPlay.combo.type, "twotriples");
  s.lastPlay = null;
  const lead = new GuandanJudge(s),
    l = lead.view(1);
  assert.ok(
    lead.handle(
      1,
      {
        gid: l.gid,
        revision: l.revision,
        k: "play",
        kind: "twotriples",
        cards: [11, 65, 12, 66, 26, 80],
      },
      1,
    ).length,
  );
  assert.equal(lead.view(1).lastPlay.combo.type, "twotriples");
});
test("straight flush beats five-card bomb and loses to six-card bomb", () => {
  const flush = classifyGuandan([0, 1, 2, 3, 4], 2);
  assert.ok(compareGuandan(flush, { type: "bomb", size: 5, value: 17 }) > 0);
  assert.ok(compareGuandan(flush, { type: "bomb", size: 6, value: 2 }) < 0);
});
