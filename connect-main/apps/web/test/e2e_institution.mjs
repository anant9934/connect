// An administrator sets up a course in a real browser; an enrolled student and the teacher use it.
// Requires CHROME_PATH, WEB_URL, API_URL and ADMIN_DATABASE_URL for a disposable database.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080';
const PASSWORD = 'correct-horse-battery-9';
const stamp = Date.now();

const step = (name) => console.log(`STEP ${name}`);

async function signup(name) {
  const email = `${name.toLowerCase()}-${stamp}@example.test`;
  const res = await fetch(`${API_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL },
    body: JSON.stringify({ email, password: PASSWORD, displayName: name }),
  });
  assert.equal(res.status, 201, `signup ${name}: ${res.status}`);
  const token = (res.headers.get('set-cookie') || '').match(/tc_session=([^;]+)/)?.[1];
  const { user } = await res.json();
  return { name, email, token, id: user.id };
}

async function setField(page, selector, value) {
  await page.waitForSelector(selector);
  await page.$eval(
    selector,
    (el, v) => {
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value
  );
}

// Waits for a reload to bring in the option, then picks it by its visible text.
async function selectByText(page, selector, text) {
  await page.waitForFunction(
    (s, t) => [...document.querySelector(s).options].some((o) => o.textContent.includes(t)),
    { timeout: 15000 },
    selector,
    text
  );
  const value = await page.$eval(selector, (el, t) => [...el.options].find((o) => o.textContent.includes(t)).value, text);
  await setField(page, selector, value);
}

const waitForText = (page, text, timeout = 15000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);

const clickTab = (page, label) =>
  page.$$eval('[role="tab"]', (tabs, l) => tabs.find((t) => t.textContent.trim() === l).click(), label);

async function signIn(context, person) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${WEB_URL}/sign-in`, { waitUntil: 'networkidle2' });
  await setField(page, '#email', person.email);
  await setField(page, '#password', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('form button[type="submit"]')]);
  await page.goto(`${WEB_URL}/institution`, { waitUntil: 'networkidle2' });
  return page;
}

const localInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

