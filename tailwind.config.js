/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // 整体上调一档：原来 8px → 12px，6px → 8px 等
      borderRadius: {
        sm: '0.25rem',     // 4px
        DEFAULT: '0.375rem', // 6px
        md: '0.5rem',      // 8px  (was 6px)
        lg: '0.75rem',     // 12px (was 8px)
        xl: '1rem',        // 16px (was 12px)
        '2xl': '1.25rem',  // 20px (was 16px)
        '3xl': '1.5rem',
        full: '9999px',
      },
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
