import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findChromeExecutable() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const platform = process.platform;
  const candidates = [];
  if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    );
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error('Chrome/Chromium executable not found. Set CHROME_PATH environment variable.');
}

const ARTIFACTS_DIR = process.env.TEST_ARTIFACTS_DIR || path.resolve(__dirname, 'artifacts');
if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}
const CHROME_PATH = findChromeExecutable();

const VIEWPORTS = [
  // Portrait
  { name: 'portrait_320x568', width: 320, height: 568, isMobile: true },
  { name: 'portrait_360x740', width: 360, height: 740, isMobile: true },
  { name: 'portrait_360x800', width: 360, height: 800, isMobile: true },
  { name: 'portrait_375x667', width: 375, height: 667, isMobile: true },
  { name: 'portrait_375x812', width: 375, height: 812, isMobile: true },
  { name: 'portrait_390x844', width: 390, height: 844, isMobile: true },
  { name: 'portrait_414x896', width: 414, height: 896, isMobile: true },
  { name: 'portrait_430x932', width: 430, height: 932, isMobile: true },
  // Landscape
  { name: 'landscape_568x320', width: 568, height: 320, isMobile: true },
  { name: 'landscape_667x375', width: 667, height: 375, isMobile: true },
  { name: 'landscape_740x360', width: 740, height: 360, isMobile: true },
  { name: 'landscape_844x390', width: 844, height: 390, isMobile: true },
  { name: 'landscape_932x430', width: 932, height: 430, isMobile: true },
  // Tablet
  { name: 'tablet_768x1024', width: 768, height: 1024, isMobile: false },
  { name: 'tablet_820x1180', width: 820, height: 1180, isMobile: false },
  // Desktop
  { name: 'desktop_1280x720', width: 1280, height: 720, isMobile: false },
  { name: 'desktop_1440x900', width: 1440, height: 900, isMobile: false },
];

