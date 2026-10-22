// Werewolf Round Table Browser Test
// 7 pages play a game with the round table interface.
// Verifies:
// 1. 7 seats rendered correctly (4 left, 3 right)
// 2. Mobile 360x740 width does not overflow
// 3. Only active actor can click avatars; avatar click pops confirmation dialog
// 4. Speech messages show speech bubbles next to speaker's seat
// 5. Speaker can pass with pass button
// 6. Voting results displayed on stage (who voted for whom)
// 7. Settlement card reveals all 7 identities with role icon SVGs
// 8. Takes 4 screenshots: werewolf-night, werewolf-day, werewolf-vote, werewolf-end
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8097';
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

async function shot(p, name) {
  const png = `${OUT}/${name}.png`;
  await p.screenshot({ path: png });
  try {
    execFileSync('python3', ['-c', `from PIL import Image; import os; i = Image.open('${png}'); i.save('${OUT}/${name}.webp', 'WEBP', quality=80, method=6); os.remove('${png}')`]);
    console.log('saved', name);
  } catch (e) {
    console.error('shot conversion error', e);
  }
}

const b = await chromium.launch();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const PASS = 'wwt' + Math.random().toString(36).slice(2, 12);

async function openPage(isPhone = false) {
  const ctx = await b.newContext(isPhone ? {
    viewport: { width: 360, height: 740 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN'
  } : {
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN'
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });
  return p;
}

const pages = [];
// Page 0: starter (desktop)
pages.push(await openPage(false));
// Page 1: phone (360x740)
pages.push(await openPage(true));
for (let i = 2; i < 7; i++) {
  pages.push(await openPage(false));
}

const starter = pages[0];
const phone = pages[1];

ok(await starter.waitForFunction(() => !document.getElementById('wwStart').disabled, null, { timeout: 40000 }).then(() => true, () => false), '7 players in room: starter can start');

// Verify judge selector defaults to server judge
const judgeMode = await starter.locator('#judgeModeSelect').inputValue();
ok(judgeMode === 'server', 'judge mode defaults to server judge in private room');

await starter.click('#wwStart');

for (const p of pages) {
  await p.waitForFunction(() => !document.getElementById('gamePanel').hidden && !document.getElementById('wwTable').hidden, null, { timeout: 25000 });
}
ok(true, 'all 7 pages see the werewolf round table');

// 1. Check seat counts: 7 total (4 left, 3 right)
const leftSeats = await phone.locator('#wwSeatsLeft .ww-seat').count();
const rightSeats = await phone.locator('#wwSeatsRight .ww-seat').count();
ok(leftSeats + rightSeats === 7, `total seats is 7 (${leftSeats} left, ${rightSeats} right)`);
ok(leftSeats === 4 && rightSeats === 3, 'seats split evenly (4 left, 3 right)');

// 2. Check mobile width 360x740 does not overflow
const overflow = await phone.evaluate(() => {
  const table = document.getElementById('wwTable');
  return { scrollWidth: table.scrollWidth, clientWidth: table.clientWidth };
});
ok(overflow.scrollWidth <= overflow.clientWidth, `mobile 360 table does not horizontally overflow (${overflow.scrollWidth} <= ${overflow.clientWidth})`);

// 2b. Check seat name bars are not clipped
const nameBarOverflow = await phone.evaluate(() => {
  const bars = Array.from(document.querySelectorAll('.ww-seat-name-bar'));
  return bars.filter(b => b.scrollWidth > b.clientWidth).map(b => `${b.textContent.trim()} (${b.scrollWidth} > ${b.clientWidth})`);
});
ok(nameBarOverflow.length === 0, `mobile name bars are not clipped: ${nameBarOverflow.length ? nameBarOverflow.join(', ') : 'OK'}`);

// 2c. Check role card does not intersect seats or input
const cardOverlap = await phone.evaluate(() => {
  const card = document.getElementById('gameWord');
  if (!card || card.hidden || card.offsetParent === null) return [];
  const cr = card.getBoundingClientRect();
  const seats = Array.from(document.querySelectorAll('.ww-seat')).filter(el => el.offsetParent !== null);
  const chat = document.getElementById('wwMobileChat') || document.getElementById('wwMobileInput');
  const items = seats.map(s => ({ name: `seat-${s.dataset.player}`, rect: s.getBoundingClientRect() }));
  if (chat && chat.offsetParent !== null) items.push({ name: 'mobile-chat', rect: chat.getBoundingClientRect() });
  const collided = items.filter(it => !(cr.right <= it.rect.left || cr.left >= it.rect.right || cr.bottom <= it.rect.top || cr.top >= it.rect.bottom));
  return collided.map(c => c.name);
});
ok(cardOverlap.length === 0, `identity card does not intersect seats or input (collided: ${cardOverlap.join(', ') || 'none'})`);

// Read player numbers and identities
const me = [];
for (const p of pages) {
  const x = await p.locator('.member .avatar.me').innerText();
  me.push(/^\d{2}$/.test(x) ? `#${x}` : x);
}

const holdCard = async (p) => p.evaluate(() => document.getElementById('gameWord').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
const releaseCard = async (p) => p.waitForTimeout(400).then(() => p.evaluate(() => document.getElementById('gameWord').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))));

