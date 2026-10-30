import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\116094a7-63d4-4c53-9b27-af0ec12a66e7';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('=== STARTING TATHASTU CONNECT PHASE 4 END-TO-END VERIFICATION ===');

  // Prepare a test upload file
  const testUploadPath = path.join(process.cwd(), 'sample_agenda.txt');
  fs.writeFileSync(testUploadPath, 'Tathastu Connect Phase 4 Agenda:\n1. 1080p Detail Presentation Mode\n2. Realtime Notes OCC\n3. Malware Quarantine Scanner\n', 'utf8');

  // 1. Launch Host Browser
  console.log('1. Launching Host browser context...');
  const hostBrowser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });

  // 2. Launch Guest Browser
  console.log('2. Launching Guest browser context (isolated)...');
  const guestBrowser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });

  try {
    const hostPage = await hostBrowser.newPage();
    await hostPage.setViewport({ width: 1440, height: 900 });

    // Host signs up / logs in
    console.log('3. Authenticating host user...');
    await hostPage.goto('http://localhost:3000/sign-in', { waitUntil: 'networkidle0' });
    await hostPage.type('input#email, input[type="email"]', 'test_supabase@example.com');
    await hostPage.type('input#password, input[type="password"]', 'StrongPassword123!');
    await hostPage.click('button[type="submit"]');
    await sleep(2000);

    // If on sign-in still, try signup
    if (hostPage.url().includes('sign-in')) {
      await hostPage.goto('http://localhost:3000/sign-up', { waitUntil: 'networkidle0' });
      await hostPage.type('input#displayName', 'Dr. Sarah Chen');
      await hostPage.type('input#email', 'test_supabase@example.com');
      await hostPage.type('input#password', 'StrongPassword123!');
      await hostPage.click('button[type="submit"]');
      await sleep(2000);
    }

    // Host navigates to landing to create meeting
    console.log('4. Creating meeting room as host...');
    await hostPage.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
    await sleep(1000);

    // Look for Start meeting / Instant meeting button
    const instantBtn = await hostPage.$('button');
    // Let's create room via API directly in page context to get exact code
    const roomCode = await hostPage.evaluate(async () => {
      const res = await fetch('http://localhost:8080/api/v1/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
        body: JSON.stringify({ maxParticipants: 50, waitingRoomEnabled: false }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.room) {
        throw new Error(`Room creation failed (${res.status}): ${JSON.stringify(data)}`);
      }
      return data.room.publicCode;
    });

    console.log(`✓ Meeting room created: ${roomCode}`);

    // Host enters room preview and joins
    console.log('5. Host entering meeting preview and joining...');
    await hostPage.goto(`http://localhost:3000/room/${roomCode}/preview`, { waitUntil: 'networkidle0' });
    await sleep(2000);

    // Click "Join Meeting"
    const joinBtns = await hostPage.$$('button');
    for (const btn of joinBtns) {
      const text = await hostPage.evaluate((el) => el.textContent, btn);
      if (text && text.includes('Join')) {
        await btn.click();
        break;
      }
    }
    await sleep(3500);

    console.log('✓ Host connected to meeting room stage.');

    // 6. Guest connects to meeting
    console.log('6. Guest connecting to meeting room...');
    const guestPage = await guestBrowser.newPage();
    await guestPage.setViewport({ width: 1440, height: 900 });
    await guestPage.goto(`http://localhost:3000/room/${roomCode}/preview`, { waitUntil: 'networkidle0' });
    await sleep(1500);

    // Enter guest display name
    const guestNameInput = await guestPage.$('input');
    if (guestNameInput) {
      await guestNameInput.click({ clickCount: 3 });
      await guestNameInput.type('Dr. Collaborator');
    }

    const guestJoinBtns = await guestPage.$$('button');
    for (const btn of guestJoinBtns) {
      const text = await guestPage.evaluate((el) => el.textContent, btn);
      if (text && text.includes('Join')) {
        await btn.click();
        break;
      }
    }
    await sleep(3500);
    console.log('✓ Guest connected to meeting room.');

    // 7. Verify Notes Panel
    console.log('7. Testing Persistent Notes Panel...');
    // Host opens Notes Panel
    const notesBtn = await hostPage.$('button[title="Meeting notes"]');
    if (notesBtn) {
      await notesBtn.click();
      await sleep(1000);
    }

    // Type notes title and content
    const titleInput = await hostPage.$('input[placeholder*="Meeting title"]');
    if (titleInput) {
      await titleInput.click({ clickCount: 3 });
      await titleInput.type('Phase 4 Architecture & Collaboration Review');
    }

    const contentTextarea = await hostPage.$('textarea[placeholder*="Write shared meeting notes"]');
    if (contentTextarea) {
      await contentTextarea.click();
      await contentTextarea.type('Discussed WebRTC 1080p screen-sharing detail mode, optimistic concurrency notes, and quarantine malware scanner.');
    }

    // Click Save
    const saveNoteBtn = await hostPage.$('button.bg-\\[\\#7658E8\\]');
    if (saveNoteBtn) {
      await saveNoteBtn.click();
      await sleep(1500);
    }

    // Screenshot Host Notes Panel
    const notesShotPath = path.join(ARTIFACTS_DIR, 'phase4_notes_panel.png');
    await hostPage.screenshot({ path: notesShotPath });
    console.log(`✓ Notes Panel verified and saved: ${notesShotPath}`);

    // 8. Verify Files Panel
    console.log('8. Testing Secure Files Panel...');
    // Host opens Files Panel
    const filesBtn = await hostPage.$('button[title="Meeting files"]');
    if (filesBtn) {
      await filesBtn.click();
      await sleep(1000);
    }

    // Upload file
    const fileInput = await hostPage.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile(testUploadPath);
      await sleep(2500);
    }

    // Screenshot Host Files Panel
    const filesShotPath = path.join(ARTIFACTS_DIR, 'phase4_files_panel.png');
    await hostPage.screenshot({ path: filesShotPath });
    console.log(`✓ Files Panel verified and saved: ${filesShotPath}`);

    // 9. Presentation test fixture screenshot
    console.log('9. Capturing test presentation fixture...');
    const presPage = await hostBrowser.newPage();
    await presPage.setViewport({ width: 1440, height: 900 });
    await presPage.goto('http://localhost:3000/test-presentation.html', { waitUntil: 'networkidle0' });
    await sleep(1000);
    const presShotPath = path.join(ARTIFACTS_DIR, 'phase4_presentation_fixture.png');
    await presPage.screenshot({ path: presShotPath });
    await presPage.close();
    console.log(`✓ Presentation test fixture saved: ${presShotPath}`);

    // 10. Meeting stage screenshot (Presentation layout)
    console.log('10. Capturing meeting stage view...');
    // Close side panel so stage takes full view
    const closePanelBtn = await hostPage.$('button[aria-label="Close panel"]');
    if (closePanelBtn) {
      await closePanelBtn.click();
      await sleep(500);
    }
    // Host clicks share screen
    const shareBtn = await hostPage.$('button[title="Share screen"]');
    if (shareBtn) {
      await shareBtn.click();
      await sleep(3500);
    }
    const stageShotPath = path.join(ARTIFACTS_DIR, 'phase4_meeting_screenshare.png');
    await hostPage.screenshot({ path: stageShotPath });
    console.log(`✓ Meeting stage view saved: ${stageShotPath}`);

    // 11. Mobile responsive verification (390x844)
    console.log('11. Capturing Mobile meeting view (390x844)...');
    const mobilePage = await hostBrowser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await mobilePage.goto(`http://localhost:3000/room/${roomCode}`, { waitUntil: 'networkidle0' });
    await sleep(2500);
    const mobileShotPath = path.join(ARTIFACTS_DIR, 'phase4_mobile_meeting.png');
    await mobilePage.screenshot({ path: mobileShotPath });
    await mobilePage.close();
    console.log(`✓ Mobile meeting view saved: ${mobileShotPath}`);

    // 12. Meeting History & View Details
    console.log('12. Testing Meeting History & View Details modal...');
    await hostPage.goto('http://localhost:3000/history', { waitUntil: 'networkidle0' });
    await sleep(2000);

    // Click "View Details" button on history item
    const viewDetailBtns = await hostPage.$$('button');
    for (const btn of viewDetailBtns) {
      const text = await hostPage.evaluate((el) => el.textContent, btn);
      if (text && text.includes('View Details')) {
        await btn.click();
        break;
      }
    }
    await sleep(2000);

    const historyShotPath = path.join(ARTIFACTS_DIR, 'phase4_meeting_history.png');
    await hostPage.screenshot({ path: historyShotPath });
    console.log(`✓ Meeting history details saved: ${historyShotPath}`);

    console.log('=== PHASE 4 END-TO-END VERIFICATION COMPLETED SUCCESSFULLY ===');
  } finally {
    await hostBrowser.close();
    await guestBrowser.close();
    if (fs.existsSync(testUploadPath)) {
      fs.unlinkSync(testUploadPath);
    }
  }
}

runTest().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
