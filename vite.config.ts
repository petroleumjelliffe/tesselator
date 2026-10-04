/// <reference types="vitest" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',   // relative asset paths, so the build also works from a GitHub Pages project subpath
  plugins: [preact()],
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
});
