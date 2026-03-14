import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin';
import manifestJson from './manifest.json' assert { type: 'json' };

const manifest = manifestJson as ManifestV3Export;

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  build: {
    target: 'es2022',
    minify: false,
  },
});
