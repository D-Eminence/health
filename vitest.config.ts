import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * One test runner, two project shapes.
 *
 * Shared packages are framework-agnostic and run in Node: if a package needs a
 * DOM to be tested, that is usually a sign it belongs in an application.
 * Applications run in jsdom with React Testing Library's cleanup registered.
 */
export default defineConfig({
  test: {
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/__tests__/**', '**/index.ts'],
    },
    projects: [
      {
        test: {
          name: 'packages',
          environment: 'node',
          include: ['packages/**/src/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          restoreMocks: true,
        },
      },
      {
        // The React plugin supplies the automatic JSX runtime. Without it,
        // Next.js apps transform their tests with the classic runtime; their
        // tsconfig sets `jsx: preserve` for the Next compiler, and every
        // render fails on an undefined `React`.
        plugins: [react()],
        test: {
          name: 'apps',
          environment: 'jsdom',
          include: ['apps/*/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
          setupFiles: ['./vitest.setup.ts'],
          restoreMocks: true,
          // A test may now wait up to ten seconds for an element (vitest.setup.ts), so it needs more than that to
          // run; OcrFields timed out at the default 5000ms on a busy runner, and the enrollment tests needed over 5s
          // for one element.
          testTimeout: 30000,
        },
        resolve: {
          // Mirrors the `@/*` path alias each Next.js app declares in its
          // tsconfig, so tests import modules the same way the app does.
          alias: {
            '@/': `${fileURLToPath(new URL('./apps/public-web', import.meta.url))}/`,
          },
        },
      },
    ],
  },
})
