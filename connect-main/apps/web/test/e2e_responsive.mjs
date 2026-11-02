// Visits every important route at phone, tablet and desktop widths, signed in and out, in a real
// browser. Requires CHROME_PATH, WEB_URL and API_URL pointing at disposable local services.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8080';
const WIDTHS = [320, 375, 768, 1280];
const PUBLIC_ROUTES = ['/', '/sign-in', '/sign-up', '/features', '/rooms', '/rooms/research', '/rooms/projects', '/rooms/mentorship', '/security',
  '/use-cases/students', '/use-cases/researchers', '/use-cases/teams', '/compare/zoom-alternative', '/compare/google-meet-alternative'];
const PRIVATE_ROUTES = ['/', '/schedule', '/history', '/institution', '/notifications', '/attendance', '/admin', '/profile', '/diagnostics'];
const MIN_TARGET = 24;

const res = await fetch(`${API_URL}/api/v1/auth/signup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: WEB_URL },
  body: JSON.stringify({ email: `layout-${Date.now()}@example.test`, password: 'correct-horse-battery-9', displayName: 'Layout Person' }),
});
assert.equal(res.status, 201);
const token = res.headers.get('set-cookie').match(/tc_session=([^;]+)/)[1];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

const problems = [];

// Reports what a person would run into: sideways scrolling, nothing shown, or controls too small to tap.
const inspect = (page) => page.evaluate((minTarget) => {
  const found = [];
  const overflow = document.documentElement.scrollWidth - window.innerWidth;
  if (overflow > 0) {
    const culprit = [...document.querySelectorAll('body *')].find((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== 'fixed');
    found.push(`overflows by ${overflow}px at ${culprit ? `${culprit.tagName.toLowerCase()}.${String(culprit.className).slice(0, 40)}` : 'unknown'}`);
  }
  if (document.body.innerText.trim().length < 10) found.push('shows nothing');
  const small = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select')].filter((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    // Screen-reader-only controls such as the skip link are clipped to a pixel until focused.
    if (rect.width <= 1 || rect.height <= 1 || style.visibility === 'hidden') return false;
    // Links inside running text are exempt, as WCAG 2.5.8 allows.
    if (el.tagName === 'A' && style.display === 'inline') return false;
    return Math.min(rect.width, rect.height) < minTarget && el.type !== 'checkbox' && el.type !== 'radio';
  });
  for (const el of small) found.push(`small target: ${(el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30)}`);
  return found;
}, MIN_TARGET);

async function sweep(context, routes, label) {
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', (err) => failures.push(err.message.slice(0, 100)));
  for (const route of routes) {
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: 800 });
      failures.length = 0;
      const response = await page.goto(`${WEB_URL}${route}`, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 150));
      if (!response || response.status() >= 400) problems.push(`${label} ${route} @${width}: status ${response?.status()}`);
      for (const found of await inspect(page)) problems.push(`${label} ${route} @${width}: ${found}`);
      for (const message of failures) problems.push(`${label} ${route} @${width}: script error ${message}`);
    }
  }
  await page.close();
}

try {
  await sweep(await browser.createBrowserContext(), PUBLIC_ROUTES, 'public');
  const signedIn = await browser.createBrowserContext();
  await signedIn.setCookie({ name: 'tc_session', value: token, domain: 'localhost', path: '/', httpOnly: true });
  await sweep(signedIn, PRIVATE_ROUTES, 'signed-in');

  const home = await signedIn.newPage();
  await home.setViewport({ width: 375, height: 800 });
  await home.goto(`${WEB_URL}/`, { waitUntil: 'networkidle2' });
  await home.waitForSelector('#nav-app-menu', { timeout: 15000 });
  await home.click('#nav-app-menu');
  await home.waitForFunction(() => document.body.innerText.includes('Sign out'), { timeout: 5000, polling: 200 });
  for (const found of await inspect(home)) problems.push(`menu @375: ${found}`);

  if (problems.length > 0) {
    // Layout breakage first, then each distinct small control once, so the report fits.
    const serious = problems.filter((p) => !p.includes('small target'));
    const small = [...new Set(problems.filter((p) => p.includes('small target')).map((p) => `${p.split(' ')[1]} ${p.split(': ').slice(1).join(': ')}`))];
    console.log(`E2E FAIL responsive ${serious.length} serious: ${serious.slice(0, 15).join(' | ')} || ${small.length} small: ${small.slice(0, 30).join(' | ')}`);
    process.exitCode = 1;
  } else {
    console.log('E2E PASS responsive');
  }
} catch (err) {
  console.log(`E2E FAIL responsive ${err.message.replace(/\s+/g, ' ').slice(0, 300)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
