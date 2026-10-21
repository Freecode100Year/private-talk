import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modeOf, isPublicMode, modesFor, publicModes, defaultModeFor, boardRoleSummary, WW_TIERS } from '../dist/modes.js';
import { BOARDS } from '../dist/werewolf.js';
import { tableOf, newPass } from '../dist/tables.js';
import { tableOf as serverTableOf, Lobby } from '../src/lobby.js';
import { checkFrame } from '../src/rules.js';

test('modes directory: all modes have valid id (lowercase + digits <= 12), game, players, settings', () => {
  assert.ok(MODES.length >= 28, 'at least 23 werewolf boards + other games');
  const ids = new Set();
  for (const m of MODES) {
    assert.match(m.id, /^[a-z0-9]{1,12}$/, `mode id ${m.id} must be lowercase letters and digits <= 12 chars`);
    assert.ok(!ids.has(m.id), `duplicate mode id ${m.id}`);
    ids.add(m.id);
    assert.ok(typeof m.game === 'string' && m.game.length > 0, `${m.id} has game`);
    assert.ok(Array.isArray(m.players) && m.players.length === 2 && m.players[0] <= m.players[1], `${m.id} has valid players range`);
    assert.ok(typeof m.settings === 'object' && m.settings !== null, `${m.id} has settings object`);
    assert.equal(typeof m.public, 'boolean', `${m.id} has boolean public field`);
  }
});

test('werewolf boards: all 23 boards are covered and grouped', () => {
  const wwList = modesFor('ww');
  assert.equal(wwList.length, 23, 'all 23 boards');
  const boardIds = Object.keys(BOARDS);
  assert.equal(boardIds.length, 23);
  for (const bId of boardIds) {
    const found = wwList.find((m) => m.settings.board === bId);
    assert.ok(found, `board ${bId} must have a mode`);
    assert.equal(found.players[0], BOARDS[bId].n, `min players matches board n for ${bId}`);
    assert.equal(found.players[1], BOARDS[bId].n, `max players matches board n for ${bId}`);
    assert.ok(['intro', 'standard', 'advanced', 'special'].includes(found.group), `valid group for ${bId}`);
    if (found.players[0] === 12) {
      assert.equal(found.settings.sheriff, true, '12-player boards default to sheriff: true');
    }
  }
  assert.deepEqual(WW_TIERS, [6, 7, 8, 9, 10, 11, 12]);
});

test('other games: spy, ld (classic and wild), tr, sm, esc (not public)', () => {
  const spy = modeOf('spy');
  assert.ok(spy && spy.public && spy.players[0] === 4 && spy.players[1] === 8);
  const ld = modeOf('ld');
  assert.ok(ld && ld.public && ld.players[0] === 2 && ld.players[1] === 8 && ld.settings.wild === false);
  const ldwild = modeOf('ldwild');
  assert.ok(ldwild && ldwild.public && ldwild.players[0] === 2 && ldwild.players[1] === 8 && ldwild.settings.wild === true);
  const tr = modeOf('tr');
  assert.ok(tr && tr.public && tr.players[0] === 2 && tr.players[1] === 8);
  const sm = modeOf('sm');
  assert.ok(sm && sm.public && sm.players[0] === 3 && sm.players[1] === 8);
  const esc = modeOf('esc');
  assert.ok(esc && !esc.public && esc.players[0] === 2 && esc.players[1] === 8, 'escape is private only');
});

test('boardRoleSummary generates role composition from BOARDS automatically', () => {
  const summary9g = boardRoleSummary('b9guard', (r) => (r === 'wolf' ? '狼' : r === 'villager' ? '民' : r));
  assert.equal(summary9g, '9 人 · 3 狼 seer witch guard 3 民');
  const summary8h = boardRoleSummary('b8hunters', (r) => (r === 'wolf' ? '狼' : r === 'hunter' ? '猎' : r));
  assert.equal(summary8h, '8 人 · 4 狼 4 猎');
});

