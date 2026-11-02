// Two browsers in one meeting, traced, checking one Room connection per participant. A reconnect
// must have an explicit cause in this script. Requires CHROME_PATH, WEB_URL, API_URL,
// ADMIN_DATABASE_URL and a local LiveKit server in a container named livekit.
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
const counts = { host: {}, member: {} };

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
    for (const event of ['RoomCreated', 'ConnectionEffectStarted', 'ConnectionEffectCleanup', 'ConnectStarted']) {
      if (text.includes(`ROOM ${event}`)) counts[who][event] = (counts[who][event] || 0) + 1;
    }
    if (/WEB_MEDIA_DIAG|negotiat|reconnect|connected to Livekit|leave request|signal|ICE|disconnect|publisher|MEDIA_LIFECYCLE/i.test(text)) {
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

const psql = (query) => execFileSync('psql', [process.env.ADMIN_DATABASE_URL, '-tAc', query]).toString().trim();

// total and open LiveKit sessions per identity, from the signed webhook.
const sessions = (code) => {
  const rows = psql(`SELECT m.identity, count(*), count(*) FILTER (WHERE m.left_at IS NULL)
    FROM participant_media_sessions m JOIN rooms r ON r.id = m.room_id WHERE r.public_code = '${code}' GROUP BY m.identity`);
  const out = {};
  for (const row of rows.split('\n').filter(Boolean)) {
    const [identity, total, open] = row.split('|');
    out[identity] = { total: Number(total), open: Number(open) };
  }
  return out;
};

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

const clickButton = (page, label) => page.waitForSelector(`button[aria-label="${label}"]`, { timeout: 15000 }).then((b) => b.click());
const clickText = (page, text) => page.waitForFunction((t) => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
  if (!button) return false;
  button.click();
  return true;
}, { timeout: 15000, polling: 200 }, text);
const waitText = (page, text, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 200 }, text);
const check = (name, ok, detail = '') => {
  trace('TEST', `${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`);
  console.log(`CHECK ${ok ? 'ok' : 'FAIL'} ${name} ${detail}`.trim());
  assert.ok(ok, `${name} ${detail}`);
};
const until = async (fn, ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(500);
  }
  return false;
};

