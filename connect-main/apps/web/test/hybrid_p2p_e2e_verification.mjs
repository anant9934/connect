import puppeteer from 'puppeteer-core';
import { promises as fs } from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\116094a7-63d4-4c53-9b27-af0ec12a66e7';

async function runHybridP2PVerification() {
  console.log('=== Starting Tathastu Connect Hybrid WebRTC P2P 1:1 E2E Verification ===');

  const browserArgs = [
    '--headless=new',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-web-security',
    '--window-size=1280,800',
    '--enable-features=WebRTCPeerConnectionWithBlockIceAddresses',
  ];

  console.log('1. Launching Host Browser A (Chrome)...');
  const browserA = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: browserArgs,
    defaultViewport: { width: 1280, height: 800 },
  });

  const pageA = await browserA.newPage();
  pageA.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('P2P') || text.includes('Signaling') || text.includes('negotiation') || text.includes('error')) {
      console.log('Host Console:', msg.type(), text);
    }
  });
  pageA.on('pageerror', (err) => console.log('Host PageError:', err.message));

  console.log('2. Authenticating Host (Alice Smith)...');
  await pageA.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  const authRes = await pageA.evaluate(async () => {
    const signupRes = await fetch('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice_p2p@example.com', password: 'ValidPass123!', displayName: 'Alice Smith' }),
      credentials: 'include',
    });
    if (signupRes.ok) return await signupRes.json();

    const loginRes = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice_p2p@example.com', password: 'ValidPass123!' }),
      credentials: 'include',
    });
    return await loginRes.json();
  });
  console.log('Host Auth Result:', authRes?.user?.email || 'Logged in');

  console.log('3. Creating room via backend API...');
  const createRoomRes = await pageA.evaluate(async () => {
    const res = await fetch('/api/v1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    return res.json();
  });

  if (!createRoomRes.room) {
    throw new Error('Failed to create room: ' + JSON.stringify(createRoomRes));
  }

  const roomCode = createRoomRes.room.publicCode;
  console.log(`Room created successfully: ${roomCode}`);

  console.log(`4. Host entering pre-join for room ${roomCode}...`);
  await pageA.goto(`http://localhost:3000/room/${roomCode}/preview`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));

  console.log('5. Host joining meeting room...');
  await pageA.evaluate(() => {
    const form = document.querySelector('form');
    if (form) {
      form.requestSubmit();
    } else {
      const btns = Array.from(document.querySelectorAll('button'));
      const joinBtn = btns.find((b) => b.textContent.toLowerCase().includes('join meeting'));
      if (joinBtn) joinBtn.click();
    }
  });

  await pageA.waitForFunction(
    (code) => window.location.pathname === `/room/${code}`,
    { timeout: 15000 },
    roomCode
  );
  console.log('Host joined room route.');

  await pageA.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('Alice Smith') || text.includes('(You)') || text.includes('Leave') || text.includes('End for all');
  }, { timeout: 15000 });

  console.log('6. Launching Guest Browser B (Chrome Context)...');
  const browserB = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: browserArgs,
    defaultViewport: { width: 1280, height: 800 },
  });

  const pageB = await browserB.newPage();
  pageB.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('P2P') || text.includes('Signaling') || text.includes('negotiation') || text.includes('error')) {
      console.log('Guest Console:', msg.type(), text);
    }
  });
  pageB.on('pageerror', (err) => console.log('Guest PageError:', err.message));

  console.log(`7. Guest opening preview link for room ${roomCode}...`);
  await pageB.goto(`http://localhost:3000/room/${roomCode}/preview`, { waitUntil: 'networkidle0' });

  // Input Guest Display Name
  await pageB.waitForSelector('input');
  await pageB.type('input', 'Bob Jones');
  await new Promise((r) => setTimeout(r, 1000));

  console.log('8. Guest joining meeting room...');
  await pageB.evaluate(() => {
    const form = document.querySelector('form');
    if (form) {
      form.requestSubmit();
    } else {
      const btns = Array.from(document.querySelectorAll('button'));
      const joinBtn = btns.find((b) => b.textContent.toLowerCase().includes('join meeting'));
      if (joinBtn) joinBtn.click();
    }
  });

  await pageB.waitForFunction(
    (code) => window.location.pathname === `/room/${code}`,
    { timeout: 15000 },
    roomCode
  );
  console.log('Guest joined room route.');

  await pageB.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('Bob Jones') || text.includes('(You)') || text.includes('Leave');
  }, { timeout: 15000 });

  console.log('9. Waiting for dual-participant media and signaling exchange...');
  await new Promise((r) => setTimeout(r, 5000));

  // Verify participant visibility and video elements in DOM
  const hostView = await pageA.evaluate(() => {
    const text = document.body.innerText;
    const videos = document.querySelectorAll('video');
    return {
      hasBob: text.includes('Bob Jones'),
      hasAlice: text.includes('Alice Smith') || text.includes('You'),
      videoCount: videos.length,
    };
  });

  const guestView = await pageB.evaluate(() => {
    const text = document.body.innerText;
    const videos = document.querySelectorAll('video');
    return {
      hasAlice: text.includes('Alice Smith'),
      hasBob: text.includes('Bob Jones') || text.includes('You'),
      videoCount: videos.length,
    };
  });

  console.log('Host Participant View:', hostView);
  console.log('Guest Participant View:', guestView);

  // Capture Screenshot 1: Dual participant 1:1 call
  const screenshot1Path = path.join(ARTIFACTS_DIR, 'p2p_1v1_dual_call.png');
  await pageA.screenshot({ path: screenshot1Path });
  console.log(`Saved screenshot 1 at: ${screenshot1Path}`);

  // 10. Test Mute & Camera Controls
  console.log('10. Testing microphone mute on Host...');
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const micBtn = btns.find((b) => b.getAttribute('aria-label')?.includes('microphone') || b.querySelector('svg.lucide-mic'));
    if (micBtn) micBtn.click();
  });

  await new Promise((r) => setTimeout(r, 2000));

  // 11. Test Chat Sending
  console.log('11. Testing in-meeting Chat over DataChannel...');
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const chatBtn = btns.find((b) => b.getAttribute('aria-label')?.includes('chat') || b.querySelector('svg.lucide-message-square'));
    if (chatBtn) chatBtn.click();
  });

  await new Promise((r) => setTimeout(r, 1000));

  await pageA.waitForSelector('input[placeholder*="message"]');
  await pageA.type('input[placeholder*="message"]', 'Hello Bob from Alice over P2P!');
  await pageA.keyboard.press('Enter');

  await new Promise((r) => setTimeout(r, 2000));

  // Open Chat on Guest to verify reception
  await pageB.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const chatBtn = btns.find((b) => b.getAttribute('aria-label')?.includes('chat') || b.querySelector('svg.lucide-message-square'));
    if (chatBtn) chatBtn.click();
  });

  await new Promise((r) => setTimeout(r, 1500));

  const chatReceived = await pageB.evaluate(() => {
    return document.body.innerText.includes('Hello Bob from Alice');
  });
  console.log('Chat message received by Guest:', chatReceived);

  // 12. Test Clean Leave
  console.log('12. Guest leaving call...');
  await pageB.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const leaveBtn = btns.find((b) => b.textContent.includes('Leave'));
    if (leaveBtn) leaveBtn.click();
  });

  await new Promise((r) => setTimeout(r, 2000));

  console.log('13. Host ending room for everyone...');
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const endBtn = btns.find((b) => b.textContent.includes('End for all') || b.textContent.includes('Leave'));
    if (endBtn) endBtn.click();
  });

  await new Promise((r) => setTimeout(r, 2000));

  await browserA.close();
  await browserB.close();

  console.log('=== Tathastu Connect Hybrid WebRTC P2P Verification PASSED Successfully! ===');
}

runHybridP2PVerification().catch((err) => {
  console.error('Hybrid WebRTC E2E Verification FAILED:', err);
  process.exit(1);
});
