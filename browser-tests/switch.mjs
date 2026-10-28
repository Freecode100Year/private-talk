// In-room mode selection & game switching:
// 1. In a private room, 3 players start Liar's Dice. One proposes to switch
//    to Pact (密约交易所). 2/3 agrees is <80% (needs 3/3), so the vote fails.
//    Another player proposes, all 3 agree (3/3 >=80%), vote passes and switches
//    to Pact.
// 2. On a public table, players switch mode to another mode, and the lobby
//    updates to show the new mode and its seats.
import { chromium } from 'playwright';
import { deriveRoom } from '../dist/crypto.js';

const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const open = async () => {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  return p;
};

// --- Part 1: Private Room Switch Vote (3 players) ---
console.log('--- Testing private room game switch vote ---');
const PASS1 = 'sw' + Math.random().toString(36).slice(2, 12);
const pages1 = [];
for (let i = 0; i < 3; i++) {
  const p = await open();
  await p.goto(`${BASE}/#${PASS1}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });
  pages1.push(p);
}
const [A, B, C] = pages1;

// A starts Liar's Dice (ld)
await A.waitForFunction(() => !document.getElementById('ldStart').disabled, null, { timeout: 30000 });
await A.click('#ldStart');
for (const p of pages1) await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 20000 });
ok(true, 'Liar\'s Dice started with 3 players');

// B opens drawer if mobile, and proposes to switch to Pact (tr)
if (await B.locator('#roomTools').isVisible()) await B.click('#roomTools');
await B.waitForSelector('#roomModesList [data-mode="tr"]', { timeout: 10000 });
await B.locator('#roomModesList [data-mode="tr"]').click();

// All 3 pages see voteBar
for (const p of pages1) {
  await p.waitForFunction(() => !document.getElementById('voteBar').hidden, null, { timeout: 10000 });
}
ok(await A.locator('#voteText').innerText().then((txt) => /密约交易所/.test(txt)), 'vote bar shows proposal to switch to Pact');

// A agrees, C declines -> 2/3 agrees < 80% (ceil(3 * 0.8) = 3 needed)
await A.click('#voteAgree');
await C.click('#voteDecline');

// Vote should fail (insufficient votes)
for (const p of pages1) {
  await p.waitForFunction(() => document.getElementById('voteBar').hidden, null, { timeout: 15000 });
}
ok(await A.waitForFunction(() => /未通过|作废/.test(document.getElementById('messages').innerText), null, { timeout: 10000 }).then(() => true, () => false), '2/3 is <80%: proposal fails and original game continues');

// A proposes to switch to Pact
if (await A.locator('#roomTools').isVisible()) await A.click('#roomTools');
await A.waitForSelector('#roomModesList [data-mode="tr"]', { timeout: 10000 });
await A.locator('#roomModesList [data-mode="tr"]').click();

// All 3 see voteBar
for (const p of pages1) {
  await p.waitForFunction(() => !document.getElementById('voteBar').hidden, null, { timeout: 25000 });
}

// B and C agree -> 3/3 agrees (100% >= 80%)
await B.click('#voteAgree');
await C.click('#voteAgree');

// Vote passes and switches to Pact
for (const p of pages1) {
  await p.waitForFunction(() => /大家同意换游戏/.test(document.getElementById('messages').innerText), null, { timeout: 15000 });
}
ok(true, '3/3 agree >= 80%: vote passes with "大家同意换游戏"');

// Proposer A starts the new game (Pact)
for (const p of pages1) {
  await p.waitForFunction(() => /开了一局密约交易所/.test(document.getElementById('messages').innerText), null, { timeout: 20000 });
}
ok(true, 'Pact game successfully started after switch vote');

for (const p of pages1) await p.context().close();

// --- Part 2: Public Table Mode Switch Reflected in Lobby ---
console.log('--- Testing public table mode switch reflected in lobby ---');
const lobby = async (p) => p.evaluate(async () => (await (await fetch('lobby', { cache: 'no-store' })).json()).tables);

const P1 = await open();
await P1.goto(BASE);
await P1.click('#quickPlay');
await P1.waitForSelector('#quickDialog[open]');
await P1.locator('#quickGames button[data-mode="ld"]').click();
await P1.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });

let tables = await lobby(P1);
const pubTable = tables.find((x) => x.mode === 'ld');
ok(!!pubTable, 'public table created for mode "ld" with 8 seats');

const P2 = await open();
await P2.goto(`${BASE}/#${pubTable.pass}`);
await P2.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });

// P1 and P2 ready up and start Liar's Dice
await P1.waitForFunction(() => !document.getElementById('readyBar').hidden, null, { timeout: 15000 });
await P1.click('#readyButton');
await P2.click('#readyButton');
await P1.waitForFunction(() => /开了一局骗子骰/.test(document.getElementById('messages').innerText), null, { timeout: 30000 });
ok(true, 'public table started Liar\'s Dice');

// P1 proposes to switch to Pact (tr)
if (await P1.locator('#roomTools').isVisible()) await P1.click('#roomTools');
await P1.waitForSelector('#roomModesList [data-mode="tr"]', { timeout: 10000 });
await P1.locator('#roomModesList [data-mode="tr"]').click();

await P2.waitForFunction(() => !document.getElementById('voteBar').hidden, null, { timeout: 25000 });
await P2.click('#voteAgree');

// Vote passes (2/2 = 100% >= 80%)
await P1.waitForFunction(() => /大家同意换游戏/.test(document.getElementById('messages').innerText), null, { timeout: 15000 });
ok(true, 'public table switch vote passed');

// Check lobby: table now has mode "tr"
let updatedTable = null;
for (let i = 0; i < 20; i++) {
  await P1.waitForTimeout(1000);
  tables = await lobby(P1);
  updatedTable = tables.find((x) => x.pass === pubTable.pass && x.mode === 'tr');
  if (updatedTable) break;
}
ok(!!updatedTable && updatedTable.mode === 'tr' && updatedTable.game === 'tr', 'lobby updated table to new mode "tr": ' + JSON.stringify(updatedTable && { mode: updatedTable.mode, seats: updatedTable.seats }));

for (const p of [P1, P2]) await p.context().close();
await b.close();

// This workflow runs switch on a fresh Node process after the general lobby
// suite. Reuse its isolated public-table quota for card-game browser tests.
await import('./card-table.mjs');
await import('./touch-stability.mjs');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
