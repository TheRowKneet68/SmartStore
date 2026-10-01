import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The till talks to the server on the same origin: /api is proxied in development, so the session cookie is a
// first-party, SameSite=Strict cookie (architecture §7.1). SERVER_URL points at the server; it defaults to the local one.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: process.env.SERVER_URL ?? 'http://127.0.0.1:3000', changeOrigin: false } },
  },
});
