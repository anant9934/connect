import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

test('M7 Phase M7.1: Universal Adaptive Layout Engine & Breakpoints', async (t) => {
  const layoutHookPath = path.join(rootDir, 'apps/mobile/src/hooks/useAdaptiveLayout.ts');
  const layoutContent = fs.readFileSync(layoutHookPath, 'utf-8');

  await t.test('defines all 6 universal width classes', () => {
    assert.match(layoutContent, /compact/);
    assert.match(layoutContent, /standard/);
    assert.match(layoutContent, /comfortable/);
    assert.match(layoutContent, /wide/);
    assert.match(layoutContent, /tablet/);
    assert.match(layoutContent, /expandedTablet/);
  });

  await t.test('enforces exact width breakpoint boundaries', () => {
    assert.match(layoutContent, /width\s*<\s*360/);
    assert.match(layoutContent, /width\s*<\s*400/);
    assert.match(layoutContent, /width\s*<\s*480/);
    assert.match(layoutContent, /width\s*<\s*600/);
    assert.match(layoutContent, /width\s*<\s*840/);
  });

  await t.test('calculates height tiers for short, medium, and tall viewports', () => {
    assert.match(layoutContent, /isShortHeight\s*=\s*height\s*<\s*500/);
    assert.match(layoutContent, /heightClass/);
  });

  await t.test('scaleFont uses viewport tier to prevent double-scaling native Android accessibility text', () => {
    assert.match(layoutContent, /scaleFont/);
    assert.match(layoutContent, /if\s*\(isCompact\)\s*return\s*Math\.round\(size\s*\*\s*0\.92\)/);
  });

  await t.test('backward compatibility export exists in useWindowDimensions.ts', () => {
    const windowDimPath = path.join(rootDir, 'apps/mobile/src/hooks/useWindowDimensions.ts');
    const dimContent = fs.readFileSync(windowDimPath, 'utf-8');
    assert.match(dimContent, /export function useWindowDimensions\(\):\s*AdaptiveLayout/);
    assert.match(dimContent, /return useAdaptiveLayout\(\)/);
  });
});

