import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
