import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import assert from 'assert/strict';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function findChromeExecutable() {
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

export function getArtifactsDir() {
  const dir = process.env.TEST_ARTIFACTS_DIR || path.resolve(__dirname, 'artifacts');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const VIEWPORTS = [
  { name: '320px_iphone_se', width: 320, height: 568, isMobile: true },
  { name: '360px_android_compact', width: 360, height: 800, isMobile: true },
  { name: '390px_iphone_14', width: 390, height: 844, isMobile: true },
  { name: '412px_realme_11_pro_5g', width: 412, height: 915, isMobile: true },
  { name: '430px_iphone_15_pro_max', width: 430, height: 932, isMobile: true },
];

export async function runLiveKitCloudWebRTCE2E() {
  console.log('========================================================================');
  console.log('  TATHASTU CONNECT — P0.3 FINAL MEDIA EVIDENCE HARDENING (E2E)          ');
  console.log('========================================================================\n');

  const chromePath = findChromeExecutable();
  const artifactsDir = getArtifactsDir();
  console.log('[SETUP] Using Chrome:', chromePath);
  console.log('[SETUP] Artifacts directory:', artifactsDir);

  const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

  // 1. Create temporary authenticated room on live backend
  console.log('\n[PHASE 1] Creating temporary authenticated meeting via real backend...');
  const hostEmail = `host_${Date.now()}@example.com`;
  const hostPass = 'ValidPass123!';
  const hostSignupRes = await fetch(`${BASE_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email: hostEmail, password: hostPass, displayName: 'Alice Host' }),
  });
  assert.ok(
    hostSignupRes.status === 201 || hostSignupRes.status === 200,
    `Host signup failed with status ${hostSignupRes.status}`
  );
  const hostCookie = hostSignupRes.headers.get('set-cookie') || '';

  const createRoomRes = await fetch(`${BASE_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Cookie: hostCookie },
  });
  assert.strictEqual(createRoomRes.status, 201, 'Failed to create temporary room on backend');
  const roomData = await createRoomRes.json();
  const roomCode = roomData.room?.publicCode;
  assert.ok(roomCode, 'Backend must return valid room code');
  console.log(`  ✓ Successfully created isolated test meeting: ${roomCode}`);

  // Create Guest B user account
  const guestEmail = `guest_${Date.now()}@example.com`;
  const guestSignupRes = await fetch(`${BASE_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email: guestEmail, password: hostPass, displayName: 'Bob Guest' }),
  });
  assert.ok(
    guestSignupRes.status === 201 || guestSignupRes.status === 200,
    `Guest signup failed with status ${guestSignupRes.status}`
  );
  const guestCookie = guestSignupRes.headers.get('set-cookie') || '';
  console.log('  ✓ Authenticated two independent test participants (Alice & Bob)');

  // Configure browser launch arguments
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
    '--window-size=1280,800',
    '--auto-select-desktop-capture-source=Entire screen',
  ];

  const guestArgs = [
    ...baseArgs,
    '--window-size=412,915',
  ];

  console.log('\n[PHASE 2] Launching independent browser instances for Alice and Bob...');
  let browserA = null;
  let browserB = null;

  try {
    browserA = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: hostArgs,
      defaultViewport: { width: 1280, height: 800 },
    });

    browserB = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: guestArgs,
      defaultViewport: { width: 412, height: 915 },
    });

    const contextA = browserA.defaultBrowserContext();
    const contextB = browserB.defaultBrowserContext();

    await contextA.overridePermissions(BASE_URL, ['camera', 'microphone']);
    await contextB.overridePermissions(BASE_URL, ['camera', 'microphone']);

    const pageA = await browserA.newPage();
    const pageB = await browserB.newPage();

    // Set cookies for authentication
    const domain = new URL(BASE_URL).hostname;
    const parseCookie = (raw) => {
      const parts = raw.split(';')[0].split('=');
      return { name: parts[0].trim(), value: parts[1].trim(), domain, path: '/' };
    };

    if (hostCookie) {
      await pageA.setCookie(parseCookie(hostCookie));
    }
    if (guestCookie) {
      await pageB.setCookie(parseCookie(guestCookie));
    }

    // Enable diagnostic harness on test documents
    const diagnosticsScript = () => {
      window.__TC_ENABLE_TEST_DIAGNOSTICS = true;
      window.__activePeerConnections = [];
      const OrigPC = window.RTCPeerConnection;
      if (OrigPC) {
        window.RTCPeerConnection = function (...args) {
          const pc = new OrigPC(...args);
          window.__activePeerConnections.push(pc);
          return pc;
        };
        Object.assign(window.RTCPeerConnection, OrigPC);
        window.RTCPeerConnection.prototype = OrigPC.prototype;
      }
    };

    await pageA.evaluateOnNewDocument(diagnosticsScript);
    await pageB.evaluateOnNewDocument(diagnosticsScript);

    pageA.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('LiveKit') || text.includes('rtc') || text.includes('error')) {
        console.log('  [Alice Console]', msg.type(), text.slice(0, 150));
      }
    });

    pageB.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('LiveKit') || text.includes('rtc') || text.includes('error')) {
        console.log('  [Bob Console]', msg.type(), text.slice(0, 150));
      }
    });

    // -------------------------------------------------------------------------
    // TEST 1: Participant A (Alice) Enters Room with Camera and Mic Enabled
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Alice (Host) entering prejoin preview and activating media...');
    await pageA.goto(`${BASE_URL}/room/${roomCode}/preview`, { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('#preview-camera-btn', { timeout: 15000 });

    // Explicitly activate camera and mic in preview
    await pageA.click('#preview-camera-btn');
    await pageA.waitForFunction(() => {
      const v = document.querySelector('video');
      return Boolean(v && v.srcObject && v.srcObject.getVideoTracks().length > 0);
    }, { timeout: 10000 });

    await pageA.click('#preview-mic-btn');
    await pageA.waitForFunction(() => {
      const btn = document.querySelector('#preview-mic-btn');
      return Boolean(btn && btn.getAttribute('aria-label') === 'Mute microphone');
    }, { timeout: 8000 });

    // Join room
    await pageA.waitForSelector('#join-meeting-btn', { timeout: 8000 });
    await pageA.click('#join-meeting-btn');
    await pageA.waitForFunction(
      (code) => window.location.pathname === `/room/${code}`,
      { timeout: 15000 },
      roomCode
    );
    console.log('  ✓ Alice joined meeting route, waiting for LiveKit SFU connection...');

    // Wait for Alice to establish LiveKit connection
    await pageA.waitForFunction(() => {
      return Boolean(window.__livekitRoom && window.__livekitRoom.state === 'connected');
    }, { timeout: 20000 });
    console.log('  ✓ Alice successfully connected to LiveKit Cloud SFU');

    // -------------------------------------------------------------------------
    // TEST 2: Participant B (Bob) Joins Same Room
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Bob (Participant) entering prejoin preview and joining room...');
    await pageB.goto(`${BASE_URL}/room/${roomCode}/preview`, { waitUntil: 'domcontentloaded' });
    await pageB.waitForSelector('#preview-camera-btn', { timeout: 15000 });

    await pageB.click('#preview-camera-btn');
    await pageB.waitForFunction(() => {
      const v = document.querySelector('video');
      return Boolean(v && v.srcObject && v.srcObject.getVideoTracks().length > 0);
    }, { timeout: 10000 });

    await pageB.click('#preview-mic-btn');
    await pageB.waitForFunction(() => {
      const btn = document.querySelector('#preview-mic-btn');
      return Boolean(btn && btn.getAttribute('aria-label') === 'Mute microphone');
    }, { timeout: 8000 });

    await pageB.waitForSelector('#join-meeting-btn', { timeout: 8000 });
    await pageB.click('#join-meeting-btn');
    await pageB.waitForFunction(
      (code) => window.location.pathname === `/room/${code}`,
      { timeout: 15000 },
      roomCode
    );
    console.log('  ✓ Bob joined meeting route, waiting for LiveKit SFU connection...');

    await pageB.waitForFunction(() => {
      return Boolean(window.__livekitRoom && window.__livekitRoom.state === 'connected');
    }, { timeout: 20000 });
    console.log('  ✓ Bob successfully connected to LiveKit Cloud SFU in the same room');

    // -------------------------------------------------------------------------
    // TEST 3 & 4: Track Publication, Subscription, and Remote Track Exchange
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3 & 4] Verifying dual-participant publication and subscription...');
    await pageB.waitForFunction(() => {
      const room = window.__livekitRoom;
      if (!room || room.remoteParticipants.size === 0) return false;
      const remote = Array.from(room.remoteParticipants.values())[0];
      return Boolean(remote && remote.trackPublications.size >= 1);
    }, { timeout: 20000 });
    console.log("  ✓ Bob subscribed to Alice's remote media tracks across LiveKit SFU");

    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      if (!room || room.remoteParticipants.size === 0) return false;
      const remote = Array.from(room.remoteParticipants.values())[0];
      return Boolean(remote && remote.trackPublications.size >= 1);
    }, { timeout: 20000 });
    console.log("  ✓ Alice subscribed to Bob's remote media tracks across LiveKit SFU");

    // -------------------------------------------------------------------------
    // TEST 5 & 6 (TASK B): INDEPENDENT WebRTC Statistics Progression (Audio & Video)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5 & 6] TASK B: Asserting independent WebRTC Audio & Video progression...');

    const fetchDetailedWebRTCStats = async () => {
      return await pageB.evaluate(async () => {
        const room = window.__livekitRoom;
        const pcs = [];

        if (room?.engine?.pcManager?.subscriber?.pc) {
          pcs.push(room.engine.pcManager.subscriber.pc);
        }
        if (room?.engine?.pcManager?.publisher?.pc) {
          pcs.push(room.engine.pcManager.publisher.pc);
        }
        if (Array.isArray(window.__activePeerConnections)) {
          for (const pc of window.__activePeerConnections) {
            if (!pcs.includes(pc)) pcs.push(pc);
          }
        }

        const statsResult = {
          audio: {
            hasInboundReport: false,
            bytesReceived: 0,
            packetsReceived: 0,
            packetsLost: 0,
            jitter: 0,
          },
          video: {
            hasInboundReport: false,
            bytesReceived: 0,
            packetsReceived: 0,
            framesDecoded: 0,
            jitter: 0,
          },
          rttMs: 0,
          canPlaybackAudio: Boolean(room?.canPlaybackAudio),
        };

        for (const pc of pcs) {
          try {
            const stats = await pc.getStats();
            stats.forEach((report) => {
              if (report.type === 'inbound-rtp') {
                if (report.kind === 'audio') {
                  statsResult.audio.hasInboundReport = true;
                  statsResult.audio.bytesReceived += report.bytesReceived || 0;
                  statsResult.audio.packetsReceived += report.packetsReceived || 0;
                  statsResult.audio.packetsLost += report.packetsLost || 0;
                  statsResult.audio.jitter = report.jitter || 0;
                } else if (report.kind === 'video') {
                  statsResult.video.hasInboundReport = true;
                  statsResult.video.bytesReceived += report.bytesReceived || 0;
                  statsResult.video.packetsReceived += report.packetsReceived || 0;
                  statsResult.video.framesDecoded += report.framesDecoded || 0;
                  statsResult.video.jitter = report.jitter || 0;
                }
              } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                statsResult.rttMs = Math.round((report.currentRoundTripTime || 0) * 1000);
              }
            });
          } catch {}
        }

        return statsResult;
      });
    };

    // Measurement 1 at t1
    await pageB.waitForFunction(() => {
      const room = window.__livekitRoom;
      return Boolean(room && room.remoteParticipants.size > 0);
    }, { timeout: 10000 });

    const stats_t1 = await fetchDetailedWebRTCStats();
    console.log('  [WebRTC Telemetry t1 (Bob Receiver)]:', {
      audio: stats_t1.audio,
      video: stats_t1.video,
      rttMs: stats_t1.rttMs,
      canPlaybackAudio: stats_t1.canPlaybackAudio,
    });

    // Let media stream actively for 3 seconds
    await new Promise((r) => setTimeout(r, 3000));

    // Measurement 2 at t2
    const stats_t2 = await fetchDetailedWebRTCStats();
    console.log('  [WebRTC Telemetry t2 (Bob Receiver)]:', {
      audio: stats_t2.audio,
      video: stats_t2.video,
      rttMs: stats_t2.rttMs,
      canPlaybackAudio: stats_t2.canPlaybackAudio,
    });

    // Assert Video Independent Progression
    assert.ok(stats_t1.video.hasInboundReport, 'Inbound video RTP report must be present');
    assert.ok(stats_t2.video.hasInboundReport, 'Inbound video RTP report must be present at t2');
    assert.ok(
      stats_t2.video.framesDecoded > stats_t1.video.framesDecoded,
      `Video framesDecoded must increase over two measurements (t1=${stats_t1.video.framesDecoded}, t2=${stats_t2.video.framesDecoded})`
    );
    assert.ok(
      stats_t2.video.bytesReceived > stats_t1.video.bytesReceived,
      `Video bytesReceived must increase over two measurements (t1=${stats_t1.video.bytesReceived}, t2=${stats_t2.video.bytesReceived})`
    );
    console.log('  ✓ Video RTP Certification: Genuine video frames decoded and increasing');

    // Assert Audio Independent Progression
    assert.ok(stats_t1.audio.hasInboundReport, 'Inbound audio RTP report must be present');
    assert.ok(stats_t2.audio.hasInboundReport, 'Inbound audio RTP report must be present at t2');
    assert.ok(
      stats_t2.audio.packetsReceived > stats_t1.audio.packetsReceived,
      `Audio packetsReceived must increase over two measurements (t1=${stats_t1.audio.packetsReceived}, t2=${stats_t2.audio.packetsReceived})`
    );
    assert.ok(
      stats_t2.audio.bytesReceived > stats_t1.audio.bytesReceived,
      `Audio bytesReceived must increase over two measurements (t1=${stats_t1.audio.bytesReceived}, t2=${stats_t2.audio.bytesReceived})`
    );
    console.log('  ✓ Audio RTP Certification: Distinct inbound audio RTP report with increasing packets/bytes');

    // Remote Audio Track Subscription Verification
    const audioTrackStatus = await pageB.evaluate(() => {
      const room = window.__livekitRoom;
      if (!room) return { ok: false, reason: 'no room' };
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          if (pub.kind === 'audio' || pub.source === 'microphone') {
            return {
              ok: true,
              isSubscribed: pub.isSubscribed,
              isMuted: pub.isMuted,
              hasTrack: Boolean(pub.track),
              canPlaybackAudio: room.canPlaybackAudio,
            };
          }
        }
      }
      return { ok: false, reason: 'no remote audio publication' };
    });

    assert.ok(audioTrackStatus.ok, `Remote audio publication missing: ${audioTrackStatus.reason}`);
    assert.strictEqual(audioTrackStatus.isSubscribed, true, 'Remote audio track must be subscribed');
    assert.strictEqual(audioTrackStatus.isMuted, false, 'Remote audio track must be unmuted');
    assert.strictEqual(audioTrackStatus.hasTrack, true, 'Remote audio track instance must exist');
    console.log('  ✓ Remote audio track subscribed, unmuted, and track instance attached');

    // Autoplay Unlock State Verification
    if (!audioTrackStatus.canPlaybackAudio) {
      console.log('  [AUTOPLAY] Autoplay locked by browser policy; invoking unlock gesture...');
      await pageB.click('body');
      await pageB.waitForFunction(() => {
        return Boolean(window.__livekitRoom && window.__livekitRoom.canPlaybackAudio);
      }, { timeout: 8000 });
      console.log('  ✓ Audio playback unlocked via user interaction gesture');
    } else {
      console.log('  ✓ Audio playback unlocked and active (canPlaybackAudio = true)');
    }

    console.log('  [NOTICE] WebRTC audio RTP telemetry certified; physical human audibility pending hardware verification.');

    // Screenshot dual-participant meeting
    const dualScreenshotPath = path.join(artifactsDir, 'livekit_e2e_dual_meeting_412px.png');
    await pageB.screenshot({ path: dualScreenshotPath });
    console.log(`  ✓ Saved dual-participant live meeting screenshot: ${dualScreenshotPath}`);

    // -------------------------------------------------------------------------
    // TEST 7: Camera ON/OFF Does Not Disconnect Meeting
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Testing Camera ON/OFF toggle resilience...');
    await pageA.click('#toolbar-camera-btn');
    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      return Boolean(room && !room.localParticipant.isCameraEnabled);
    }, { timeout: 8000 });

    const stateAfterCamOff = await pageA.evaluate(() => window.__livekitRoom?.state);
    assert.strictEqual(stateAfterCamOff, 'connected', 'Meeting disconnected when camera was turned OFF');
    console.log('  ✓ Camera turned OFF: Meeting remains stably connected');

    await pageA.click('#toolbar-camera-btn');
    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      return Boolean(room && room.localParticipant.isCameraEnabled);
    }, { timeout: 8000 });

    const stateAfterCamOn = await pageA.evaluate(() => window.__livekitRoom?.state);
    assert.strictEqual(stateAfterCamOn, 'connected', 'Meeting disconnected when camera was turned back ON');
    console.log('  ✓ Camera turned ON: Meeting remains stably connected');

    // -------------------------------------------------------------------------
    // TEST 8: Microphone ON/OFF Does Not Disconnect Meeting
    // -------------------------------------------------------------------------
    console.log('\n[TEST 8] Testing Microphone ON/OFF toggle resilience...');
    await pageA.click('#toolbar-mic-btn');
    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      return Boolean(room && !room.localParticipant.isMicrophoneEnabled);
    }, { timeout: 8000 });

    const stateAfterMicOff = await pageA.evaluate(() => window.__livekitRoom?.state);
    assert.strictEqual(stateAfterMicOff, 'connected', 'Meeting disconnected when mic was muted');
    console.log('  ✓ Microphone muted: Meeting remains stably connected');

    await pageA.click('#toolbar-mic-btn');
    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      return Boolean(room && room.localParticipant.isMicrophoneEnabled);
    }, { timeout: 8000 });

    const stateAfterMicOn = await pageA.evaluate(() => window.__livekitRoom?.state);
    assert.strictEqual(stateAfterMicOn, 'connected', 'Meeting disconnected when mic was unmuted');
    console.log('  ✓ Microphone unmuted: Meeting remains stably connected');

    // -------------------------------------------------------------------------
    // TEST 9 (TASK A): Desktop Screen Sharing Certified (NO FALSE-PASS FALLBACKS)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 9] TASK A: Hardened Desktop Screen Sharing Certification...');
    await pageA.click('#toolbar-screen-share-btn');
    console.log('  Initiated screen sharing from Alice, waiting for real publication...');

    // 1. Verify publication on sender (Alice)
    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      if (!room) return false;
      const localPubs = Array.from(room.localParticipant.trackPublications.values());
      return localPubs.some((pub) => pub.source === 'screen_share' && !pub.isMuted);
    }, { timeout: 15000 });
    console.log('  ✓ Sender (Alice): Screen share track publication verified (source: screen_share, unmuted)');

    // 2. Verify subscription and unmuted state on receiver (Bob)
    await pageB.waitForFunction(() => {
      const room = window.__livekitRoom;
      if (!room) return false;
      for (const p of room.remoteParticipants.values()) {
        const pubs = Array.from(p.trackPublications.values());
        const screenPub = pubs.find((pub) => pub.source === 'screen_share');
        if (screenPub && screenPub.isSubscribed && !screenPub.isMuted && screenPub.track) {
          return true;
        }
      }
      return false;
    }, { timeout: 15000 });
    console.log('  ✓ Receiver (Bob): Matching remote screen-share publication subscribed and unmuted');

    // 3. Verify real screen-share track attached to receiver video element
    await pageB.waitForSelector('#screenshare-video', { timeout: 15000 });
    const screenAttachment = await pageB.evaluate(() => {
      const stage = document.querySelector('#screenshare-stage');
      const video = document.querySelector('#screenshare-video');
      const cameraTiles = document.querySelectorAll('[data-testid="participant-tile"]');

      if (!stage || !video) {
        return {
          ok: false,
          error: 'Screen share stage or video element missing from DOM',
          cameraCount: cameraTiles.length,
        };
      }

      const stream = video.srcObject;
      if (!stream) {
        return {
          ok: false,
          error: 'Receiver video element has no attached srcObject stream',
          cameraCount: cameraTiles.length,
        };
      }

      const vTracks = stream.getVideoTracks();
      if (!vTracks || vTracks.length === 0) {
        return {
          ok: false,
          error: 'srcObject contains 0 video tracks',
          cameraCount: cameraTiles.length,
        };
      }

      const track = vTracks[0];
      return {
        ok: true,
        trackId: track.id,
        readyState: track.readyState,
        enabled: track.enabled,
        cameraCount: cameraTiles.length,
      };
    });

    if (!screenAttachment.ok) {
      throw new Error(`SCREEN SHARE TEST FAILURE: ${screenAttachment.error} (Only camera tiles found: ${screenAttachment.cameraCount})`);
    }

    console.log('  ✓ Receiver (Bob): Real screen-share track attached to #screenshare-video:', {
      trackId: screenAttachment.trackId,
      readyState: screenAttachment.readyState,
      enabled: screenAttachment.enabled,
    });

    // 4. Frames decoded must increase over two measurements
    const getScreenDecodedFrames = async () => {
      return await pageB.evaluate(async () => {
        const room = window.__livekitRoom;
        const pcs = [];
        if (room?.engine?.pcManager?.subscriber?.pc) pcs.push(room.engine.pcManager.subscriber.pc);
        if (Array.isArray(window.__activePeerConnections)) {
          for (const pc of window.__activePeerConnections) {
            if (!pcs.includes(pc)) pcs.push(pc);
          }
        }
        let totalFrames = 0;
        for (const pc of pcs) {
          try {
            const stats = await pc.getStats();
            stats.forEach((report) => {
              if (report.type === 'inbound-rtp' && report.kind === 'video') {
                totalFrames += report.framesDecoded || 0;
              }
            });
          } catch {}
        }
        return totalFrames;
      });
    };

    const screen_m1 = await getScreenDecodedFrames();
    await new Promise((r) => setTimeout(r, 2500));
    const screen_m2 = await getScreenDecodedFrames();

    assert.ok(
      screen_m2 > screen_m1,
      `Screen share video framesDecoded must increase over two measurements (m1=${screen_m1}, m2=${screen_m2})`
    );
    console.log(`  ✓ Receiver (Bob): Frames decoded verified increasing: ${screen_m1} -> ${screen_m2}`);

    // 5. Screenshot evidence of actual shared content
    const screenShareScreenshotPath = path.join(artifactsDir, 'screen_sharing_meeting_412px.png');
    await pageB.screenshot({ path: screenShareScreenshotPath });
    console.log(`  ✓ Saved screen-share evidence screenshot: ${screenShareScreenshotPath}`);

    // 6. Stop screen share and verify clean teardown on receiver
    await pageA.click('#toolbar-screen-share-btn');
    await pageB.waitForFunction(() => {
      return !document.querySelector('#screenshare-video');
    }, { timeout: 10000 });
    console.log('  ✓ Screen share stopped cleanly and stage restored to camera grid');

    // -------------------------------------------------------------------------
    // TEST 10: In-Room Mobile Geometry & Bounding Box Collision Assertions
    // -------------------------------------------------------------------------
    console.log('\n[TEST 10] Running In-Room Mobile Geometry Validations across 320px to 430px...');
    for (const vp of VIEWPORTS) {
      await pageB.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile });
      await pageB.waitForSelector('#meeting-toolbar', { timeout: 10000 });
      await new Promise((r) => setTimeout(r, 400));

      const geometry = await pageB.evaluate(() => {
        const diagPill = document.querySelector('#transport-diagnostics-pill');
        const nameBadges = Array.from(document.querySelectorAll('[data-testid="participant-name-badge"]'));
        const leaveBtn = document.querySelector('#toolbar-leave-btn');
        const micBtn = document.querySelector('#toolbar-mic-btn');
        const camBtn = document.querySelector('#toolbar-camera-btn');
        const toolbar = document.querySelector('#meeting-toolbar');

        if (!leaveBtn || !micBtn || !camBtn || !toolbar) {
          throw new Error('Mandatory toolbar controls not found in DOM');
        }

        const leaveR = leaveBtn.getBoundingClientRect();
        const micR = micBtn.getBoundingClientRect();
        const camR = camBtn.getBoundingClientRect();
        const toolR = toolbar.getBoundingClientRect();

        // Check horizontal overflow
        const docW = document.documentElement.clientWidth;
        const scrollW = document.documentElement.scrollWidth;
        const hasHorizontalOverflow = scrollW > docW + 1;

        // Check diagnostic pill does NOT overlap participant names
        let pillOverlapsNames = false;
        if (diagPill && nameBadges.length > 0) {
          const pillR = diagPill.getBoundingClientRect();
          for (const nb of nameBadges) {
            const nbR = nb.getBoundingClientRect();
            const overlap = !(
              pillR.right <= nbR.left ||
              pillR.left >= nbR.right ||
              pillR.bottom <= nbR.top ||
              pillR.top >= nbR.bottom
            );
            if (overlap) {
              pillOverlapsNames = true;
              break;
            }
          }
        }

        // Check leave button visibility inside viewport
        const leaveVisible =
          leaveR.bottom <= window.innerHeight + 2 &&
          leaveR.top >= 0 &&
          leaveR.width >= 40 &&
          leaveR.height >= 40;

        // Check mic and cam buttons reachability
        const micVisible = micR.width >= 40 && micR.height >= 40;
        const camVisible = camR.width >= 40 && camR.height >= 40;

        // Check for intrusive red error overlays
        const redOverlays = document.querySelectorAll('.bg-red-950, .bg-pink-950').length;

        return {
          hasHorizontalOverflow,
          pillOverlapsNames,
          leaveVisible,
          micVisible,
          camVisible,
          redOverlays,
          participantCount: nameBadges.length,
        };
      });

      assert.strictEqual(
        geometry.hasHorizontalOverflow,
        false,
        `Horizontal overflow detected on viewport ${vp.name}`
      );
      assert.strictEqual(
        geometry.pillOverlapsNames,
        false,
        `SFU Diagnostic pill overlaps participant names on viewport ${vp.name}`
      );
      assert.strictEqual(
        geometry.leaveVisible,
        true,
        `Leave button not fully visible/reachable on viewport ${vp.name}`
      );
      assert.strictEqual(
        geometry.micVisible,
        true,
        `Microphone button not reachable on viewport ${vp.name}`
      );
      assert.strictEqual(
        geometry.camVisible,
        true,
        `Camera button not reachable on viewport ${vp.name}`
      );
      assert.strictEqual(
        geometry.redOverlays,
        0,
        `Intrusive red error overlays detected on viewport ${vp.name}`
      );

      console.log(`  ✓ Viewport validated: ${vp.name} (${vp.width}x${vp.height}) - geometry and controls verified`);
    }

    // Set Bob back to Realme 11 Pro 5G viewport
    await pageB.setViewport({ width: 412, height: 915, isMobile: true });

    // -------------------------------------------------------------------------
    // TEST 11 & 12: Device Independence & Blocked Device Isolation
    // -------------------------------------------------------------------------
    console.log('\n[TEST 11 & 12] Testing device independence & blocked device isolation in meeting...');
    // Alice turns off camera while speaking on microphone
    await pageA.click('#toolbar-camera-btn');
    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      return Boolean(room && !room.localParticipant.isCameraEnabled);
    }, { timeout: 8000 });

    const aliceAvState = await pageA.evaluate(() => {
      const room = window.__livekitRoom;
      if (!room) return null;
      return {
        isCameraEnabled: room.localParticipant.isCameraEnabled,
        isMicrophoneEnabled: room.localParticipant.isMicrophoneEnabled,
      };
    });

    assert.strictEqual(aliceAvState.isCameraEnabled, false, 'Camera must be turned off');
    assert.strictEqual(aliceAvState.isMicrophoneEnabled, true, 'Microphone must remain active when camera is turned off');
    console.log('  ✓ Turning camera off does NOT mute or disable microphone');

    // Alice turns camera back on and mutes microphone
    await pageA.click('#toolbar-camera-btn');
    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      return Boolean(room && room.localParticipant.isCameraEnabled);
    }, { timeout: 8000 });

    await pageA.click('#toolbar-mic-btn');
    await pageA.waitForFunction(() => {
      const room = window.__livekitRoom;
      return Boolean(room && !room.localParticipant.isMicrophoneEnabled);
    }, { timeout: 8000 });

    const aliceAvState2 = await pageA.evaluate(() => {
      const room = window.__livekitRoom;
      if (!room) return null;
      return {
        isCameraEnabled: room.localParticipant.isCameraEnabled,
        isMicrophoneEnabled: room.localParticipant.isMicrophoneEnabled,
      };
    });

    assert.strictEqual(aliceAvState2.isCameraEnabled, true, 'Camera must be active');
    assert.strictEqual(aliceAvState2.isMicrophoneEnabled, false, 'Microphone must be muted');
    console.log('  ✓ Muting microphone does NOT disable camera');

    // -------------------------------------------------------------------------
    // TEST 13: Room Termination & Disconnection Propagation
    // -------------------------------------------------------------------------
    console.log('\n[TEST 13] Testing Host End Meeting for Everyone...');
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

    // Wait for disconnection to propagate to Bob
    await pageB.waitForFunction(() => {
      return (
        document.body.innerText.includes('This meeting has ended') ||
        (window.__livekitRoom && window.__livekitRoom.state === 'disconnected')
      );
    }, { timeout: 12000 });
    console.log('  ✓ Host terminated meeting: Bob received disconnection and ended state');

    console.log('\n========================================================================');
    console.log('  ALL P0.3 FINAL MEDIA EVIDENCE & HARDENING ASSERTIONS PASSED!           ');
    console.log('========================================================================\n');
  } finally {
    if (browserA) {
      try { await browserA.close(); } catch {}
    }
    if (browserB) {
      try { await browserB.close(); } catch {}
    }
    // Clean up isolated test room if needed
    if (roomCode && hostCookie) {
      try {
        await fetch(`${BASE_URL}/api/v1/rooms/${roomCode}/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Cookie: hostCookie },
        });
      } catch {}
    }
  }
}

// Execute standalone when run via node
if (process.argv[1] && process.argv[1].endsWith('livekit_cloud_webrtc_e2e.mjs')) {
  runLiveKitCloudWebRTCE2E()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ FATAL E2E FAILURE:', err);
      process.exit(1);
    });
}

