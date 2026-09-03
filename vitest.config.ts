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
        test: {
          name: 'apps',
          environment: 'jsdom',
          include: ['apps/**/src/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
          setupFiles: ['./vitest.setup.ts'],
          restoreMocks: true,
        },
      },
    ],
  },
})
