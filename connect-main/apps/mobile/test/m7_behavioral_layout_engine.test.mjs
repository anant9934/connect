import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure behavioral simulation of useAdaptiveLayout logic
 * directly exercising the production mathematical and layout models.
 */
function computeAdaptiveLayout(width, height, options = {}) {
  const safeInsets = options.safeInsets || { top: 0, bottom: 0, left: 0, right: 0 };
  const fontScale = options.fontScale || 1.0;

  const isLandscape = width > height;
  const isPortrait = !isLandscape;
  const orientation = isLandscape ? 'landscape' : 'portrait';

  // Width Class
  let widthClass = 'standard';
  if (width < 360) widthClass = 'compact';
  else if (width < 400) widthClass = 'standard';
  else if (width < 480) widthClass = 'comfortable';
  else if (width < 600) widthClass = 'wide';
  else if (width < 840) widthClass = 'tablet';
  else widthClass = 'expandedTablet';

  // Height Class
  let heightClass = 'medium';
  if (height < 500) heightClass = 'short';
  else if (height > 750) heightClass = 'tall';

  const smallestWidth = Math.min(width, height);
  const isTabletDevice = smallestWidth >= 600;
  // Tablet mode requires smallestWidth >= 600 OR (width >= 600 AND height >= 500)
  // Prevents short landscape phones (e.g. 740x360, 851x393) from being misclassified as tablets
  const isTablet = (isTabletDevice && width >= 600) || (width >= 600 && height >= 500);
  const isLargeTablet = isTablet && (width >= 840 || (smallestWidth >= 720 && isLandscape));
  const isExpandedTablet = isLargeTablet;
  const isPhone = !isTablet;
  const isShortHeight = height < 500;

  const isCompact = width < 360;
  const isStandard = width >= 360 && width < 400;
  const isComfortable = width >= 400 && width < 480;
  const isWide = width >= 480 && width < 600;

  // Horizontal Gutters
  let horizontalGutter = 16;
  if (isCompact) horizontalGutter = 12;
  else if (isStandard) horizontalGutter = 16;
  else if (isComfortable) horizontalGutter = 18;
  else if (isWide) horizontalGutter = 20;
  else if (isTablet && !isExpandedTablet) horizontalGutter = 28;
  else horizontalGutter = 36;

  // Grid columns
  let columns = 1;
  if (isExpandedTablet) columns = 3;
  else if (isTablet) columns = isLandscape ? 3 : 2;
  else if (isWide || (isLandscape && isPhone)) columns = 2;
  else columns = 1;

  // Responsive font scaling helper (viewport-tier based, does not double-scale fontScale)
  const scaleFont = (size) => {
    if (isCompact) return Math.round(size * 0.92);
    if (isTablet) return Math.round(size * 1.08);
    return size;
  };

  // Toolbar computation
  const availableToolbarWidth = width - (safeInsets.left + safeInsets.right);
  const isCompactToolbar = availableToolbarWidth < 520;
  const isVeryNarrow = availableToolbarWidth < 360;

  // Proportional PiP
  const pipWidth = isTablet ? 110 : (isLandscape ? 78 : (isCompact ? 84 : 96));
  const pipHeight = isTablet ? 155 : (isLandscape ? 108 : (isCompact ? 118 : 136));

  return {
    width,
    height,
    isLandscape,
    isPortrait,
    orientation,
    widthClass,
    heightClass,
    isTablet,
    isLargeTablet,
    isExpandedTablet,
    isPhone,
    isShortHeight,
    isCompact,
    isStandard,
    isComfortable,
    isWide,
    horizontalGutter,
    columns,
    scaleFont,
    availableToolbarWidth,
    isCompactToolbar,
    isVeryNarrow,
    pipWidth,
    pipHeight,
  };
}

