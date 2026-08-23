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
        sans: ['DM Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        heading: ['Space Grotesk', 'sans-serif']
      }
    }
  },
  plugins: []
}
