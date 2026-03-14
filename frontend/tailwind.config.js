/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          400: '#6b8cff',
          500: '#4d6ef5',
          600: '#3d5ce0',
          700: '#2f4ac0',
          900: '#1a2a6e',
        },
        surface: {
          900: '#0d0f14',
          800: '#13161d',
          700: '#1a1d27',
          600: '#22263a',
          500: '#2d334d',
        },
      },
    },
  },
  plugins: [],
};
