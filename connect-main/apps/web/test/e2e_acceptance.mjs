// One class from setup to reports, with attendance produced by the real worker when the class ends.
// Requires CHROME_PATH, WEB_URL, API_URL and ADMIN_DATABASE_URL for a disposable database.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describePages } from './e2e_report.mjs';

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
  const res = await fetch(`${API_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL },
    body: JSON.stringify({ email: `${name.toLowerCase()}-${stamp}@example.test`, password: 'correct-horse-battery-9', displayName: name }),
  });
  assert.equal(res.status, 201);
  return { name, id: (await res.json()).user.id, token: res.headers.get('set-cookie').match(/tc_session=([^;]+)/)[1] };
}

async function call(path, person, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL, Authorization: `Bearer ${person.token}` },
    body: JSON.stringify(body),
  });
  assert.ok(res.ok, `${path}: ${res.status}`);
  return res.json();
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function open(person, path) {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: 'tc_session', value: person.token, domain: 'localhost', path: '/', httpOnly: true });
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${WEB_URL}${path}`, { waitUntil: 'networkidle2' });
  return page;
}

const waitForText = (page, text, timeout = 20000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 200 }, text);
const click = (page, label) => page.waitForSelector(`button[aria-label="${label}"]`, { timeout: 20000 }).then((b) => b.click());
const clickText = (page, text) => page.waitForFunction((t) => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
  if (!button) return false;
  button.click();
  return true;
}, { timeout: 20000, polling: 200 }, text);
const setField = (page, selector, value) => page.$eval(selector, (el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const enter = async (person, code) => {
  const page = await open(person, `/room/${code}/preview`);
  await page.waitForSelector('form button[type="submit"]');
  await Promise.all([
    page.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000, polling: 200 }, code),
    page.click('form button[type="submit"]'),
  ]);
  return page;
};

