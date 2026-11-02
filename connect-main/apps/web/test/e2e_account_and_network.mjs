// Manages a profile, checks the connection page and uses bandwidth modes, in real browsers.
// Requires CHROME_PATH, WEB_URL and API_URL pointing at disposable local services.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080';
const PASSWORD = 'correct-horse-battery-9';
const stamp = Date.now();

let currentStep = 'setup';
const step = (name) => {
  currentStep = name;
  console.log(`STEP ${name}`);
};

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function solidPng(size, [r, g, b]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).map((_, i) => [r, g, b][i % 3])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function signup(name) {
  const email = `${name.toLowerCase()}-${stamp}@example.test`;
  const res = await fetch(`${API_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL },
    body: JSON.stringify({ email, password: PASSWORD, displayName: name }),
  });
  assert.equal(res.status, 201);
  return { email, id: (await res.json()).user.id, token: res.headers.get('set-cookie').match(/tc_session=([^;]+)/)[1] };
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function open(person, path, diagnostics = false) {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: 'tc_session', value: person.token, domain: 'localhost', path: '/', httpOnly: true });
  const page = await context.newPage();
  if (diagnostics) await page.evaluateOnNewDocument(() => { window.__TC_ENABLE_TEST_DIAGNOSTICS = true; });
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${WEB_URL}${path}`, { waitUntil: 'networkidle2' });
  return page;
}

