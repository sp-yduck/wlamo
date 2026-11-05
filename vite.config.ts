import { defineConfig } from 'vite';

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
  optimizeDeps: { exclude: ['@wllama/wllama'] },
  build: { target: 'es2022' },
});
