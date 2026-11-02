// Two browsers in one meeting, traced. Records every room lifecycle event so reconnects can be
// explained. Requires CHROME_PATH, WEB_URL, API_URL, ADMIN_DATABASE_URL and a local LiveKit server.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080';
const TRACE_FILE = process.env.MEDIA_TRACE_FILE || '/tmp/media_trace.txt';
const LABEL = process.env.MEDIA_TRACE_LABEL || 'run';
const stamp = Date.now();
const started = Date.now();
const lines = [];

const trace = (who, text) => lines.push(`${String(((Date.now() - started) / 1000).toFixed(1)).padStart(6)} ${who.padEnd(6)} ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signup(name) {
  const res = await fetch(`${API_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL },
    body: JSON.stringify({ email: `${name}-${stamp}@example.test`, password: 'correct-horse-battery-9', displayName: name }),
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
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});

async function person(who, token) {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: 'tc_session', value: token, domain: 'localhost', path: '/', httpOnly: true });
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('dialog', (d) => d.accept());
  await page.evaluateOnNewDocument(() => {
    window.__TC_ENABLE_TEST_DIAGNOSTICS = true;
  });
  page.on('console', (m) => {
    const text = m.text();
    if (/WEB_MEDIA_DIAG\]\[ROOM|negotiat|reconnect|connected to Livekit|leave request|signal|ICE|disconnect|publisher|MEDIA_LIFECYCLE/i.test(text)) {
      trace(who, text.replace(/\s+/g, ' ').slice(0, 170));
    }
  });
  page.on('response', (r) => {
    if (r.url().endsWith('/token') || r.url().endsWith('/join') || r.url().endsWith('/leave')) {
      trace(who, `HTTP ${r.status()} ${r.url().split('/').pop()}`);
    }
  });
  return page;
}

const sessions = (code) => execFileSync('psql', [process.env.ADMIN_DATABASE_URL, '-tAc',
  `SELECT split_part(m.identity, '-', 1) || '=' || count(*) || '/open=' || count(*) FILTER (WHERE m.left_at IS NULL)
   FROM participant_media_sessions m JOIN rooms r ON r.id = m.room_id WHERE r.public_code = '${code}' GROUP BY m.identity ORDER BY 1`]).toString().trim().replace(/\n/g, ' ');

async function enter(page, code) {
  await page.goto(`${WEB_URL}/room/${code}/preview`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('form button[type="submit"]');
  await page.click('form button[type="submit"]');
  await page.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000, polling: 200 }, code);
}

const roomState = (page) => page.evaluate(() => {
  const room = window.__livekitRoom;
  if (!room) return 'no room';
  return `state=${room.state} sid=${room.localParticipant?.sid} remotes=${room.remoteParticipants.size} tracks=${room.localParticipant?.trackPublications?.size}`;
});

let failed = null;
try {
  const [hostToken, memberToken] = await Promise.all([signup('hostb'), signup('memberb')]);
  const created = await fetch(`${API_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL, Authorization: `Bearer ${hostToken}` },
    body: JSON.stringify({}),
  });
  const code = (await created.json()).room.publicCode;
  const [host, member] = await Promise.all([person('host', hostToken), person('member', memberToken)]);

  const phase = async (name, ms) => {
    trace('TEST', `--- ${name}`);
    await sleep(ms);
    trace('TEST', `after ${name}: sessions ${sessions(code)}`);
    trace('host', await roomState(host));
    trace('member', await roomState(member));
  };

  await enter(host, code);
  await enter(member, code);
  await phase('joined, no media, 30s', 30000);

  await (await host.waitForSelector('button[aria-label="Turn on camera"]')).click();
  await phase('host camera on, 30s', 30000);

  await (await host.waitForSelector('button[aria-label="Turn off camera"]')).click();
  await phase('host camera off, 15s', 15000);

  await (await host.waitForSelector('button[aria-label="Toggle participants list"]')).click();
  await host.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Make host'), { timeout: 15000, polling: 200 });
  await host.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Make host').click());
  await phase('host transferred, 20s', 20000);

  const final = sessions(code);
  trace('TEST', `final sessions ${final}`);
  const counts = [...final.matchAll(/=(\d+)\/open=(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const extra = counts.filter(([total]) => total !== 1).length;
  console.log(`E2E ${extra === 0 ? 'PASS' : 'FAIL'} ${LABEL}: sessions per user ${final}`);
  if (extra !== 0) process.exitCode = 1;
} catch (err) {
  failed = err;
  console.log(`E2E FAIL ${LABEL} ${err.message.replace(/\s+/g, ' ').slice(0, 200)}`);
  process.exitCode = 1;
} finally {
  fs.appendFileSync(TRACE_FILE, `==== ${LABEL} ====\n${lines.join('\n')}\n`);
  await browser.close();
}
