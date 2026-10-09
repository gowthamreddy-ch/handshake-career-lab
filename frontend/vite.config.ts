import { defineConfig } from 'vite';
const proxy = { '/api': { target: 'http://127.0.0.1:4191', changeOrigin: false } };
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/handshake-career-lab/' : '/',
  define: { 'import.meta.env.VITE_DEMO_MODE': JSON.stringify(mode === 'pages' ? 'pages' : 'api') },
  server: { proxy }, preview: { proxy },
  build: { target: 'es2022', sourcemap: false },
}));
