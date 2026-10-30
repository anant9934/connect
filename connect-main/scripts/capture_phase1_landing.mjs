import puppeteer from 'puppeteer-core';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\116094a7-63d4-4c53-9b27-af0ec12a66e7';

async function capture() {
  console.log('Capturing Phase 1 Landing Page screenshots...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();

    // 1. Desktop Viewport (1440x900)
    await page.setViewport({ width: 1440, height: 900 });
    console.log('Navigating to http://localhost:3000/ (Desktop 1440x900)...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1000));
    const deskPath = path.join(ARTIFACTS_DIR, 'phase1_landing_1440x900.png');
    await page.screenshot({ path: deskPath, fullPage: true });
    console.log(`Saved ${deskPath}`);

    // 2. Mobile Viewport (390x844)
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    console.log('Navigating to http://localhost:3000/ (Mobile 390x844)...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1000));
    const mobPath = path.join(ARTIFACTS_DIR, 'phase1_landing_390x844.png');
    await page.screenshot({ path: mobPath, fullPage: true });
    console.log(`Saved ${mobPath}`);

    console.log('Phase 1 screenshots captured successfully!');
  } finally {
    await browser.close();
  }
}

capture().catch((err) => {
  console.error('Capture error:', err);
  process.exit(1);
});
