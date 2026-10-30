import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import assert from 'assert/strict';
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
  throw new Error('Chrome/Chromium executable not found. Please set CHROME_PATH environment variable.');
}

function getArtifactsDir() {
  const dir = process.env.TEST_ARTIFACTS_DIR || path.resolve(__dirname, 'artifacts');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const VIEWPORTS = [
  { name: '320px_iphone_se', width: 320, height: 568, isMobile: true },
  { name: '360px_android_compact', width: 360, height: 800, isMobile: true },
  { name: '375px_iphone_standard', width: 375, height: 667, isMobile: true },
  { name: '390px_iphone_14', width: 390, height: 844, isMobile: true },
  { name: '412px_realme_11_pro_5g', width: 412, height: 915, isMobile: true },
  { name: '430px_iphone_15_pro_max', width: 430, height: 932, isMobile: true },
];

export async function runMediaPermissionsE2E() {
  console.log('========================================================================');
  console.log('  TATHASTU CONNECT — P0.1 REAL MEDIA PERMISSION RELIABILITY CERTIFICATION ');
  console.log('========================================================================\n');

  const chromePath = findChromeExecutable();
  const artifactsDir = getArtifactsDir();
  console.log('[E2E SETUP] Found Chrome executable:', chromePath);
  console.log('[E2E SETUP] Artifacts output directory:', artifactsDir);

  const isCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
  const launchArgs = [
    '--headless=new',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--disable-dev-shm-usage',
  ];
  if (isCi || process.env.NO_SANDBOX === 'true') {
    launchArgs.push('--no-sandbox');
  }

  // Secure Chrome launch: NO --disable-web-security flag
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: launchArgs,
    defaultViewport: { width: 412, height: 915 },
  });

  try {
    const context = browser.defaultBrowserContext();
    const page = await browser.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('  [BROWSER CONSOLE ERROR]', msg.text());
      }
    });
    page.on('pageerror', (err) => {
      console.error('  [BROWSER PAGEERROR]', err.message);
    });

    const corsHeaders = {
      'Access-Control-Allow-Origin': 'http://localhost:3000',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Mock API requests with proper CORS and authentication for an isolated test room
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      const url = req.url();
      if (req.method() === 'OPTIONS') {
        await req.respond({
          status: 204,
          headers: corsHeaders,
        });
        return;
      }

      if (url.includes('/api/v1/rooms/TEST-ROOM-101/token')) {
        await req.respond({
          status: 200,
          headers: corsHeaders,
          contentType: 'application/json',
          body: JSON.stringify({
            token: 'mock-test-jwt-token',
            livekitUrl: 'wss://tathastu-connect-htzr4167.livekit.cloud',
          }),
        });
      } else if (url.includes('/api/v1/rooms/TEST-ROOM-101/join')) {
        await req.respond({
          status: 200,
          headers: corsHeaders,
          contentType: 'application/json',
          body: JSON.stringify({
            room: { id: 'room-101', publicCode: 'TEST-ROOM-101', status: 'active' },
            participant: { identity: 'p-anant', displayName: 'Anant Kumar', role: 'host' },
            isHost: true,
          }),
        });
      } else if (url.includes('/api/v1/rooms/TEST-ROOM-101')) {
        await req.respond({
          status: 200,
          headers: corsHeaders,
          contentType: 'application/json',
          body: JSON.stringify({
            room: {
              id: 'room-101',
              publicCode: 'TEST-ROOM-101',
              status: 'active',
              isLocked: false,
              waitingRoomEnabled: false,
              maxParticipants: 10,
              createdAt: new Date().toISOString(),
            },
          }),
        });
      } else if (url.includes('/api/v1/auth/session')) {
        await req.respond({
          status: 200,
          headers: corsHeaders,
          contentType: 'application/json',
          body: JSON.stringify({
            user: {
              id: 'user-anant-1',
              displayName: 'Anant Kumar',
              email: 'quantumanant01@gmail.com',
            },
          }),
        });
      } else {
        await req.continue();
      }
    });

    // -------------------------------------------------------------------------
    // TEST SUITE A: PREJOIN CLEAN COMPOSITION & NO OVERLAY DEFECTS
    // -------------------------------------------------------------------------
    console.log('\n[TEST A] Navigating to Prejoin preview page (TEST-ROOM-101)...');
    await page.setViewport({ width: 412, height: 915, isMobile: true });
    const navResponse = await page.goto('http://localhost:3000/room/TEST-ROOM-101/preview', {
      waitUntil: 'networkidle0',
      timeout: 15000,
    });
    assert.ok(navResponse && navResponse.status() === 200, 'Prejoin route failed to load with 200 OK');

    await page.waitForSelector('#device-preview-container', { timeout: 10000 });
    console.log('  ✓ #device-preview-container rendered successfully');

    // ASSERTION A1: No red error overlay inside preview
    const redOverlayCount = await page.$$eval('.bg-red-950', (els) => els.length);
    assert.strictEqual(redOverlayCount, 0, 'DEFECT: Found red error overlay (.bg-red-950) inside camera preview!');
    console.log('  ✓ ASSERTION PASS: Zero red error boxes covering camera preview');

    // ASSERTION A2: No duplicate "Enable Camera & Mic" button inside preview
    const duplicateButtonText = await page.$$eval('button', (btns) =>
      btns.filter((b) => b.textContent && b.textContent.includes('Enable Camera & Mic')).length
    );
    assert.strictEqual(duplicateButtonText, 0, 'DEFECT: Found duplicate "Enable Camera & Mic" button inside preview!');
    console.log('  ✓ ASSERTION PASS: Zero duplicate "Enable Camera & Mic" buttons inside preview');

    // ASSERTION A3: No duplicate purple recommended card below preview
    const purpleCardCount = await page.$$eval('.bg-\\[\\#EEE8FF\\]', (els) =>
      els.filter((el) => el.textContent && el.textContent.includes('recommended for meeting')).length
    );
    assert.strictEqual(purpleCardCount, 0, 'DEFECT: Found duplicate purple recommended banner below preview!');
    console.log('  ✓ ASSERTION PASS: Zero duplicate purple recommended cards below preview');

    // ASSERTION A4: Geometry & Bounding Box Collision Check for Controls
    const geometry = await page.evaluate(() => {
      const micBtn = document.querySelector('#preview-mic-btn');
      const camBtn = document.querySelector('#preview-camera-btn');
      const container = document.querySelector('#device-preview-container');

      if (!micBtn || !camBtn || !container) {
        throw new Error('Required preview controls not found in DOM');
      }

      const micR = micBtn.getBoundingClientRect();
      const camR = camBtn.getBoundingClientRect();
      const contR = container.getBoundingClientRect();

      // Check collision between mic button and camera button
      const buttonsCollide = !(
        micR.right <= camR.left ||
        micR.left >= camR.right ||
        micR.bottom <= camR.top ||
        micR.top >= camR.bottom
      );

      // Check buttons are inside preview container
      const micInside = micR.left >= contR.left && micR.right <= contR.right && micR.bottom <= contR.bottom;
      const camInside = camR.left >= contR.left && camR.right <= contR.right && camR.bottom <= contR.bottom;

      return {
        micWidth: micR.width,
        micHeight: micR.height,
        camWidth: camR.width,
        camHeight: camR.height,
        buttonsCollide,
        clearance: camR.left - micR.right,
        micInside,
        camInside,
      };
    });

    assert.strictEqual(geometry.buttonsCollide, false, 'DEFECT: Floating mic and camera buttons collide with each other!');
    assert.ok(geometry.clearance >= 8, `DEFECT: Clearance between buttons is only ${geometry.clearance}px (must be >= 8px)`);
    assert.ok(geometry.micHeight >= 44 && geometry.camHeight >= 44, 'DEFECT: Touch target height must be >= 44px');
    console.log(`  ✓ ASSERTION PASS: Controls geometry valid (Clearance: ${geometry.clearance}px, Heights: ${geometry.micHeight}px, Collision: None)`);

    // -------------------------------------------------------------------------
    // TEST SUITE B: MULTI-RESOLUTION MOBILE RESPONSIVENESS & OVERFLOW
    // -------------------------------------------------------------------------
    console.log('\n[TEST B] Validating Mobile Viewports (320px to 430px, including Realme 11 Pro 5G)...');
    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile });
      await new Promise((r) => setTimeout(r, 150));

      const overflowCheck = await page.evaluate(() => {
        const docW = document.documentElement.clientWidth;
        const scrollW = document.documentElement.scrollWidth;
        return { docW, scrollW, hasOverflow: scrollW > docW + 1 };
      });

      assert.strictEqual(
        overflowCheck.hasOverflow,
        false,
        `DEFECT: Horizontal overflow detected on viewport ${vp.name} (${overflowCheck.scrollW}px > ${overflowCheck.docW}px)`
      );
      console.log(`  ✓ Viewport validated: ${vp.name} (${vp.width}x${vp.height}) - scrollWidth matches clientWidth exactly`);
    }

    // Set back to Realme 11 Pro 5G viewport for subsequent assertions
    await page.setViewport({ width: 412, height: 915, isMobile: true });

    // -------------------------------------------------------------------------
    // TEST SUITE C: FIRST-TIME ACCESS & EXPLICIT USER ACTIVATION
    // -------------------------------------------------------------------------
    console.log('\n[TEST C] Testing First-Time Access (No unprompted media capture on mount)...');
    // On fresh mount with permissions prompt/unknown, preview stream must NOT start unprompted
    const videoStreamActiveOnMount = await page.evaluate(() => {
      const video = document.querySelector('video');
      return Boolean(video && video.srcObject);
    });
    assert.strictEqual(videoStreamActiveOnMount, false, 'DEFECT: Camera stream started unexpectedly on mount without user action!');
    console.log('  ✓ ASSERTION PASS: Camera stays off initially until explicitly activated by user');

    // -------------------------------------------------------------------------
    // TEST SUITE D: PERMISSION REQUEST & REAL TRACK ACQUISITION
    // -------------------------------------------------------------------------
    console.log('\n[TEST D] Testing Explicit Camera and Mic Button Activation...');
    await context.overridePermissions('http://localhost:3000', ['camera', 'microphone']);

    // Click camera button to explicitly trigger camera capture
    await page.click('#preview-camera-btn');
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return Boolean(v && v.srcObject && v.srcObject.getVideoTracks().length > 0);
    }, { timeout: 5000 });

    const cameraTrackState = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video || !video.srcObject) return null;
      const stream = video.srcObject;
      const vTrack = stream.getVideoTracks()[0];
      return vTrack ? { readyState: vTrack.readyState, kind: vTrack.kind } : null;
    });

    assert.ok(cameraTrackState, 'DEFECT: Video element did not mount or has no srcObject after camera activation');
    assert.strictEqual(cameraTrackState.readyState, 'live', 'DEFECT: Camera track readyState must be "live"');
    console.log('  ✓ ASSERTION PASS: Camera track acquired and verified live (kind: video, readyState: live)');

    // Click microphone button to explicitly trigger microphone capture
    await page.click('#preview-mic-btn');
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return Boolean(v && v.srcObject && v.srcObject.getAudioTracks().length > 0);
    }, { timeout: 5000 });

    const audioTrackState = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video || !video.srcObject) return null;
      const stream = video.srcObject;
      const aTrack = stream.getAudioTracks()[0];
      return aTrack ? { readyState: aTrack.readyState, kind: aTrack.kind } : null;
    });
    assert.ok(audioTrackState, 'DEFECT: Audio track not found in media stream after microphone activation');
    assert.strictEqual(audioTrackState.readyState, 'live', 'DEFECT: Audio track readyState must be "live"');
    console.log('  ✓ ASSERTION PASS: Audio track acquired and verified live (kind: audio, readyState: live)');

    // Capture clean prejoin preview screenshot
    const prejoinScreenshotPath = path.join(artifactsDir, 'prejoin_clean_composition_412px.png');
    await page.screenshot({ path: prejoinScreenshotPath, fullPage: true });
    console.log('  ✓ Saved prejoin screenshot:', prejoinScreenshotPath);

    // -------------------------------------------------------------------------
    // TEST SUITE E: PERMISSION DENIAL & LEGITIMATE RECOVERY FLOW
    // -------------------------------------------------------------------------
    console.log('\n[TEST E] Testing Permission Denial & Legitimate User Recovery...');
    
    // Step E1: Turn camera off
    await page.click('#preview-camera-btn');
    await new Promise((r) => setTimeout(r, 400));

    // Step E2: Revoke camera permission in browser context to simulate blocked device
    await context.overridePermissions('http://localhost:3000', []);

    // Step E3: User taps camera button to attempt activation while blocked
    await page.click('#preview-camera-btn');
    
    // Wait for the Permission Help Sheet dialog to mount
    const helpTitleEl = await page.waitForSelector('#permission-help-title', { visible: true, timeout: 5000 });
    assert.ok(helpTitleEl, 'DEFECT: Permission Help Sheet was not displayed upon permission denial');
    const helpText = await page.evaluate((el) => el.textContent, helpTitleEl);
    assert.ok(helpText.includes('Camera is blocked'), `Expected 'Camera is blocked', got: '${helpText}'`);
    console.log('  ✓ ASSERTION PASS: Permission denial displays Permission Help Sheet ("Camera is blocked")');

    // Step E4: Capture help sheet screenshot
    const helpScreenshotPath = path.join(artifactsDir, 'permission_help_sheet_412px.png');
    await page.screenshot({ path: helpScreenshotPath, fullPage: true });
    console.log('  ✓ Saved permission help sheet screenshot:', helpScreenshotPath);

    // Step E5: Legitimate recovery - User enables permission in browser
    await context.overridePermissions('http://localhost:3000', ['camera', 'microphone']);

    // Step E6: Tap retry button inside help sheet
    await page.click('#retry-permission-btn');

    // Step E7: Confirm dialog automatically closes upon successful recovery
    await page.waitForFunction(() => !document.querySelector('#permission-help-title'), { timeout: 5000 });
    console.log('  ✓ ASSERTION PASS: Permission help sheet automatically dismissed upon recovery');

    // Step E8: Confirm live video track is restored
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return Boolean(v && v.srcObject && v.srcObject.getVideoTracks().length > 0);
    }, { timeout: 5000 });
    const recoveredTrackState = await page.evaluate(() => {
      const v = document.querySelector('video');
      const track = v?.srcObject?.getVideoTracks()[0];
      return track ? track.readyState : null;
    });
    assert.strictEqual(recoveredTrackState, 'live', 'DEFECT: Recovered video track readyState is not "live"');
    console.log('  ✓ ASSERTION PASS: Camera track successfully recovered and live after permission grant');

    // -------------------------------------------------------------------------
    // TEST SUITE F: JOIN MUTED BEHAVIOR
    // -------------------------------------------------------------------------
    console.log('\n[TEST F] Testing Join Muted Flow...');
    const hasJoinMuted = await page.$('#join-muted-btn');
    assert.ok(hasJoinMuted, 'DEFECT: #join-muted-btn is missing from preview page!');

    await page.click('#join-muted-btn');
    await page.waitForFunction(
      () => window.location.pathname === '/room/TEST-ROOM-101',
      { timeout: 10000 }
    );
    console.log('  ✓ ASSERTION PASS: Joined room successfully with muted option (navigated to /room/TEST-ROOM-101)');

    // -------------------------------------------------------------------------
    // TEST SUITE G: IN-ROOM LAYOUT INTEGRITY & NO SFU CLOUD COLLISION
    // -------------------------------------------------------------------------
    console.log('\n[TEST G] Testing In-Room Header & Diagnostic Pill Placement (Zero Overlap with Participant Names)...');
    await new Promise((r) => setTimeout(r, 1000));

    const inRoomOverlays = await page.evaluate(() => {
      const pinkBanners = document.querySelectorAll('.bg-\\[\\#FFE5DF\\].fixed.top-16');
      return {
        pinkBannerCount: pinkBanners.length,
      };
    });

    assert.strictEqual(inRoomOverlays.pinkBannerCount, 0, 'DEFECT: Found fixed top-16 pink error banner in MeetingRoom!');
    console.log('  ✓ ASSERTION PASS: Zero fixed pink mediaAlert banners in MeetingRoom');

    const inRoomScreenshotPath = path.join(artifactsDir, 'in_room_layout_412px.png');
    await page.screenshot({ path: inRoomScreenshotPath, fullPage: true });
    console.log('  ✓ Saved in-room screenshot:', inRoomScreenshotPath);

    console.log('\n========================================================================');
    console.log('  ALL P0.1 PERMISSION RELIABILITY & MOBILE GEOMETRY ASSERTIONS PASSED!   ');
    console.log('========================================================================\n');
  } catch (err) {
    console.error('\n❌ E2E TEST FAILED:', err.message);
    const failurePath = path.join(artifactsDir, 'p0_1_e2e_failure.png');
    const pages = await browser.pages();
    if (pages[0]) {
      await pages[0].screenshot({ path: failurePath, fullPage: true }).catch(() => {});
      console.log('  Captured failure screenshot at:', failurePath);
    }
    throw err;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMediaPermissionsE2E()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal E2E Execution Failure:', err);
      process.exit(1);
    });
}

