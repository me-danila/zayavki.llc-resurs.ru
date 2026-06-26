import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true,
    // dev: API и /repair проксируем на бэкенд (bun server/index.ts :3005).
    // На прод-сборку (vite build) не влияет.
    proxy: {
      "/api": "http://localhost:3005",
      "/repair": "http://localhost:3005",
    },
  },
  preview: {
    allowedHosts: true,
  },
})