const waitForText = (page, text, timeout = 15000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 200 }, text);
const setField = (page, selector, value) => page.$eval(selector, (el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const noSideScroll = async (page, name) => {
  await page.setViewport({ width: 375, height: 800 });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, `${name} overflows`);
  await page.setViewport({ width: 1280, height: 800 });
};

try {
  const [user, other] = await Promise.all([signup('Profileg'), signup('Otherg')]);

  step('a person changes their name');
  const page = await open(user, '/profile');
  await page.waitForSelector('#profile-name');
  await setField(page, '#profile-name', 'Renamed Person');
  await page.$$eval('button', (els) => els.find((b) => b.textContent.trim() === 'Save name').click());
  await waitForText(page, 'Your name was updated');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#profile-name');
  assert.equal(await page.$eval('#profile-name', (el) => el.value), 'Renamed Person');

  step('a person uploads a picture, and what comes back is a re-encoded image');
  assert.ok(await page.$('[data-testid="avatar-empty"]'));
  const picture = `/tmp/avatar-${stamp}.png`;
  writeFileSync(picture, solidPng(320, [200, 20, 20]));
  const input = await page.$('[data-testid="avatar-file"]');
  await input.uploadFile(picture);
  await page.waitForSelector('[data-testid="avatar-image"]', { timeout: 15000 });
  await page.waitForFunction(() => {
    const img = document.querySelector('[data-testid="avatar-image"]');
    return img.complete && img.naturalWidth === 256;
  }, { timeout: 15000, polling: 200 });
  const served = await page.$eval('[data-testid="avatar-image"]', async (img) => {
    const res = await fetch(img.src, { credentials: 'include' });
    return { status: res.status, type: res.headers.get('content-type'), sniff: res.headers.get('x-content-type-options') };
  });
  assert.deepEqual(served, { status: 200, type: 'image/jpeg', sniff: 'nosniff' });

  step('something that is not an image is refused and the picture stays');
  const fake = `/tmp/fake-${stamp}.png`;
  writeFileSync(fake, '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  await (await page.$('[data-testid="avatar-file"]')).uploadFile(fake);
  await waitForText(page, 'Choose a PNG or JPEG');
  assert.ok(await page.$('[data-testid="avatar-image"]'), 'the old picture was lost');

  step('a picture needs a signed-in viewer');
  const anonymous = await fetch(`${API_URL}/api/v1/users/${user.id}/avatar`);
  assert.equal(anonymous.status, 401);
  const seen = await fetch(`${API_URL}/api/v1/users/${user.id}/avatar`, { headers: { Authorization: `Bearer ${other.token}` } });
  assert.equal(seen.status, 200);

  step('phone width has no horizontal scroll');
  await noSideScroll(page, 'profile');

  step('a person removes their picture');
  await page.$$eval('button', (els) => els.find((b) => b.textContent.trim() === 'Remove picture').click());
  await page.waitForSelector('[data-testid="avatar-empty"]', { timeout: 15000 });
  const gone = await fetch(`${API_URL}/api/v1/users/${user.id}/avatar`, { headers: { Authorization: `Bearer ${other.token}` } });
  assert.equal(gone.status, 404);

  step('a wrong current password changes nothing');
  await setField(page, '#password-current', 'not-my-password');
  await setField(page, '#password-next', 'a-new-password-77');
  await setField(page, '#password-confirm', 'a-different-one-77');
  await page.click('#change-password button[type="submit"]');
  await waitForText(page, 'do not match');
  await setField(page, '#password-confirm', 'a-new-password-77');
  await page.click('#change-password button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('[role="alert"]') && !document.querySelector('[role="alert"]').innerText.includes('do not match'), { timeout: 15000, polling: 200 });

  step('changing the password ends every session');
  const elsewhere = await fetch(`${API_URL}/api/v1/users/me/profile`, { headers: { Authorization: `Bearer ${user.token}` } });
  assert.equal(elsewhere.status, 200);
  await setField(page, '#password-current', PASSWORD);
  await page.click('#change-password button[type="submit"]');
  await page.waitForFunction(() => location.pathname.startsWith('/sign-in'), { timeout: 15000, polling: 200 });
  const ended = await fetch(`${API_URL}/api/v1/users/me/profile`, { headers: { Authorization: `Bearer ${user.token}` } });
  assert.equal(ended.status, 401);
  const relogin = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL },
    body: JSON.stringify({ email: user.email, password: 'a-new-password-77' }),
  });
  assert.equal(relogin.status, 200);
  await page.close();

  step('the connection check reports real results');
  const check = await open(other, '/diagnostics');
  await check.waitForFunction(() => [...document.querySelectorAll('[data-testid^="check-"]')].every((el) => el.dataset.outcome !== 'pending'), { timeout: 30000, polling: 200 });
  const outcome = (id) => check.$eval(`[data-testid="check-${id}"]`, (el) => el.dataset.outcome);
  assert.equal(await outcome('server'), 'pass');
  assert.equal(await outcome('microphone'), 'pass');
  assert.equal(await outcome('camera'), 'pass');
  assert.ok(['pass', 'warn'].includes(await outcome('network')), `network: ${await outcome('network')}`);
  await noSideScroll(check, 'diagnostics');
  await check.close();

  step('audio only stops receiving video without leaving the call');
  const created = await fetch(`${API_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL, Authorization: `Bearer ${other.token}` },
    body: JSON.stringify({}),
  });
  assert.equal(created.status, 201);
  const code = (await created.json()).room.publicCode;
  const fresh = await signup('Viewerg');
  const enter = async (person) => {
    const room = await open(person, `/room/${code}/preview`, true);
    await room.waitForSelector('form button[type="submit"]');
    await Promise.all([
      room.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000, polling: 200 }, code),
      room.click('form button[type="submit"]'),
    ]);
    await room.waitForFunction(() => window.__tcDiagnostics?.getRoomState() === 'connected', { timeout: 30000, polling: 200 });
    return room;
  };
  const sender = await enter(other);
  const viewer = await enter(fresh);
  await sender.evaluate(() => window.__livekitRoom.localParticipant.setCameraEnabled(true));
  const videoSubscribed = (want) => viewer.waitForFunction((w) => {
    const video = window.__tcDiagnostics.getRemoteTrackStats().flatMap((p) => p.tracks).find((t) => t.kind === 'video');
    return video && video.isSubscribed === w;
  }, { timeout: 20000, polling: 300 }, want);
  await videoSubscribed(true);
  await viewer.waitForSelector('[data-testid="bandwidth-mode"]');
  await viewer.select('[data-testid="bandwidth-mode"]', 'audio-only');
  await videoSubscribed(false);
  assert.equal(await viewer.evaluate(() => window.__tcDiagnostics.getRoomState()), 'connected');

  step('the choice survives a reload and applies to video already there');
  await viewer.reload({ waitUntil: 'networkidle2' });
  await viewer.waitForFunction(() => window.__tcDiagnostics?.getRoomState() === 'connected' || document.querySelector('form button[type="submit"]'), { timeout: 30000, polling: 200 });
  const mode = await viewer.waitForSelector('[data-testid="bandwidth-mode"]', { timeout: 30000 });
  assert.equal(await mode.evaluate((el) => el.value), 'audio-only');
  await videoSubscribed(false);

  step('best video brings it back');
  await viewer.select('[data-testid="bandwidth-mode"]', 'normal');
  await videoSubscribed(true);

  console.log('E2E PASS account and network');
} catch (err) {
  console.log(`E2E FAIL account and network [${currentStep}] ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