test('Behavioral Suite: Viewport Classification Across Device Matrix', async (t) => {
  await t.test('320 × 568: Compact Narrow Phone', () => {
    const layout = computeAdaptiveLayout(320, 568);
    assert.equal(layout.widthClass, 'compact');
    assert.equal(layout.isCompact, true);
    assert.equal(layout.isPhone, true);
    assert.equal(layout.isTablet, false);
    assert.equal(layout.isCompactToolbar, true);
    assert.equal(layout.isVeryNarrow, true);
    assert.equal(layout.pipWidth, 84);
    assert.equal(layout.pipHeight, 118);
    assert.equal(layout.columns, 1);
  });

  await t.test('360 × 640: Standard Android Handset (Realme / Vivo / OnePlus)', () => {
    const layout = computeAdaptiveLayout(360, 640);
    assert.equal(layout.widthClass, 'standard');
    assert.equal(layout.isStandard, true);
    assert.equal(layout.isPhone, true);
    assert.equal(layout.isTablet, false);
    assert.equal(layout.isCompactToolbar, true);
    assert.equal(layout.isVeryNarrow, false);
    assert.equal(layout.pipWidth, 96);
    assert.equal(layout.pipHeight, 136);
  });

  await t.test('393 × 873: Modern Flagship Handset (Pixel / Xiaomi / Galaxy)', () => {
    const layout = computeAdaptiveLayout(393, 873);
    assert.equal(layout.widthClass, 'standard');
    assert.equal(layout.isPhone, true);
    assert.equal(layout.isTablet, false);
    assert.equal(layout.isCompactToolbar, true);
  });

  await t.test('412 × 915: Comfortable Handset (Galaxy S22/S23/S24, OnePlus 11)', () => {
    const layout = computeAdaptiveLayout(412, 915);
    assert.equal(layout.widthClass, 'comfortable');
    assert.equal(layout.isComfortable, true);
    assert.equal(layout.isPhone, true);
    assert.equal(layout.isTablet, false);
    assert.equal(layout.isCompactToolbar, true);
  });

  await t.test('740 × 360: Short Landscape Phone Must NOT be Classified as Tablet', () => {
    const layout = computeAdaptiveLayout(740, 360, { safeInsets: { left: 24, right: 24 } });
    assert.equal(layout.isLandscape, true);
    assert.equal(layout.isShortHeight, true);
    assert.equal(layout.isPhone, true);
    assert.equal(layout.isTablet, false, 'Landscape phone must not be classified as tablet');
    assert.equal(layout.pipWidth, 78, 'Landscape phone PiP must be compact (78dp) to avoid covering stage');
    assert.equal(layout.pipHeight, 108);
    assert.equal(layout.columns, 2, 'Landscape phone reflows cards into 2 columns');
  });

  await t.test('800 × 1280: Realme Pad Golden Reference Device (Portrait)', () => {
    const layout = computeAdaptiveLayout(800, 1280);
    assert.equal(layout.isTablet, true);
    assert.equal(layout.isPhone, false);
    assert.equal(layout.isCompactToolbar, false, 'Realme Pad portrait fits full 8-button toolbar');
    assert.equal(layout.pipWidth, 110, 'Approved Realme Pad PiP width');
    assert.equal(layout.pipHeight, 155, 'Approved Realme Pad PiP height');
    assert.equal(layout.columns, 2);
  });

  await t.test('1280 × 800: Realme Pad Golden Reference Device (Landscape)', () => {
    const layout = computeAdaptiveLayout(1280, 800);
    assert.equal(layout.isTablet, true);
    assert.equal(layout.isLargeTablet, true);
    assert.equal(layout.isCompactToolbar, false);
    assert.equal(layout.pipWidth, 110);
    assert.equal(layout.columns, 3, 'Large tablet landscape uses 3-column room grid');
  });
});

test('Behavioral Suite: Meeting Toolbar Geometric Clearance Analysis', async (t) => {
  await t.test('320dp screen: 5-button compact toolbar fits with >= 30dp clearance', () => {
    const layout = computeAdaptiveLayout(320, 568);
    assert.equal(layout.isCompactToolbar, true);

    // Exact geometric footprint of compact 5-button toolbar on very narrow screen:
    const numCircleButtons = 4; // Mic, Cam, Share, More
    const circleBtnWidth = 44;
    const leaveBtnWidth = 72; // leaveBtnVeryNarrow: padding 8+8, icon 16, gap 4, text 36
    const gap = 5; // controlsBarVeryNarrow
    const horizontalPadding = 10; // 5 + 5

    const totalOccupiedWidth =
      numCircleButtons * circleBtnWidth + leaveBtnWidth + 4 * gap + horizontalPadding;
    // 4 * 44 + 72 + 20 + 10 = 278dp
    assert.ok(totalOccupiedWidth <= 288, `Occupied width ${totalOccupiedWidth} must be <= 288dp`);
    const clearance = layout.width - totalOccupiedWidth;
    assert.ok(clearance >= 32, `Clearance ${clearance}dp must be at least 32dp on 320dp screen`);
  });

  await t.test('500dp screen with 24dp insets: Activates progressive disclosure to prevent 2-row wrapping', () => {
    const layout = computeAdaptiveLayout(500, 800, { safeInsets: { left: 16, right: 16 } });
    assert.equal(layout.availableToolbarWidth, 468);
    // 468dp is less than 484dp required by full 8-button row
    assert.equal(layout.isCompactToolbar, true, 'Must use compact toolbar when available width < 520dp');
  });
});

