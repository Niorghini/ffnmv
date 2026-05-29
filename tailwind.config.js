/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2F8C5C',
        'primary-dark': '#1E6640',
        bg: {
          main: '#F5F6F7',
          card: '#FFFFFF',
          sidebar: '#F0F1F2',
        },
        heatmap: {
          0: '#EBEDF0',
          1: '#9BE9A7',
          2: '#40C463',
          3: '#30A14E',
          4: '#216E39',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        fadeInScale: {
          '0%': { opacity: '0', transform: 'scale(0.8)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        flashEmail: {
          '0%, 100%': { color: '#0077B6' },
          '50%': { color: '#9CA3AF' },
        },
      },
      animation: {
        fadeInScale: 'fadeInScale 0.3s ease forwards',
        flashEmail: 'flashEmail 1s step-end infinite',
      },
    },
  },
  plugins: [],
}