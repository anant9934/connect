// Runs a breakout discussion between real browsers on a local media server.
// Requires CHROME_PATH, WEB_URL and API_URL pointing at disposable local services.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { describePages } from './e2e_report.mjs';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080';
const stamp = Date.now();

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

const inMeeting = async (page, code) => {
  await page.waitForSelector('form button[type="submit"]');
  await Promise.all([
    page.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000, polling: 200 }, code),
    page.click('form button[type="submit"]'),
  ]);
};

async function enter(token, code) {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: 'tc_session', value: token, domain: 'localhost', path: '/', httpOnly: true });
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${WEB_URL}/room/${code}/preview`, { waitUntil: 'networkidle2' });
  await inMeeting(page, code);
  await page.waitForSelector('[data-testid="open-whiteboard"]', { timeout: 20000 });
  return page;
}

const clickText = (page, text) => page.$$eval('button', (els, t) => els.find((e) => e.textContent.trim() === t).click(), text);
const waitForText = (page, text, timeout = 15000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 200 }, text);

try {
  const [hostToken, aliceToken, bobToken] = await Promise.all([signup('Hostf'), signup('Alicef'), signup('Bobf')]);
  const created = await fetch(`${API_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL, Authorization: `Bearer ${hostToken}` },
    body: JSON.stringify({}),
  });
  assert.equal(created.status, 201);
  const code = (await created.json()).room.publicCode;
  const host = await enter(hostToken, code);
  const alice = await enter(aliceToken, code);
  const bob = await enter(bobToken, code);

  step('a participant has no breakout controls');
  assert.equal(await alice.$('[data-testid="open-breakouts"]'), null);

  step('the host opens two groups');
  await host.waitForSelector('[data-testid="open-breakouts"]');
  await host.click('[data-testid="open-breakouts"]');
  await host.waitForSelector('#breakout-count');
  await clickText(host, 'Open groups');
  await waitForText(host, 'Visit Group 2');

  step('the host places people');
  await host.waitForFunction(() => document.querySelectorAll('[data-testid="breakout-person"]').length === 3, { timeout: 15000, polling: 200 });
  const groupOf = (page, label) => page.$eval(`select[aria-label="Group for ${label}"]`, (el) => [...el.options].map((o) => [o.textContent, o.value]));
  const options = Object.fromEntries(await groupOf(host, 'Alicef'));
  await host.select('select[aria-label="Group for Alicef"]', options['Group 1']);
  await alice.waitForSelector('[data-testid="breakout-invite"]', { timeout: 15000 });
  await waitForText(alice, 'You are in Group 1');
  await host.waitForFunction(() => !document.querySelector('select[aria-label="Group for Bobf"]')?.disabled, { timeout: 10000, polling: 200 });
  await host.select('select[aria-label="Group for Bobf"]', options['Group 2']);
  await waitForText(bob, 'You are in Group 2');

  step('each person joins their own group');
  await alice.$eval('[data-testid="breakout-invite"] a', (a) => a.click());
  await alice.waitForFunction(() => location.pathname.endsWith('/preview'), { timeout: 15000, polling: 200 });
  const groupOne = alice.url().split('/room/')[1].split('/')[0];
  assert.notEqual(groupOne, code);
  await inMeeting(alice, groupOne);
  await alice.waitForSelector('[data-testid="back-to-main"]', { timeout: 20000 });

  step('someone in another group is refused');
  await bob.goto(`${WEB_URL}/room/${groupOne}/preview`, { waitUntil: 'networkidle2' });
  await bob.waitForSelector('form button[type="submit"]');
  await bob.click('form button[type="submit"]');
  await bob.waitForFunction((c) => location.pathname !== `/room/${c}` , { timeout: 15000, polling: 200 }, groupOne);
  await new Promise((r) => setTimeout(r, 1500));
  assert.notEqual(new URL(bob.url()).pathname, `/room/${groupOne}`, 'bob entered a group they were not assigned to');
  await bob.goto(`${WEB_URL}/room/${code}`, { waitUntil: 'networkidle2' });

  step('closing the groups brings the group back to the main meeting');
  await clickText(host, 'Close all groups');
  await alice.waitForFunction((c) => location.pathname === `/room/${c}/preview`, { timeout: 30000, polling: 500 }, code);
  await waitForText(host, 'Number of groups');
  await inMeeting(alice, code);

  step('phone width stays inside the screen');
  await host.setViewport({ width: 375, height: 800 });
  await new Promise((r) => setTimeout(r, 400));
  assert.ok((await host.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'the dialog overflows');

  console.log('E2E PASS breakouts');
} catch (err) {
  console.log(`E2E FAIL breakouts [${currentStep}] ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
  for (const line of await describePages(browser)) console.log(line);
  process.exitCode = 1;
} finally {
  await browser.close();
}
