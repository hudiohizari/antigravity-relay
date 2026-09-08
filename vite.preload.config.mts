import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(() => {
  return {
    envPrefix: ['VITE_', 'ANTIGRAVITY_ENABLE_PERFORMANCE_RECORDER'],
    plugins: [],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), './src'),
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        external: ['better-sqlite3', 'keytar'],
      },
    },
  };
});
