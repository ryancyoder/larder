import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// transformers.js pins an exact onnxruntime-web build (currently a dev release).
// The WASM binaries must match that build exactly, so the version is read from
// the installed package at build time rather than hardcoded — a stale literal
// here would load a mismatched binary and fail at runtime, not at build.
// Read off disk because the package doesn't expose ./package.json via exports.
const here = path.dirname(fileURLToPath(import.meta.url))
const ortVersion: string = JSON.parse(
  readFileSync(path.join(here, 'node_modules/onnxruntime-web/package.json'), 'utf8'),
).version

export default defineConfig({
  plugins: [react()],
  define: { __ORT_VERSION__: JSON.stringify(ortVersion) },
  // Relative asset paths, so the same build works at a domain root (Netlify,
  // Cloudflare) and under a repo subpath (github.io/<repo>/) without rebuilding.
  base: './',
  server: { port: 5180, host: true },
})
