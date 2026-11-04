import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/kerr-black-hole/.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
