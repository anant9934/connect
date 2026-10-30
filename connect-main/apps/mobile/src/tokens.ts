/**
 * Tathastu Meet Native Mobile - Universal Design Tokens
 * Re-exports the shared design tokens from @tathastu/ui to ensure 100% brand parity
 * across Web and Native Android phones & tablets.
 */

import { connectTokens } from '@tathastu/ui';

export const brandColors = {
  // Near-black and dark neutrals
  neutralDark: '#17151F',
  darkSurface: '#201D2C',
  stageDark: '#0D0C13',

  // Signature Yellow
  yellow: {
    primary: '#FFC93C',
    hover: '#F2BD31',
    surface: '#FFF4D1',
    surfaceSubtle: '#FFFBEA',
    text: '#6B4E00',
    border: '#FBEAB4',
  },

  // Signature Purple / Violet
  purple: {
    primary: '#7444E8',
    hover: '#6537D6',
    surface: '#F1EBFF',
    text: '#5A2FC7',
    border: '#E4DCFC',
  },

  // Signature Mint / Green
  mint: {
    primary: '#2DBE74',
    light: '#86E3A8',
    surface: '#E4F8EB',
    text: '#1F6B3B',
    border: '#CDEED8',
  },

  // Accent Coral / Red
  coral: {
    primary: '#FF6B6B',
    danger: '#E53E3E',
    surface: '#FFEAEA',
    surfaceSubtle: '#FFE9E9',
    text: '#9B2C2C',
    border: '#FBD2D2',
  },

  // Surfaces & Backgrounds
  background: '#FAF9FC',
  backgroundAlt: '#FCFCFA',
  surface: '#FFFFFF',
  surfaceSubtle: '#F6F5F2',

  // Borders
  border: '#E4E2DB',
  borderSubtle: '#F0EEE8',
  borderDark: 'rgba(255, 255, 255, 0.1)',

  // Typography
  textPrimary: '#17151F',
  textSecondary: '#5E5A50',
  textMuted: '#6B675C',
  textSubtle: '#9C988D',
  textWhite: '#FFFFFF',
};

import { Platform } from 'react-native';

export const fontFamilies = {
  regular: Platform.select({
    android: 'Inter-Regular',
    ios: 'Inter-Regular',
    default: 'sans-serif',
  }),
  medium: Platform.select({
    android: 'Inter-Medium',
    ios: 'Inter-Medium',
    default: 'sans-serif-medium',
  }),
  semiBold: Platform.select({
    android: 'Inter-SemiBold',
    ios: 'Inter-SemiBold',
    default: 'sans-serif',
  }),
  bold: Platform.select({
    android: 'Inter-Bold',
    ios: 'Inter-Bold',
    default: 'sans-serif',
  }),
  sans: Platform.select({
    android: 'sans-serif',
    ios: 'System',
    default: 'sans-serif',
  }),
  mono: Platform.select({
    android: 'monospace',
    ios: 'Courier',
    default: 'monospace',
  }),
};

export const mobileTokens = {
  ...connectTokens,
  colors: {
    ...connectTokens.colors,
    ...brandColors,
  },
  fonts: fontFamilies,
  touchTarget: {
    minWidth: 44,
    minHeight: 44,
  },
  gutters: {
    compact: 12,
    standard: 16,
    comfortable: 18,
    wide: 20,
    tablet: 28,
    expandedTablet: 36,
  },
};

export default mobileTokens;

