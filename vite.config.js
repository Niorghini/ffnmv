/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: 生产 = '/', ffn-pre/ canary = '/ffn-pre/'
// build 时设 VITE_BASE 环境变量,不设就默认 '/'
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    // 性能:拆 vendor chunk,主 bundle 从 553KB → ~250KB,首屏下载/解析快一倍
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          dexie: ['dexie'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
})
