import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, tableOf, readBody, CREATES, EMPTY_MS, MAX_TABLES } from '../src/lobby.js';
import { tableOf as pageTableOf, newPass } from '../dist/tables.js';

const verify = async (body) => (body?.pass ? `room-${body.pass}` : null);
const P = (g, n, r = 'abcdefghjkmnpqrs') => `pub${g}${n}${r}`;

test('a public passphrase says the game and the seats; anything else is a private room', () => {
  assert.deepEqual(tableOf(P('ld', 4)), { mode: 'ld', game: 'ld', seats: 4 });
  assert.equal(tableOf(P('spy', 3)), null, 'too few for the game');
  assert.equal(tableOf(P('ld', 9)), null, 'too many');
  assert.equal(tableOf('correct horse battery staple'), null);
  assert.equal(tableOf(P('ld', 4, 'ABC')), null);
  const p = newPass('sm', 5);
  assert.deepEqual(tableOf(p), { mode: 'sm', game: 'sm', seats: 8 });
  assert.deepEqual(pageTableOf(p), tableOf(p), 'page and server agree');

  // New format: pub<modeId>-<rand16>
  const pNew = 'pubww9guard-abcdef1234567890';
  assert.deepEqual(tableOf(pNew), { mode: 'ww9guard', game: 'ww', seats: 9 });
  assert.deepEqual(pageTableOf(pNew), tableOf(pNew), 'page and server agree on new format');
});

test('tables are listed, counted from their rooms, and gone when empty', async () => {
  const l = new Lobby();
  const r = await l.create({ pass: P('ld', 4), lang: 'zh-Hans' }, '1.1.1.1', verify, 0);
  assert.match(r.id, /^[0-9a-f]{12}$/);
  assert.equal(l.list(0)[0].taken, 0);
  l.people(`room-${P('ld', 4)}`, 3, 10);
  l.playing(`room-${P('ld', 4)}`, true);
  assert.deepEqual(l.list(10).map((x) => [x.game, x.seats, x.taken, x.playing, x.lang]), [['ld', 4, 3, true, 'zh-Hans']]);
  l.people(`room-${P('ld', 4)}`, 0, 20);
  assert.equal(l.list(20).length, 0, 'the room emptied: the table goes');
  await l.create({ pass: P('tr', 2) }, '1.1.1.1', verify, 0);
  assert.equal(l.list(EMPTY_MS - 1).length, 1);
  assert.equal(l.list(EMPTY_MS + 1).length, 0, 'nobody came: the table goes');
  assert.equal(l.people('room-x', 2), undefined, 'a room that is not a table is not listed');
  assert.equal(l.list().length, 0);
});

test('a table the lobby lost comes back from its room; only counts limit abuse', async () => {
  const l = new Lobby();
  l.people('room-y', 2, 0, { id: 'aaaaaaaaaaaa', pass: P('spy', 6), lang: 'en', at: 0 });
  assert.equal(l.list(0)[0].taken, 2);
  l.people('room-z', 2, 0, { id: 'bbbbbbbbbbbb', pass: 'not public', lang: 'en', at: 0 });
  assert.equal(l.list(0).length, 1);
  for (let i = 0; i < CREATES; i++) assert.ok((await l.create({ pass: P('ld', 3, `abcdefghjkmnpq${i}a`) }, '2.2.2.2', verify, 0)).id);
  assert.equal((await l.create({ pass: P('ld', 3, 'zzzzzzzzzzzzzzzz') }, '2.2.2.2', verify, 0)).error, 'too many');
  assert.ok((await l.create({ pass: P('ld', 3, 'yyyyyyyyyyyyyyyy') }, '3.3.3.3', verify, 0)).id, 'another address may');
  assert.equal((await l.create({ pass: 'private room' }, '4.4.4.4', verify, 0)).error, 'bad table');
  assert.equal((await l.create({ pass: P('ld', 4) }, '4.4.4.4', async () => null, 0)).error, 'bad table', 'refuses when verify fails');
  const custom = await l.create({ pass: P('ld', 4), roomId: 'custom-room' }, '5.5.5.5', async (b) => b.roomId, 0);
  assert.equal(custom.roomId, 'custom-room');
  assert.equal(readBody('x'.repeat(600)), null);
  assert.equal(readBody('[1]'), null);
  assert.ok(MAX_TABLES >= 100);
});
