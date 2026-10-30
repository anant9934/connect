import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { findChromeExecutable, getArtifactsDir } from './hardened_mobile_regression.mjs';

const CHROME_PATH = findChromeExecutable();
const ARTIFACTS_DIR = getArtifactsDir();

const VIEWPORTS = [
  { name: '320px_iphone_se', width: 320, height: 568, isMobile: true, dpr: 2 },
  { name: '360px_android_compact', width: 360, height: 800, isMobile: true, dpr: 2.25 },
  { name: '375px_iphone_standard', width: 375, height: 667, isMobile: true, dpr: 2 },
  { name: '390px_iphone_14', width: 390, height: 844, isMobile: true, dpr: 3 },
  { name: '393px_pixel_7', width: 393, height: 873, isMobile: true, dpr: 2.75 },
  { name: '412px_realme_11_pro_5g', width: 412, height: 915, isMobile: true, dpr: 2.625 },
  { name: '430px_iphone_15_pro_max', width: 430, height: 932, isMobile: true, dpr: 3 },
  { name: '768px_tablet_portrait', width: 768, height: 1024, isMobile: false, dpr: 2 },
  { name: '1280px_laptop', width: 1280, height: 800, isMobile: false, dpr: 1 },
  { name: '1440px_desktop_reference', width: 1440, height: 900, isMobile: false, dpr: 1 },
];

function checkIntersection(r1, r2) {
  if (!r1 || !r2) return false;
  return !(
    r2.left >= r1.right ||
    r2.right <= r1.left ||
    r2.top >= r1.bottom ||
    r2.bottom <= r1.top
  );
}

