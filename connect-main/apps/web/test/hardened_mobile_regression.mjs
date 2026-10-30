import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
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
  throw new Error('Chrome/Chromium executable not found. Please set CHROME_PATH environment variable.');
}

export function getArtifactsDir() {
  const dir = process.env.TEST_ARTIFACTS_DIR || path.resolve(__dirname, 'artifacts');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const VIEWPORTS = [
  { name: '320px_iphone_se', width: 320, height: 568, isMobile: true, dpr: 2 },
  { name: '360px_android_compact', width: 360, height: 800, isMobile: true, dpr: 2.25 },
  { name: '375px_iphone_standard', width: 375, height: 667, isMobile: true, dpr: 2 },
  { name: '390px_iphone_14', width: 390, height: 844, isMobile: true, dpr: 3 },
  { name: '412px_realme_11_pro_5g', width: 412, height: 915, isMobile: true, dpr: 2.625 },
  { name: '430px_iphone_15_pro_max', width: 430, height: 932, isMobile: true, dpr: 3 },
  { name: '768px_tablet_portrait', width: 768, height: 1024, isMobile: false, dpr: 2 },
  { name: '1280px_laptop', width: 1280, height: 800, isMobile: false, dpr: 1 },
  { name: '1440px_desktop_reference', width: 1440, height: 900, isMobile: false, dpr: 1 },
];

async function runHardenedVisualRegressionSuite() {
  console.log('=================================================================');
  console.log('  TATHASTU CONNECT — COMPLETE HARDENED QA REGRESSION SUITE       ');
  console.log('=================================================================');

  const chromePath = findChromeExecutable();
  const artifactsDir = getArtifactsDir();
  const ideArtifactsDir = 'C:\\Users\\Lenovo\\.gemini\\antigravity-ide\\brain\\843a47ab-b7af-4ad3-811f-cf4e58539b8d';

  console.log(`Chrome Executable : ${chromePath}`);
  console.log(`Local Artifacts   : ${artifactsDir}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: ['--headless=new', '--disable-gpu'],
    });

    const matrixResults = [];
    const page = await browser.newPage();

    // 1. Viewport Matrix Assertions
    for (const vp of VIEWPORTS) {
      console.log(`\n[VIEWPORT] Auditing ${vp.name} (${vp.width}x${vp.height}, DPR: ${vp.dpr})...`);
      await page.setViewport({
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.dpr,
        isMobile: vp.isMobile,
        hasTouch: vp.isMobile,
      });

      await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

      // Explicit Readiness Assertions: Wait for selectors and web fonts
      await page.waitForSelector('#nav-brand-link', { timeout: 10000 });
      await page.waitForSelector('#anant-speech-bubble', { timeout: 10000 });
      await page.waitForSelector('#roundtable-surface', { timeout: 10000 });
      await page.evaluate(() => document.fonts.ready);

      const check = await page.evaluate((vpInfo) => {
        const errors = [];

        function isVisible(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        function checkRectCollision(r1, r2, tolerance = 0) {
          if (!r1 || !r2) return false;
          return !(
            r2.left >= r1.right - tolerance ||
            r2.right <= r1.left + tolerance ||
            r2.top >= r1.bottom - tolerance ||
            r2.bottom <= r1.top + tolerance
          );
        }

        // A. Horizontal Overflow Assertion
        const docW = document.documentElement.clientWidth;
        const scrollW = document.documentElement.scrollWidth;
        const hasHorizontalOverflow = scrollW > docW + 1;
        if (hasHorizontalOverflow) {
          errors.push(`HORIZONTAL OVERFLOW: scrollWidth (${scrollW}px) > clientWidth (${docW}px)`);
        }

        // B. Navbar Brand vs Actions Collision Check
        const brandEl = document.querySelector('#nav-brand-link');
        const actionsEl = document.querySelector('#nav-actions-container');
        let navCollision = false;
        let navClearance = 0;

        if (!brandEl || !isVisible(brandEl)) {
          errors.push('CRITICAL: #nav-brand-link is missing or not visible');
        }
        if (!actionsEl || !isVisible(actionsEl)) {
          errors.push('CRITICAL: #nav-actions-container is missing or not visible');
        }

        if (brandEl && actionsEl && isVisible(brandEl) && isVisible(actionsEl)) {
          const brandR = brandEl.getBoundingClientRect();
          const actR = actionsEl.getBoundingClientRect();
          navCollision = checkRectCollision(brandR, actR);
          navClearance = actR.left - brandR.right;
          if (navCollision) {
            errors.push(`NAVBAR COLLISION: Brand right (${brandR.right}px) collides with Actions left (${actR.left}px)`);
          }
          if (navClearance < 4) {
            errors.push(`NAVBAR INSUFFICIENT CLEARANCE: Clearance between brand and actions is only ${navClearance}px`);
          }
        }

        // C. Navbar Brand Text Clipping Check
        const brandTextEl = document.querySelector('#nav-brand-text');
        if (brandTextEl) {
          if (brandTextEl.scrollWidth > brandTextEl.clientWidth + 2) {
            errors.push(`TEXT CLIPPING: Brand text clipped (scrollWidth: ${brandTextEl.scrollWidth} > clientWidth: ${brandTextEl.clientWidth})`);
          }
        }

        // D. Touch Target Size Checks
        const interactiveSelectors = ['#nav-action-signin', '#nav-action-start', '#room-code-input', 'form button[type="submit"]'];
        for (const sel of interactiveSelectors) {
          const el = document.querySelector(sel);
          if (el && isVisible(el)) {
            const rect = el.getBoundingClientRect();
            if (rect.height < 38) {
              errors.push(`TOUCH TARGET DEFECT: Element ${sel} height is ${rect.height}px (must be >= 38px)`);
            }
          }
        }

        // E. Hero Meeting Window: Anant Bubble vs Speaker Badge Clearance
        const bubbleEl = document.querySelector('#anant-speech-bubble');
        const badgeEl = document.querySelector('#anant-speaker-badge');
        let heroCollision = false;
        let heroClearance = 0;

        if (bubbleEl && badgeEl && isVisible(bubbleEl) && isVisible(badgeEl)) {
          const bR = bubbleEl.getBoundingClientRect();
          const bdR = badgeEl.getBoundingClientRect();
          heroCollision = checkRectCollision(bR, bdR);
          heroClearance = bdR.top - bR.bottom;
          if (heroCollision) {
            errors.push(`HERO COLLISION: Anant speech bubble collides with speaker badge`);
          }
          if (heroClearance <= 0) {
            errors.push(`HERO CLEARANCE DEFECT: Bubble bottom (${bR.bottom}) is not strictly above Badge top (${bdR.top})`);
          }
        }

        // F. Roundtable: Verify Central Table & All 5 Participants
        const tableSurface = document.querySelector('#roundtable-surface');
        if (!tableSurface || !isVisible(tableSurface)) {
          errors.push('CRITICAL: Central table surface #roundtable-surface is missing or hidden');
        }

        const participants = [
          { id: 'anant', avatar: '#avatar-anant', name: '#name-anant', bubble: '#bubble-anant' },
          { id: 'sanara', avatar: '#avatar-sanara', name: '#name-sanara', bubble: '#bubble-sanara' },
          { id: 'shivam', avatar: '#avatar-shivam', name: '#name-shivam', bubble: null },
          { id: 'rao', avatar: '#avatar-rao', name: '#name-rao', bubble: null },
          { id: 'neha', avatar: '#avatar-neha', name: '#name-neha', bubble: '#bubble-neha' },
        ];

        const pRects = {};
        for (const p of participants) {
          const aEl = document.querySelector(p.avatar);
          const nEl = document.querySelector(p.name);
          if (!aEl || !isVisible(aEl)) {
            errors.push(`ROUNDTABLE DEFECT: Participant ${p.id} avatar (${p.avatar}) is missing or hidden`);
          } else {
            pRects[p.id + '_avatar'] = aEl.getBoundingClientRect();
          }

          if (!nEl || !isVisible(nEl)) {
            errors.push(`ROUNDTABLE DEFECT: Participant ${p.id} name label (${p.name}) is missing or hidden`);
          } else {
            pRects[p.id + '_name'] = nEl.getBoundingClientRect();
            // Check label text clipping
            if (nEl.scrollWidth > nEl.clientWidth + 2) {
              errors.push(`ROUNDTABLE TEXT CLIPPING: Participant ${p.id} name label is clipped`);
            }
          }

          if (p.bubble) {
            const bEl = document.querySelector(p.bubble);
            if (!bEl || !isVisible(bEl)) {
              errors.push(`ROUNDTABLE DEFECT: Participant ${p.id} speech bubble (${p.bubble}) is missing or hidden`);
            } else {
              pRects[p.id + '_bubble'] = bEl.getBoundingClientRect();
            }
          }
        }

        // G. Speech Bubble Collision Assertions
        if (pRects['anant_bubble'] && pRects['anant_avatar']) {
          if (checkRectCollision(pRects['anant_bubble'], pRects['anant_avatar'])) {
            errors.push('COLLISION: Anant speech bubble collides with Anant avatar');
          }
        }
        if (pRects['sanara_bubble'] && pRects['sanara_avatar']) {
          if (checkRectCollision(pRects['sanara_bubble'], pRects['sanara_avatar'])) {
            errors.push('COLLISION: Sanara speech bubble collides with Sanara avatar');
          }
        }
        if (pRects['neha_bubble'] && pRects['neha_avatar']) {
          if (checkRectCollision(pRects['neha_bubble'], pRects['neha_avatar'])) {
            errors.push('COLLISION: Neha speech bubble collides with Neha avatar');
          }
        }
        if (pRects['anant_bubble'] && pRects['sanara_bubble']) {
          if (checkRectCollision(pRects['anant_bubble'], pRects['sanara_bubble'])) {
            errors.push('COLLISION: Anant speech bubble collides with Sanara speech bubble');
          }
        }
        if (pRects['sanara_bubble'] && pRects['neha_bubble']) {
          if (checkRectCollision(pRects['sanara_bubble'], pRects['neha_bubble'])) {
            errors.push('COLLISION: Sanara speech bubble collides with Neha speech bubble');
          }
        }

        return {
          viewport: vpInfo.name,
          dimensions: `${vpInfo.width}x${vpInfo.height}`,
          hasHorizontalOverflow,
          navCollision,
          navClearance: Math.round(navClearance * 10) / 10,
          heroCollision,
          heroClearance: Math.round(heroClearance * 10) / 10,
          errors,
          passed: errors.length === 0,
        };
      }, vp);

      matrixResults.push(check);

      // Save Viewport Screenshot
      const vpScreenshotPath = path.join(artifactsDir, `${vp.name}.png`);
      await page.screenshot({ path: vpScreenshotPath, fullPage: false });
      if (fs.existsSync(ideArtifactsDir)) {
        try { fs.copyFileSync(vpScreenshotPath, path.join(ideArtifactsDir, `${vp.name}.png`)); } catch (_) {}
      }

      if (check.passed) {
        console.log(`  -> PASSED: Nav clearance +${check.navClearance}px, Hero clearance +${check.heroClearance}px, 0 collisions, 0 overflow`);
      } else {
        console.error(`  -> FAILED with ${check.errors.length} errors:`, check.errors);
      }
    }

    // 2. Section-Specific Target Screenshots on Realme 11 Pro 5G Viewport
    console.log('\n[SECTION CAPTURE] Capturing dedicated section proof on Realme 11 Pro 5G profile...');
    await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#nav-brand-link', { timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);

    const navEl = await page.$('nav');
    if (navEl) {
      const p = path.join(artifactsDir, 'section_header_412px_realme.png');
      await navEl.screenshot({ path: p });
      if (fs.existsSync(ideArtifactsDir)) { try { fs.copyFileSync(p, path.join(ideArtifactsDir, 'section_header_412px_realme.png')); } catch (_) {} }
    }

    const heroWinEl = await page.$('section[aria-label="Interactive meeting preview"]');
    if (heroWinEl) {
      const p = path.join(artifactsDir, 'section_hero_meeting_window_412px_realme.png');
      await heroWinEl.screenshot({ path: p });
      if (fs.existsSync(ideArtifactsDir)) { try { fs.copyFileSync(p, path.join(ideArtifactsDir, 'section_hero_meeting_window_412px_realme.png')); } catch (_) {} }
    }

    const roundEl = await page.$('section[aria-label="Research circle collaboration"]');
    if (roundEl) {
      const p = path.join(artifactsDir, 'section_roundtable_412px_realme.png');
      await roundEl.screenshot({ path: p });
      if (fs.existsSync(ideArtifactsDir)) { try { fs.copyFileSync(p, path.join(ideArtifactsDir, 'section_roundtable_412px_realme.png')); } catch (_) {} }
    }

    // Full page Realme capture
    const fullPagePath = path.join(artifactsDir, 'full_page_412px_realme.png');
    await page.screenshot({ path: fullPagePath, fullPage: true });
    if (fs.existsSync(ideArtifactsDir)) {
      try { fs.copyFileSync(fullPagePath, path.join(ideArtifactsDir, 'full_page_412px_realme.png')); } catch (_) {}
    }

    // 3. System Font Scaling (125% and 150%)
    console.log('\n[FONT SCALING] Testing 125% and 150% System Text Resizing...');
    const fontScalingResults = [];
    for (const scale of [125, 150]) {
      const res = await page.evaluate((s) => {
        document.documentElement.style.fontSize = `${s}%`;
        const bubble = document.querySelector('#anant-speech-bubble');
        const badge = document.querySelector('#anant-speaker-badge');
        const bR = bubble ? bubble.getBoundingClientRect() : null;
        const bdR = badge ? badge.getBoundingClientRect() : null;
        const collides = (bR && bdR) ? !(bR.left >= bdR.right || bR.right <= bdR.left || bR.top >= bdR.bottom || bR.bottom <= bdR.top) : false;
        const scrollW = document.documentElement.scrollWidth;
        const docW = document.documentElement.clientWidth;

        return {
          scale: `${s}%`,
          collides,
          verticalClearance: bR && bdR ? Math.round(bdR.top - bR.bottom) : null,
          hasOverflow: scrollW > docW + 1,
        };
      }, scale);

      fontScalingResults.push(res);
      console.log(`  -> Scale ${res.scale}: Collides = ${res.collides}, Vertical Clearance = +${res.verticalClearance}px, Overflow = ${res.hasOverflow}`);
    }

    // Restore font size
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

    // 4. Save Final JSON Summary
    const allMatrixPassed = matrixResults.every((r) => r.passed);
    const fontScalingPassed = fontScalingResults.every((r) => !r.collides && !r.hasOverflow);
    const overallSuitePassed = allMatrixPassed && fontScalingPassed;

    const summary = {
      timestamp: new Date().toISOString(),
      overallSuitePassed,
      allMatrixPassed,
      fontScalingPassed,
      matrixResults,
      fontScalingResults,
    };

    const summaryPath = path.join(artifactsDir, 'test_results.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    if (fs.existsSync(ideArtifactsDir)) {
      try { fs.writeFileSync(path.join(ideArtifactsDir, 'test_results.json'), JSON.stringify(summary, null, 2)); } catch (_) {}
    }

    console.log('\n=================================================================');
    console.log(`  ALL VIEWPORT CHECKS PASSED      : ${allMatrixPassed ? 'PASS' : 'FAIL'}`);
    console.log(`  FONT SCALING (125% & 150%) PASS : ${fontScalingPassed ? 'PASS' : 'FAIL'}`);
    console.log(`  OVERALL HARNED QA VERDICT       : ${overallSuitePassed ? 'SUCCESS (PASS)' : 'FAILURE (FAIL)'}`);
    console.log('=================================================================');

    if (!overallSuitePassed) {
      process.exitCode = 1;
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

runHardenedVisualRegressionSuite().catch((err) => {
  console.error('Fatal execution error in test runner:', err);
  process.exit(1);
});
