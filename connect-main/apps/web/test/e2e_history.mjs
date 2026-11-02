// Searches persisted meetings in a real browser as different people.
// Requires CHROME_PATH, WEB_URL and API_URL pointing at disposable local services.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { describePages } from './e2e_report.mjs';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080';
const stamp = Date.now();
const tag = `T${stamp}`;

let currentStep = 'setup';
const step = (name) => {
  currentStep = name;
  console.log(`STEP ${name}`);
};

async function api(method, path, token, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
}

async function signup(name) {
  const res = await api('POST', '/api/v1/auth/signup', null, { email: `${name}-${stamp}@example.test`, password: 'correct-horse-battery-9', displayName: name });
  assert.equal(res.status, 201);
  return res.headers.get('set-cookie').match(/tc_session=([^;]+)/)[1];
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox'] });

async function person(token) {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: 'tc_session', value: token, domain: 'localhost', path: '/', httpOnly: true });
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  return page;
}

const waitForText = (page, text, timeout = 15000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 200 }, text);
const waitGone = (page, text, timeout = 15000) =>
  page.waitForFunction((t) => !document.body.innerText.includes(t), { timeout, polling: 200 }, text);
const typeSearch = async (page, text) => {
  await page.click('#history-search', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('#history-search', text);
};
const setDate = (page, selector, value) => page.$eval(selector, (el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, value);
const waitForOnlyRow = (page, text) => page.waitForFunction((t) => {
  const found = [...document.querySelectorAll('[data-testid="meeting-row"]')];
  return found.length === 1 && found[0].innerText.includes(t);
}, { timeout: 15000, polling: 200 }, text);

try {
  const [hostToken, memberToken, strangerToken] = await Promise.all([signup('Hostc'), signup('Memberc'), signup('Strangerc')]);
  const schedule = async (token, title, days) => {
    const start = new Date(Date.now() + days * 86400000);
    const res = await api('POST', '/api/v1/rooms', token, {
      title, timeZone: 'Asia/Kolkata', scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3600000).toISOString(),
    });
    assert.equal(res.status, 201);
    return res.data.room;
  };
  const alpha = await schedule(hostToken, `${tag} Alpha`, 10);
  const beta = await schedule(hostToken, `${tag} Beta`, 20);
  await schedule(strangerToken, `${tag} Stranger`, 10);
  assert.equal((await api('POST', `/api/v1/rooms/${beta.publicCode}/join`, hostToken, {})).status, 200);
  assert.equal((await api('POST', `/api/v1/rooms/${beta.publicCode}/join`, memberToken, {})).status, 200);
  assert.equal((await api('POST', `/api/v1/rooms/${beta.publicCode}/leave`, memberToken, {})).status, 200);
  assert.equal((await api('POST', `/api/v1/rooms/${beta.publicCode}/end`, hostToken)).status, 200);

  const host = await person(hostToken);

  step('the host searches by title');
  await host.goto(`${WEB_URL}/history`, { waitUntil: 'networkidle2' });
  await host.waitForSelector('#history-search');
  await typeSearch(host, `${tag} alpha`);
  await waitForOnlyRow(host, `${tag} Alpha`);
  assert.ok(!(await host.evaluate(() => document.body.innerText.includes('Stranger'))), 'another person\'s meeting appeared');

  step('the host searches by meeting code');
  await typeSearch(host, alpha.publicCode.toLowerCase());
  await waitForOnlyRow(host, 'Alpha');

  step('status and date filters narrow the results');
  await typeSearch(host, tag);
  await host.waitForFunction(() => document.querySelectorAll('[data-testid="meeting-row"]').length === 2, { timeout: 15000, polling: 200 });
  await host.select('#history-status', 'ended');
  await waitForOnlyRow(host, 'Beta');
  await host.select('#history-status', '');
  await waitForText(host, '2 meetings');
  const day = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  step('a start date narrows the results');
  await setDate(host, '#history-from', day(15));
  await waitForOnlyRow(host, 'Beta');
  step('a date range with nothing in it shows the empty state');
  await setDate(host, '#history-to', day(16));
  await waitForText(host, 'No meetings match this search');

  step('clearing filters brings everything back');
  await host.$$eval('button', (els) => els.find((b) => b.textContent.trim() === 'Clear filters').click());
  await typeSearch(host, tag);
  await host.waitForFunction(() => document.querySelectorAll('[data-testid="meeting-row"]').length === 2, { timeout: 15000, polling: 200 });

  step('sorting changes the order');
  await host.select('#history-sort', 'oldest');
  await host.waitForFunction(() => document.querySelector('[data-testid="meeting-row"]')?.innerText.includes('Alpha'), { timeout: 15000, polling: 200 });
  await host.select('#history-sort', 'newest');
  await host.waitForFunction(() => document.querySelector('[data-testid="meeting-row"]')?.innerText.includes('Beta'), { timeout: 15000, polling: 200 });

  step('the host exports a scheduled meeting to a calendar');
  const exported = await host.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
  }, `${API_URL}/api/v1/meetings/${alpha.id}/calendar.ics`);
  assert.equal(exported.status, 200);
  assert.ok(exported.type.startsWith('text/calendar') && exported.text.includes(`${tag} Alpha`), exported.text.slice(0, 200));
  assert.ok(await host.$('[data-testid="calendar-all"]'), 'export link is missing');

  step('phone width has no horizontal scroll');
  await host.setViewport({ width: 375, height: 800 });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok((await host.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'history overflows');
  await host.setViewport({ width: 1280, height: 800 });

  step('the host opens a meeting and sees who attended');
  await host.click('[data-testid="meeting-row"] a');
  await waitForText(host, 'Participants');
  await waitForText(host, 'Memberc');
  const betaId = host.url().split('/').pop();

  step('a participant sees only their own part, and their search only what they attended');
  const member = await person(memberToken);
  await member.goto(`${WEB_URL}/history/${betaId}`, { waitUntil: 'networkidle2' });
  await waitForText(member, 'Your participation');
  assert.equal((await member.$$('[data-testid="meeting-participant"]')).length, 1);
  assert.ok(!(await member.evaluate(() => document.body.innerText.includes('Hostc (you)'))));
  await member.goto(`${WEB_URL}/history`, { waitUntil: 'networkidle2' });
  await member.waitForSelector('#history-search');
  await typeSearch(member, tag);
  await waitForOnlyRow(member, 'Beta');

  step('someone else cannot open it');
  const stranger = await person(strangerToken);
  await stranger.goto(`${WEB_URL}/history/${betaId}`, { waitUntil: 'networkidle2' });
  await waitForText(stranger, 'This meeting is unavailable');
  await waitGone(stranger, 'Memberc');

  step('nobody signed in sees a sign-in prompt');
  const anonymous = await (await browser.createBrowserContext()).newPage();
  await anonymous.goto(`${WEB_URL}/history`, { waitUntil: 'networkidle2' });
  await waitForText(anonymous, 'Authentication Required');

  console.log('E2E PASS history');
} catch (err) {
  console.log(`E2E FAIL history [${currentStep}] ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
  for (const line of await describePages(browser)) console.log(line);
  process.exitCode = 1;
} finally {
  await browser.close();
}
