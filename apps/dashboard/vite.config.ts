import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Host-Header unverändert lassen: Die API prüft bei schreibenden Anfragen, ob Origin zum Host passt (CSRF-Schutz).
const apiProxy = { '/api': { target: 'http://localhost:3001', changeOrigin: false } };

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    port: 5173,
    proxy: apiProxy,
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
