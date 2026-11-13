import { defineConfig } from 'vite';

// A relative base makes the build work both at the domain root and under
// /Mandelbrot/ on GitHub Pages.
export default defineConfig({
  base: './',
});
