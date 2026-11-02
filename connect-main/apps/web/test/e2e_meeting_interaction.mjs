// Three real browsers in a real LiveKit room, from a local dev server, not LiveKit Cloud.
// Requires CHROME_PATH, WEB_URL, API_URL and ADMIN_DATABASE_URL for a disposable database.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080';
const stamp = Date.now();

const step = (name) => console.log(`STEP ${name}`);

async function signup(name) {
  const res = await fetch(`${API_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL },
    body: JSON.stringify({ email: `${name.toLowerCase()}-${stamp}@example.test`, password: 'correct-horse-battery-9', displayName: name }),
  });
  assert.equal(res.status, 201, `signup ${name}`);
  return (res.headers.get('set-cookie') || '').match(/tc_session=([^;]+)/)?.[1];
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: [
    '--no-sandbox',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--auto-accept-this-tab-capture',
    '--auto-select-desktop-capture-source=Entire screen',
  ],
});

async function person(token) {
  const context = await browser.createBrowserContext();
  if (token) {
    await context.setCookie({ name: 'tc_session', value: token, domain: 'localhost', path: '/', httpOnly: true });
  }
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('dialog', (d) => d.accept());
  return page;
}

async function setField(page, selector, value) {
  await page.waitForSelector(selector);
  await page.$eval(selector, (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

const waitForText = (page, text, timeout = 15000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const waitGone = (page, text, timeout = 15000) =>
  page.waitForFunction((t) => !document.body.innerText.includes(t), { timeout }, text);
const click = (page, label) => page.waitForSelector(`button[aria-label="${label}"]`).then((b) => b.click());
const clickByText = (page, text) =>
  page.waitForFunction((t) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
    if (!button) return false;
    button.click();
    return true;
  }, { timeout: 15000 }, text);

async function enter(page, code, guestName) {
  await page.goto(`${WEB_URL}/room/${code}/preview`, { waitUntil: 'networkidle2' });
  if (guestName) await setField(page, '#guestName', guestName);
  await page.waitForSelector('form button[type="submit"]');
  await page.click('form button[type="submit"]');
  await page.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000 }, code);
}

async function sendChat(page, text) {
  await setField(page, '#chat-input', text);
  await click(page, 'Send message');
}

try {
  step('three people enter one meeting');
  const [hostToken, memberToken] = await Promise.all([signup('Hosta'), signup('Membera')]);
  const created = await fetch(`${API_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL, Authorization: `Bearer ${hostToken}` },
    body: JSON.stringify({}),
  });
  assert.equal(created.status, 201);
  const code = (await created.json()).room.publicCode;

  const [host, member, guest] = await Promise.all([person(hostToken), person(memberToken), person()]);
  await enter(host, code);
  await enter(member, code);
  await enter(guest, code, 'Guesta');
  await host.waitForFunction(() => document.querySelectorAll('[data-testid="participant-tile"]').length >= 3, { timeout: 30000 });

  step('real video reaches another participant');
  await click(host, 'Turn on camera');
  await host.waitForSelector('button[aria-label="Turn off camera"]');
  await member.waitForFunction(
    () => [...document.querySelectorAll('video')].some((v) => v.videoWidth > 0 && v.readyState >= 2),
    { timeout: 30000 }
  );
  const before = await member.$$eval('video', (videos) => Math.max(...videos.map((v) => v.currentTime)));
  await new Promise((r) => setTimeout(r, 2000));
  const after = await member.$$eval('video', (videos) => Math.max(...videos.map((v) => v.currentTime)));
  assert.ok(after > before, `remote video did not advance: ${before} then ${after}`);

  step('microphone publishes');
  await click(member, 'Unmute microphone');
  await member.waitForSelector('button[aria-label="Mute microphone"]', { timeout: 15000 });

  step('chat reaches others, with the sender set by the server');
  await click(member, 'Toggle chat');
  await click(host, 'Toggle chat');
  await click(guest, 'Toggle chat');
  await sendChat(member, 'Hello from Membera');
  await waitForText(host, 'Hello from Membera');
  await waitForText(guest, 'Hello from Membera');
  await waitForText(host, 'Membera');
  await sendChat(guest, 'Hello from Guesta');
  await waitForText(member, 'Hello from Guesta');

  step('only the host and co-hosts can announce');
  assert.equal(await member.$('#chat-announcement'), null, 'a participant can announce');
  assert.equal(await guest.$('#chat-announcement'), null, 'a guest can announce');
  await host.waitForSelector('#chat-announcement');
  await host.click('#chat-announcement');
  await sendChat(host, 'Exam moved to Friday');
  await guest.waitForSelector('[data-testid="announcement-banner"]', { timeout: 15000 });
  await waitForText(guest, 'Exam moved to Friday');

  step('messages survive a reload');
  await guest.reload({ waitUntil: 'networkidle2' });
  await guest.waitForSelector('button[aria-label="Toggle chat"]', { timeout: 20000 });
  await click(guest, 'Toggle chat');
  await waitForText(guest, 'Hello from Membera');
  await waitForText(guest, 'Exam moved to Friday');
  await guest.waitForSelector('[data-testid="announcement-message"]');
  assert.equal(await guest.$$eval('[data-testid="chat-message"]', (rows) => rows.filter((r) => r.textContent.includes('Hello from Guesta')).length), 1, 'a reload duplicated a message');

  step('a raised hand is visible and a host can lower it');
  await click(guest, 'Reactions');
  await clickByText(guest, 'Raise Hand').catch(async () => click(guest, 'Raise hand'));
  await click(host, 'Toggle participants list');
  await host.waitForSelector('button[aria-label="Lower Guesta\'s hand"]', { timeout: 15000 });
  await click(host, "Lower Guesta's hand");
  await host.waitForFunction(() => !document.querySelector('button[aria-label^="Lower Guesta"]'), { timeout: 15000 });

  step('a reaction reaches others');
  await click(member, 'Reactions');
  await click(member, 'Thumbs Up');
  await waitForText(host, '👍');

  step('the host makes a co-host, and their controls appear');
  await clickByText(host, 'Make co-host');
  await click(member, 'Toggle participants list');
  await waitForText(member, 'Mute all', 15000);
  await waitForText(member, 'Co-host');
  assert.equal(await guest.$('button[aria-label="Mute all"]'), null);

  step('the host transfers the meeting');
  await clickByText(host, 'Make host');
  await waitForText(member, 'Meeting permissions', 15000);
  await waitGone(host, 'Meeting permissions', 15000);

  step('screen sharing publishes');
  await click(member, 'Share screen');
  await member.waitForSelector('button[aria-label="Stop sharing screen"]', { timeout: 20000 });

  step('phone width has no horizontal scroll in the meeting');
  await guest.setViewport({ width: 375, height: 800 });
  await new Promise((r) => setTimeout(r, 500));
  const overflow = await guest.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `meeting overflows by ${overflow}px`);

  step('the signed webhook recorded the connections');
  const count = () => Number(execFileSync('psql', [process.env.ADMIN_DATABASE_URL, '-tAc',
    `SELECT count(DISTINCT m.identity) FROM participant_media_sessions m JOIN rooms r ON r.id = m.room_id WHERE r.public_code = '${code}'`]).toString().trim());
  for (let i = 0; i < 30 && count() < 3; i++) await new Promise((r) => setTimeout(r, 1000));
  assert.ok(count() >= 3, `the webhook recorded ${count()} of 3 participants`);

  console.log('E2E PASS meeting interaction with real media');
} catch (err) {
  console.log(`E2E FAIL ${err.message}`);
  for (const [i, page] of (await browser.pages()).entries()) {
    console.log(`page ${i}: ${page.url()}`);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