const roles = [];
for (const p of pages) {
  await holdCard(p);
  const cardText = await p.locator('#gameWord').innerText();
  const m = cardText.match(/你的身份：(\S+)/);
  roles.push(m ? m[1] : '?');
  await releaseCard(p);
}
console.log('Roles:', me.map((m, i) => `${m}:${roles[i]}`).join(' '));
ok(roles.every((r) => r !== '?'), 'every player got an identity card from server judge');

// 3. Night phase: Check that only active actors see actionable avatars and avatar click pops confirm
const nightTheme = await phone.evaluate(() => document.getElementById('wwTable').classList.contains('ww-night'));
ok(nightTheme, 'night theme applied to round table');

// Find an actor who can act during night
let actorIndex = -1;
for (let wait = 0; wait < 15 && actorIndex === -1; wait++) {
  for (let i = 0; i < 7; i++) {
    const actCount = await pages[i].locator('.ww-seat.actionable').count();
    if (actCount > 0) {
      actorIndex = i;
      break;
    }
  }
  if (actorIndex === -1) await phone.waitForTimeout(1000);
}

if (actorIndex >= 0) {
  const actor = pages[actorIndex];
  ok(true, `actor ${me[actorIndex]} (${roles[actorIndex]}) has actionable seats`);

  // Non-actors (villagers) should have 0 actionable seats
  const villagerIndex = roles.indexOf('村民');
  const nonActorIndex = villagerIndex >= 0 ? villagerIndex : (actorIndex + 1) % 7;
  const nonActorCount = await pages[nonActorIndex].locator('.ww-seat.actionable').count();
  ok(nonActorCount === 0, `villager ${me[nonActorIndex]} has 0 actionable seats`);

  // Click actionable avatar -> pops confirm dialog
  await actor.locator('.ww-seat.actionable .ww-seat-avatar').first().click();
  await actor.waitForSelector('#wwConfirmDialog:not([hidden])', { timeout: 5000 });
  ok(await actor.locator('#wwConfirmDialog').isVisible(), 'confirm dialog popped up on avatar click');

  // Screenshots: night confirmation popup (phone 360x740 and desktop)
  await shot(phone, 'werewolf-night-wolf');
  await shot(starter, 'werewolf-night-wolf-desktop');
  await shot(phone, 'werewolf-night');
  await shot(starter, 'werewolf-night-desktop');

  // Confirm action
  await actor.click('#wwConfirmOk');
  ok(!(await actor.locator('#wwConfirmDialog').isVisible()), 'confirm dialog closed after confirming');
}

// 4. Day phase: Speeches, speech bubbles, pass button, voting checkmarks, and settlement replay
console.log('Waiting for daytime...');
const startLoop = Date.now();
let dayShotTaken = false;
let voteShotTaken = false;
let endShotTaken = false;
let stageVotesLogged = false;

