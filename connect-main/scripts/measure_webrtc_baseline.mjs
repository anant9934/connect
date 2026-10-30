import puppeteer from 'puppeteer-core';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PC_HOOK_SCRIPT = `
  window.__webrtc_pcs = [];
  const OrigPC = window.RTCPeerConnection;
  window.RTCPeerConnection = function(...args) {
    const pc = new OrigPC(...args);
    window.__webrtc_pcs.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = OrigPC.prototype;
`;

async function collectStats(page) {
  return await page.evaluate(async () => {
    const pcs = window.__webrtc_pcs || [];
    const metrics = {
      outbound: [],
      inbound: [],
      candidatePair: null,
    };

    for (const pc of pcs) {
      if (pc.signalingState === 'closed') continue;
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === 'outbound-rtp') {
          metrics.outbound.push({
            kind: report.kind,
            bytesSent: report.bytesSent,
            packetsSent: report.packetsSent,
            framesEncoded: report.framesEncoded,
            frameWidth: report.frameWidth,
            frameHeight: report.frameHeight,
            framesPerSecond: report.framesPerSecond,
            nackCount: report.nackCount,
            pliCount: report.pliCount,
          });
        } else if (report.type === 'inbound-rtp') {
          metrics.inbound.push({
            kind: report.kind,
            bytesReceived: report.bytesReceived,
            packetsReceived: report.packetsReceived,
            packetsLost: report.packetsLost,
            jitter: report.jitter,
            framesDecoded: report.framesDecoded,
            framesDropped: report.framesDropped,
            frameWidth: report.frameWidth,
            frameHeight: report.frameHeight,
            framesPerSecond: report.framesPerSecond,
            freezeCount: report.freezeCount,
            totalFreezesDuration: report.totalFreezesDuration,
            jitterBufferDelay: report.jitterBufferDelay,
            jitterBufferEmittedCount: report.jitterBufferEmittedCount,
          });
        } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          metrics.candidatePair = {
            rtt: report.currentRoundTripTime,
            availableOutgoingBitrate: report.availableOutgoingBitrate,
            requestsSent: report.requestsSent,
            responsesReceived: report.responsesReceived,
          };
        }
      });
    }
    return metrics;
  });
}

