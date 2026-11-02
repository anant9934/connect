// Draws on the whiteboard and presents a real PDF between real browsers.
// Requires CHROME_PATH, WEB_URL and API_URL pointing at disposable local services.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { buildPdf } from './fixtures_pdf.mjs';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080';
const stamp = Date.now();
const RED = [1, 0, 0];
const GREEN = [0, 1, 0];
const BLUE = [0, 0, 1];

let currentStep = 'setup';
const step = (name) => {
  currentStep = name;
  console.log(`STEP ${name}`);
};

async function signup(name) {
  const res = await fetch(`${API_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL },
    body: JSON.stringify({ email: `${name.toLowerCase()}-${stamp}@example.test`, password: 'correct-horse-battery-9', displayName: name }),
  });
  assert.equal(res.status, 201);
  return res.headers.get('set-cookie').match(/tc_session=([^;]+)/)[1];
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function enter(token, code) {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: 'tc_session', value: token, domain: 'localhost', path: '/', httpOnly: true });
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${WEB_URL}/room/${code}/preview`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('form button[type="submit"]');
  await Promise.all([
    page.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000, polling: 200 }, code),
    page.click('form button[type="submit"]'),
  ]);
  await page.waitForSelector('[data-testid="open-whiteboard"]', { timeout: 20000 });
  return page;
}

const strokes = (page, count) => page.waitForFunction(
  (n) => document.querySelector('[data-testid="board-canvas"]')?.dataset.strokes === String(n),
  { timeout: 15000, polling: 200 },
  count
);

async function drawLine(page, from = [0.2, 0.3], to = [0.7, 0.6]) {
  const canvas = await page.$('[data-testid="board-canvas"]');
  const box = await canvas.boundingBox();
  const at = ([x, y]) => [box.x + box.width * x, box.y + box.height * y];
  await page.mouse.move(...at(from));
  await page.mouse.down();
  await page.mouse.move(...at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]), { steps: 5 });
  await page.mouse.move(...at(to), { steps: 5 });
  await page.mouse.up();
}

const inked = (page) => page.$eval('[data-testid="board-canvas"]', (canvas) => {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
  return false;
});

// Reads the rendered page itself, so this proves the PDF was drawn and not just that a number moved.
const waitForColor = (page, color) => page.waitForFunction((want) => {
  const canvas = document.querySelector('[data-testid="presentation-page-canvas"]');
  if (!canvas || canvas.width < 2) return false;
  const [r, g, b] = canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
  return [r, g, b].map((v) => (v > 128 ? 1 : 0)).join() === want.join();
}, { timeout: 20000, polling: 200 }, color);
const pageLabel = (page, text) => page.waitForFunction(
  (t) => document.querySelector('[data-testid="presentation-page"]')?.innerText === t,
  { timeout: 15000, polling: 200 },
  text
);

try {
  const [hostToken, memberToken] = await Promise.all([signup('Hoste'), signup('Membere')]);
  const created = await fetch(`${API_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL, Authorization: `Bearer ${hostToken}` },
    body: JSON.stringify({}),
  });
  assert.equal(created.status, 201);
  const code = (await created.json()).room.publicCode;

  const host = await enter(hostToken, code);
  const member = await enter(memberToken, code);

  step('the host draws and the member sees it');
  await host.click('[data-testid="open-whiteboard"]');
  await member.click('[data-testid="open-whiteboard"]');
  await host.waitForSelector('[data-testid="board-canvas"]');
  await member.waitForSelector('[data-testid="board-canvas"]');
  await drawLine(host);
  await strokes(host, 1);
  await strokes(member, 1);
  assert.ok(await inked(member), 'the line was counted but not drawn');

  step('a member cannot draw until allowed');
  await drawLine(member, [0.1, 0.1], [0.4, 0.2]);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(await member.$eval('[data-testid="board-canvas"]', (c) => c.dataset.strokes), '1');
  await host.click('[data-testid="let-everyone-draw"]');
  await member.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Undo'), { timeout: 15000, polling: 200 });
  await drawLine(member, [0.1, 0.1], [0.4, 0.2]);
  await strokes(member, 2);
  await strokes(host, 2);

  step('undo removes the member\'s own line for everyone');
  await member.$$eval('button', (els) => els.find((b) => b.textContent.trim() === 'Undo').click());
  await strokes(member, 1);
  await strokes(host, 1);

  step('the drawing survives a reload');
  await member.reload({ waitUntil: 'networkidle2' });
  await member.waitForSelector('[data-testid="open-whiteboard"]', { timeout: 20000 });
  await member.click('[data-testid="open-whiteboard"]');
  await strokes(member, 1);
  assert.ok(await inked(member));

  step('the host clears the board');
  await host.$$eval('button', (els) => els.find((b) => b.textContent.trim() === 'Clear').click());
  await strokes(host, 0);
  await strokes(member, 0);
  await host.click('[aria-label="Close board"]');
  await member.click('[aria-label="Close board"]');

  step('a member has no presenter controls');
  assert.equal(await member.$('[data-testid="start-presentation"]'), null);

  step('the host uploads a PDF and everyone is brought to it');
  const pdfPath = `/tmp/deck-${stamp}.pdf`;
  writeFileSync(pdfPath, buildPdf([RED, GREEN, BLUE]), 'latin1');
  await host.click('[data-testid="start-presentation"]');
  const input = await host.waitForSelector('[data-testid="presentation-file"]');
  await input.uploadFile(pdfPath);
  await pageLabel(host, 'Page 1 of 3');
  await pageLabel(member, 'Page 1 of 3');
  await waitForColor(host, RED);
  await waitForColor(member, RED);

  step('turning the page moves everyone');
  await host.click('[aria-label="Next page"]');
  await pageLabel(member, 'Page 2 of 3');
  await waitForColor(member, GREEN);
  await host.click('[aria-label="Next page"]');
  await pageLabel(member, 'Page 3 of 3');
  await waitForColor(member, BLUE);
  assert.ok(await host.$eval('[aria-label="Next page"]', (b) => b.disabled), 'next stays enabled on the last page');
  assert.equal(await member.$('[aria-label="Next page"]'), null, 'a member has page controls');

  step('annotations stay on their page');
  await drawLine(host);
  await strokes(host, 1);
  await strokes(member, 1);
  await host.click('[aria-label="Previous page"]');
  await pageLabel(member, 'Page 2 of 3');
  await strokes(member, 0);
  await host.click('[aria-label="Next page"]');
  await pageLabel(member, 'Page 3 of 3');
  await strokes(member, 1);

  step('someone rejoining lands on the current page');
  await member.reload({ waitUntil: 'networkidle2' });
  await pageLabel(member, 'Page 3 of 3');
  await waitForColor(member, BLUE);
  await strokes(member, 1);

  step('phone width stays inside the screen');
  await member.setViewport({ width: 375, height: 800 });
  await new Promise((r) => setTimeout(r, 500));
  assert.ok((await member.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'the board overflows');
  await waitForColor(member, BLUE);

  step('a closed presentation can be reopened, and stopping ends it for everyone');
  await member.click('[aria-label="Close board"]');
  await member.waitForSelector('[data-testid="open-presentation"]');
  await member.click('[data-testid="open-presentation"]');
  await pageLabel(member, 'Page 3 of 3');
  await host.$$eval('button', (els) => els.find((b) => b.textContent.trim() === 'Stop presenting').click());
  await member.waitForFunction(() => !document.querySelector('[data-testid="classroom-board"]'), { timeout: 15000, polling: 200 });

  console.log('E2E PASS classroom board');
} catch (err) {
  console.log(`E2E FAIL classroom board [${currentStep}] ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
