import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En production, construit dans web/public/admin : servi par le site Next.js sur /admin
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/admin/' : '/',
  envDir: '..',
  build: { outDir: '../web/public/admin', emptyOutDir: true },
}));