async function run() {
  console.log('=== Measuring WebRTC Baseline via Puppeteer & LiveKit Cloud SFU ===');
  const browserArgs = [
    '--no-sandbox',
    '--disable-gpu',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ];

  const browserA = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: browserArgs,
    defaultViewport: { width: 1440, height: 900 },
  });

  const browserB = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: browserArgs,
    defaultViewport: { width: 1440, height: 900 },
  });

  try {
    const pageA = await browserA.newPage();
    const pageB = await browserB.newPage();

    await pageA.evaluateOnNewDocument(PC_HOOK_SCRIPT);
    await pageB.evaluateOnNewDocument(PC_HOOK_SCRIPT);

    // 1. Authenticate Host
    console.log('1. Host logging in...');
    await pageA.goto('http://localhost:3000/sign-in', { waitUntil: 'networkidle0' });
    await pageA.type('input[type="email"]', 'test_supabase@example.com');
    await pageA.type('input[type="password"]', 'StrongPassword123!');
    await pageA.click('button[type="submit"]');
    await sleep(2000);

    // 2. Create room
    console.log('2. Creating room...');
    const roomCode = await pageA.evaluate(async () => {
      const res = await fetch('/api/v1/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      return data.room?.publicCode;
    });
    console.log(`Room created: ${roomCode}`);

    // 3. Host joins room
    const t0 = Date.now();
    await pageA.goto(`http://localhost:3000/room/${roomCode}/preview`, { waitUntil: 'networkidle0' });
    await sleep(1500);

    const hostJoinBtns = await pageA.$$('button');
    for (const btn of hostJoinBtns) {
      const text = await pageA.evaluate((el) => el.textContent, btn);
      if (text && text.includes('Join')) {
        await btn.click();
        break;
      }
    }
    await sleep(3500);
    const hostConnectedTime = Date.now() - t0;
    console.log(`Host joined in ${hostConnectedTime}ms`);

    // 4. Guest joins room
    const t1 = Date.now();
    await pageB.goto(`http://localhost:3000/room/${roomCode}/preview`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const guestInput = await pageB.$('input');
    if (guestInput) {
      await guestInput.click({ clickCount: 3 });
      await guestInput.type('Guest Bob');
    }
    const guestJoinBtns = await pageB.$$('button');
    for (const btn of guestJoinBtns) {
      const text = await pageB.evaluate((el) => el.textContent, btn);
      if (text && text.includes('Join')) {
        await btn.click();
        break;
      }
    }
    await sleep(3500);
    const guestConnectedTime = Date.now() - t1;
    console.log(`Guest joined in ${guestConnectedTime}ms`);

    // Let media stream stabilize for 5 seconds
    console.log('Stabilizing media exchange for 5s...');
    await sleep(5000);

    // Sample stats at T_sample1
    const hostSample1 = await collectStats(pageA);
    const guestSample1 = await collectStats(pageB);

    await sleep(3000);

    // Sample stats at T_sample2 (delta over 3 seconds)
    const hostSample2 = await collectStats(pageA);
    const guestSample2 = await collectStats(pageB);

    console.log('\n--- HOST WebRTC SAMPLE ---');
    console.log('Outbound tracks:', JSON.stringify(hostSample2.outbound, null, 2));
    console.log('Inbound tracks (from Guest):', JSON.stringify(hostSample2.inbound, null, 2));
    console.log('Candidate Pair:', JSON.stringify(hostSample2.candidatePair, null, 2));

    console.log('\n--- GUEST WebRTC SAMPLE ---');
    console.log('Outbound tracks:', JSON.stringify(guestSample2.outbound, null, 2));
    console.log('Inbound tracks (from Host):', JSON.stringify(guestSample2.inbound, null, 2));
    console.log('Candidate Pair:', JSON.stringify(guestSample2.candidatePair, null, 2));

    // Calculate bitrates
    let hostOutAudioBps = 0;
    let hostOutVideoBps = 0;
    for (const t2 of hostSample2.outbound) {
      const t1 = hostSample1.outbound.find((x) => x.kind === t2.kind);
      if (t1) {
        const bps = ((t2.bytesSent - t1.bytesSent) * 8) / 3;
        if (t2.kind === 'audio') hostOutAudioBps = Math.round(bps);
        if (t2.kind === 'video') hostOutVideoBps = Math.round(bps);
      }
    }

    let guestInAudioBps = 0;
    let guestInVideoBps = 0;
    for (const t2 of guestSample2.inbound) {
      const t1 = guestSample1.inbound.find((x) => x.kind === t2.kind);
      if (t1) {
        const bps = ((t2.bytesReceived - t1.bytesReceived) * 8) / 3;
        if (t2.kind === 'audio') guestInAudioBps = Math.round(bps);
        if (t2.kind === 'video') guestInVideoBps = Math.round(bps);
      }
    }

    const baselineSummary = {
      callSetupMs: {
        host: hostConnectedTime,
        guest: guestConnectedTime,
      },
      rttMs: {
        host: hostSample2.candidatePair ? Math.round(hostSample2.candidatePair.rtt * 1000) : null,
        guest: guestSample2.candidatePair ? Math.round(guestSample2.candidatePair.rtt * 1000) : null,
      },
      hostPublished: {
        audioBps: hostOutAudioBps,
        videoBps: hostOutVideoBps,
        videoDims: hostSample2.outbound.filter((t) => t.kind === 'video').map((t) => `${t.frameWidth}x${t.frameHeight}@${t.framesPerSecond || 30}fps`),
      },
      guestReceived: {
        audioBps: guestInAudioBps,
        videoBps: guestInVideoBps,
        videoDims: guestSample2.inbound.filter((t) => t.kind === 'video').map((t) => `${t.frameWidth}x${t.frameHeight}@${t.framesPerSecond || 30}fps`),
        packetsLost: guestSample2.inbound.map((t) => ({ kind: t.kind, lost: t.packetsLost, jitterMs: Math.round((t.jitter || 0) * 1000) })),
        freezes: guestSample2.inbound.filter((t) => t.kind === 'video').map((t) => ({ freezeCount: t.freezeCount, framesDropped: t.framesDropped })),
      },
    };

    console.log('\n=== BASELINE METRICS SUMMARY ===');
    console.log(JSON.stringify(baselineSummary, null, 2));

  } finally {
    await browserA.close();
    await browserB.close();
  }
}

run().catch((err) => {
  console.error('Measurement failed:', err);
  process.exit(1);
});
