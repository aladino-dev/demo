import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '../.env') }); // .env à la racine du front

/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  outputFileTracingRoot: path.join(here, '..'),
  // /cuisine et /admin : interfaces Vite construites dans public/ (npm run build)
  async rewrites() {
    return [
      { source: '/cuisine', destination: '/cuisine/index.html' },
      { source: '/admin', destination: '/admin/index.html' },
    ];
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
    NEXT_PUBLIC_RESTAURANT: process.env.NEXT_PUBLIC_RESTAURANT || 'fastcamion',
  },
};
