import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // Numero di versione mostrato nell'app (da package.json): la guida incorporata è quella di questa versione.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      registerType: 'autoUpdate',
      includeAssets: ['brand/icon-192.png', 'brand/icon-512.png', 'brand/icon-maskable-192.png', 'brand/icon-maskable-512.png', 'brand/badge-96.png', 'brand/favicon.svg'],
      manifest: {
        name: 'WayMatch',
        short_name: 'WayMatch',
        description: 'Piattaforma di carpooling aziendale. Due strade, una via.',
        theme_color: '#14424F',
        background_color: '#F3F7F5',
        display: 'standalone',
        lang: 'it',
        start_url: '/',
        icons: [
          { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/brand/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    // Le guide in ../docs sono incorporate nell'app.
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
  build: {
    outDir: '../backend/public',
    emptyOutDir: true,
  },
});
