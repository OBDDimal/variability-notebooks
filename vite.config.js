import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const base = '/'; // Use '/' for both dev and production
  
  return {
    base,
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      emptyOutDir: true,
      sourcemap: false
    },
    server: {
      headers: {
        'Service-Worker-Allowed': '/'
      }
    },
    preview: {
      headers: {
        'Service-Worker-Allowed': '/'
      }
    }
  }
}) 