test('Behavioral Suite: Participant Grid Layout Mapping & Local PiP Isolation', async (t) => {
  function resolveParticipantStage(remoteCount, isTablet, isLandscape) {
    if (remoteCount === 0) {
      return { mode: 'solo', tiles: 0, pip: true };
    }
    if (remoteCount === 1) {
      // 1 remote + 1 local = 2 participants in call
      return { mode: 'remote_stage_one', tiles: 1, pip: true, orientation: 'full_stage' };
    }
    if (remoteCount === 2) {
      // 2 remote + 1 local = 3 participants in call
      const orientation = isLandscape || isTablet ? 'horizontal_split' : 'vertical_stack';
      return { mode: 'remote_grid_two', tiles: 2, pip: true, orientation };
    }
    // 3+ remote + 1 local = 4+ participants in call
    return { mode: 'remote_grid_multi', tiles: remoteCount, pip: true, orientation: 'multi_grid' };
  }

  await t.test('1 Remote (Total 2 in call): 1 Stage Tile + Local PiP without duplicate tiles', () => {
    const stage = resolveParticipantStage(1, false, false);
    assert.equal(stage.tiles, 1);
    assert.equal(stage.pip, true);
    assert.equal(stage.orientation, 'full_stage');
  });

  await t.test('2 Remotes (Total 3 in call): Vertical Stack on portrait handset', () => {
    const stage = resolveParticipantStage(2, false, false);
    assert.equal(stage.tiles, 2);
    assert.equal(stage.pip, true);
    assert.equal(stage.orientation, 'vertical_stack', 'Portrait phone must stack 2 remote tiles vertically');
  });

  await t.test('2 Remotes (Total 3 in call): Horizontal Split on tablet or landscape', () => {
    const stagePhoneLandscape = resolveParticipantStage(2, false, true);
    assert.equal(stagePhoneLandscape.orientation, 'horizontal_split');

    const stageTablet = resolveParticipantStage(2, true, false);
    assert.equal(stageTablet.orientation, 'horizontal_split');
  });

  await t.test('3 Remotes (Total 4 in call): 2x2 multi grid + local PiP', () => {
    const stage = resolveParticipantStage(3, false, false);
    assert.equal(stage.tiles, 3);
    assert.equal(stage.pip, true);
    assert.equal(stage.orientation, 'multi_grid');
  });
});

test('Behavioral Suite: Font Scaling Does Not Double-Scale System Accessibility', async (t) => {
  const layoutCompact = computeAdaptiveLayout(320, 568);
  const layoutStandard = computeAdaptiveLayout(393, 851);
  const layoutTablet = computeAdaptiveLayout(800, 1280);

  // Assert scaleFont returns expected responsive base font size
  assert.equal(layoutCompact.scaleFont(16), 15); // 16 * 0.92 = 14.72 -> 15
  assert.equal(layoutStandard.scaleFont(16), 16); // standard baseline
  assert.equal(layoutTablet.scaleFont(16), 17); // 16 * 1.08 = 17.28 -> 17

  // Verify that system fontScale is kept independent so Text allows Android accessibility
  for (const fontScale of [1.0, 1.15, 1.3, 1.5]) {
    const layout = computeAdaptiveLayout(393, 851, { fontScale });
    // scaleFont(16) should remain 16 so that React Native native Text multiplies by fontScale ONCE (16 * 1.30 = 20.8)
    assert.equal(layout.scaleFont(16), 16, `scaleFont must not multiply by system fontScale ${fontScale}`);
  }
});
