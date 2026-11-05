import { defineConfig } from 'vitest/config';

/** Node-side checks on the design tokens (tailwind.css); see tokens.node-spec.ts. */
export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    include: ['src/**/*.node-spec.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
