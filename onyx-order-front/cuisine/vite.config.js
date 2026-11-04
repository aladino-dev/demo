import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En production, construit dans web/public/cuisine : servi par le site Next.js sur /cuisine
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/cuisine/' : '/',
  envDir: '..',
  build: { outDir: '../web/public/cuisine', emptyOutDir: true },
}));
