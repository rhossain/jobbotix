import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
