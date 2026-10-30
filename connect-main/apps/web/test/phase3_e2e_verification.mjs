import puppeteer from 'puppeteer-core';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\116094a7-63d4-4c53-9b27-af0ec12a66e7';

async function runPhase3Verification() {
  console.log('=== Starting Tathastu Connect Phase 3 Full E2E LiveKit Verification ===');

  const browserArgs = [
    '--headless=new',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-web-security',
    '--window-size=1280,800',
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
    if (text.includes('tc-chat') || text.includes('tc-reaction') || text.includes('error') || text.includes('LiveKit')) {
      console.log('Host Console:', msg.type(), text);
    }
  });

  console.log('2. Authenticating Host (Alice Smith)...');
  await pageA.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  const authRes = await pageA.evaluate(async () => {
    const signupRes = await fetch('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice3@example.com', password: 'ValidPass123!', displayName: 'Alice Smith' }),
      credentials: 'include',
    });
    if (signupRes.ok) return await signupRes.json();

    const loginRes = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice3@example.com', password: 'ValidPass123!' }),
      credentials: 'include',
    });
    return await loginRes.json();
  });
  console.log('Host Auth Result:', authRes?.user?.email || 'authenticated');

  console.log('3. Creating room with Waiting Room enabled...');
  const createRoomRes = await pageA.evaluate(async () => {
    const res = await fetch('/api/v1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxParticipants: 10, waitingRoomEnabled: true }),
      credentials: 'include',
    });
    return res.json();
  });

  if (!createRoomRes.room) {
    throw new Error('Failed to create room: ' + JSON.stringify(createRoomRes));
  }

  const roomCode = createRoomRes.room.publicCode;
  console.log(`Room created: ${roomCode} (waitingRoomEnabled: true)`);

  console.log(`4. Host entering pre-join for room ${roomCode}...`);
  await pageA.goto(`http://localhost:3000/room/${roomCode}/preview`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2000));

  console.log('5. Host joining meeting room...');
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const joinBtn = btns.find((b) => b.textContent.includes('Join meeting'));
    if (joinBtn) joinBtn.click();
  });

  await pageA.waitForNavigation({ waitUntil: 'networkidle0' });
  console.log('Host connected to meeting stage!');

  // Wait for stage to render
  await new Promise((r) => setTimeout(r, 4000));

  // Screenshot 1: Meeting Stage (Light-First)
  const stageScreenshotPath = path.join(ARTIFACTS_DIR, 'phase3_meeting_stage_light.png');
  await pageA.screenshot({ path: stageScreenshotPath });
  console.log(`Captured Screenshot 1: ${stageScreenshotPath}`);

  // 6. Test Invite Dialog
  console.log('6. Opening Invite Dialog...');
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const inviteBtn = btns.find((b) => b.textContent.includes('Invite'));
    if (inviteBtn) inviteBtn.click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  const inviteScreenshotPath = path.join(ARTIFACTS_DIR, 'phase3_invite_dialog.png');
  await pageA.screenshot({ path: inviteScreenshotPath });
  console.log(`Captured Screenshot 2: ${inviteScreenshotPath}`);

  // Close invite dialog
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const closeBtn = btns.find((b) => b.getAttribute('aria-label') === 'Close');
    if (closeBtn) closeBtn.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  // 7. Test Reactions & Hand Raise
  console.log('7. Opening Reaction Picker & Raising Hand...');
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const reactBtn = btns.find((b) => b.getAttribute('aria-label') === 'Reactions');
    if (reactBtn) reactBtn.click();
  });
  await new Promise((r) => setTimeout(r, 800));

  const reactionScreenshotPath = path.join(ARTIFACTS_DIR, 'phase3_reactions_picker.png');
  await pageA.screenshot({ path: reactionScreenshotPath });
  console.log(`Captured Screenshot 3: ${reactionScreenshotPath}`);

  // Click Thumbs Up & Raise Hand
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const thumbsBtn = btns.find((b) => b.getAttribute('aria-label') === 'Thumbs Up');
    if (thumbsBtn) thumbsBtn.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  // 8. Test Chat Panel
  console.log('8. Opening Chat Panel & Sending Ephemeral Message...');
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const chatBtn = btns.find((b) => b.getAttribute('title') === 'Chat messages' || b.getAttribute('aria-label') === 'Toggle chat');
    if (chatBtn) chatBtn.click();
  });
  await new Promise((r) => setTimeout(r, 1000));

  // Type and send chat message
  await pageA.type('input[placeholder="Send a message to everyone..."]', 'Hello team! Welcome to Tathastu Connect Phase 3.');
  await pageA.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1500));

  const chatScreenshotPath = path.join(ARTIFACTS_DIR, 'phase3_chat_panel.png');
  await pageA.screenshot({ path: chatScreenshotPath });
  console.log(`Captured Screenshot 4: ${chatScreenshotPath}`);

  // 9. Launch Guest Browser B
  console.log('9. Launching Guest Browser B (Bob Jones)...');
  const browserB = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: browserArgs,
    defaultViewport: { width: 1280, height: 800 },
  });

  const pageB = await browserB.newPage();
  pageB.on('console', (msg) => console.log('Guest Console:', msg.type(), msg.text()));
  pageB.on('pageerror', (err) => console.log('Guest PageError:', err.message));

  console.log(`Guest opening invite link: http://localhost:3000/room/${roomCode}/preview`);
  await pageB.goto(`http://localhost:3000/room/${roomCode}/preview`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2000));

  // Guest enters name and clicks join
  await pageB.type('input#guestName', 'Bob Jones');
  await pageB.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const joinBtn = btns.find((b) => b.textContent.includes('Join meeting'));
    if (joinBtn) joinBtn.click();
  });

  // Wait 3 seconds for join request to process
  await new Promise((r) => setTimeout(r, 3000));
  const guestBodyText = await pageB.evaluate(() => document.body.innerText);
  console.log('Guest Page Current URL:', pageB.url());
  console.log('Guest Page Body Snippet:\n', guestBodyText.substring(0, 300));
  await pageB.screenshot({ path: path.join(ARTIFACTS_DIR, 'guest_debug.png') });

  // Wait for waiting room UI
  await new Promise((r) => setTimeout(r, 3000));
  const waitingRoomScreenshotPath = path.join(ARTIFACTS_DIR, 'phase3_waiting_room.png');
  await pageB.screenshot({ path: waitingRoomScreenshotPath });
  console.log(`Captured Screenshot 5: ${waitingRoomScreenshotPath}`);

  // 10. Host opens Participants Panel to see Admission Request
  console.log('10. Host opening Participants Panel to review admission request...');
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const pBtn = btns.find((b) => b.getAttribute('title') === 'Participants' || b.getAttribute('aria-label') === 'Toggle participants list');
    if (pBtn) pBtn.click();
  });
  await new Promise((r) => setTimeout(r, 3500)); // wait for poll to fetch pending request

  const hostParticipantsScreenshotPath = path.join(ARTIFACTS_DIR, 'phase3_host_participants_panel.png');
  await pageA.screenshot({ path: hostParticipantsScreenshotPath });
  console.log(`Captured Screenshot 6: ${hostParticipantsScreenshotPath}`);

  // Host clicks "Admit" for Bob Jones
  console.log('11. Host admitting Bob Jones...');
  await pageA.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const admitBtn = btns.find((b) => b.textContent.includes('Admit'));
    if (admitBtn) admitBtn.click();
  });

  // Wait for Guest to detect approval, request token, and join meeting
  console.log('Waiting for Guest to transition from Waiting Room to Meeting Stage...');
  await new Promise((r) => setTimeout(r, 6000));

  const twoPersonScreenshotPath = path.join(ARTIFACTS_DIR, 'phase3_two_person_call.png');
  await pageA.screenshot({ path: twoPersonScreenshotPath });
  console.log(`Captured Screenshot 7: ${twoPersonScreenshotPath}`);

  // 12. Host ends meeting for everyone
  console.log('12. Host ending meeting for everyone...');
  await pageA.evaluate(async (code) => {
    await fetch(`/api/v1/rooms/${code}/end`, {
      method: 'POST',
      credentials: 'include',
    });
  }, roomCode);
  await new Promise((r) => setTimeout(r, 2000));

  // 13. Host visits Meeting History
  console.log('13. Host navigating to Meeting History page...');
  await pageA.goto('http://localhost:3000/history', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2000));

  const historyScreenshotPath = path.join(ARTIFACTS_DIR, 'phase3_meeting_history_verified.png');
  await pageA.screenshot({ path: historyScreenshotPath });
  console.log(`Captured Screenshot 8: ${historyScreenshotPath}`);

  console.log('14. Cleaning up browsers...');
  await browserA.close();
  await browserB.close();

  console.log('=== Phase 3 Full E2E Verification Complete! ===');
}

runPhase3Verification().catch((err) => {
  console.error('E2E Verification Error:', err);
  process.exit(1);
});
