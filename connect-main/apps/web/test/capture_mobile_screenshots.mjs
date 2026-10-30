import puppeteer from 'puppeteer-core';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\116094a7-63d4-4c53-9b27-af0ec12a66e7';

async function captureMobile() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--headless=new',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--no-sandbox',
    ],
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
  });

  const page = await browser.newPage();

  // 1. Mobile Meeting History (Unauthenticated)
  await page.goto('http://localhost:3000/history', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase3_mobile_history_unauth.png') });

  // 2. Authenticate
  await page.evaluate(async () => {
    await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice3@example.com', password: 'ValidPass123!' }),
      credentials: 'include',
    });
  });

  // 3. Mobile Meeting History (Authenticated)
  await page.goto('http://localhost:3000/history', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase3_mobile_history_auth.png') });

  // 4. Create Room & View Meeting Stage on Mobile
  const createRoomRes = await page.evaluate(async () => {
    const res = await fetch('/api/v1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxParticipants: 10, waitingRoomEnabled: true }),
      credentials: 'include',
    });
    return res.json();
  });

  const code = createRoomRes.room.publicCode;
  await page.goto(`http://localhost:3000/room/${code}/preview`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase3_mobile_prejoin.png') });

  // Join
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const joinBtn = btns.find((b) => b.textContent.includes('Join meeting'));
    if (joinBtn) joinBtn.click();
  });

  await new Promise((r) => setTimeout(r, 4000));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase3_mobile_meeting_stage.png') });

  // Open Chat on Mobile
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const chatBtn = btns.find((b) => b.getAttribute('title') === 'Chat messages' || b.getAttribute('aria-label') === 'Toggle chat');
    if (chatBtn) chatBtn.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase3_mobile_chat_panel.png') });

  await browser.close();
  console.log('Mobile screenshots captured successfully!');
}

captureMobile().catch(console.error);
