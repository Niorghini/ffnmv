/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 沿用 v0.7.0 蓝 (#0077B6)
        primary: '#0077B6',
        'primary-dark': '#005f8c',
        bg: {
          main: '#f5f6f7',
          card: '#FFFFFF',
          sidebar: '#F0F1F2',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        fadeInScale: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        fadeInScale: 'fadeInScale 0.2s ease forwards',
      },
    },
  },
  plugins: [],
}
