import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the same build works at a domain root (Netlify,
  // Cloudflare) and under a repo subpath (github.io/<repo>/) without rebuilding.
  base: './',
  server: { port: 5180, host: true },
})
