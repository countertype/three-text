import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['three-text']
  },
  server: {
    port: 3000,
    fs: {
      allow: [
        // Allow serving files from the project root
        path.resolve(__dirname, '../../')
      ]
    }
  }
});
