/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          tertiary: 'var(--bg-tertiary)',
          hover: 'var(--bg-hover)',
          active: 'var(--bg-active)',
          terminal: 'var(--bg-terminal)'
        },
        border: {
          DEFAULT: 'var(--border-default)',
          subtle: 'var(--border-subtle)'
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          'on-purple': 'var(--text-on-purple)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          subtle: 'var(--accent-subtle)',
          muted: 'var(--accent-muted)'
        },
        status: {
          working: 'var(--status-working)',
          waiting: 'var(--status-waiting)',
          done: 'var(--status-done)',
          danger: 'var(--status-danger)'
        },
        sidebar: {
          bg: 'var(--sidebar-bg)',
          active: 'var(--sidebar-active)'
        }
      },
      fontFamily: {
        // v2.8.0: SINGLE-FAMILY typography. Inter Tight covers everything
        // from 10px caption to 24px display; weight (400/500/600/700)
        // does the hierarchy work, not a second family. Space Grotesk
        // moved to `font-display` for the very few marketing-tier titles
        // that genuinely need a display face — most callers on
        // `font-heading` should just render Inter Tight and stop double-
        // familying.
        sans: ['Inter Tight', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        heading: ['Inter Tight', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Space Grotesk', 'Inter Tight', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
}
