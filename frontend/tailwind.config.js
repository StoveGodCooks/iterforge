/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['Space Grotesk', 'system-ui', 'sans-serif'],
        mono:  ['IBM Plex Mono', 'Menlo', 'monospace'],
        forge: ['Syne', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Primary accent — molten yellow
        brand: {
          50:  '#fffde7',
          100: '#fff9c4',
          200: '#fff59d',
          300: '#fff176',
          400: '#ffcc00',   // molten yellow — primary
          500: '#ff4d00',   // forge orange — secondary
          600: '#e64400',
          700: '#cc3d00',
          900: '#7c1d00',
        },
        // Background scale — pure black to dark glass
        surface: {
          900: '#000000',   // pure black
          800: '#0a0a0a',   // panel bg
          700: '#111111',   // card bg
          600: '#1a1a1a',   // borders
          500: '#242424',   // hover / active
          400: '#333333',   // muted elements
        },
      },
      boxShadow: {
        'forge': '0 0 40px rgba(255, 204, 0, 0.15)',
        'forge-lg': '0 0 80px rgba(255, 204, 0, 0.2)',
        'orange': '0 0 40px rgba(255, 77, 0, 0.2)',
      },
      borderColor: {
        'forge': 'rgba(255, 204, 0, 0.12)',
        'forge-active': 'rgba(255, 204, 0, 0.6)',
      },
      backdropBlur: {
        'forge': '40px',
      },
    },
  },
  plugins: [],
};