try {
  const [admin, teacher, student, absentee] = await Promise.all(['Adminz', 'Teacherz', 'Studentz', 'Absentz'].map(signup));

  step('an institution is set up with a course, faculty and students');
  const org = sql(`INSERT INTO organizations (slug, name) VALUES ('accept-${stamp}', 'Acceptance College') RETURNING id`);
  for (const [person, role] of [[admin, 'institution_admin'], [teacher, 'faculty'], [student, 'student'], [absentee, 'student']]) {
    sql(`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ('${org}', '${person.id}', '${role}')`);
  }
  const base = `/api/v1/organizations/${org}`;
  const dept = (await call(`${base}/departments`, admin, { code: 'M', name: 'Maths' })).department.id;
  const course = (await call(`${base}/courses`, admin, { departmentId: dept, code: 'M1', title: 'Algebra' })).course.id;
  const batch = (await call(`${base}/batches`, admin, { courseId: course, name: 'Morning', academicTerm: '2026', startDate: '2020-01-01', endDate: '2035-01-01' })).batch.id;
  const allocation = (await call(`${base}/allocations`, admin, { courseId: course, facultyUserId: teacher.id })).allocation.id;
  for (const person of [student, absentee]) await call(`${base}/enrollments`, admin, { batchId: batch, studentUserId: person.id });

  step('faculty schedules a class and the student is notified');
  const title = `Algebra ${stamp}`;
  const start = new Date(Date.now() + 3600000);
  const created = await call(`${base}/sessions`, teacher, {
    courseId: course, batchId: batch, facultyAllocationId: allocation, title, timeZone: 'UTC',
    start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString(),
  });
  const { id: session, roomCode: code } = created.sessions[0];
  const inbox = await open(student, '/notifications');
  await inbox.waitForFunction(async () => {
    if (document.body.innerText.includes('New class scheduled')) return true;
    location.reload();
    return false;
  }, { timeout: 60000, polling: 3000 }).catch(() => waitForText(inbox, 'New class scheduled', 15000));
  await inbox.close();

  step('faculty starts the class and the student joins');
  const host = await enter(teacher, code);
  const member = await enter(student, code);
  await member.waitForSelector('button[aria-label="Toggle chat"]', { timeout: 20000 });

  step('chat reaches everyone');
  await click(member, 'Toggle chat');
  await click(host, 'Toggle chat');
  await member.waitForSelector('#chat-input');
  await setField(member, '#chat-input', 'Good morning');
  await click(member, 'Send message');
  await waitForText(host, 'Good morning');

  step('faculty runs a quiz and it is scored');
  await click(host, 'Toggle questions and doubts');
  await click(member, 'Toggle questions and doubts');
  await host.waitForSelector('#new-poll');
  await host.select('#poll-kind', 'quiz');
  await setField(host, '#poll-question', 'What is 2 + 2?');
  const options = await host.$$('[data-testid="poll-option"]');
  for (const [index, label] of ['Four', 'Five'].entries()) {
    await options[index].click();
    await options[index].type(label);
  }
  await host.waitForSelector('[data-testid="poll-correct"]');
  await (await host.$$('[data-testid="poll-correct"]'))[0].click();
  await host.click('#new-poll button[type="submit"]');
  await waitForText(member, 'What is 2 + 2?');
  await member.$$eval('[data-testid="poll-card"] label', (labels) => labels.find((l) => l.textContent.includes('Four')).querySelector('input').click());
  await clickText(member, 'Submit answer');
  await waitForText(member, 'Your answer is saved.');
  await clickText(host, 'Close question');
  await waitForText(member, 'Your score: 10 of 10');

  step('a student asks a doubt and faculty resolves it');
  await setField(member, '#doubt-input', 'What is a variable?');
  await member.click('#ask-doubt button[type="submit"]');
  await waitForText(host, 'What is a variable?');
  await host.waitForSelector('[data-testid="doubt-answer"]');
  await (await host.$('[data-testid="doubt-answer"]')).type('A named value.');
  await clickText(host, 'Answer');
  await waitForText(member, 'A named value.');

  step('faculty ends the class and the worker records attendance');
  await new Promise((r) => setTimeout(r, 3000));
  await clickText(host, 'End for all');
  await clickText(host, 'End for everyone');
  await waitForText(member, 'This meeting has ended', 30000);
  const deadline = Date.now() + 90000;
  while (sql(`SELECT count(*) FROM attendance_records WHERE class_session_id = '${session}'`) !== '2' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.equal(sql(`SELECT count(*) FROM attendance_records WHERE class_session_id = '${session}'`), '2', 'attendance was not recorded for both students');
  assert.ok(Number(sql(`SELECT total_connected_seconds FROM attendance_records WHERE class_session_id = '${session}' AND student_user_id = '${student.id}'`)) > 0, 'the student has no connected time');
  assert.equal(sql(`SELECT attendance_status FROM attendance_records WHERE class_session_id = '${session}' AND student_user_id = '${absentee.id}'`), 'absent');

  step('faculty sees the attendance report');
  const report = await open(teacher, '/attendance');
  await report.waitForSelector('[data-testid="student-row"]', { timeout: 20000 });
  assert.equal((await report.$$('[data-testid="student-row"]')).length, 2);
  await waitForText(report, 'Absentz');
  await report.close();

  step('the class is in the student history with their own attendance');
  const history = await open(student, '/history');
  await history.waitForSelector('#history-search');
  await history.type('#history-search', title);
  await history.waitForFunction((t) => [...document.querySelectorAll('[data-testid="meeting-row"]')].some((r) => r.innerText.includes(t)), { timeout: 20000, polling: 200 }, title);
  await history.click('[data-testid="meeting-row"] a');
  await history.waitForSelector('[data-testid="attendance-explanation"]', { timeout: 20000 });
  await history.close();

  step('the administrator sees the institution on the dashboard');
  const dashboard = await open(admin, '/admin');
  await dashboard.waitForSelector('[data-testid="stat-students"]', { timeout: 20000 });
  assert.equal(await dashboard.$eval('[data-testid="stat-students"]', (el) => el.innerText), '2');
  assert.equal(await dashboard.$eval('[data-testid="stat-enrollments"]', (el) => el.innerText), '2');
  assert.equal(await dashboard.$eval('[data-testid="stat-courses"]', (el) => el.innerText), '1');

  console.log('E2E PASS acceptance');
} catch (err) {
  console.log(`E2E FAIL acceptance [${currentStep}] ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
  for (const line of await describePages(browser)) console.log(line);
  process.exitCode = 1;
} finally {
  await browser.close();
}
