// Uses the administration dashboard in a real browser as each role.
// Requires CHROME_PATH, WEB_URL, API_URL and ADMIN_DATABASE_URL for a disposable database.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { describePages } from './e2e_report.mjs';
import { execFileSync } from 'node:child_process';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080';
const stamp = Date.now();

let currentStep = 'setup';
const step = (name) => {
  currentStep = name;
  console.log(`STEP ${name}`);
};
const sql = (query) => execFileSync('psql', [process.env.ADMIN_DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-At', '-c', query]).toString().trim().split('\n')[0];

async function signup(name) {
  const email = `${name.toLowerCase()}-${stamp}@example.test`;
  const res = await fetch(`${API_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL },
    body: JSON.stringify({ email, password: 'correct-horse-battery-9', displayName: name }),
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  return { name, email, id: data.user.id, token: res.headers.get('set-cookie').match(/tc_session=([^;]+)/)[1] };
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox'] });

async function open(person) {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: 'tc_session', value: person.token, domain: 'localhost', path: '/', httpOnly: true });
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${WEB_URL}/admin`, { waitUntil: 'networkidle2' });
  return page;
}

const waitForText = (page, text, timeout = 15000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 200 }, text);
const stat = (page, id) => page.$eval(`[data-testid="stat-${id}"]`, (el) => el.innerText);
const waitForStat = (page, id, value) =>
  page.waitForFunction((i, v) => document.querySelector(`[data-testid="stat-${i}"]`)?.innerText === v, { timeout: 15000, polling: 200 }, id, value);

try {
  const [admin, auditor, teacher, student, stranger] = await Promise.all(['Adminc', 'Auditorc', 'Teacherc', 'Studentc', 'Strangerc'].map(signup));
  const org = sql(`INSERT INTO organizations (slug, name) VALUES ('dash-${stamp}', 'Dashboard College') RETURNING id`);
  for (const [person, role] of [[admin, 'institution_admin'], [auditor, 'institution_auditor'], [teacher, 'faculty'], [student, 'student']]) {
    sql(`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ('${org}', '${person.id}', '${role}')`);
  }

  step('an administrator sees real counts');
  const page = await open(admin);
  await waitForText(page, 'Dashboard College');
  await page.waitForSelector('[data-testid="stat-active"]');
  assert.equal(await stat(page, 'active'), '4');
  assert.equal(await stat(page, 'students'), '1');
  assert.equal(await stat(page, 'faculty'), '1');
  assert.equal(await stat(page, 'suspended'), '0');
  assert.equal((await page.$$('[data-testid="admin-member"]')).length, 4);

  step('finding a person by name');
  await page.type('#member-filter', 'teacherc');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="admin-member"]').length === 1, { timeout: 5000, polling: 200 });

  step('suspending a person changes the counts and is audited');
  await page.select(`select[aria-label="Status of Teacherc"]`, 'suspended');
  await waitForText(page, 'Teacherc is now Faculty, suspended');
  await waitForStat(page, 'suspended', '1');
  await waitForStat(page, 'faculty', '0');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="audit-event"]')].some((e) => e.innerText.includes('institution.member_updated') && e.innerText.includes('by Adminc') && e.innerText.includes('Teacherc')), { timeout: 15000, polling: 200 });
  assert.equal(sql(`SELECT status FROM organization_memberships WHERE organization_id = '${org}' AND user_id = '${teacher.id}'`), 'suspended');

  step('the change survives a reload');
  await page.reload({ waitUntil: 'networkidle2' });
  await waitForStat(page, 'suspended', '1');

  step('phone width has no horizontal scroll');
  await page.setViewport({ width: 375, height: 800 });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'admin overflows');

  step('an auditor can read but has no controls');
  const auditorPage = await open(auditor);
  await page.close();
  await waitForText(auditorPage, 'Dashboard College');
  await auditorPage.waitForSelector('[data-testid="stat-active"]');
  assert.equal((await auditorPage.$$('select[aria-label^="Status of"]')).length, 0);
  assert.ok(await auditorPage.$('[data-testid="audit-event"]'), 'auditor sees the audit log');

  for (const [who, person] of [['a student', student], ['someone outside', stranger]]) {
    step(`${who} has no access`);
    const other = await open(person);
    await waitForText(other, 'You do not administer an organization');
    assert.equal(await other.$('[data-testid="stat-active"]'), null);
    const denied = await other.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).status, `${API_URL}/api/v1/organizations/${org}/admin/overview`);
    assert.equal(denied, 403);
    await other.close();
  }

  step('nobody signed in sees a sign-in prompt');
  const anonymous = await (await browser.createBrowserContext()).newPage();
  await anonymous.goto(`${WEB_URL}/admin`, { waitUntil: 'networkidle2' });
  await waitForText(anonymous, 'Authentication Required');

  console.log('E2E PASS admin');
} catch (err) {
  console.log(`E2E FAIL admin [${currentStep}] ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
  for (const line of await describePages(browser)) console.log(line);
  process.exitCode = 1;
} finally {
  await browser.close();
}