test('tableOf parses new passphrase format pub<modeId>-<rand16>', () => {
  const p1 = 'pubww9guard-abcdef1234567890';
  assert.deepEqual(tableOf(p1), { mode: 'ww9guard', game: 'ww', seats: 9 });
  assert.deepEqual(serverTableOf(p1), { mode: 'ww9guard', game: 'ww', seats: 9 });

  const p2 = 'publd-abcdef1234567890';
  assert.deepEqual(tableOf(p2), { mode: 'ld', game: 'ld', seats: 8 });
  assert.deepEqual(serverTableOf(p2), { mode: 'ld', game: 'ld', seats: 8 });

  const p3 = 'publdwild-abcdef1234567890';
  assert.deepEqual(tableOf(p3), { mode: 'ldwild', game: 'ld', seats: 8 });

  // Non-public modes or unknown modes return null
  assert.equal(tableOf('pubesc-abcdef1234567890'), null);
  assert.equal(serverTableOf('pubesc-abcdef1234567890'), null);
  assert.equal(tableOf('pubunknown-abcdef1234567890'), null);
});

test('tableOf accepts legacy format pub(spy|ld|tr|sm|ww)(seats)(16chars) and maps to default mode', () => {
  const pWW = 'pubww9abcdef1234567890';
  assert.deepEqual(tableOf(pWW), { mode: 'ww9', game: 'ww', seats: 9 });
  assert.deepEqual(serverTableOf(pWW), { mode: 'ww9', game: 'ww', seats: 9 });

  const pLD = 'publd4abcdef1234567890';
  assert.deepEqual(tableOf(pLD), { mode: 'ld', game: 'ld', seats: 4 });
  assert.deepEqual(serverTableOf(pLD), { mode: 'ld', game: 'ld', seats: 4 });

  const pSpy = 'pubspy6abcdef1234567890';
  assert.deepEqual(tableOf(pSpy), { mode: 'spy', game: 'spy', seats: 6 });

  // Out of range for legacy format returns null
  assert.equal(tableOf('pubspy3abcdef1234567890'), null);
  assert.equal(tableOf('publd9abcdef1234567890'), null);
});

test('newPass generates new format passphrase with mode id and hyphen', () => {
  const p = newPass('ww9guard');
  assert.match(p, /^pubww9guard-[a-z0-9]{16}$/);
  assert.deepEqual(tableOf(p), { mode: 'ww9guard', game: 'ww', seats: 9 });

  const pOldArgs = newPass('ww', 12);
  assert.match(pOldArgs, /^pubww12-[a-z0-9]{16}$/);
  assert.deepEqual(tableOf(pOldArgs), { mode: 'ww12', game: 'ww', seats: 12 });
});

test('rules.js checkFrame validates mode in { type: "table" }', () => {
  const state = {};
  const okFrame = checkFrame(JSON.stringify({ type: 'table', mode: 'ww9guard', playing: false }), state, 1e6);
  assert.deepEqual(okFrame, { table: { mode: 'ww9guard', playing: false } });

  // Non-public mode refused
  const escFrame = checkFrame(JSON.stringify({ type: 'table', mode: 'esc', playing: false }), state, 1e6 + 3000);
  assert.ok(escFrame === null, 'esc is bad frame, dropped');

  // Invalid mode id refused
  const badFrame = checkFrame(JSON.stringify({ type: 'table', mode: 'nonexistent', playing: false }), state, 1e6 + 6000);
  assert.ok(badFrame === null, 'invalid mode id dropped');
});

test('server Lobby supports setMode to update mode, game, and seats', () => {
  const lobby = new Lobby();
  lobby.tables.set('room-1', { id: 'tbl1', pass: 'publd-abcdef1234567890', mode: 'ld', game: 'ld', seats: 8, taken: 3, playing: true, at: 0, seen: 0 });
  lobby.setMode('room-1', 'tr');
  const t = lobby.tables.get('room-1');
  assert.equal(t.mode, 'tr');
  assert.equal(t.game, 'tr');
  assert.equal(t.seats, 8);

  // Switching to werewolf board
  lobby.setMode('room-1', 'ww9guard');
  assert.equal(t.mode, 'ww9guard');
  assert.equal(t.game, 'ww');
  assert.equal(t.seats, 9);
});
