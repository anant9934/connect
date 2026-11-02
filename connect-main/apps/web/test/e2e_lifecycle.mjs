// Runs a meeting from waiting room to end, with the host's controls, between real browsers.
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

async function preview(token, code) {
  const context = await browser.createBrowserContext();
  if (token) await context.setCookie({ name: 'tc_session', value: token, domain: 'localhost', path: '/', httpOnly: true });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.evaluateOnNewDocument(() => { window.__TC_ENABLE_TEST_DIAGNOSTICS = true; });
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${WEB_URL}/room/${code}/preview`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('form button[type="submit"]');
  return page;
}

const submit = async (page, code) => {
  await Promise.all([
    page.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000, polling: 200 }, code),
    page.click('form button[type="submit"]'),
  ]);
};
const inRoom = (page) => page.waitForFunction(() => window.__tcDiagnostics?.getRoomState() === 'connected', { timeout: 30000, polling: 200 });
const waitForText = (page, text, timeout = 20000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 200 }, text);
const clickText = (page, text) => page.$$eval('button', (els, t) => {
  const found = els.find((e) => e.textContent.trim() === t);
  if (!found) throw new Error(`no button ${t}`);
  found.click();
}, text);
// The room has a waiting room, so someone newly allowed in may need admitting.
const inRoomOrWaiting = async (host, page) => {
  await page.waitForFunction(() => document.body.innerText.includes('Please wait') || window.__tcDiagnostics?.getRoomState() === 'connected', { timeout: 30000, polling: 200 });
  assert.ok(!(await page.evaluate(() => document.body.innerText.includes('locked'))), 'still locked');
};
const openPeople = async (page) => {
  await page.waitForSelector('button[aria-label="Toggle participants list"]', { timeout: 20000 });
  await page.click('button[aria-label="Toggle participants list"]');
  await waitForText(page, 'Participants');
};

try {
  const [hostToken, memberToken, lateToken] = await Promise.all([signup('Hosth'), signup('Memberh'), signup('Lateh')]);
  const created = await fetch(`${API_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL, Authorization: `Bearer ${hostToken}` },
    body: JSON.stringify({ waitingRoomEnabled: true }),
  });
  assert.equal(created.status, 201);
  const code = (await created.json()).room.publicCode;

  const host = await preview(hostToken, code);
  await submit(host, code);
  await inRoom(host);
  await openPeople(host);

  step('a guest waits, and the host admits them');
  const guest = await preview(null, code);
  await guest.waitForSelector('input[type="text"]');
  await guest.type('input[type="text"]', 'Visitor H');
  await guest.click('form button[type="submit"]');
  await waitForText(guest, 'Please wait, the host will let');
  await waitForText(host, 'Visitor H');
  await clickText(host, 'Admit');
  await inRoom(guest);

  step('a signed-in member joins');
  const member = await preview(memberToken, code);
  await member.click('form button[type="submit"]');
  await new Promise((r) => setTimeout(r, 500));
  if (await member.evaluate(() => document.body.innerText.includes('Please wait'))) {
    await waitForText(host, 'Memberh');
    await clickText(host, 'Admit');
  }
  await inRoom(member);

  step('locking keeps a new person out');
  await clickText(host, 'Lock Room');
  await waitForText(host, 'Unlock');
  const late = await preview(lateToken, code);
  await late.click('form button[type="submit"]');
  await waitForText(late, 'locked');
  await late.close();

  step('unlocking lets people in again');
  await clickText(host, 'Unlock');
  await waitForText(host, 'Lock Room');
  const again = await preview(lateToken, code);
  await again.click('form button[type="submit"]');
  await inRoomOrWaiting(host, again);
  await again.close();

  step('muting everyone silences a live microphone');
  await member.waitForSelector('button[aria-label="Turn on microphone"], button[aria-label="Mute microphone"], button[aria-label="Turn off microphone"]', { timeout: 15000 });
  await member.evaluate(() => window.__livekitRoom.localParticipant.setMicrophoneEnabled(true));
  await member.waitForFunction(() => window.__livekitRoom.localParticipant.isMicrophoneEnabled, { timeout: 15000, polling: 200 });
  await host.waitForFunction(() => window.__tcDiagnostics.getRemoteTrackStats().some((p) => p.tracks.some((t) => t.kind === 'audio')), { timeout: 15000, polling: 200 });
  await clickText(host, 'Mute all');
  await member.waitForFunction(() => {
    const pub = [...window.__livekitRoom.localParticipant.trackPublications.values()].find((t) => t.kind === 'audio');
    return !pub || pub.isMuted;
  }, { timeout: 20000, polling: 200 });

  step('removing a person disconnects them and keeps them out');
  await host.waitForFunction(() => document.querySelector('button[aria-label="Remove participant"]'), { timeout: 15000, polling: 200 });
  const removed = await host.$$eval('button[aria-label="Remove participant"]', (buttons) => {
    const target = buttons.find((b) => (b.closest('div[class*="rounded"]')?.parentElement?.innerText || '').includes('Memberh')) || null;
    if (target) target.click();
    return Boolean(target);
  });
  assert.ok(removed, 'the host could not find the member to remove');
  await waitForText(host, 'Remove participant?');
  await host.$$eval('.fixed button', (els) => els.find((e) => /^remove/i.test(e.textContent.trim())).click());
  await waitForText(member, 'Removed from Meeting');
  await member.goto(`${WEB_URL}/room/${code}`, { waitUntil: 'networkidle2' });
  await waitForText(member, 'removed');

  step('ending the meeting ends it for everyone');
  await clickText(host, 'End for all').catch(() => clickText(host, 'End for All'));
  await waitForText(host, 'End for everyone');
  await clickText(host, 'End for everyone');
  await waitForText(guest, 'This meeting has ended', 30000);
  const after = await fetch(`${API_URL}/api/v1/rooms/${code}`, { headers: { Authorization: `Bearer ${hostToken}` } });
  assert.equal((await after.json()).room?.status ?? 'ended', 'ended');

  console.log('E2E PASS lifecycle');
} catch (err) {
  console.log(`E2E FAIL lifecycle [${currentStep}] ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
  for (const line of await describePages(browser)) console.log(line);
  process.exitCode = 1;
} finally {
  await browser.close();
}
