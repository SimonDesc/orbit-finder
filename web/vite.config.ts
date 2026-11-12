import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // FastAPI runs on :8000 in dev (API_URL to change it); same-origin /api in production.
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:8000' },
  },
})
