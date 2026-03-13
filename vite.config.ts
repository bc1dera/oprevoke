import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          opnet: ['opnet'],
          btcvision: [
            '@btc-vision/bitcoin',
            '@btc-vision/transaction',
            '@btc-vision/walletconnect',
          ],
        },
      },
    },
  },
});
