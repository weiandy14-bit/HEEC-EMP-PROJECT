import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages 以 repo 子路徑服務（如 /HEEC-EMP-PROJECT/）。由 VITE_BASE 注入；
  // 本機開發、E2E 與一般 build 預設 '/'，行為不變。
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    // 開發期代理 API；正式部署由反向代理/同源處理
    proxy: { '/api': process.env.VITE_API_TARGET ?? 'http://localhost:3023' },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
    css: false,
  },
});
