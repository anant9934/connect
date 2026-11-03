import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './features/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        page: '#FCFCFA',
        surface: {
          DEFAULT: '#F8F8F5',
          card: '#FFFFFF',
          elevated: '#FFFFFF',
        },
        hairline: '#ECECE6',
        ink: {
          DEFAULT: '#17171A',
          secondary: '#5F5F68',
          muted: '#8B8B93',
        },
        // Room Types & Dedicated Palette (No cyan, no pink, no blue)
        room: {
          instant: {
            bg: '#17171A',
            text: '#FFFFFF',
          },
          research: {
            tint: '#F1EBFF',
            primary: '#7444E8',
          },
          project: {
            tint: '#E4F8EB',
            primary: '#2DBE74',
          },
          mentor: {
            tint: '#FFF4D1',
            primary: '#FFC93C',
          },
          community: {
            tint: '#FFE9E9',
            primary: '#FF6B6B',
          },
        },
        // Specialized control & UI colors
        control: {
          mint: '#86E3A8',
          purple: '#7444E8',
          yellow: '#FFC93C',
          coral: '#FF6B6B',
          white: '#FFFFFF',
        },
      },
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'system-ui', '-apple-system', 'sans-serif'],
        heading: ['var(--font-bricolage)', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      boxShadow: {
        soft: '0 2px 12px -2px rgba(23, 23, 26, 0.04), 0 1px 3px 0 rgba(23, 23, 26, 0.02)',
        card: '0 4px 20px -4px rgba(23, 23, 26, 0.06), 0 1px 2px 0 rgba(23, 23, 26, 0.03)',
        floating: '0 12px 36px -8px rgba(23, 23, 26, 0.08), 0 4px 12px -2px rgba(23, 23, 26, 0.03)',
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
        '4xl': '32px',
      },
    },
  },
  plugins: [],
};

export default config;
