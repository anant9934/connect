import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\843a47ab-b7af-4ad3-811f-cf4e58539b8d';

async function runApplicationWideMobileAudit() {
  console.log('=== STARTING APPLICATION-WIDE MOBILE AUDIT (REALME 11 PRO 5G) ===');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--headless=new', '--no-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  });

  const auditResults = {};

  // 1. Sign In Page
  console.log('Testing /sign-in on mobile...');
  await page.goto('http://localhost:3000/sign-in', { waitUntil: 'networkidle0' });
  const signInData = await page.evaluate(() => {
    const emailInput = document.querySelector('input[type="email"]');
    const pwdInput = document.querySelector('input[type="password"], input[name="password"]');
    const submitBtn = document.querySelector('button[type="submit"]');
    const emailFontSize = emailInput ? window.getComputedStyle(emailInput).fontSize : null;
    const pwdFontSize = pwdInput ? window.getComputedStyle(pwdInput).fontSize : null;
    const submitHeight = submitBtn ? submitBtn.getBoundingClientRect().height : 0;
    const hasHorizontalOverflow = document.documentElement.scrollWidth > window.innerWidth;

    return {
      emailFontSize,
      pwdFontSize,
      submitHeight,
      hasHorizontalOverflow,
      inputZoomSafe: parseFloat(emailFontSize || '0') >= 16 && parseFloat(pwdFontSize || '0') >= 16,
    };
  });
  console.log('Sign In Data:', signInData);
  auditResults.signIn = signInData;
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'audit_realme_signin.png') });

  // 2. Sign Up Page
  console.log('Testing /sign-up on mobile...');
  await page.goto('http://localhost:3000/sign-up', { waitUntil: 'networkidle0' });
  const signUpData = await page.evaluate(() => {
    const nameInput = document.querySelector('input#displayName');
    const emailInput = document.querySelector('input[type="email"]');
    const submitBtn = document.querySelector('button[type="submit"]');
    const nameFontSize = nameInput ? window.getComputedStyle(nameInput).fontSize : null;
    const emailFontSize = emailInput ? window.getComputedStyle(emailInput).fontSize : null;
    const submitHeight = submitBtn ? submitBtn.getBoundingClientRect().height : 0;
    const hasHorizontalOverflow = document.documentElement.scrollWidth > window.innerWidth;

    return {
      nameFontSize,
      emailFontSize,
      submitHeight,
      hasHorizontalOverflow,
      inputZoomSafe: parseFloat(nameFontSize || '0') >= 16 && parseFloat(emailFontSize || '0') >= 16,
    };
  });
  console.log('Sign Up Data:', signUpData);
  auditResults.signUp = signUpData;
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'audit_realme_signup.png') });

  // 3. Meeting History Page (Unauthenticated & Layout)
  console.log('Testing /history on mobile...');
  await page.goto('http://localhost:3000/history', { waitUntil: 'networkidle0' });
  const historyData = await page.evaluate(() => {
    const hasHorizontalOverflow = document.documentElement.scrollWidth > window.innerWidth;
    const authBtn = document.querySelector('a[href*="/sign-in"]');
    return {
      hasHorizontalOverflow,
      authBtnVisible: !!authBtn,
    };
  });
  console.log('History Data:', historyData);
  auditResults.history = historyData;
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'audit_realme_history.png') });

  // 4. Pre-join Preview Screen (Empty/Guest or Unavailable handling)
  console.log('Testing /room/DEMO-ROOM/preview on mobile...');
  await page.goto('http://localhost:3000/room/DEMO-ROOM/preview', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));
  const previewData = await page.evaluate(() => {
    const hasHorizontalOverflow = document.documentElement.scrollWidth > window.innerWidth;
    return {
      hasHorizontalOverflow,
      bodyTextSnippet: document.body.innerText.slice(0, 150),
    };
  });
  console.log('Preview Screen Data:', previewData);
  auditResults.preview = previewData;
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'audit_realme_preview_screen.png') });

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'application_wide_mobile_audit.json'),
    JSON.stringify(auditResults, null, 2)
  );

  await browser.close();
  console.log('Application-wide mobile audit completed.');
}

runApplicationWideMobileAudit().catch(console.error);
