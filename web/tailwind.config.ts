import type { Config } from 'tailwindcss';

// Single source of truth for the Cortex UI design tokens (DR-0018 §5, v2 定稿).
// No screen may hard-code a hex value — every color/space/radius/shadow/font below
// is consumed as a Tailwind token. Status pills and mono text are built from `pill`
// and `fontFamily.mono` respectively.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // State palette
        state: {
          ink: '#191C22',
          run: '#4655D4',
          wait: '#A96B0B',
          done: '#23854F',
          fail: '#C03D33',
          gray: '#F1F2F5',
        },
        // Status-pill tinted bg/fg pairs
        pill: {
          'running-bg': '#EEF0FA',
          'running-fg': '#4655D4',
          'waiting-bg': '#F7ECCE',
          'waiting-fg': '#8A5B06',
          'done-bg': '#E9F4EE',
          'done-fg': '#23854F',
          'failed-bg': '#FBEDEB',
          'failed-fg': '#C03D33',
          'cancelled-bg': '#F1F2F5',
          'cancelled-fg': '#8A93A2',
        },
        // Surfaces
        surface: {
          card: '#FFFFFF',
          canvas: '#F0EEE9',
          'canvas-alt': '#F7F8FA',
          rail: '#FBFBFC',
        },
      },
      borderColor: {
        card: 'rgba(0,0,0,0.08)',
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          '"PingFang SC"',
          '"Segoe UI"',
          '"Microsoft YaHei"',
          '"Noto Sans CJK SC"',
          'sans-serif',
        ],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        ui: ['13px', { lineHeight: '1.4' }],
        body: ['14px', { lineHeight: '1.5' }],
      },
      // 8px grid
      spacing: {
        grid: '8px',
        '0.5g': '4px',
        '1g': '8px',
        '1.5g': '12px',
        '2g': '16px',
        '3g': '24px',
        '4g': '32px',
        '5g': '40px',
        '6g': '48px',
      },
      borderRadius: {
        card: '10px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
};

export default config;
