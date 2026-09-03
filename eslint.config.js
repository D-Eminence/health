import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Lint rules for the Health ID frontend ecosystem.
 *
 * Alongside the usual correctness rules, this file encodes the architectural
 * constraints that are easy to state in a document and easy to erode in a pull
 * request. Each restriction names the reason, because a rule whose purpose is
 * unclear gets disabled the first time it is inconvenient.
 */

const NO_RAW_FETCH = {
  selector: "CallExpression[callee.name='fetch']",
  message:
    'Do not call fetch directly. Use a service module from @hid/api so the call inherits the gateway base URL, authentication, error handling, cancellation and retry policy.',
}

const NO_BROWSER_STORAGE = {
  selector:
    "MemberExpression[object.name=/^(localStorage|sessionStorage)$/], MemberExpression[property.name=/^(localStorage|sessionStorage)$/]",
  message:
    'Browser storage is off limits here. Sessions live in memory (@hid/auth) and PHI is never persisted. The only permitted persisted value is the portal hint in @hid/auth.',
}

const NO_INDEXED_DB = {
  selector: "MemberExpression[property.name='indexedDB'], Identifier[name='indexedDB']",
  message: 'IndexedDB must not be used to hold Health ID data. See docs/ARCHITECTURE.md, PHI handling.',
}

const NO_CONSOLE = {
  selector: "MemberExpression[object.name='console']",
  message:
    'Use the logger from @hid/observability. It redacts identifying and clinical fields before anything reaches a console, a breadcrumb or an error report.',
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-syntax': ['error', NO_RAW_FETCH, NO_BROWSER_STORAGE, NO_INDEXED_DB, NO_CONSOLE],

      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message:
                'The browser must not talk to Supabase, Postgres or any internal service directly. Every request goes through the Health ID Gateway via @hid/api.',
            },
          ],
          patterns: [
            {
              group: ['**/apps/*/**'],
              message:
                'Applications must not import from each other. Shared code belongs in a package under packages/.',
            },
            {
              group: ['@hid/*/src/*', '@hid/*/dist/*'],
              message:
                'Import a package through its public entry point, not through its internals.',
            },
          ],
        },
      ],
    },
  },

  // --- Exemptions, each scoped to the one module that owns the concern -------

  {
    // The transport layer is where fetch is allowed to exist. That is the point
    // of having a transport layer.
    files: ['packages/http/src/client.ts'],
    rules: { 'no-restricted-syntax': ['error', NO_BROWSER_STORAGE, NO_INDEXED_DB, NO_CONSOLE] },
  },
  {
    // The logger is the sanctioned console call.
    files: ['packages/observability/src/logger.ts'],
    rules: { 'no-restricted-syntax': ['error', NO_RAW_FETCH, NO_BROWSER_STORAGE, NO_INDEXED_DB] },
  },
  {
    // The session module owns the portal hint, the single permitted persisted value.
    files: ['packages/auth/src/session.ts'],
    rules: { 'no-restricted-syntax': ['error', NO_RAW_FETCH, NO_INDEXED_DB, NO_CONSOLE] },
  },
  {
    // Tests construct fake transports and assert on storage behaviour.
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'vitest.setup.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Build tooling runs in Node and reports to a terminal.
    files: ['scripts/**/*.mjs', '*.config.{js,ts,mjs}', 'apps/*/*.config.{ts,mjs}'],
    rules: { 'no-restricted-syntax': 'off', 'no-undef': 'off' },
  },
)
