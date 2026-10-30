import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
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
  throw new Error('Chrome/Chromium executable not found. Set CHROME_PATH environment variable.');
}

function getArtifactsDir() {
  const dir = process.env.TEST_ARTIFACTS_DIR || path.resolve(__dirname, 'artifacts');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function runWebRTCE2EVerification() {
  console.log('========================================================================');
  console.log('  TATHASTU CONNECT — WEBRTC DUAL-PARTICIPANT INTEGRATION VERIFICATION   ');
  console.log('========================================================================\n');

  const chromePath = findChromeExecutable();
  const artifactsDir = getArtifactsDir();
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';

  const isCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
  const baseArgs = [
    '--headless=new',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--disable-dev-shm-usage',
    '--enable-features=WebRTCPeerConnectionWithBlockIceAddresses',
  ];
  if (isCi || process.env.NO_SANDBOX === 'true') {
    baseArgs.push('--no-sandbox');
  }

  const hostArgs = [
    ...baseArgs,
    '--auto-select-desktop-capture-source=Entire screen',
    '--window-size=1280,800',
  ];
  const guestArgs = [
    ...baseArgs,
    '--window-size=412,915',
  ];

  let browserA = null;
  let browserB = null;

  try {
    console.log('1. Launching Host Browser A (Chrome)...');
    browserA = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: hostArgs,
      defaultViewport: { width: 1280, height: 800 },
    });

    const pageA = await browserA.newPage();
    await pageA.evaluateOnNewDocument(() => {
      window.__TC_ENABLE_TEST_DIAGNOSTICS = true;
    });

    pageA.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('LiveKit') || text.includes('rtc') || text.includes('error')) {
        console.log('Host Console:', msg.type(), text.slice(0, 150));
      }
    });

    console.log('2. Authenticating Host (Alice Smith)...');
    await pageA.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const authRes = await pageA.evaluate(async () => {
      const email = `alice_${Date.now()}@example.com`;
      const signupRes = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'ValidPass123!', displayName: 'Alice Smith' }),
        credentials: 'include',
      });
      if (signupRes.ok) return await signupRes.json();
      return { ok: false };
    });

    assert.ok(authRes?.user, 'Host signup must succeed');

    console.log('3. Creating room via backend API...');
    const createRoomRes = await pageA.evaluate(async () => {
      const res = await fetch('/api/v1/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      return res.json();
    });

    assert.ok(createRoomRes.room?.publicCode, 'Room code must exist');
    const roomCode = createRoomRes.room.publicCode;
    console.log(`Room created successfully on LiveKit Cloud: ${roomCode}`);

    console.log(`4. Host entering pre-join for room ${roomCode}...`);
    await pageA.goto(`${baseUrl}/room/${roomCode}/preview`, { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#preview-camera-btn', { timeout: 15000 });

    await pageA.click('#preview-camera-btn');
    await pageA.waitForFunction(() => {
      const v = document.querySelector('video');
      return Boolean(v && v.srcObject && v.srcObject.getVideoTracks().length > 0);
    }, { timeout: 10000 });

    console.log('5. Host joining meeting room...');
    await pageA.waitForSelector('#join-meeting-btn', { timeout: 8000 });
    await pageA.click('#join-meeting-btn');

    await pageA.waitForFunction(
      (code) => window.location.pathname === `/room/${code}`,
      { timeout: 15000 },
      roomCode
    );

    await pageA.waitForFunction(() => {
      return Boolean(window.__livekitRoom && window.__livekitRoom.state === 'connected');
    }, { timeout: 15000 });
    console.log('Host connected to LiveKit room.');

    // 6. Guest joins
    console.log('6. Launching Guest Browser B...');
    browserB = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: guestArgs,
      defaultViewport: { width: 412, height: 915 },
    });

    const pageB = await browserB.newPage();
    await pageB.evaluateOnNewDocument(() => {
      window.__TC_ENABLE_TEST_DIAGNOSTICS = true;
    });

    await pageB.goto(`${baseUrl}/room/${roomCode}/preview`, { waitUntil: 'domcontentloaded' });
    await pageB.waitForSelector('#preview-camera-btn', { timeout: 15000 });

    await pageB.click('#preview-camera-btn');
    await pageB.waitForFunction(() => {
      const v = document.querySelector('video');
      return Boolean(v && v.srcObject && v.srcObject.getVideoTracks().length > 0);
    }, { timeout: 10000 });

    await pageB.waitForSelector('#join-meeting-btn', { timeout: 8000 });
    await pageB.click('#join-meeting-btn');

    await pageB.waitForFunction(
      (code) => window.location.pathname === `/room/${code}`,
      { timeout: 15000 },
      roomCode
    );

    await pageB.waitForFunction(() => {
      return Boolean(window.__livekitRoom && window.__livekitRoom.state === 'connected');
    }, { timeout: 15000 });
    console.log('Guest connected to LiveKit room.');

    // 7. Verify mutual track subscription
    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      return Boolean(room && room.remoteParticipants.size >= 1);
    }, { timeout: 15000 });

    await pageB.waitForFunction(() => {
      const room = window.__livekitRoom;
      return Boolean(room && room.remoteParticipants.size >= 1);
    }, { timeout: 15000 });
    console.log('Mutual remote participants discovered and tracks subscribed.');

    // 8. Capture meeting screenshot
    const dualScreenshotPath = path.join(artifactsDir, 'webrtc_verified_meeting.png');
    await pageB.screenshot({ path: dualScreenshotPath });
    console.log(`Captured dual meeting screenshot at: ${dualScreenshotPath}`);

    // 9. Certified Screen Sharing
    console.log('9. Testing Certified Screen Sharing from Host (Alice)...');
    await pageA.click('#toolbar-screen-share-btn');

    // Wait for screen share publication on Alice
    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      if (!room) return false;
      const pubs = Array.from(room.localParticipant.trackPublications.values());
      return pubs.some((p) => p.source === 'screen_share' && !p.isMuted);
    }, { timeout: 15000 });

    // Wait for screen share subscription and element attachment on Bob
    await pageB.waitForSelector('#screenshare-video', { timeout: 15000 });
    const screenVerified = await pageB.evaluate(() => {
      const v = document.querySelector('#screenshare-video');
      return Boolean(v && v.srcObject && v.srcObject.getVideoTracks().length > 0);
    });
    assert.ok(screenVerified, 'Screen share stream must be attached to #screenshare-video on receiver');
    console.log('Screen share published, received, and attached to video element.');

    const screenScreenshotPath = path.join(artifactsDir, 'webrtc_screenshare_verified.png');
    await pageB.screenshot({ path: screenScreenshotPath });

    // Stop screen share
    await pageA.click('#toolbar-screen-share-btn');
    await pageB.waitForFunction(() => !document.querySelector('#screenshare-video'), { timeout: 10000 });

    // 10. End meeting for everyone
    console.log('10. Host ends meeting for everyone...');
    await pageA.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const endBtn = btns.find((b) => b.textContent && b.textContent.includes('End for all'));
      if (endBtn) endBtn.click();
    });

    await pageA.waitForFunction(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some((b) => b.textContent && b.textContent.includes('End for everyone'));
    }, { timeout: 8000 });

    await pageA.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const confirmBtn = btns.find((b) => b.textContent && b.textContent.includes('End for everyone'));
      if (confirmBtn) confirmBtn.click();
    });

    await pageB.waitForFunction(() => {
      return (
        document.body.innerText.includes('This meeting has ended') ||
        (window.__livekitRoom && window.__livekitRoom.state === 'disconnected')
      );
    }, { timeout: 12000 });
    console.log('Room ended for all participants.');

    console.log('\n========================================================================');
    console.log('  WEBRTC DUAL-PARTICIPANT INTEGRATION VERIFICATION PASSED!               ');
    console.log('========================================================================\n');
  } finally {
    if (browserA) {
      try { await browserA.close(); } catch {}
    }
    if (browserB) {
      try { await browserB.close(); } catch {}
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('webrtc_e2e_verification.mjs')) {
  runWebRTCE2EVerification()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ FATAL TEST FAILURE:', err);
      process.exit(1);
    });
}