try {
  step('platform administrator creates the institution');
  const [superAdmin, admin, teacher, student, outsider] = await Promise.all(['Platform', 'Admin', 'Teacher', 'Student', 'Outsider'].map(signup));
  execFileSync('psql', [process.env.ADMIN_DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-c', `INSERT INTO platform_administrators (user_id, role) VALUES ('${superAdmin.id}', 'platform_super_admin')`]);
  const created = await fetch(`${API_URL}/api/v1/organizations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: WEB_URL, Authorization: `Bearer ${superAdmin.token}` },
    body: JSON.stringify({ slug: `college-${stamp}`, name: 'Browser College', adminEmail: admin.email }),
  });
  assert.equal(created.status, 201);

  const adminContext = await browser.createBrowserContext();
  const page = await signIn(adminContext, admin);
  await waitForText(page, 'Browser College');

  step('administrator adds people');
  await clickTab(page, 'People');
  for (const [person, role] of [[teacher, 'faculty'], [student, 'student']]) {
    await setField(page, '#member-email', person.email);
    await setField(page, '#member-role', role);
    await page.click('#add-member button[type="submit"]');
    await waitForText(page, person.email);
  }

  step('administrator builds the course');
  await clickTab(page, 'Courses');
  await setField(page, '#dept-code', 'CS');
  await setField(page, '#dept-name', 'Computing');
  await page.click('#add-department button[type="submit"]');
  await waitForText(page, 'CS · Computing');
  await selectByText(page, '#course-department', 'Computing');
  await setField(page, '#course-code', 'CS101');
  await setField(page, '#course-title', 'Programming');
  await page.click('#add-course button[type="submit"]');
  await waitForText(page, 'CS101 · Programming');
  await selectByText(page, '#batch-course', 'Programming');
  await setField(page, '#batch-name', 'Morning');
  await setField(page, '#batch-term', '2026');
  await setField(page, '#batch-from', '2020-01-01');
  await setField(page, '#batch-to', '2035-12-31');
  await page.click('#add-batch button[type="submit"]');
  await waitForText(page, 'Programming · Morning');
  await selectByText(page, '#alloc-course', 'Programming');
  await selectByText(page, '#alloc-faculty', 'Teacher');
  await page.click('#assign-faculty button[type="submit"]');
  await waitForText(page, 'Teacher teaches Programming');
  await selectByText(page, '#enroll-batch', 'Morning');
  await selectByText(page, '#enroll-student-select', 'Student');
  await page.click('#enroll-student button[type="submit"]');
  await waitForText(page, '1 students enrolled');

  step('administrator schedules a repeating class');
  await clickTab(page, 'Classes');
  const start = new Date(Date.now() + 7 * 86400000);
  await setField(page, '#class-title', 'Weekly Lecture');
  await selectByText(page, '#class-batch', 'Morning');
  await setField(page, '#class-start', localInput(start));
  await setField(page, '#class-end', localInput(new Date(start.getTime() + 3600000)));
  await page.click(`#schedule-class input[name="day${start.getDay()}"]`);
  await setField(page, '#class-until', new Date(start.getTime() + 14 * 86400000).toISOString().slice(0, 10));
  await page.click('#schedule-class button[type="submit"]');
  await waitForText(page, 'Weekly Lecture');
  const classes = await page.$$eval('a[href^="/room/"]', (links) => links.map((a) => a.getAttribute('href')));
  assert.ok(classes.length >= 2, `expected a repeating series, got ${classes.length}`);

  step('phone width has no horizontal scroll');
  await page.setViewport({ width: 375, height: 800 });
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'page overflows');
  await page.setViewport({ width: 1280, height: 800 });

  step('student sees their classes but no management');
  const studentContext = await browser.createBrowserContext();
  const studentPage = await signIn(studentContext, student);
  await waitForText(studentPage, 'Weekly Lecture');
  const tabs = await studentPage.$$eval('[role="tab"]', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(tabs, ['Classes', 'Attendance']);
  assert.equal(await studentPage.$('#schedule-class'), null, 'student can see the scheduling form');

  step('someone outside the institution sees no institution');
  const outsiderContext = await browser.createBrowserContext();
  const outsiderPage = await signIn(outsiderContext, outsider);
  await waitForText(outsiderPage, 'No institutions yet');

  step('teacher starts the class and the student enters');
  const teacherContext = await browser.createBrowserContext();
  const teacherPage = await signIn(teacherContext, teacher);
  await waitForText(teacherPage, 'Weekly Lecture');
  const code = classes[0].split('/')[2];
  await teacherPage.goto(`${WEB_URL}${classes[0]}`, { waitUntil: 'networkidle2' });
  await teacherPage.waitForSelector('form button[type="submit"]');
  await Promise.all([
    teacherPage.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000 }, code),
    teacherPage.click('form button[type="submit"]'),
  ]);

  await studentPage.goto(`${WEB_URL}${classes[0]}`, { waitUntil: 'networkidle2' });
  await studentPage.waitForSelector('form button[type="submit"]');
  await Promise.all([
    studentPage.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000 }, code),
    studentPage.click('form button[type="submit"]'),
  ]);

  step('outsider is refused the class');
  await outsiderPage.goto(`${WEB_URL}${classes[0]}`, { waitUntil: 'networkidle2' });
  await outsiderPage.waitForSelector('form button[type="submit"]');
  await outsiderPage.click('form button[type="submit"]');
  await waitForText(outsiderPage, 'not permitted');

  console.log('E2E PASS institution');
} catch (err) {
  console.log(`E2E FAIL ${err.message}`);
  for (const [i, p] of (await browser.pages()).entries()) {
    console.log(`page ${i}: ${p.url()}`);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
