/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', '"Noto Sans Thaana"', 'sans-serif'],
        thaana: ['"Noto Sans Thaana"', '"MV Faseyha"', 'Faruma', 'sans-serif'],
      },
      colors: {
        ocean: {
          50: '#eef8fb', 100: '#d4eef5', 200: '#a9dceb', 300: '#72c3dc', 400: '#3aa3c6',
          500: '#1d86ab', 600: '#166b8d', 700: '#145673', 800: '#13475f', 900: '#0f3a4f', 950: '#082433',
        },
        coral: { 500: '#e4572e', 600: '#c8441e' },
        sand: { 50: '#fbf8f2', 100: '#f4ecdc' },
      },
    },
  },
  plugins: [],
};