async function run() {
  console.log('--- STARTING PHASE 4.9C MOBILE VERIFICATION SUITE ---');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--headless=new',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--no-sandbox',
    ],
  });

  const results = [];

  try {
    const page = await browser.newPage();

    // 1. Authenticate to create a real test room
    console.log('[1/4] Authenticating and creating test room...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
    
    // Signup unique host
    const authRes = await page.evaluate(async () => {
      const email = `host_${Date.now()}@example.com`;
      const signupRes = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'ValidPass123!', displayName: 'Alice Host' }),
        credentials: 'include',
      });
      const data = await signupRes.json();
      return { status: signupRes.status, data };
    });
    console.log('Signup Result:', JSON.stringify(authRes));

    // Create room
    const createRoomRes = await page.evaluate(async () => {
      const res = await fetch('/api/v1/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxParticipants: 10, waitingRoomEnabled: false }),
        credentials: 'include',
      });
      const data = await res.json();
      return { status: res.status, data };
    });
    console.log('Create room result:', JSON.stringify(createRoomRes));

    const roomCode = createRoomRes.data.room.publicCode;
    console.log(`Room created: ${roomCode}`);

    // 2. Prejoin Screen Test on Mobile (390x844)
    console.log('[2/4] Testing Prejoin Screen on Mobile (390x844)...');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(`http://localhost:3000/room/${roomCode}/preview`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1200));

    const prejoinCheck = await page.evaluate(() => {
      const joinBtn = document.querySelector('button[type="submit"]');
      const joinMutedBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('camera & mic off'));
      const videoToggle = document.querySelector('button[aria-label="Turn off camera"], button[aria-label="Turn on camera"]');
      const micToggle = document.querySelector('button[aria-label="Mute microphone"], button[aria-label="Unmute microphone"]');
      
      return {
        joinBtnVisible: !!joinBtn && joinBtn.getBoundingClientRect().height >= 44,
        joinMutedBtnVisible: !!joinMutedBtn,
        videoToggleVisible: !!videoToggle && videoToggle.getBoundingClientRect().height >= 44,
        micToggleVisible: !!micToggle && micToggle.getBoundingClientRect().height >= 44,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

    console.log('Prejoin checks:', prejoinCheck);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase4_9c_mobile_prejoin_390x844.png') });

    // Join room
    console.log('Joining meeting room...');
    await page.evaluate(() => {
      const joinBtn = document.querySelector('button[type="submit"]');
      if (joinBtn) joinBtn.click();
    });

    // Wait for meeting stage to mount
    await page.waitForSelector('#meeting-toolbar', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2000));

    // 3. Viewport Matrix Test Suite
    console.log('[3/4] Running Viewport Matrix Verification across all 17 viewports...');
    for (const vp of VIEWPORTS) {
      await page.setViewport({
        width: vp.width,
        height: vp.height,
        isMobile: vp.isMobile,
        hasTouch: vp.isMobile,
      });

      // Wait for toolbar to be ready in the new viewport
      await page.waitForSelector('#meeting-toolbar', { timeout: 10000 });
      await new Promise((r) => setTimeout(r, 600));

      const evaluation = await page.evaluate((vpInfo) => {
        const toolbar = document.querySelector('#meeting-toolbar');
        const micBtn = document.querySelector('#toolbar-mic-btn');
        const cameraBtn = document.querySelector('#toolbar-camera-btn');
        const leaveBtn = document.querySelector('#toolbar-leave-btn');
        const moreBtn = document.querySelector('#toolbar-more-btn');
        const chatBtn = document.querySelector('#toolbar-chat-btn');

        const docWidth = document.documentElement.clientWidth;
        const scrollWidth = document.documentElement.scrollWidth;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        const tbRect = toolbar ? toolbar.getBoundingClientRect() : null;
        const micRect = micBtn ? micBtn.getBoundingClientRect() : null;
        const camRect = cameraBtn ? cameraBtn.getBoundingClientRect() : null;
        const leaveRect = leaveBtn ? leaveBtn.getBoundingClientRect() : null;

        // Toolbar visibility: toolbar must be within the viewport
        const tbVisible = tbRect && tbRect.top < viewportHeight && tbRect.bottom <= viewportHeight + 2;
        
        // Mic button
        const micVisible = micRect && micRect.width >= 40 && micRect.height >= 40 &&
          micRect.bottom <= viewportHeight && micRect.top >= 0 && micRect.right <= viewportWidth;

        // Camera button
        const camVisible = camRect && camRect.width >= 40 && camRect.height >= 40 &&
          camRect.bottom <= viewportHeight && camRect.top >= 0 && camRect.right <= viewportWidth;

        // Leave button
        const leaveVisible = leaveRect && leaveRect.width >= 40 && leaveRect.height >= 40 &&
          leaveRect.bottom <= viewportHeight && leaveRect.top >= 0 && leaveRect.right <= viewportWidth;

        return {
          viewport: vpInfo.name,
          dimensions: `${vpInfo.width}x${vpInfo.height}`,
          hasHorizontalOverflow: scrollWidth > docWidth + 1,
          toolbarVisible: !!tbVisible,
          toolbarBottom: tbRect ? Math.round(tbRect.bottom) : null,
          viewportHeight,
          micVisible: !!micVisible,
          micSize: micRect ? `${Math.round(micRect.width)}x${Math.round(micRect.height)}` : null,
          camVisible: !!camVisible,
          camSize: camRect ? `${Math.round(camRect.width)}x${Math.round(camRect.height)}` : null,
          leaveVisible: !!leaveVisible,
          leaveSize: leaveRect ? `${Math.round(leaveRect.width)}x${Math.round(leaveRect.height)}` : null,
        };
      }, vp);

      results.push(evaluation);

      // Capture screenshots for key representative devices
      const captureKeys = [
        'portrait_320x568',
        'portrait_360x740',
        'portrait_375x667',
        'portrait_390x844',
        'portrait_430x932',
        'landscape_740x360',
        'landscape_844x390',
        'tablet_768x1024',
        'desktop_1440x900',
      ];

      if (captureKeys.includes(vp.name)) {
        const ssPath = path.join(ARTIFACTS_DIR, `phase4_9c_${vp.name}.png`);
        await page.screenshot({ path: ssPath });
        console.log(`Saved screenshot: ${vp.name} -> ${ssPath}`);
      }
    }

    // 4. Test Mobile Interactive Workflows (More Sheet, Chat Drawer, Button Taps)
    console.log('[4/4] Testing Interactive Controls & More Options Sheet on Mobile (390x844)...');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 600));

    console.log('Current URL at step 4:', page.url());
    const micExists = await page.$('#toolbar-mic-btn');
    console.log('Mic button element found:', !!micExists);
    if (!micExists) {
      const bodyHtml = await page.evaluate(() => document.body.innerHTML.slice(0, 500));
      console.log('Body HTML snippet:', bodyHtml);
    }

    await page.waitForSelector('#toolbar-mic-btn', { timeout: 10000 });

    // Tap Mic
    await page.click('#toolbar-mic-btn');
    await new Promise((r) => setTimeout(r, 300));

    // Tap Camera
    await page.click('#toolbar-camera-btn');
    await new Promise((r) => setTimeout(r, 300));

    // Tap More Sheet
    await page.click('#toolbar-more-btn');
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase4_9c_mobile_more_sheet_390x844.png') });

    const sheetCheck = await page.evaluate(() => {
      const sheet = document.querySelector('h3');
      const hasHeading = sheet && sheet.textContent?.includes('Meeting Options');
      const buttons = Array.from(document.querySelectorAll('button'));
      const participantsOpt = buttons.find(b => b.textContent?.includes('Participants'));
      const notesOpt = buttons.find(b => b.textContent?.includes('Notes'));
      const handOpt = buttons.find(b => b.textContent?.includes('Hand'));
      return {
        hasHeading: !!hasHeading,
        hasParticipants: !!participantsOpt,
        hasNotes: !!notesOpt,
        hasHand: !!handOpt,
      };
    });

    console.log('More sheet checks:', sheetCheck);

    // Close More sheet
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[aria-label="Close options"]');
      if (closeBtn) closeBtn.click();
    });
    await new Promise((r) => setTimeout(r, 400));

    // Open Chat Drawer on mobile and verify toolbar is still fully visible
    await page.click('#toolbar-chat-btn');
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase4_9c_mobile_chat_overlay_390x844.png') });

    const chatOverlayCheck = await page.evaluate(() => {
      const toolbar = document.querySelector('#meeting-toolbar');
      const leaveBtn = document.querySelector('#toolbar-leave-btn');
      const micBtn = document.querySelector('#toolbar-mic-btn');
      const camBtn = document.querySelector('#toolbar-camera-btn');
      const tbRect = toolbar.getBoundingClientRect();
      const leaveRect = leaveBtn.getBoundingClientRect();

      return {
        toolbarVisibleWithChat: tbRect.bottom <= window.innerHeight + 2,
        leaveVisibleWithChat: leaveRect.bottom <= window.innerHeight && leaveRect.top >= 0,
        micVisibleWithChat: micBtn.getBoundingClientRect().bottom <= window.innerHeight,
        camVisibleWithChat: camBtn.getBoundingClientRect().bottom <= window.innerHeight,
      };
    });

    console.log('Chat overlay checks:', chatOverlayCheck);

    // Close chat
    await page.evaluate(() => {
      const closeChat = document.querySelector('button[aria-label="Close chat panel"]');
      if (closeChat) closeChat.click();
    });
    await new Promise((r) => setTimeout(r, 400));

    // Test Leave Button Clickability
    console.log('Testing Leave button click...');
    await page.click('#toolbar-leave-btn');
    await new Promise((r) => setTimeout(r, 1200));

    const finalUrl = page.url();
    console.log(`Page URL after leave: ${finalUrl}`);
    const leaveSuccess = finalUrl.includes('/') && !finalUrl.includes('/room/');

    console.log('\n=== MATRIX SUMMARY RESULTS ===');
    console.table(results);

    const allPassed = results.every(
      r => !r.hasHorizontalOverflow && r.toolbarVisible && r.micVisible && r.camVisible && r.leaveVisible
    );

    console.log(`\nALL 17 VIEWPORTS PASS: ${allPassed}`);
    console.log(`PREJOIN PASS: ${prejoinCheck.joinBtnVisible && prejoinCheck.videoToggleVisible}`);
    console.log(`MORE SHEET PASS: ${sheetCheck.hasHeading && sheetCheck.hasParticipants}`);
    console.log(`CHAT OVERLAY PASS: ${chatOverlayCheck.toolbarVisibleWithChat && chatOverlayCheck.leaveVisibleWithChat}`);
    console.log(`LEAVE ACTION PASS: ${leaveSuccess}`);

    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, 'phase4_9c_matrix_results.json'),
      JSON.stringify({ results, prejoinCheck, sheetCheck, chatOverlayCheck, leaveSuccess, allPassed }, null, 2)
    );

  } catch (err) {
    console.error('Test execution error:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
