// Uses attendance rules, the dashboard, corrections and the tab visibility signal in a real browser.
// Reconciliation itself is covered against the database by TestWorkflowDB_AttendanceSignals, so
// records here are seeded with what it produces. Requires CHROME_PATH, WEB_URL, API_URL and ADMIN_DATABASE_URL.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
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
  const res = await fetch(`${API_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL },
    body: JSON.stringify({ email: `${name.toLowerCase()}-${stamp}@example.test`, password: 'correct-horse-battery-9', displayName: name }),
  });
  assert.equal(res.status, 201);
  return { name, id: (await res.json()).user.id, token: res.headers.get('set-cookie').match(/tc_session=([^;]+)/)[1] };
}

async function call(method, path, person, body, expected) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL, Authorization: `Bearer ${person.token}` },
    body: JSON.stringify(body ?? {}),
  });
  assert.equal(res.status, expected, `${method} ${path}`);
  return res.json();
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function open(person, path, answers = []) {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: 'tc_session', value: person.token, domain: 'localhost', path: '/', httpOnly: true });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept(answers.shift()));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${WEB_URL}${path}`, { waitUntil: 'networkidle2' });
  return page;
}

const waitForText = (page, text, timeout = 15000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 200 }, text);
const setField = (page, selector, value) => page.$eval(selector, (el, v) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, value);
const clickButton = (page, label) => page.$$eval('button', (els, l) => els.find((e) => e.textContent.trim() === l).click(), label);