async function runVisualRegressionSuite() {
  console.log('=== STARTING AUTOMATED RESPONSIVE VISUAL REGRESSION SUITE ===');
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--headless=new', '--no-sandbox'],
  });

  const matrixResults = [];
  const page = await browser.newPage();

  for (const vp of VIEWPORTS) {
    console.log(`\nTesting viewport: ${vp.name} (${vp.width}x${vp.height}, DPR: ${vp.dpr})...`);
    await page.setViewport({
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.dpr,
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
    });

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));

    const evaluation = await page.evaluate(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scrollW = document.documentElement.scrollWidth;
      const docW = document.documentElement.clientWidth;

      // 1. Horizontal overflow check
      const hasHorizontalOverflow = scrollW > docW + 1;

      // 2. Anant Bubble vs Badge Collision Check
      const bubble = document.querySelector('#anant-speech-bubble');
      const badge = document.querySelector('#anant-speaker-badge');
      let anantCollision = false;
      let bubbleRect = null;
      let badgeRect = null;

      if (bubble && badge) {
        const bR = bubble.getBoundingClientRect();
        const bdR = badge.getBoundingClientRect();
        bubbleRect = { top: bR.top, bottom: bR.bottom, left: bR.left, right: bR.right };
        badgeRect = { top: bdR.top, bottom: bdR.bottom, left: bdR.left, right: bdR.right };
        anantCollision = !(
          bR.left >= bdR.right ||
          bR.right <= bdR.left ||
          bR.top >= bdR.bottom ||
          bR.bottom <= bdR.top
        );
      }

      // 3. Room Code Label Single-Line & Form Integrity
      const codeLabel = document.querySelector('label[for="room-code-input"]');
      const joinBtn = document.querySelector('form button[type="submit"]');
      const joinForm = document.querySelector('form');
      
      let labelWraps = false;
      let joinInsideForm = false;
      if (codeLabel) {
        const lR = codeLabel.getBoundingClientRect();
        // Single line text should be <= 26px height
        labelWraps = lR.height > 28;
      }
      if (joinBtn && joinForm) {
        const btnR = joinBtn.getBoundingClientRect();
        const fR = joinForm.getBoundingClientRect();
        joinInsideForm = btnR.right <= fR.right + 2 && btnR.left >= fR.left - 2;
      }

      // 4. Navbar Wrapping Check
      const nav = document.querySelector('nav');
      let navHeight = 0;
      let navWrapsAwkwardly = false;
      if (nav) {
        const nR = nav.getBoundingClientRect();
        navHeight = Math.round(nR.height);
        // On mobile, clean single-line nav is ~56px-70px; a wrapping nav jumps to > 100px
        navWrapsAwkwardly = nR.height > 85;
      }

      // 5. Research Circle Collisions Check
      // Check visible avatars vs visible speech bubbles
      const participantItems = Array.from(document.querySelectorAll('[aria-label="Meeting participants"] > div'));
      const speechCards = Array.from(document.querySelectorAll('section[aria-label="Research circle collaboration"] .space-y-3 > div'));
      
      let researchCircleCollisions = [];
      participantItems.forEach((p, pIdx) => {
        const pR = p.getBoundingClientRect();
        speechCards.forEach((s, sIdx) => {
          const sR = s.getBoundingClientRect();
          const collides = !(
            sR.left >= pR.right ||
            sR.right <= pR.left ||
            sR.top >= pR.bottom ||
            sR.bottom <= pR.top
          );
          if (collides) {
            researchCircleCollisions.push({ pIdx, sIdx });
          }
        });
      });

      // 6. Major cards viewport containment
      const cards = Array.from(document.querySelectorAll('section'));
      let cardsOverflowing = [];
      cards.forEach((c, idx) => {
        const r = c.getBoundingClientRect();
        if (r.left < -2 || r.right > vw + 2) {
          cardsOverflowing.push({ idx, left: r.left, right: r.right, vw });
        }
      });

      return {
        hasHorizontalOverflow,
        anantCollision,
        bubbleRect,
        badgeRect,
        labelWraps,
        joinInsideForm,
        navHeight,
        navWrapsAwkwardly,
        researchCircleCollisionsCount: researchCircleCollisions.length,
        cardsOverflowingCount: cardsOverflowing.length,
      };
    });

    const passed =
      !evaluation.hasHorizontalOverflow &&
      !evaluation.anantCollision &&
      !evaluation.labelWraps &&
      evaluation.joinInsideForm &&
      !evaluation.navWrapsAwkwardly &&
      evaluation.researchCircleCollisionsCount === 0 &&
      evaluation.cardsOverflowingCount === 0;

    console.log(`Results for ${vp.name}:`, {
      ...evaluation,
      PASSED: passed,
    });

    matrixResults.push({
      viewport: vp.name,
      dimensions: `${vp.width}x${vp.height}`,
      ...evaluation,
      PASSED: passed,
    });

    // Capture screenshot for key viewports
    if (['320px_iphone_se', '375px_iphone_standard', '390px_iphone_14', '412px_realme_11_pro_5g', '1440px_desktop_reference'].includes(vp.name)) {
      const fullPath = path.join(ARTIFACTS_DIR, `after_${vp.name}_full_page.png`);
      await page.screenshot({ path: fullPath, fullPage: true });
      console.log(`Saved screenshot: ${fullPath}`);
    }
  }

  // Test Realme 11 Pro 5G with Font Scaling (125% and 150%)
  console.log('\n--- TESTING REALME 11 PRO 5G UNDER 125% & 150% SYSTEM FONT SCALING ---');
  await page.setViewport({ width: 412, height: 915, isMobile: true, dpr: 2.625 });
  
  // Set 125% font size
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '20px'; // 125% of 16px
  });
  await new Promise((r) => setTimeout(r, 400));
  const font125Check = await page.evaluate(() => {
    const bubble = document.querySelector('#anant-speech-bubble')?.getBoundingClientRect();
    const badge = document.querySelector('#anant-speaker-badge')?.getBoundingClientRect();
    if (!bubble || !badge) return { collision: false };
    const collision = !(
      bubble.left >= badge.right ||
      bubble.right <= badge.left ||
      bubble.top >= badge.bottom ||
      bubble.bottom <= badge.top
    );
    return {
      collision,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  console.log('125% Font Scaling Check:', font125Check);

  // Set 150% font size
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '24px'; // 150% of 16px
  });
  await new Promise((r) => setTimeout(r, 400));
  const font150Check = await page.evaluate(() => {
    const bubble = document.querySelector('#anant-speech-bubble')?.getBoundingClientRect();
    const badge = document.querySelector('#anant-speaker-badge')?.getBoundingClientRect();
    if (!bubble || !badge) return { collision: false };
    const collision = !(
      bubble.left >= badge.right ||
      bubble.right <= badge.left ||
      bubble.top >= badge.bottom ||
      bubble.bottom <= badge.top
    );
    return {
      collision,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  console.log('150% Font Scaling Check:', font150Check);

  // Capture targeted comparison shots of Realme 11 Pro 5G
  await page.evaluate(() => {
    document.documentElement.style.fontSize = ''; // reset
  });
  await new Promise((r) => setTimeout(r, 400));

  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'after_realme_hero_nav.png'),
    clip: { x: 0, y: 0, width: 412, height: 650 },
  });

  const heroMeetingWindowY = await page.evaluate(() => {
    const el = document.querySelector('section[aria-label="Interactive meeting preview"]');
    return el ? el.getBoundingClientRect().top + window.scrollY : 500;
  });

  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'after_realme_hero_meeting_window.png'),
    clip: { x: 0, y: Math.max(0, heroMeetingWindowY - 20), width: 412, height: 680 },
  });

  const roundTableY = await page.evaluate(() => {
    const el = document.querySelector('section[aria-label="Research circle collaboration"]');
    return el ? el.getBoundingClientRect().top + window.scrollY : 1200;
  });

  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'after_realme_roundtable.png'),
    clip: { x: 0, y: Math.max(0, roundTableY - 20), width: 412, height: 600 },
  });

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'visual_regression_matrix_results.json'),
    JSON.stringify({ matrixResults, font125Check, font150Check }, null, 2)
  );

  await browser.close();

  const allPassed = matrixResults.every((r) => r.PASSED) && !font125Check.collision && !font150Check.collision;
  console.log(`\n========================================`);
  console.log(`ALL 10 VIEWPORTS + FONT SCALING PASSED: ${allPassed}`);
  console.log(`========================================\n`);

  if (!allPassed) {
    process.exit(1);
  }
}

runVisualRegressionSuite().catch((err) => {
  console.error('Visual regression error:', err);
  process.exit(1);
});
