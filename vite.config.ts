import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      // Prefer browser builds for packages with export maps (e.g. @google/genai/web).
      conditions: ['browser', 'module', 'import', 'default'],
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@google/genai/web': path.resolve(
          __dirname,
          'node_modules/@google/genai/dist/web/index.mjs'
        ),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
