/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#0B0E11',    // Deepest background
          surface: '#1E2329', // Card/Table background (slightly lighter)
          surfaceHighlight: '#2B3139', // Hover states
          border: '#2B3139',  // Borders
          text: {
            primary: '#EAECEF', // Headings
            secondary: '#848E9C', // Subtitles/Meta
            muted: '#474D57',   // Disabled/Placeholder
          },
          accent: '#F0B90B',  // Binance Yellow (classic crypto accent)
          success: '#0ECB81', // Crypto Green
          danger: '#F6465D',  // Crypto Red
          info: '#1199FA',    // Blue for links/info
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Roboto Mono', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-glow': 'conic-gradient(from 180deg at 50% 50%, #161A1E 0deg, #0B0E11 180deg, #161A1E 360deg)',
      }
    },
  },
  plugins: [],
}