while (Date.now() - startLoop < 12 * 60000 && !endShotTaken) {
  for (let i = 0; i < 7; i++) {
    const p = pages[i];
    const isOver = await p.evaluate(() => !document.getElementById('wwSettlement').hidden);
    if (isOver) {
      if (!endShotTaken) {
        endShotTaken = true;
        ok(true, 'game over settlement card is visible');
        const winner = await p.locator('#wwSettlementWinner').innerText();
        ok(/获胜/.test(winner), 'settlement card has winner banner: ' + winner);
        const cardCount = await p.locator('#wwSettlementGrid .ww-settlement-player').count();
        ok(cardCount === 7, `all 7 identities flipped open on settlement grid (${cardCount})`);
        const svgCount = await p.locator('#wwSettlementGrid .role-icon-svg').count();
        ok(svgCount === 7, `all 7 player cards have inline SVG role icons (${svgCount})`);
        
        // Assert dead players have "出局" stamp
        const deadStamps = await p.locator('.ww-settlement-stamp').count();
        ok(deadStamps > 0, `dead players stamped with exile/death stamp (${deadStamps})`);

        // Assert replay timeline content is chronological and populated
        const timelineSections = await p.locator('#wwReplayTimeline .ww-replay-section').count();
        const timelineRows = await p.locator('#wwReplayTimeline .ww-replay-row').count();
        ok(timelineSections > 0 && timelineRows > 0, `replay timeline rendered ${timelineSections} sections and ${timelineRows} event rows`);

        // Assert all 3 replay buttons are fully within viewport and clickable
        const replayButtonsCheck = await p.evaluate(() => {
          const ids = ['#wwAgainBtn', '#wwSwitchBtn', '#wwBackChatBtn'];
          return ids.map(id => {
            const el = document.querySelector(id);
            if (!el || el.offsetParent === null) return { id, ok: false, reason: 'not visible' };
            const r = el.getBoundingClientRect();
            const inVp = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
            return { id, ok: inVp && r.width > 0 && r.height > 0, r };
          });
        });
        ok(replayButtonsCheck.every(b => b.ok), `all 3 replay buttons are fully within viewport: ${replayButtonsCheck.map(b => b.id).join(', ')}`);

        // Screenshots: Replay page on phone 360x740 and desktop
        await shot(phone, 'werewolf-end');
        await shot(starter, 'werewolf-end-desktop');
      }
      break;
    }

    // Night actions: act quickly if available
    const isNight = await p.evaluate(() => document.getElementById('wwTable').classList.contains('ww-night'));
    if (isNight) {
      const hasAction = await p.locator('.ww-seat.actionable').count();
      if (hasAction > 0) {
        await p.locator('.ww-seat.actionable .ww-seat-avatar').first().click().catch(() => {});
        await p.waitForTimeout(100);
        if (await p.locator('#wwConfirmDialog:not([hidden])').isVisible()) {
          await p.click('#wwConfirmOk').catch(() => {});
        }
      }
      if (await p.locator('#wwPotionPanel').isVisible()) {
        const potionBtns = p.locator('#wwPotionActions button');
        if (await potionBtns.count()) {
          await potionBtns.first().click().catch(() => {});
        }
      }
    }

    // Check if it's someone's turn to speak
    const line = await p.locator('#gameLine').innerText().catch(() => '');
    if (/(轮到你发言|请发表遗言)/.test(line)) {
      const passBtnVisible = await p.locator('#wwPassButton').isVisible();
      ok(passBtnVisible, 'pass button is visible when it is your turn to speak');

      if (!dayShotTaken) {
        const msg = `我是 ${me[i]}，村民一枚。`;
        if (await p.locator('#wwMobileInput').isVisible()) {
          await p.fill('#wwMobileInput', msg);
          await p.click('#wwMobileSend').catch(() => {});
        } else {
          await p.fill('#messageInput', msg);
          await p.click('#sendButton').catch(() => {});
        }

        const mySeatNum = String(i + 1);
        const bubble = p.locator(`.ww-seat[data-player="${mySeatNum}"] .ww-seat-bubble`);
        const phoneBubble = phone.locator(`.ww-seat[data-player="${mySeatNum}"] .ww-seat-bubble`);
        const hasBubble = await phoneBubble.waitFor({ timeout: 6000 }).then(() => true, () => false);
        if (hasBubble) {
          ok(true, `speech bubble appeared next to seat ${me[i]}`);
          await phone.waitForTimeout(200);
          const phoneBox = await phoneBubble.boundingBox();
          ok(phoneBox && phoneBox.width >= 80, `360 宽下气泡宽度 >= 80px (actual: ${phoneBox?.width?.toFixed(1)}px)`);

          const bubbleOverlap = await phone.evaluate(() => {
            const bubbles = Array.from(document.querySelectorAll('.ww-seat-bubble')).filter(b => b.offsetParent !== null);
            const title = document.getElementById('wwStageTitle');
            const sub = document.getElementById('wwStageSub');
            const stageTexts = [title, sub].filter(s => s && s.offsetParent !== null);
            const intersects = (r1, r2) => !(r1.right <= r2.left || r1.left >= r2.right || r1.bottom <= r2.top || r1.top >= r2.bottom);
            for (const b of bubbles) {
              const br = b.getBoundingClientRect();
              for (const st of stageTexts) {
                if (intersects(br, st.getBoundingClientRect())) return true;
              }
            }
            return false;
          });
          ok(!bubbleOverlap, 'any speech bubble does not intersect stage text rectangle on 360');

          dayShotTaken = true;
          await p.waitForTimeout(300);
          await shot(phone, 'werewolf-day');
          await shot(starter, 'werewolf-day-desktop');
        }
        await p.click('#wwPassButton').catch(() => {});
      } else {
        await p.click('#wwPassButton').catch(() => {});
      }
      continue;
    }

    // Check voting phase
    const hasVoting = await p.locator('.ww-seat.actionable').count();
    const isVotePhase = await p.evaluate(() => document.getElementById('wwStageTitle').textContent.includes('投票'));
    if (isVotePhase && hasVoting > 0) {
      await p.locator('.ww-seat.actionable .ww-seat-avatar').first().click().catch(() => {});
      await p.waitForTimeout(100);
      if (await p.locator('#wwConfirmDialog:not([hidden])').isVisible()) {
        await p.click('#wwConfirmOk').catch(() => {});
      }

      // Check that voted checkmark appears over avatar
      await p.waitForTimeout(400);
      const votedMarks = await p.locator('.ww-avatar-voted').count();
      if (votedMarks > 0 && !voteShotTaken) {
        voteShotTaken = true;
        ok(true, `green checkmark appeared on voted avatar (${votedMarks} voted)`);
        await shot(phone, 'werewolf-vote');
        await shot(starter, 'werewolf-vote-desktop');
      }
    }

    // Check stage votes display
    const stageVotesText = await p.locator('#wwStageVotes').innerText().catch(() => '');
    if (!stageVotesLogged && stageVotesText && stageVotesText.includes('→')) {
      stageVotesLogged = true;
      ok(true, 'stage votes display who voted for whom: ' + stageVotesText);
    }
  }
  await phone.waitForTimeout(800);
}

