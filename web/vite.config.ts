import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
import { defineConfig } from 'vite';
import {consolePort} from '../server/src/runtime.ts';

// No @vitejs/plugin-react on purpose: Vite compiles .tsx with esbuild out of the box and
// the automatic JSX runtime comes from tsconfig's "jsx": "react-jsx". The only thing we
// give up is React Fast Refresh, which a three-screen console does not need.
export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {alias: {"@": fileURLToPath(new URL("./src", import.meta.url))}},
  server: {
    port: 8321,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${consolePort()}`, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
