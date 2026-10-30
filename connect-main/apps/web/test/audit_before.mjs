import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\843a47ab-b7af-4ad3-811f-cf4e58539b8d';

// Ensure artifacts dir exists
if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

// Bounding box collision detector
function boxesIntersect(r1, r2) {
  return !(
    r2.left >= r1.right ||
    r2.right <= r1.left ||
    r2.top >= r1.bottom ||
    r2.bottom <= r1.top
  );
}

async function runBeforeAudit() {
  console.log('--- STARTING BEFORE-AUDIT BASELINE CAPTURE ---');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--headless=new', '--no-sandbox'],
  });

  const page = await browser.newPage();

  // Test at Realme 11 Pro 5G equivalent: 412x915, dpr 2.625
  await page.setViewport({
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1000));

  // 1. Capture full page baseline
  const fullPagePath = path.join(ARTIFACTS_DIR, 'before_realme_full_page.png');
  await page.screenshot({ path: fullPagePath, fullPage: true });
  console.log(`Saved baseline full page: ${fullPagePath}`);

  // 2. Capture Hero and Nav section
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'before_realme_hero_nav.png'),
    clip: { x: 0, y: 0, width: 412, height: 650 },
  });

  // 3. Capture HeroMeetingWindow section
  const heroMeetingRect = await page.evaluate(() => {
    const el = document.querySelector('.max-w-\\[1120px\\]');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: 0, y: Math.max(0, rect.top + window.scrollY - 20), width: 412, height: rect.height + 40 };
  });

  if (heroMeetingRect) {
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, 'before_realme_hero_meeting_window.png'),
      clip: {
        x: 0,
        y: Math.min(heroMeetingRect.y, 400),
        width: 412,
        height: 750,
      },
    });
  }

  // 4. Capture RoundTableSection
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'before_realme_roundtable.png'),
    clip: { x: 0, y: 1150, width: 412, height: 600 },
  });

  // Check collision between Anant bubble and Anant label
  const collisionReport = await page.evaluate(() => {
    // Anant label: span containing "Anant · speaking"
    const spans = Array.from(document.querySelectorAll('span'));
    const anantLabel = spans.find((s) => s.textContent.includes('Anant · speaking'));
    
    // Anant bubble: div containing "What if we federate"
    const divs = Array.from(document.querySelectorAll('div'));
    const anantBubble = divs.find((d) => d.textContent.includes('What if we federate at the grid edge?'));

    let anantOverlap = false;
    let labelRect = null;
    let bubbleRect = null;

    if (anantLabel && anantBubble) {
      const l = anantLabel.getBoundingClientRect();
      const b = anantBubble.getBoundingClientRect();
      labelRect = { top: l.top, bottom: l.bottom, left: l.left, right: l.right, width: l.width, height: l.height };
      bubbleRect = { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };

      const intersect = !(b.left >= l.right || b.right <= l.left || b.top >= l.bottom || b.bottom <= l.top);
      anantOverlap = intersect;
    }

    // RoundTable collisions
    const roundTableBubbles = [
      'Can we reuse the same evaluation set?',
      'Power data is the hard part.',
      'I can share my dataset notes.',
    ];
    const bubbleElements = roundTableBubbles.map((text) =>
      divs.find((d) => d.textContent?.trim() === text)
    );

    const roundTableAvatars = ['Anant', 'Rahul', 'Shivam', 'Prof. Rao', 'Neha'];
    const avatarElements = roundTableAvatars.map((name) => {
      return divs.find((d) => d.textContent?.trim() === name || (d.textContent?.includes(name) && d.children.length === 1));
    });

    const roundTableCollisions = [];
    bubbleElements.forEach((bEl, bIdx) => {
      if (!bEl) return;
      const bR = bEl.getBoundingClientRect();
      avatarElements.forEach((aEl, aIdx) => {
        if (!aEl) return;
        const aR = aEl.getBoundingClientRect();
        const overlap = !(bR.left >= aR.right || bR.right <= aR.left || bR.top >= aR.bottom || bR.bottom <= aR.top);
        if (overlap) {
          roundTableCollisions.push({
            bubble: roundTableBubbles[bIdx],
            avatar: roundTableAvatars[aIdx],
          });
        }
      });
    });

    return {
      anantOverlap,
      labelRect,
      bubbleRect,
      roundTableCollisions,
    };
  });

  console.log('Collision Report (BEFORE):', JSON.stringify(collisionReport, null, 2));

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'before_audit_report.json'),
    JSON.stringify(collisionReport, null, 2)
  );

  await browser.close();
  console.log('BEFORE baseline completed.');
}

runBeforeAudit().catch(console.error);
