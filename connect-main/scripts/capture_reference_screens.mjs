import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WORKSPACE_ROOT = 'E:\\Tathastu connect';
const REFERENCE_DIR = path.join(WORKSPACE_ROOT, 'reference');
const SCREENS_DIR = path.join(REFERENCE_DIR, 'screens');

if (!fs.existsSync(SCREENS_DIR)) {
  fs.mkdirSync(SCREENS_DIR, { recursive: true });
}

async function capture() {
  console.log('Launching browser to capture reference HTML files...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();

    // 1. Landing 1440x900
    await page.setViewport({ width: 1440, height: 900 });
    const landingUrl = 'file:///' + path.join(REFERENCE_DIR, 'landing.html').replace(/\\/g, '/');
    console.log(`Opening ${landingUrl} at 1440x900...`);
    await page.goto(landingUrl, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1000));
    const landingDeskPath = path.join(SCREENS_DIR, 'landing_1440x900.png');
    await page.screenshot({ path: landingDeskPath, fullPage: true });
    console.log(`Saved ${landingDeskPath}`);

    // 2. Landing 390x844
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    console.log(`Opening ${landingUrl} at 390x844...`);
    await page.goto(landingUrl, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1000));
    const landingMobPath = path.join(SCREENS_DIR, 'landing_390x844.png');
    await page.screenshot({ path: landingMobPath, fullPage: true });
    console.log(`Saved ${landingMobPath}`);

    // 3. Meeting Room 1440x900
    await page.setViewport({ width: 1440, height: 900 });
    const roomUrl = 'file:///' + path.join(REFERENCE_DIR, 'meeting-room.html').replace(/\\/g, '/');
    console.log(`Opening ${roomUrl} at 1440x900...`);
    await page.goto(roomUrl, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1000));
    const roomDeskPath = path.join(SCREENS_DIR, 'meeting_room_1440x900.png');
    await page.screenshot({ path: roomDeskPath, fullPage: true });
    console.log(`Saved ${roomDeskPath}`);

    // 4. Meeting Room 390x844
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    console.log(`Opening ${roomUrl} at 390x844...`);
    await page.goto(roomUrl, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1000));
    const roomMobPath = path.join(SCREENS_DIR, 'meeting_room_390x844.png');
    await page.screenshot({ path: roomMobPath, fullPage: true });
    console.log(`Saved ${roomMobPath}`);

    console.log('All reference screens successfully captured in /reference/screens/!');
  } finally {
    await browser.close();
  }
}

capture().catch((err) => {
  console.error('Error capturing reference screens:', err);
  process.exit(1);
});
