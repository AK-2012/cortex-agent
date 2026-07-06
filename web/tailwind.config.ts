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
        overlay: '0 10px 38px rgba(0,0,0,0.20), 0 6px 12px rgba(0,0,0,0.12)',
      },
      // Overlay enter/exit motion (DR-0018 §5, task 970d). Driven off Radix
      // `data-[state=open|closed]` attributes; kept token-side (no extra dep).
      // `motion-reduce:` variants in the primitives disable transforms.
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'zoom-in': {
          from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'zoom-out': {
          from: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
          to: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.96)' },
        },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'slide-out-right': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(100%)' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'slide-out-left': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-100%)' } },
        'toast-in': {
          from: { opacity: '0', transform: 'translateX(calc(100% + 16px))' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'toast-out': {
          from: { opacity: '1', transform: 'translateX(0)' },
          to: { opacity: '0', transform: 'translateX(calc(100% + 16px))' },
        },
        'popover-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'popover-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.96)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'fade-out': 'fade-out 120ms ease-in',
        'zoom-in': 'zoom-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        'zoom-out': 'zoom-out 120ms ease-in',
        'slide-in-right': 'slide-in-right 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-out-right': 'slide-out-right 160ms ease-in',
        'slide-in-left': 'slide-in-left 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-out-left': 'slide-out-left 160ms ease-in',
        'toast-in': 'toast-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'toast-out': 'toast-out 120ms ease-in',
        'popover-in': 'popover-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
        'popover-out': 'popover-out 100ms ease-in',
      },
    },
  },
  plugins: [],
};

export default config;