// Update modes-lobby.webp and room-modes.webp
try {
  const lobbyCtx = await b.newContext({ viewport: { width: 360, height: 740 }, locale: 'zh-CN' });
  const lobbyPage = await lobbyCtx.newPage();
  await lobbyPage.goto(`${BASE}/`);
  await lobbyPage.waitForSelector('#quickPlay', { timeout: 10000 });
  await lobbyPage.click('#quickPlay');
  await lobbyPage.waitForSelector('#quickDialog[open]', { timeout: 10000 });
  await lobbyPage.waitForTimeout(500);
  await shot(lobbyPage, 'modes-lobby');
  await lobbyCtx.close();

  // Room modes screenshot
  const roomCtx = await b.newContext({ viewport: { width: 360, height: 740 }, locale: 'zh-CN' });
  const roomPage = await roomCtx.newPage();
  await roomPage.goto(`${BASE}/#preview${Date.now()}`);
  await roomPage.waitForSelector('#tabGame', { timeout: 10000 });
  await roomPage.click('#tabGame');
  await roomPage.waitForTimeout(500);
  await shot(roomPage, 'room-modes');
  await roomCtx.close();
} catch (e) {
  console.log('Extra screenshot error (non-fatal):', e.message);
}

ok(dayShotTaken, 'speech bubble and daytime speech verified');
ok(endShotTaken, 'settlement card at game over verified');

await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
