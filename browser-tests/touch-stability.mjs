// Real touch regression: preserve a held avatar through a countdown render,
// then accept two different magician choices without a global debounce delay.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:8099";
const browser = await chromium.launch();
try {
  const room = "touchstable" + Math.random().toString(36).slice(2);
  const pages = [];
  for (let i = 0; i < 12; i++) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    await page.goto(`${base}/#${room}`);
    await page.waitForSelector("#sendButton:not([disabled])");
    pages.push(page);
  }
  const dealer = pages[0];
  await dealer.locator("#roomTools").tap();
  await dealer.selectOption("#wwBoard", "b12magician");
  await dealer.locator("#wwStart:not([disabled])").tap();
  let magician;
  for (const page of pages) {
    await page.waitForSelector("#gamePanel:not([hidden])");
    if (
      /交换.*第.*一|交换.*第一|交换.*1|交换的第一/.test(
        await page.locator("#gameLine").innerText(),
      )
    )
      magician = page;
  }
  if (!magician) {
    console.log(
      await Promise.all(pages.map((p) => p.locator("#gameLine").innerText())),
    );
    throw new Error("magician first choice not found");
  }
  // Only the dealer and the acting phone need to render during this gesture.
  // Freeze other phones as mobile background tabs; leave their seats/connections
  // intact so the rapid-input assertion measures input handling, not 12 renderers.
  for (const page of pages) {
    if (page!==dealer && page!==magician) {
      const background=await page.context().newCDPSession(page);
      await background.send("Page.setWebLifecycleState",{state:"frozen"});
    }
  }
  const avatar = await magician
    .locator(".ww-seat.actionable .ww-seat-avatar")
    .first()
    .elementHandle();
  await avatar.scrollIntoViewIfNeeded();
  const box = await avatar.boundingBox();
  assert.ok(box);
  const session = await magician.context().newCDPSession(magician);
  const firstLine = await magician.locator("#gameLine").innerText();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await magician.waitForFunction(
    (line) => document.getElementById("gameLine").textContent !== line,
    firstLine,
  );
  assert.equal(
    await avatar.evaluate((node) => node.isConnected),
    true,
    "held avatar stays attached across countdown render",
  );
  assert.equal(
    await avatar.evaluate(
      (node) =>
        node === document.querySelector(".ww-seat.actionable .ww-seat-avatar"),
    ),
    true,
    "same keyed avatar survives",
  );
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await magician.locator("#wwConfirmDialog:not([hidden])").waitFor();
  // Sample the drawn target and use real touch events without Playwright's
  // stability retries: this regression deliberately exercises rapid choices.
  const touch = async (page, locator) => {
    const point = await locator.evaluate((node) => {
      const r = node.getBoundingClientRect(),
        x = r.x + r.width / 2,
        y = r.y + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, hit: !!top && (top === node || node.contains(top)) };
    });
    assert.ok(point.hit, "touch lands on the drawn target");
    await page.touchscreen.tap(point.x, point.y);
  };
  await magician.evaluate(() => {
    window.confirmTouchTimes = [];
    window.realDateNow = Date.now;
    document
      .getElementById("wwConfirmOk")
      .addEventListener(
        "pointerup",
        () => {
          window.confirmTouchTimes.push(Date.now());
          if (window.confirmTouchTimes.length === 2) {
            // Model two valid, distinct confirmations 100 ms apart even if
            // network/render scheduling takes longer between the two screens.
            // This catches a global 400 ms debounce without flaky wall-clock
            // assertions or synthetic DOM clicks.
            const acceptedAt = window.confirmTouchTimes[0] + 100;
            window.simulatedConfirmTime = acceptedAt;
            Date.now = () => acceptedAt;
            setTimeout(() => { Date.now = window.realDateNow; }, 0);
          }
        },
        { capture: true },
      );
  });
  await touch(magician, magician.locator("#wwConfirmOk"));
  const firstPrompt = await magician.locator("#gameLine").innerText();
  assert.match(
    firstPrompt,
    /第二个人/,
    "first choice advances to the second choice",
  );
  await touch(magician, magician.locator(".ww-seat.actionable .ww-seat-avatar").nth(1));
  await touch(magician, magician.locator("#wwConfirmOk"));
  const elapsed = await magician.evaluate(
    () => window.simulatedConfirmTime - window.confirmTouchTimes[0],
  );
  await magician.waitForFunction(
    () => /已提交/.test(document.getElementById("gameLine").textContent),
    null,
    { timeout: 4000 },
  );
  assert.equal(
    await magician.locator(".ww-seat.actionable").count(),
    0,
    "second choice actually submitted",
  );
  console.log(
    `PASS held avatar survives render; second real touch accepted at simulated ${elapsed}ms`,
  );

  // Two wolves act in the same stage. Keep one target held while the other
  // submits; the resulting state update must preserve the still-current touch.
  let wolves = [];
  const until = Date.now() + 20000;
  while (Date.now() < until && wolves.length < 2) {
    wolves = [];
    for (const page of pages) {
      const state = await page.evaluate(() => ({
        line: document.getElementById("gameLine").textContent,
        targets: document.querySelectorAll(".ww-seat.actionable .ww-seat-avatar").length,
      }));
      if (/选择今晚要刀的人/.test(state.line) && state.targets) wolves.push(page);
    }
    if (wolves.length < 2) await pages[0].waitForTimeout(100);
  }
  assert.ok(wolves.length >= 2, "two wolves receive the same simultaneous action");
  const [heldWolf, otherWolf] = wolves;
  const heldTarget = await heldWolf
    .locator(".ww-seat.actionable .ww-seat-avatar")
    .first()
    .elementHandle();
  await heldTarget.scrollIntoViewIfNeeded();
  const heldBox = await heldTarget.boundingBox();
  assert.ok(heldBox);
  const stableLine = (line) => line.replace(/\(\d+s\)/g, "").trim();
  const heldBefore = stableLine(await heldWolf.locator("#gameLine").innerText());
  const heldSession = await heldWolf.context().newCDPSession(heldWolf);
  await heldSession.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: heldBox.x + heldBox.width / 2, y: heldBox.y + heldBox.height / 2 }],
  });
  await touch(otherWolf, otherWolf.locator(".ww-seat.actionable .ww-seat-avatar").first());
  await otherWolf.locator("#wwConfirmDialog:not([hidden])").waitFor();
  await touch(otherWolf, otherWolf.locator("#wwConfirmOk"));
  await heldWolf.waitForFunction(
    (before) => document.getElementById("gameLine").textContent.replace(/\(\d+s\)/g, "").trim() !== before,
    heldBefore,
    { timeout: 4000 },
  );
  assert.equal(await heldTarget.evaluate((node) => node.isConnected), true);
  const afterOtherWolf = stableLine(await heldWolf.locator("#gameLine").innerText());
  await heldSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await heldWolf.locator("#wwConfirmDialog:not([hidden])").waitFor();
  await touch(heldWolf, heldWolf.locator("#wwConfirmOk"));
  await heldWolf.waitForFunction(
    (previous) => document.getElementById("gameLine").textContent.replace(/\(\d+s\)/g, "").trim() !== previous,
    afterOtherWolf,
    { timeout: 4000 },
  );
  console.log("PASS another wolf's action preserves the held, still-valid touch");
} finally {
  await browser.close();
}
