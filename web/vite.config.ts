import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev, the API runs on :8080 and Vite proxies to it, so the app and API share an origin.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
});
