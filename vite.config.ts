import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0', // Listen on all interfaces for Docker
    watch: {
      usePolling: true, // Required for Docker on some systems
      interval: 1000,
    },
    hmr: {
      // Hot Module Replacement config for Docker
      clientPort: 5173,
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3003',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