try {
  const [admin, teacher, student, absentee] = await Promise.all(['Admind', 'Teacherd', 'Studentd', 'Absentd'].map(signup));
  const org = sql(`INSERT INTO organizations (slug, name) VALUES ('att-${stamp}', 'Attendance College') RETURNING id`);
  for (const [person, role] of [[admin, 'institution_admin'], [teacher, 'faculty'], [student, 'student'], [absentee, 'student']]) {
    sql(`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ('${org}', '${person.id}', '${role}')`);
  }
  const base = `/api/v1/organizations/${org}`;
  const dept = (await call('POST', `${base}/departments`, admin, { code: 'P', name: 'Physics' }, 201)).department.id;
  const course = (await call('POST', `${base}/courses`, admin, { departmentId: dept, code: 'P1', title: 'Mechanics' }, 201)).course.id;
  const batch = (await call('POST', `${base}/batches`, admin, { courseId: course, name: 'Evening', academicTerm: '2026', startDate: '2020-01-01', endDate: '2035-01-01' }, 201)).batch.id;
  const allocation = (await call('POST', `${base}/allocations`, admin, { courseId: course, facultyUserId: teacher.id }, 201)).allocation.id;
  for (const person of [student, absentee]) {
    await call('POST', `${base}/enrollments`, admin, { batchId: batch, studentUserId: person.id }, 201);
  }
  const start = new Date(Date.now() + 3600000);
  const created = await call('POST', `${base}/sessions`, teacher, {
    courseId: course, batchId: batch, facultyAllocationId: allocation, title: 'Forces', timeZone: 'UTC',
    start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString(),
  }, 201);
  const session = created.sessions[0].id;
  const code = created.sessions[0].roomCode;

  step('an administrator sets rules, and bad weights are refused');
  const adminPage = await open(admin, '/institution');
  await waitForText(adminPage, 'Attendance College');
  await adminPage.$$eval('[role="tab"]', (tabs) => tabs.find((t) => t.textContent.trim() === 'Attendance').click());
  await adminPage.waitForSelector('#policy-early');
  await setField(adminPage, '#policy-present', '75');
  await setField(adminPage, '#policy-partial', '40');
  await setField(adminPage, '#policy-grace', '300');
  await setField(adminPage, '#policy-early', '300');
  await setField(adminPage, '#policy-duration-weight', '80');
  await setField(adminPage, '#policy-engagement-weight', '10');
  await setField(adminPage, '#policy-browser-weight', '20');
  await clickButton(adminPage, 'Add new version');
  await waitForText(adminPage, 'Weights cannot be negative and must add up to 100%');
  assert.equal(sql(`SELECT count(*) FROM attendance_policies WHERE organization_id = '${org}'`), '0');
  await setField(adminPage, '#policy-browser-weight', '10');
  await clickButton(adminPage, 'Add new version');
  await adminPage.waitForFunction(() => !document.body.innerText.includes('Weights cannot be negative'), { timeout: 15000, polling: 200 });
  const deadline = Date.now() + 10000;
  while (sql(`SELECT count(*) FROM attendance_policies WHERE organization_id = '${org}'`) !== '1' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(sql(`SELECT duration_weight || ',' || engagement_weight || ',' || browser_weight || ',' || early_leave_grace_seconds FROM attendance_policies WHERE organization_id = '${org}'`), '0.800,0.100,0.100,300');
  await adminPage.close();

  step('the class records tab visibility and tells the student');
  const teacherRoom = await open(teacher, `/room/${code}/preview`);
  await teacherRoom.waitForSelector('form button[type="submit"]');
  await Promise.all([
    teacherRoom.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000, polling: 200 }, code),
    teacherRoom.click('form button[type="submit"]'),
  ]);
  const studentRoom = await open(student, `/room/${code}/preview`);
  await studentRoom.waitForSelector('form button[type="submit"]');
  await Promise.all([
    studentRoom.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000, polling: 200 }, code),
    studentRoom.click('form button[type="submit"]'),
  ]);
  await studentRoom.waitForSelector('[data-testid="activity-notice"]', { timeout: 60000 });
  const seen = sql(`SELECT visible_seconds + hidden_seconds FROM browser_activity WHERE user_id = '${student.id}'`);
  assert.ok(Number(seen) > 0 && Number(seen) <= 60, `unexpected reported time ${seen}`);

  step('what the student does counts as engagement');
  await call('POST', `/api/v1/rooms/${code}/reactions`, student, { emoji: '👍' }, 201);
  await studentRoom.close();
  await teacherRoom.close();

  const calc = JSON.stringify({
    sessionSeconds: 3600, connectedSeconds: 3000, actions: 1, engagementTarget: 3, durationRatio: 0.833, engagementRatio: 0.333, browserRatio: null,
    durationWeight: 0.8, engagementWeight: 0.1, browserWeight: 0.1, score: 0.778, minPresent: 0.75, minPartial: 0.4,
    joinedLate: true, leftEarly: false, rules: ['browser_signal_unavailable', 'joined_late_marked_late'],
  });
  sql(`INSERT INTO attendance_records (organization_id, batch_id, class_session_id, student_user_id, total_connected_seconds, attendance_status, policy_version, joined_late, duration_ratio, engagement_ratio, score, calculation)
       VALUES ('${org}', '${batch}', '${session}', '${student.id}', 3000, 'late', 1, true, 0.833, 0.333, 0.778, '${calc}'),
              ('${org}', '${batch}', '${session}', '${absentee.id}', 0, 'absent', 1, false, 0, 0, 0, '{"sessionSeconds":3600,"connectedSeconds":0,"actions":0,"engagementTarget":3,"durationRatio":0,"engagementRatio":0,"browserRatio":null,"durationWeight":0.8,"engagementWeight":0.1,"browserWeight":0.1,"score":0,"minPresent":0.75,"minPartial":0.4,"rules":["never_connected"]}')`);

  step('the teacher sees separate metrics and who needs attention');
  const teacherPage = await open(teacher, '/attendance');
  await teacherPage.waitForSelector('[data-testid="student-row"]');
  assert.equal((await teacherPage.$$('[data-testid="student-row"]')).length, 2);
  const row = await teacherPage.$$eval('[data-testid="student-row"]', (els) => els.find((e) => e.innerText.includes('Studentd')).innerText);
  assert.ok(row.includes('83%') && row.includes('33%'), `row: ${row}`);
  await teacherPage.waitForFunction(() => document.querySelector('[data-testid="at-risk"]')?.innerText.includes('Absentd'), { timeout: 15000, polling: 200 });

  step('the teacher opens engagement for the class');
  await clickButton(teacherPage, 'Engagement');
  await teacherPage.waitForSelector('[data-testid="engagement-row"]');
  const engaged = await teacherPage.$$eval('[data-testid="engagement-row"]', (els) => els.find((e) => e.innerText.includes('Studentd')).innerText);
  assert.ok(/\b1\b/.test(engaged), `engagement: ${engaged}`);

  step('phone width has no horizontal page scroll');
  await teacherPage.setViewport({ width: 375, height: 800 });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok((await teacherPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'attendance overflows');
  await teacherPage.close();

  const room = sql(`SELECT id FROM rooms WHERE public_code = '${code}'`);

  step('the student sees how their result was reached');
  const studentPage = await open(student, `/history/${room}`);
  await studentPage.waitForSelector('[data-testid="attendance-explanation"]');
  await waitForText(studentPage, 'Time connected: 50 of 60 minutes (83%), weight 80%');
  await waitForText(studentPage, 'Score 78%');
  await waitForText(studentPage, 'you are marked late');

  step('the teacher corrects a record with a reason');
  const correctPage = await open(teacher, '/institution', ['present', 'Network outage on campus']);
  await waitForText(correctPage, 'Attendance College');
  await correctPage.$$eval('[role="tab"]', (tabs) => tabs.find((t) => t.textContent.trim() === 'Attendance').click());
  await correctPage.waitForSelector('#attendance-session');
  await setField(correctPage, '#attendance-session', session);
  await waitForText(correctPage, 'Studentd');
  await correctPage.$$eval('tr', (rows) => rows.find((r) => r.innerText.includes('Studentd')).querySelector('button').click());
  await waitForText(correctPage, 'corrected from late');
  assert.equal(sql(`SELECT count(*) FROM attendance_overrule_audit_log WHERE class_session_id = '${session}' AND student_user_id = '${student.id}'`), '1');
  await correctPage.close();

  step('the student sees the correction and why');
  await studentPage.reload({ waitUntil: 'networkidle2' });
  await waitForText(studentPage, 'corrected from late');
  await waitForText(studentPage, 'Network outage on campus');
  await studentPage.close();

  step('a student sees only their own attendance, with no engagement controls');
  const ownPage = await open(student, '/attendance');
  await ownPage.waitForSelector('[data-testid="student-row"]');
  assert.equal((await ownPage.$$('[data-testid="student-row"]')).length, 1);
  await waitForText(ownPage, 'Your attendance');
  assert.ok(!(await ownPage.evaluate(() => document.body.innerText.includes('Absentd'))), 'a classmate appeared');
  assert.equal(await ownPage.$('[data-testid="at-risk"]'), null);
  const denied = await ownPage.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).status, `${API_URL}${base}/sessions/${session}/engagement`);
  assert.equal(denied, 403);

  console.log('E2E PASS attendance');
} catch (err) {
  console.log(`E2E FAIL attendance [${currentStep}] ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
