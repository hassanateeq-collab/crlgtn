import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    // Pinned: this origin is the ALLOWED_ORIGINS dev fallback in
    // supabase/functions/_shared/cors.ts. A drifting port breaks CORS.
    port: 5173,
    strictPort: true,
  },
})
