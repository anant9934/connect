/**
 * @tathastu/ui Design System Design Tokens
 * Curated HSL colors, modern dark-mode palette, typography scale,
 * transitions, and accessible focus states.
 */

export const tokens = {
  colors: {
    background: '#090a0f',
    surface: '#11131a',
    surfaceElevated: '#171a24',
    surfaceBorder: 'rgba(255, 255, 255, 0.08)',
    surfaceBorderFocus: 'rgba(99, 102, 241, 0.6)',

    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',

    brand: {
      primary: '#6366f1', // Indigo
      primaryHover: '#4f46e5',
      primaryLight: '#818cf8',
      cyan: '#06b6d4',
      emerald: '#10b981',
      purple: '#8b5cf6',
      ambientGlow: 'rgba(99, 102, 241, 0.15)',
    },

    status: {
      online: '#10b981',
      active: '#06b6d4',
      standby: '#f59e0b',
      inCall: '#8b5cf6',
      error: '#ef4444',
    },
  },
  typography: {
    fontFamilySans: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontFamilyMono: 'JetBrains Mono, Fira Code, monospace',
  },
  radii: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    xl: '24px',
    full: '9999px',
  },
  shadows: {
    soft: '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
    glow: '0 0 35px -5px rgba(99, 102, 241, 0.25)',
    card: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
  },
  transitions: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    normal: '250ms cubic-bezier(0.4, 0, 0.2, 1)',
    smooth: '400ms cubic-bezier(0.16, 1, 0.3, 1)',
  },
} as const;

/**
 * Tathastu Connect Warm-White Mobile & Web Design Tokens
 * Used across Web and future Native Android/iOS applications.
 */
export const connectTokens = {
  colors: {
    background: '#FAF9FC',
    backgroundAlt: '#FCFCFA',
    surface: '#FFFFFF',
    surfaceSubtle: '#F6F5F2',
    border: '#E4E2DB',
    borderSubtle: '#F0EEE8',

    // Typography
    textPrimary: '#17151F',
    textSecondary: '#5E5A50',
    textMuted: '#6B675C',
    textSubtle: '#9C988D',

    // Signature Brand Accents
    violet: {
      primary: '#7444E8',
      hover: '#6537D6',
      surface: '#F1EBFF',
      text: '#5A2FC7',
      border: '#E3D9FC',
    },
    yellow: {
      primary: '#FFC93C',
      hover: '#F2BD31',
      surface: '#FFF4D1',
      text: '#6B4E00',
      border: '#FBEAB4',
    },
    mint: {
      primary: '#2DBE74',
      light: '#86E3A8',
      surface: '#E4F8EB',
      text: '#1F6B3B',
      border: '#CDEED8',
    },
    coral: {
      primary: '#FF6B6B',
      surface: '#FFE9E9',
      text: '#9B2C2C',
      border: '#FBD2D2',
    },
    neutralDark: '#17151F',
  },
  radii: {
    pill: 9999,
    cardMobile: 24,
    cardDesktop: 32,
    bubble: 16,
    tileMobile: 18,
    tileDesktop: 20,
    button: 9999,
  },
  touchTarget: {
    minWidth: 44,
    minHeight: 44,
  },
  spacing: {
    gutterMobile: 16,
    gutterDesktop: 32,
  },
} as const;
