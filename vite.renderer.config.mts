import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  return {
    server: {
      port: 51730,
    },
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
      }),
      tailwindcss(),
      react(),
    ],
    optimizeDeps: {
      entries: ['index.html'],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    resolve: {
      preserveSymlinks: true,
      alias: {
        '@': path.resolve(process.cwd(), './src'),
      },
    },
  };
});
