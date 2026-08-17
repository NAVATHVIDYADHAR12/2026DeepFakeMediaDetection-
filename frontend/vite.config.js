import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  css: {
    preprocessorOptions: {
      // Dart Sass's legacy JS API is deprecated; opt into the modern compiler.
      scss: { api: 'modern-compiler' },
    },
  },
  server: {
    port: 5173,
    // During development the UI runs on :5173 and the API on :8000.
    // Proxying keeps all fetches same-origin, so no CORS handling is needed.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // The backend serves this build directly, so assets must be relative.
    assetsDir: 'assets',
  },
})
