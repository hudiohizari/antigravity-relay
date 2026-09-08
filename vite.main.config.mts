import { defineConfig, loadEnv } from 'vite';
import path from 'path';

const mainProcessExternals = [
  'bufferutil',
  'better-sqlite3',
  'keytar',
  'koffi',
  '@napi-rs/keyring',
  'ps-list',
  'utf-8-validate',
];

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const oauthClientId =
    process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || env.ANTIGRAVITY_OAUTH_CLIENT_ID || '';
  const oauthClientSecret =
    process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || '';

  return {
    define: {
      'process.env.ANTIGRAVITY_OAUTH_CLIENT_ID': JSON.stringify(oauthClientId),
      'process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET': JSON.stringify(oauthClientSecret),
    },
    plugins: [],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), './src'),
        kafkajs: path.resolve(process.cwd(), './src/mocks/empty.ts'),
        mqtt: path.resolve(process.cwd(), './src/mocks/empty.ts'),
        amqplib: path.resolve(process.cwd(), './src/mocks/empty.ts'),
        'amqp-connection-manager': path.resolve(process.cwd(), './src/mocks/empty.ts'),
        nats: path.resolve(process.cwd(), './src/mocks/empty.ts'),
        ioredis: path.resolve(process.cwd(), './src/mocks/empty.ts'),
        '@fastify/view': path.resolve(process.cwd(), './src/mocks/empty.ts'),
        '@nestjs/microservices': path.resolve(process.cwd(), './src/mocks/nestjs-microservices'),
        '@nestjs/websockets': path.resolve(process.cwd(), './src/mocks/nestjs-websockets'),
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        external: mainProcessExternals,
      },
    },
  };
});
