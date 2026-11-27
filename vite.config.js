import { defineConfig } from 'vite';

// base './' → o bundle estático abre em qualquer subpath (GitHub Pages, Netlify, CF Pages)
export default defineConfig({
  base: './',
  server: { port: 5199 },
  preview: { port: 5199 },
});