test('M7 Phase M7.2: Universal Design Tokens & Safe Area Integration', async (t) => {
  await t.test('App.tsx integrates SafeAreaProvider at root level', () => {
    const appPath = path.join(rootDir, 'apps/mobile/App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf-8');
    assert.match(appContent, /SafeAreaProvider/);
    assert.match(appContent, /<SafeAreaProvider/);
  });

  await t.test('tokens define gutters and touch target minimums (44x44 dp)', () => {
    const tokensPath = path.join(rootDir, 'apps/mobile/src/tokens.ts');
    const tokensContent = fs.readFileSync(tokensPath, 'utf-8');
    assert.match(tokensContent, /touchTarget:\s*\{[\s\S]*minWidth:\s*44/);
    assert.match(tokensContent, /gutters:\s*\{/);
    assert.match(tokensContent, /compact:\s*12/);
    assert.match(tokensContent, /standard:\s*16/);
    assert.match(tokensContent, /tablet:\s*28/);
  });
});

test('M7 Phase M7.3: Complete 10-Section Landing Page Responsiveness', async (t) => {
  const landingPath = path.join(rootDir, 'apps/mobile/src/screens/LandingScreen.tsx');
  const landingContent = fs.readFileSync(landingPath, 'utf-8');

  await t.test('Section 1: Header adapts brand title and actions on compact screens', () => {
    assert.match(landingContent, /brandTitleCompact/);
    assert.match(landingContent, /navStartBtnCompact/);
    assert.match(landingContent, /signInBtnCompact/);
  });

  await t.test('Section 2: Hero dynamically wraps room code container', () => {
    assert.match(landingContent, /styles\.roomCodeContainer/);
    assert.match(landingContent, /styles\.roomCodeContainerCompact/);
    assert.match(landingContent, /width\s*>=\s*380/);
  });

  await t.test('Section 3: Showcase adapts simulated meeting controls on compact screens', () => {
    assert.match(landingContent, /styles\.simulatedControlsBarCompact/);
    assert.match(landingContent, /styles\.simControlCircleCompact/);
  });

  await t.test('Section 4: Round Table provides compact constellation layout for phones and approved tablet layout', () => {
    assert.match(landingContent, /styles\.roundTableContainerCompact/);
    assert.match(landingContent, /styles\.centralTableOvalCompact/);
    assert.match(landingContent, /styles\.rtAvatarCompact/);
  });

  await t.test('Section 5: Room categories reflow into 1, 2, or 3 columns based on widthClass', () => {
    assert.match(landingContent, /styles\.roomCategoryCard/);
    assert.match(landingContent, /styles\.roomCategoryCardWide/);
    assert.match(landingContent, /styles\.roomCategoryCardTablet/);
  });

  await t.test('All 10 sections remain present and in order', () => {
    const s1 = landingContent.indexOf('SECTION 1 — NAVIGATION');
    const s2 = landingContent.indexOf('SECTION 2 — MAIN HERO');
    const s3 = landingContent.indexOf('SECTION 3 — HERO MEETING SHOWCASE');
    const s4 = landingContent.indexOf('SECTION 4 — RESEARCH ROUND TABLE');
    const s5 = landingContent.indexOf('SECTION 5 — ROOM CATEGORIES');
    const s6 = landingContent.indexOf('SECTION 6 — CONTEXT SECTION');
    const s7 = landingContent.indexOf('SECTION 7 — AUDIO QUALITY SECTION');
    const s8 = landingContent.indexOf('SECTION 8 — MENTORSHIP SECTION');
    const s9 = landingContent.indexOf('SECTION 9 — FINAL CALL TO ACTION');
    const s10 = landingContent.indexOf('SECTION 10 — FOOTER');

    assert.ok(s1 > 0 && s1 < s2, 'Section 1 precedes Section 2');
    assert.ok(s2 < s3, 'Section 2 precedes Section 3');
    assert.ok(s3 < s4, 'Section 3 precedes Section 4');
    assert.ok(s4 < s5, 'Section 4 precedes Section 5');
    assert.ok(s5 < s6, 'Section 5 precedes Section 6');
    assert.ok(s6 < s7, 'Section 6 precedes Section 7');
    assert.ok(s7 < s8, 'Section 7 precedes Section 8');
    assert.ok(s8 < s9, 'Section 8 precedes Section 9');
    assert.ok(s9 < s10, 'Section 9 precedes Section 10');
  });
});

test('M7 Phase M7.4 & M7.5: Auth and Prejoin Screen Responsiveness', async (t) => {
  await t.test('SignInScreen adapts card padding and tab buttons for narrow viewports', () => {
    const signInPath = path.join(rootDir, 'apps/mobile/src/screens/SignInScreen.tsx');
    const signInContent = fs.readFileSync(signInPath, 'utf-8');
    assert.match(signInContent, /contentCompact:\s*\{[\s\S]*padding:\s*18/);
    assert.match(signInContent, /contentTablet:\s*\{[\s\S]*padding:\s*32/);
    assert.match(signInContent, /tabBtnCompact/);
  });

  await t.test('PrejoinScreen enables two-column split layout for landscape/tablets', () => {
    const prejoinPath = path.join(rootDir, 'apps/mobile/src/screens/PrejoinScreen.tsx');
    const prejoinContent = fs.readFileSync(prejoinPath, 'utf-8');
    assert.match(prejoinContent, /const useTwoColumn\s*=\s*isLandscape\s*&&\s*\(/);
    assert.match(prejoinContent, /styles\.mainWrapperLandscape/);
  });

  await t.test('PrejoinScreen preserves the explicit 200ms camera release invariant before joining', () => {
    const prejoinPath = path.join(rootDir, 'apps/mobile/src/screens/PrejoinScreen.tsx');
    const prejoinContent = fs.readFileSync(prejoinPath, 'utf-8');
    assert.match(prejoinContent, /PrejoinCameraReleaseInitiated/);
    assert.match(prejoinContent, /setTimeout\(r,\s*200\)/);
  });
});

test('M7 Phase M7.6 & M7.7: Live Video Meeting Universal Responsiveness & Toolbar', async (t) => {
  const meetingPath = path.join(rootDir, 'apps/mobile/src/screens/MeetingScreen.tsx');
  const meetingContent = fs.readFileSync(meetingPath, 'utf-8');

  await t.test('MeetingScreen computes responsive PiP dimensions', () => {
    assert.match(meetingContent, /const pipWidth\s*=\s*isTablet\s*\?\s*110\s*:\s*\(isLandscape\s*\?\s*78\s*:\s*\(isCompact\s*\?\s*84\s*:\s*96\)\)/);
    assert.match(meetingContent, /const pipHeight\s*=\s*isTablet\s*\?\s*155\s*:\s*\(isLandscape\s*\?\s*108\s*:\s*\(isCompact\s*\?\s*118\s*:\s*136\)\)/);
  });

  await t.test('2-participant layout stacks vertically on portrait handsets and horizontally on tablet/landscape', () => {
    assert.match(meetingContent, /remoteParticipantsArray\.length\s*===\s*2\s*&&\s*\(isLandscape\s*\|\|\s*isTablet\s*\?\s*styles\.remoteGridTwoHorizontal\s*:\s*styles\.remoteGridTwoVertical\)/);
    assert.match(meetingContent, /remoteTileTwoVertical:\s*\{[\s\S]*minWidth:\s*['"]100%['"]/);
    assert.match(meetingContent, /remoteTileTwoHorizontal:\s*\{[\s\S]*minWidth:\s*['"]47%['"]/);
  });

  await t.test('Progressive disclosure toolbar uses 5 buttons on handsets (< 520dp) and 8 on tablet', () => {
    assert.match(meetingContent, /const isCompactToolbar\s*=\s*availableToolbarWidth\s*<\s*520/);
    assert.match(meetingContent, /isCompactToolbar\s*\?\s*\([\s\S]*More meeting actions[\s\S]*\)\s*:\s*\(/);
  });

  await t.test('More Actions modal sheet exposes all secondary controls without feature deletion', () => {
    assert.match(meetingContent, /<Modal visible=\{showMoreActions\}/);
    assert.match(meetingContent, /Flip Camera/);
    assert.match(meetingContent, /Speaker/);
    assert.match(meetingContent, /Raise Hand/);
    assert.match(meetingContent, /Reactions/);
    assert.match(meetingContent, /Share Invite/);
    assert.match(meetingContent, /Diagnostics/);
  });
});
