import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

const certDir = path.resolve(__dirname, '..', 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

const hasCerts = fs.existsSync(keyPath) && fs.existsSync(certPath);
const backendPort = process.env.PORT || 8000;
const backendProtocol = hasCerts ? 'https' : 'http';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    https: hasCerts ? {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    } : false,
    proxy: {
      '/api': {
        target: `${backendProtocol}://localhost:${backendPort}`,
        changeOrigin: true,
        secure: false, // accept self-signed cert from backend
      },
    },
  },
  build: {
    outDir: '../static',
    emptyOutDir: true,
  },
  appType: 'spa',
});