try {
  const [hostToken, memberToken] = await Promise.all([signup('hostb'), signup('memberb')]);
  const created = await fetch(`${API_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL, Authorization: `Bearer ${hostToken}` },
    body: JSON.stringify({}),
  });
  const createdBody = await created.json();
  const code = createdBody.room.publicCode;
  const hostIdentity = createdBody.room.hostIdentity;
  const [host, member] = await Promise.all([person('host', hostToken), person('member', memberToken)]);
  const memberIdentity = () => Object.keys(sessions(code)).find((i) => i !== hostIdentity);
  const totals = () => Object.values(sessions(code)).map((v) => v.total).sort().join(',');
  const opens = () => Object.values(sessions(code)).map((v) => v.open).sort().join(',');
  const phase = async (name, ms) => {
    trace('TEST', `--- ${name}`);
    await sleep(ms);
    trace('TEST', `after ${name}: ${JSON.stringify(sessions(code))}`);
    trace('host', await roomState(host));
    trace('member', await roomState(member));
  };

  await enter(host, code);
  await enter(member, code);
  await phase('joined, no media', 20000);
  check('two participants joined with one session each', totals() === '1,1' && opens() === '1,1', totals());
  check('one Room per participant', counts.host.RoomCreated === 1 && counts.member.RoomCreated === 1, JSON.stringify(counts));
  check('connection effect ran once', counts.host.ConnectionEffectStarted === 1 && counts.member.ConnectionEffectStarted === 1);

  await clickButton(host, 'Turn on camera');
  await member.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.videoWidth > 0 && v.currentTime > 3 && !v.paused), { timeout: 30000, polling: 500 });
  check('remote video keeps playing', true);
  await phase('host camera on', 20000);
  check('media over time created no reconnect', totals() === '1,1', totals());
  await clickButton(host, 'Turn off camera');

  await clickButton(host, 'Toggle participants list');
  await clickText(host, 'Make co-host');
  await clickButton(member, 'Toggle participants list');
  await waitText(member, 'Mute all');
  await clickText(host, 'Revoke co-host');
  await member.waitForFunction(() => !document.body.innerText.includes('Mute all'), { timeout: 15000, polling: 200 });
  await phase('co-host granted and revoked', 5000);
  check('role changes caused no reconnect', totals() === '1,1' && counts.member.ConnectionEffectStarted === 1, totals());

  await clickText(host, 'Make host');
  await waitText(member, 'Meeting permissions');
  await host.waitForFunction(() => !document.body.innerText.includes('Meeting permissions'), { timeout: 15000, polling: 200 });
  await phase('host transferred', 20000);
  check('transfer after a stable connection caused no reconnect', totals() === '1,1' && counts.host.ConnectionEffectStarted === 1, totals());
  await clickButton(host, 'Turn on camera');
  await host.waitForSelector('button[aria-label="Turn off camera"]', { timeout: 15000 });
  check('the previous host can still publish', true);
  await clickButton(host, 'Turn off camera');
  check('the new host holds host controls', await member.evaluate(() => document.body.innerText.includes('Mute all')));

  const sidBefore = await member.evaluate(() => window.__livekitRoom.localParticipant.sid);
  await member.evaluate(() => Promise.all([window.__tcDiagnostics.connectAgain(), window.__tcDiagnostics.connectAgain()]));
  await sleep(2000);
  const sidAfter = await member.evaluate(() => window.__livekitRoom.localParticipant.sid);
  check('duplicate connect attempts change nothing', sidBefore === sidAfter && totals() === '1,1', totals());

  // A real outage: the media server stops responding, then returns.
  trace('TEST', '--- media server paused 8s');
  execFileSync('docker', ['pause', 'livekit']);
  await sleep(8000);
  execFileSync('docker', ['unpause', 'livekit']);
  const recovered = await until(async () => (await roomState(host)).startsWith('state=connected') && (await roomState(member)).startsWith('state=connected'), 45000);
  check('both recover from a network interruption', recovered, `${await roomState(host)} | ${await roomState(member)}`);
  await sleep(5000);
  check('recovery leaves one open session per participant', await until(() => opens() === '1,1', 20000), `${totals()} open ${opens()}`);

  await member.reload({ waitUntil: 'networkidle2' });
  await member.waitForSelector('button[aria-label="Toggle chat"]', { timeout: 20000 });
  check('reload ends with one open session', await until(() => opens() === '1,1', 30000), `${totals()} open ${opens()}`);
  check('reload adds exactly one session', Number(sessions(code)[memberIdentity()].total) >= 2, totals());

  const cleanupBefore = counts.member.ConnectionEffectCleanup || 0;
  await clickButton(member, 'Leave meeting');
  await member.waitForFunction(() => location.pathname === '/', { timeout: 15000, polling: 200 });
  check('leaving unmounts and cleans up once', (counts.member.ConnectionEffectCleanup || 0) === cleanupBefore + 1, JSON.stringify(counts.member));
  check('leaving closes the session', await until(() => sessions(code)[memberIdentity()].open === 0, 20000));
  await enter(member, code);
  check('rejoining opens one session', await until(() => sessions(code)[memberIdentity()].open === 1, 20000));
  const rows = psql(`SELECT count(*) FROM room_participants p JOIN rooms r ON r.id = p.room_id WHERE r.public_code = '${code}' AND p.identity = '${memberIdentity()}' AND p.left_at IS NULL`);
  check('one active participant record after rejoining', rows === '1', rows);

  console.log(`E2E PASS ${LABEL}`);
} catch (err) {
  console.log(`E2E FAIL ${LABEL} ${err.message.replace(/\s+/g, ' ').slice(0, 240)}`);
  process.exitCode = 1;
} finally {
  fs.appendFileSync(TRACE_FILE, `==== ${LABEL} ====\n${lines.join('\n')}\n`);
  await browser.close();
}
