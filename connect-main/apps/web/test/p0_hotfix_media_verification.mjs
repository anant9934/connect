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

export async function runP0MasterMediaVerification() {
  console.log('========================================================================');
  console.log('  TATHASTU CONNECT — P0 MASTER MEDIA & PARTICIPANT REPAIR VERIFICATION  ');
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

  const browserArgsHost = [
    ...baseArgs,
    '--auto-select-desktop-capture-source=Entire screen',
    '--window-size=1280,800',
  ];
  const browserArgsGuest = [
    ...baseArgs,
    '--window-size=390,844',
  ];

  let browserA = null;
  let browserB = null;

  try {
    console.log('[STAGE 1] Launching Host Browser A (Desktop Chrome)...');
    browserA = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: browserArgsHost,
      defaultViewport: { width: 1280, height: 800 },
    });

    const pageA = await browserA.newPage();
    await pageA.evaluateOnNewDocument(() => {
      window.__TC_ENABLE_TEST_DIAGNOSTICS = true;
    });

    pageA.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('LiveKit') || text.includes('rtc') || text.includes('error')) {
        console.log(`  [Host Console ${msg.type()}]:`, text.slice(0, 150));
      }
    });

    console.log('[STAGE 2] Authenticating Host & Creating Room...');
    await pageA.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const authRes = await pageA.evaluate(async () => {
      const email = `host_${Date.now()}@example.com`;
      const signupRes = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'ValidPass123!', displayName: 'Dr. Jane Host' }),
        credentials: 'include',
      });
      if (signupRes.ok) return await signupRes.json();
      return { ok: false };
    });

    assert.ok(authRes?.user, 'Host authentication must succeed');
    console.log('  -> Host Authenticated:', authRes.user.displayName);

    const createRoomRes = await pageA.evaluate(async () => {
      const res = await fetch('/api/v1/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxParticipants: 10, waitingRoomEnabled: false }),
        credentials: 'include',
      });
      return res.json();
    });

    assert.ok(createRoomRes.room?.publicCode, 'Failed to create room: ' + JSON.stringify(createRoomRes));
    const roomCode = createRoomRes.room.publicCode;
    console.log(`  -> Room Created: ${roomCode}`);

    console.log('\n[STAGE 3] Host joining meeting room...');
    await pageA.goto(`${baseUrl}/room/${roomCode}/preview`, { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#preview-camera-btn', { timeout: 15000 });

    // Enable camera in preview
    await pageA.click('#preview-camera-btn');
    await pageA.waitForFunction(() => {
      const v = document.querySelector('video');
      return Boolean(v && v.srcObject && v.srcObject.getVideoTracks().length > 0);
    }, { timeout: 10000 });

    await pageA.waitForSelector('#join-meeting-btn', { timeout: 8000 });
    await pageA.click('#join-meeting-btn');

    await pageA.waitForFunction((code) => window.location.pathname === `/room/${code}`, { timeout: 15000 }, roomCode);
    console.log('  -> Host navigated to room page.');

    await pageA.waitForSelector('[data-testid="participant-tile"]', { timeout: 15000 });
    const hostTileCount = await pageA.$$eval('[data-testid="participant-tile"]', (tiles) => tiles.length);
    assert.strictEqual(hostTileCount, 1, 'Local participant tile must be rendered');
    console.log(`  [ASSERT 1 PASS] Local participant tile rendered! Count = ${hostTileCount}`);

    // ASSERTION 2: Local Video element is active and attached
    const hasVideoElement = await pageA.waitForFunction(() => {
      const vid = document.querySelector('video[data-testid="participant-video"]');
      return Boolean(vid && vid.srcObject);
    }, { timeout: 10000 });
    assert.ok(hasVideoElement, 'Host local camera stream must attach to video element');
    console.log('  [ASSERT 2 PASS] Host local camera video stream attached to <video>');

    // Screenshot: Host joined alone
    await pageA.screenshot({ path: path.join(artifactsDir, '01_host_joined_stage.png') });

    // ASSERTION 3: Toggle Camera OFF & ON
    console.log('\n[STAGE 4] Testing Camera & Microphone Toggles on Host...');
    await pageA.click('#toolbar-camera-btn');
    await pageA.waitForFunction(() => {
      const vid = document.querySelector('video[data-testid="participant-video"]');
      return vid && vid.classList.contains('opacity-0');
    }, { timeout: 8000 });
    console.log('  [ASSERT 3A PASS] Host camera toggled OFF -> Video hidden, avatar visible');

    await pageA.click('#toolbar-camera-btn');
    await pageA.waitForFunction(() => {
      const vid = document.querySelector('video[data-testid="participant-video"]');
      return vid && vid.classList.contains('opacity-100') && Boolean(vid.srcObject);
    }, { timeout: 8000 });
    console.log('  [ASSERT 3B PASS] Host camera toggled back ON -> Video restored');

    await pageA.click('#toolbar-mic-btn');
    await pageA.waitForFunction(() => {
      const btn = document.querySelector('#toolbar-mic-btn');
      return Boolean(btn && btn.getAttribute('aria-label')?.includes('Unmute'));
    }, { timeout: 8000 });
    console.log('  [ASSERT 3C PASS] Host mic toggled without reconnect: Muted');

    await pageA.click('#toolbar-mic-btn');
    await pageA.waitForFunction(() => {
      const btn = document.querySelector('#toolbar-mic-btn');
      return Boolean(btn && btn.getAttribute('aria-label')?.includes('Mute microphone'));
    }, { timeout: 8000 });

    // ASSERTION 4: Guest joins on Mobile Viewport
    console.log('\n[STAGE 5] Launching Guest Browser B (Android Mobile Chrome 390x844)...');
    browserB = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: browserArgsGuest,
      defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
    });

    const pageB = await browserB.newPage();
    await pageB.evaluateOnNewDocument(() => {
      window.__TC_ENABLE_TEST_DIAGNOSTICS = true;
    });

    pageB.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('LiveKit') || text.includes('rtc') || text.includes('error')) {
        console.log(`  [Guest Console ${msg.type()}]:`, text.slice(0, 150));
      }
    });

    console.log('  -> Guest opening room preview URL...');
    await pageB.goto(`${baseUrl}/room/${roomCode}/preview`, { waitUntil: 'domcontentloaded' });
    await pageB.waitForSelector('#preview-camera-btn', { timeout: 15000 });

    await pageB.click('#preview-camera-btn');
    await pageB.waitForFunction(() => {
      const v = document.querySelector('video');
      return Boolean(v && v.srcObject && v.srcObject.getVideoTracks().length > 0);
    }, { timeout: 10000 });

    await pageB.waitForSelector('#join-meeting-btn', { timeout: 8000 });
    await pageB.click('#join-meeting-btn');

    await pageB.waitForFunction((code) => window.location.pathname === `/room/${code}`, { timeout: 15000 }, roomCode);
    console.log('  -> Guest joined room.');

    // ASSERTION 5: Cross-Device Mutual Visibility
    console.log('\n[STAGE 6] Verifying Cross-Device Grid & Media Synchronization...');
    await pageA.waitForFunction(() => document.querySelectorAll('[data-testid="participant-tile"]').length === 2, { timeout: 15000 });
    await pageB.waitForFunction(() => document.querySelectorAll('[data-testid="participant-tile"]').length === 2, { timeout: 15000 });

    const hostObservedCount = await pageA.$$eval('[data-testid="participant-tile"]', (t) => t.length);
    const guestObservedCount = await pageB.$$eval('[data-testid="participant-tile"]', (t) => t.length);
    assert.strictEqual(hostObservedCount, 2, 'Host must see 2 participant tiles');
    assert.strictEqual(guestObservedCount, 2, 'Guest must see 2 participant tiles');
    console.log(`  [ASSERT 5A PASS] Host sees ${hostObservedCount} participant tiles.`);
    console.log(`  [ASSERT 5B PASS] Guest sees ${guestObservedCount} participant tiles on Mobile.`);

    // Verify both tiles have video streams attached
    await pageA.waitForFunction(() => {
      const vids = Array.from(document.querySelectorAll('video[data-testid="participant-video"]'));
      return vids.filter((v) => Boolean(v.srcObject)).length >= 2;
    }, { timeout: 15000 });

    await pageB.waitForFunction(() => {
      const vids = Array.from(document.querySelectorAll('video[data-testid="participant-video"]'));
      return vids.filter((v) => Boolean(v.srcObject)).length >= 2;
    }, { timeout: 15000 });
    console.log('  [ASSERT 6 PASS] Both host and guest have active remote video streams attached.');

    // Screenshots
    await pageA.screenshot({ path: path.join(artifactsDir, '03_desktop_two_participants.png') });
    await pageB.screenshot({ path: path.join(artifactsDir, '04_mobile_two_participants.png') });

    // ASSERTION 7: Certified Screen Sharing
    console.log('\n[STAGE 7] Verifying Screen Sharing publication and reception...');
    await pageA.click('#toolbar-screen-share-btn');

    // Wait for screen share track publication on Alice
    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      if (!room) return false;
      const pubs = Array.from(room.localParticipant.trackPublications.values());
      return pubs.some((p) => p.source === 'screen_share' && !p.isMuted);
    }, { timeout: 15000 });

    // Wait for screen share stage and video on Bob
    await pageB.waitForSelector('#screenshare-video', { timeout: 15000 });
    const screenAttached = await pageB.evaluate(() => {
      const vid = document.querySelector('#screenshare-video');
      return Boolean(vid && vid.srcObject && vid.srcObject.getVideoTracks().length > 0);
    });
    assert.ok(screenAttached, 'Receiver must attach genuine screen share stream to #screenshare-video');
    console.log('  [ASSERT 7 PASS] Screen sharing published by host and attached on mobile receiver.');

    await pageB.screenshot({ path: path.join(artifactsDir, '05_screen_sharing_active.png') });

    // Stop screen share
    await pageA.click('#toolbar-screen-share-btn');
    await pageB.waitForFunction(() => !document.querySelector('#screenshare-video'), { timeout: 10000 });
    console.log('  ✓ Screen share stopped cleanly');

    console.log('\n========================================================================');
    console.log('  ALL P0 MASTER REPAIR VERIFICATIONS PASSED WITH 100% SUCCESS!          ');
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

if (process.argv[1] && process.argv[1].endsWith('p0_hotfix_media_verification.mjs')) {
  runP0MasterMediaVerification()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ FATAL TEST FAILURE:', err);
      process.exit(1);
    });
}

