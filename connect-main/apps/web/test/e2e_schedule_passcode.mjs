// Drives a real browser against the built web app and real API on a disposable database.
// Requires CHROME_PATH, and WEB_URL pointing at a non-production deployment.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const PASSCODE = 'open-sesame';

const step = (name) => console.log(`STEP ${name}`);

async function setField(page, selector, value) {
  await page.waitForSelector(selector);
  await page.$eval(
    selector,
    (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value
  );
}

const localInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

async function waitForText(page, text, timeout = 15000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
}

async function fillSchedule(page, title, start) {
  await setField(page, '#title', title);
  await setField(page, '#start', localInput(start));
  await setField(page, '#end', localInput(new Date(start.getTime() + 3600000)));
  await setField(page, '#passcode', PASSCODE);
  await page.click('form button[type="submit"]');
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

try {
  const host = await browser.newPage();
  host.on('dialog', (d) => d.accept());

  step('host signs up');
  await host.goto(`${WEB_URL}/sign-up`, { waitUntil: 'networkidle2' });
  await setField(host, '#displayName', 'Browser Host');
  await setField(host, '#email', `host-${Date.now()}@example.test`);
  await setField(host, '#password', 'correct-horse-battery-9');
  for (const box of await host.$$('form input[type="checkbox"]')) {
    await box.click();
  }
  await Promise.all([host.waitForNavigation({ waitUntil: 'networkidle2' }), host.click('form button[type="submit"]')]);

  step('host schedules a meeting');
  await host.goto(`${WEB_URL}/schedule`, { waitUntil: 'networkidle2' });
  await host.waitForSelector('#title');
  const start = new Date(Date.now() + 48 * 3600000);
  await fillSchedule(host, 'Browser Algebra', start);
  await waitForText(host, 'Browser Algebra');
  assert.ok(await host.$('[aria-label="Passcode protected"]'), 'passcode icon missing');

  step('overlap shows an error, not a second meeting');
  await fillSchedule(host, 'Overlap', new Date(start.getTime() + 600000));
  await host.waitForSelector('[role="alert"]');
  await waitForText(host, 'already have a meeting');

  step('phone width has no horizontal scroll');
  await host.setViewport({ width: 375, height: 800 });
  const overflow = await host.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page overflows by ${overflow}px`);
  await host.setViewport({ width: 1280, height: 800 });

  const href = await host.$eval('a[href^="/room/"]', (a) => a.getAttribute('href'));
  const code = href.split('/')[2];

  const guestContext = await browser.createBrowserContext();
  const guest = await guestContext.newPage();
  const guestJoin = async (passcode) => {
    await setField(guest, '#guestName', 'Browser Guest');
    await setField(guest, '#meetingPasscode', passcode);
    await guest.click('form button[type="submit"]');
  };

  step('guest cannot enter before the host starts');
  await guest.goto(`${WEB_URL}/room/${code}/preview`, { waitUntil: 'networkidle2' });
  await guest.waitForSelector('#meetingPasscode');
  await guestJoin(PASSCODE);
  await waitForText(guest, 'has not started');

  step('host starts by joining');
  await host.goto(`${WEB_URL}${href}`, { waitUntil: 'networkidle2' });
  await host.waitForSelector('form button[type="submit"]');
  await Promise.all([
    host.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000 }, code),
    host.click('form button[type="submit"]'),
  ]);

  step('guest needs the right passcode');
  await guest.goto(`${WEB_URL}/room/${code}/preview`, { waitUntil: 'networkidle2' });
  await guest.waitForSelector('#meetingPasscode');
  await guestJoin('wrong-code');
  await guest.waitForSelector('[role="alert"]');
  await waitForText(guest, 'incorrect');
  assert.ok(guest.url().endsWith('/preview'), 'wrong passcode left the preview page');
  await guestJoin(PASSCODE);
  await guest.waitForFunction((c) => location.pathname === `/room/${c}`, { timeout: 20000 }, code);

  step('host cancels another meeting');
  await host.goto(`${WEB_URL}/schedule`, { waitUntil: 'networkidle2' });
  await fillSchedule(host, 'To Cancel', new Date(start.getTime() + 24 * 3600000));
  await waitForText(host, 'To Cancel');
  const cancelled = await host.$$eval('button', (els) => {
    const b = els.find((e) => e.textContent.includes('Cancel meeting'));
    b.click();
    return !!b;
  });
  assert.ok(cancelled);
  await host.waitForFunction(() => !document.body.innerText.includes('To Cancel'), { timeout: 15000 });

  console.log('E2E PASS schedule and passcode');
} catch (err) {
  console.log(`E2E FAIL ${err.message}`);
  for (const [i, page] of (await browser.pages()).entries()) {
    await page.screenshot({ path: `/tmp/e2e_failure_${i}.png` }).catch(() => {});
    console.log(`page ${i}: ${page.url()}`);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
