/**
 * Sing Chess — Full Site Redesign
 * Tailwind CSS configuration (v3-compatible, also drives the @theme tokens
 * in styles/globals.css for v4 builds).
 *
 * The all-white theme is enforced through the palette here. The ONLY place a
 * dark color appears is the chessboard's dark square (handled by
 * `body[data-board-theme]` in globals.css, never here).
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: [
    './redesign.html',
    './redesign/**/*.{html,js}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── All-white surfaces ───────────────────────────────────────────
        page: '#ffffff',          // page background (pure white)
        panel: '#ffffff',         // panels / cards / boards
        elevated: '#ffffff',      // hover / lift surfaces
        muted: '#f7f8fa',         // recessed wells / subtle fills
        'muted-2': '#f1f3f6',     // hover fill on white rows

        // ── Soft gray borders (never dark) ───────────────────────────────
        border: '#e6e8eb',
        'border-soft': '#eef0f3',
        'border-strong': '#d6d9dd',

        // ── Text ─────────────────────────────────────────────────────────
        ink: {
          900: '#0f1115',         // primary headings
          700: '#2b3242',         // body text
          500: '#5c6573',         // secondary
          400: '#8b94a3',         // muted / labels
        },

        // ── Accent (a calm, refined graphite used sparingly) ─────────────
        accent: {
          DEFAULT: '#272a31',
          hover: '#3a3f49',
          contrast: '#ffffff',
        },

        // ── Move-quality (analysis pills) ────────────────────────────────
        brilliant: '#27c2a2',
        great: '#749ac0',
        best: '#6bbf59',
        book: '#caa37a',
        inaccuracy: '#eab308',
        mistake: '#f59e0b',
        blunder: '#ef4444',
        miss: '#fb7185',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        card: '16px',
        pill: '999px',
      },
      boxShadow: {
        // Very subtle — premium white-on-white
        soft: '0 1px 2px rgba(15, 17, 21, 0.04)',
        'soft-md': '0 4px 14px rgba(15, 17, 21, 0.05)',
        'soft-lg': '0 12px 32px rgba(15, 17, 21, 0.07)',
        focus: '0 0 0 3px rgba(39, 42, 49, 0.16)',
      },
      width: {
        sidebar: '300px',         // medium-width desktop sidebar
      },
      maxWidth: {
        shell: '1440px',          // max content width
      },
      transitionTimingFunction: {
        soft: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        'fade-up': {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: 0, transform: 'scale(0.97)' },
          '100%': { opacity: 1, transform: 'scale(1)' },
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'piece-pop': {
          '0%': { transform: 'scale(0.8)', opacity: 0 },
          '60%': { transform: 'scale(1.05)' },
          '100%': { transform: 'scale(1)', opacity: 1 },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.28s cubic-bezier(0.22,1,0.36,1) both',
        'fade-up': 'fade-up 0.34s cubic-bezier(0.22,1,0.36,1) both',
        'scale-in': 'scale-in 0.22s cubic-bezier(0.22,1,0.36,1) both',
        'slide-in-left': 'slide-in-left 0.32s cubic-bezier(0.22,1,0.36,1) both',
        'piece-pop': 'piece-pop 0.18s cubic-bezier(0.22,1,0.36,1) both',
      },
      screens: {
        // Treat <768px as mobile (header + board + tabs + drawer)
        mobile: { max: '767px' },
      },
    },
  },
  plugins: [],
};

// The dark-square color is intentionally NOT defined here. It lives entirely
// under body[data-board-theme] in globals.css and is the only non-white
// surface in the entire redesign.
