import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves this project at https://<user>.github.io/fight-or-flight/
// so the build must be rooted at the repo name. Override with VITE_BASE locally
// (e.g. VITE_BASE=/ npm run build) when serving from a domain root.
const base = process.env.VITE_BASE ?? '/fight-or-flight/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Fight or Flight',
        short_name: 'Fight or Flight',
        description:
          'Identify the nearest aircraft, flag possible local-rule breaches, and prefill a complaint to the right authority.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        // Must match Vite base so the installed PWA scope is correct on Pages.
        scope: base,
        start_url: base,
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
