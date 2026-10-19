// A phone-sized page with a touch screen: tapping Send while typing sends
// (a layout change when the text box loses the focus once moved the button
// from under the finger), and the message arrives.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'phone' + Math.random().toString(36).slice(2, 12);
const desk = await (await b.newContext({ locale: 'zh-CN' })).newPage();
await desk.goto(`${BASE}/#${PASS}`);
await desk.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
const phone = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' })).newPage();
await phone.goto(`${BASE}/#${PASS}`);
await phone.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
for (const [how, text] of [['tap', '用手指点发送'], ['click', '再点一次发送']]) {
  await phone.locator('#messageInput').focus();
  await phone.fill('#messageInput', text);
  if (how === 'tap') await phone.tap('#sendButton'); else await phone.click('#sendButton');
  ok(await desk.waitForFunction((t) => document.getElementById('messages').innerText.includes(t), text, { timeout: 8000 }).then(() => true, () => false), `a ${how} on Send while typing sends the message`);
  ok((await phone.inputValue('#messageInput')) === '', 'and the box is cleared');
}
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
