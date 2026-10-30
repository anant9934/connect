import { useWindowDimensions as useRNWindowDimensions } from 'react-native';
import { useSafeAreaInsets, EdgeInsets } from 'react-native-safe-area-context';

export type WidthClass =
  | 'compact'        // < 360dp (Compact narrow phone)
  | 'standard'       // 360 - 399dp (Standard compact phone)
  | 'comfortable'    // 400 - 479dp (Comfortable modern phone)
  | 'wide'           // 480 - 599dp (Wide phone / compact window)
  | 'tablet'         // 600 - 839dp (Tablet window / Realme Pad portrait)
  | 'expandedTablet'; // >= 840dp (Expanded tablet window / landscape)

export type HeightClass =
  | 'short'          // < 500dp (e.g. landscape phone)
  | 'medium'         // 500 - 750dp (standard phone height)
  | 'tall';          // > 750dp (tall phone, tablet)

export interface AdaptiveLayout {
  /** Usable window width in dp */
  width: number;
  /** Usable window height in dp */
  height: number;
  /** Screen orientation */
  orientation: 'portrait' | 'landscape';
  isLandscape: boolean;
  isPortrait: boolean;
  /** Breakpoint class based on width */
  widthClass: WidthClass;
  /** Breakpoint class based on height */
  heightClass: HeightClass;
  /** Quick boolean helpers */
  isCompact: boolean;
  isStandard: boolean;
  isComfortable: boolean;
  isWide: boolean;
  isTablet: boolean;
  isLargeTablet: boolean;
  isExpandedTablet: boolean;
  isPhone: boolean;
  isShortHeight: boolean;
  /** Screen density and font scaling */
  fontScale: number;
  pixelRatio: number;
  scale: number;
  /** Safe-area insets */
  safeInsets: EdgeInsets;
  /** Recommended horizontal page gutter */
  horizontalGutter: number;
  /** Max content width for container centering */
  contentMaxWidth: number;
  /** Recommended column count for card grids */
  columns: number;
  /** Spacing scale multiplier */
  spacingScale: number;
  /** Clamped font scaling helper */
  scaleFont: (size: number, maxScaleFactor?: number) => number;
  /** Scaled spacing helper */
  scaleSpacing: (spacing: number) => number;
  /** Clamping utility */
  clamp: (val: number, min: number, max: number) => number;
}

const FALLBACK_INSETS: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Universal Adaptive Layout Hook
 * Provides reactive, comprehensive layout adaptation metrics for Android phones and tablets.
 */
export function useAdaptiveLayout(): AdaptiveLayout {
  const window = useRNWindowDimensions();
  const width = window.width;
  const height = window.height;
  const fontScale = window.fontScale || 1;
  const scale = window.scale || 1;
  const pixelRatio = scale;

  let safeInsets = FALLBACK_INSETS;
  try {
    // Safe-area insets if wrapped in SafeAreaProvider
    // eslint-disable-next-line react-hooks/rules-of-hooks
    safeInsets = useSafeAreaInsets();
  } catch (_) {
    safeInsets = FALLBACK_INSETS;
  }

  const isLandscape = width > height;
  const isPortrait = !isLandscape;
  const orientation: 'portrait' | 'landscape' = isLandscape ? 'landscape' : 'portrait';

  // Width Class Breakpoints
  let widthClass: WidthClass = 'standard';
  if (width < 360) {
    widthClass = 'compact';
  } else if (width < 400) {
    widthClass = 'standard';
  } else if (width < 480) {
    widthClass = 'comfortable';
  } else if (width < 600) {
    widthClass = 'wide';
  } else if (width < 840) {
    widthClass = 'tablet';
  } else {
    widthClass = 'expandedTablet';
  }

  // Height Class Breakpoints
  let heightClass: HeightClass = 'medium';
  if (height < 500) {
    heightClass = 'short';
  } else if (height > 750) {
    heightClass = 'tall';
  }

  const smallestWidth = Math.min(width, height);
  const isTabletDevice = smallestWidth >= 600;
  // A window qualifies for tablet layout only if width >= 600 and height >= 500
  // to prevent short landscape phones (e.g., 850x390) from receiving oversized tablet compositions
  const isTablet = (isTabletDevice && width >= 600) || (width >= 600 && height >= 500);
  const isLargeTablet = isTablet && (width >= 840 || (smallestWidth >= 720 && isLandscape));
  const isExpandedTablet = isLargeTablet;
  const isPhone = !isTablet;
  const isShortHeight = height < 500;
  const isCompact = width < 360;
  const isStandard = width >= 360 && width < 400;
  const isComfortable = width >= 400 && width < 480;
  const isWide = width >= 480 && width < 600;

  // Horizontal Gutter
  let horizontalGutter = 16;
  if (isCompact) {
    horizontalGutter = 12;
  } else if (isStandard) {
    horizontalGutter = 16;
  } else if (isComfortable) {
    horizontalGutter = 18;
  } else if (isWide) {
    horizontalGutter = 20;
  } else if (isTablet && !isExpandedTablet) {
    horizontalGutter = 28;
  } else {
    horizontalGutter = 36;
  }

  // Max content width
  let contentMaxWidth = width;
  if (isExpandedTablet) {
    contentMaxWidth = 1040;
  } else if (isTablet) {
    contentMaxWidth = isLandscape ? 960 : 720;
  } else if (isWide || (isLandscape && isPhone)) {
    contentMaxWidth = 640;
  }

  // Grid columns
  let columns = 1;
  if (isExpandedTablet) {
    columns = 3;
  } else if (isTablet) {
    columns = isLandscape ? 3 : 2;
  } else if (isWide || (isLandscape && isPhone)) {
    columns = 2;
  } else {
    columns = 1;
  }

  // Spacing scale multiplier
  let spacingScale = 1;
  if (isCompact) {
    spacingScale = 0.85;
  } else if (isComfortable) {
    spacingScale = 1.05;
  } else if (isTablet) {
    spacingScale = 1.2;
  }

  const clamp = (val: number, min: number, max: number) => {
    return Math.max(min, Math.min(max, val));
  };

  /**
   * Viewport-tier based typography helper.
   * Scales based on viewport width tier, NOT by multiplying system fontScale,
   * so React Native native text accessibility scaling is NOT double-applied.
   */
  const scaleFont = (size: number) => {
    if (isCompact) return Math.round(size * 0.92);
    if (isTablet) return Math.round(size * 1.08);
    return size;
  };

  const scaleSpacing = (spacing: number) => {
    return Math.round(spacing * spacingScale);
  };

  return {
    width,
    height,
    orientation,
    isLandscape,
    isPortrait,
    widthClass,
    heightClass,
    isCompact,
    isStandard,
    isComfortable,
    isWide,
    isTablet,
    isLargeTablet,
    isExpandedTablet,
    isPhone,
    isShortHeight,
    fontScale,
    pixelRatio,
    scale,
    safeInsets,
    horizontalGutter,
    contentMaxWidth,
    columns,
    spacingScale,
    scaleFont,
    scaleSpacing,
    clamp,
  };
}

export default useAdaptiveLayout;
