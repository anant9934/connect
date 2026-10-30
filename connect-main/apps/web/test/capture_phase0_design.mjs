import puppeteer from 'puppeteer-core';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\116094a7-63d4-4c53-9b27-af0ec12a66e7';

async function captureDesign() {
  console.log('Launching browser for Phase 0 Design System capture...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    // 1. Desktop Viewport (1440x900)
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    console.log('Navigating to http://localhost:3000/design (Desktop)...');
    await page.goto('http://localhost:3000/design', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1000));
    const desktopPath = path.join(ARTIFACTS_DIR, 'phase0_design_desktop.png');
    await page.screenshot({ path: desktopPath, fullPage: true });
    console.log(`Saved desktop screenshot: ${desktopPath}`);

    // 2. Mobile Viewport (390x844)
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    console.log('Navigating to http://localhost:3000/design (Mobile 390x844)...');
    await page.goto('http://localhost:3000/design', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1000));
    const mobilePath = path.join(ARTIFACTS_DIR, 'phase0_design_mobile.png');
    await page.screenshot({ path: mobilePath, fullPage: true });
    console.log(`Saved mobile screenshot: ${mobilePath}`);

    console.log('Phase 0 screenshot capture complete!');
  } finally {
    await browser.close();
  }
}

captureDesign().catch((err) => {
  console.error('Error capturing design screenshots:', err);
  process.exit(1);
});
