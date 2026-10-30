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

// Plain, dotted and destructured uses are caught; computed (navigator['serviceWorker'])
// and aliased ones (const N = Notification) are not: review catches those.
const NO_SERVICE_WORKER = {
  selector: [
    "MemberExpression[property.name=/^(serviceWorker|pushManager|showNotification)$/]",
    "Identifier[name='PushManager']",
    "MemberExpression[property.name='requestPermission'][object.name='Notification']",
    "MemberExpression[property.name='requestPermission'][object.property.name='Notification']",
    "NewExpression[callee.name='Notification']",
    "NewExpression[callee.property.name='Notification']",
    "ObjectPattern > Property[key.name=/^(serviceWorker|pushManager|showNotification|requestPermission)$/]",
  ].join(', '),
  message:
    'The browser\'s service worker, push and notification APIs are used in two places only: apps/patient-web/src/pushDevice.ts, which registers /sw.js, asks for notification permission from the Notifications page switch and subscribes, and apps/patient-web/public/sw.js, the push-only worker that shows a fixed notification and keeps nothing (B6). Use pushDevice.ts. See docs/ARCHITECTURE.md (PHI handling).',
}

const NO_CACHE_STORAGE = {
  selector: "Identifier[name='caches'], MemberExpression[property.name='caches'], ObjectPattern > Property[key.name='caches']",
  message:
    'The Cache API must not hold Health ID pages or data: nothing is kept for offline use. See docs/ARCHITECTURE.md (PHI handling).',
}

const NO_CONSOLE = {
  selector: "MemberExpression[object.name='console']",
  message:
    'Use the logger from @hid/observability. It redacts identifying and clinical fields before anything reaches a console, a breadcrumb or an error report.',
}

// A .focus() written inside the callback is caught; one reached through a helper or a
// named callback (setTimeout(focusTitle)) is not: review catches those. A request from
// useStepFocus (stepFocus.focus(), pinFocus.focus()) is the fix, not the pattern, and
// is told apart by its name.
const FOCUS_CALL = "CallExpression[callee.property.name='focus']:not([callee.object.name=/Focus$/])" +
  // A listener the effect adds (a key or pointer handler) runs when its event fires, not a task after a render.
  ":not(CallExpression[callee.property.name='addEventListener'] > :function CallExpression)"

const NO_DEFERRED_FOCUS = {
  selector: [
    "CallExpression[callee.name='useEffect']",
    "CallExpression[callee.object.name='React'][callee.property.name='useEffect']",
    "CallExpression[callee.name=/^(setTimeout|requestAnimationFrame)$/]",
    "CallExpression[callee.object.name=/^(window|globalThis|self)$/][callee.property.name=/^(setTimeout|requestAnimationFrame)$/]",
  ].map(later => `${later} > :function ${FOCUS_CALL}`).join(', '),
  message:
    'Do not move focus from a useEffect, a setTimeout or a requestAnimationFrame callback. Each runs a task after the commit that shows the element, so anything that looks at focus as soon as the element is shown (a test, a key pressed at once) finds it still where it was, as in health#16. Move the focus into a useLayoutEffect, or make it a focus request handled in one. A timer kept on purpose says why in an eslint-disable comment.',
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      // Historical sketches outside the npm workspaces are not shipped frontend code.
      'play_around/**',
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
      'no-restricted-syntax': ['error', NO_RAW_FETCH, NO_BROWSER_STORAGE, NO_INDEXED_DB, NO_SERVICE_WORKER, NO_CACHE_STORAGE, NO_CONSOLE, NO_DEFERRED_FOCUS],

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
    rules: { 'no-restricted-syntax': ['error', NO_BROWSER_STORAGE, NO_INDEXED_DB, NO_SERVICE_WORKER, NO_CACHE_STORAGE, NO_CONSOLE, NO_DEFERRED_FOCUS] },
  },
  {
    // The logger is the sanctioned console call.
    files: ['packages/observability/src/logger.ts'],
    rules: { 'no-restricted-syntax': ['error', NO_RAW_FETCH, NO_BROWSER_STORAGE, NO_INDEXED_DB, NO_SERVICE_WORKER, NO_CACHE_STORAGE, NO_DEFERRED_FOCUS] },
  },
  {
    // The session module owns the portal hint, the single permitted persisted value.
    files: ['packages/auth/src/session.ts'],
    rules: { 'no-restricted-syntax': ['error', NO_RAW_FETCH, NO_INDEXED_DB, NO_SERVICE_WORKER, NO_CACHE_STORAGE, NO_CONSOLE, NO_DEFERRED_FOCUS] },
  },
  {
    // The script that retires an earlier HID service worker (no Health ID page
    // registers it): a classic worker script that deletes that app's caches.
    files: ['apps/*/public/service-worker.js'],
    languageOptions: { sourceType: 'script', globals: { self: 'readonly', caches: 'readonly' } },
    rules: { 'no-restricted-syntax': ['error', NO_RAW_FETCH, NO_BROWSER_STORAGE, NO_INDEXED_DB, NO_SERVICE_WORKER, NO_CONSOLE, NO_DEFERRED_FOCUS] },
  },
  {
    // "Notifications on this device" (B6): the one module allowed the service worker, push and notification APIs.
    // Every other restriction stays, the Cache API and browser storage among them.
    files: ['apps/patient-web/src/pushDevice.ts'],
    rules: { 'no-restricted-syntax': ['error', NO_RAW_FETCH, NO_BROWSER_STORAGE, NO_INDEXED_DB, NO_CACHE_STORAGE, NO_CONSOLE, NO_DEFERRED_FOCUS] },
  },
  {
    // The portal's push-only worker (B6), a classic worker script: it shows a fixed notification and opens
    // Notifications. No fetch, Cache API, storage or IndexedDB (scripts/check-launch-build.mjs checks the build too).
    files: ['apps/patient-web/public/sw.js'],
    languageOptions: { sourceType: 'script', globals: { self: 'readonly', URL: 'readonly' } },
    rules: { 'no-restricted-syntax': ['error', NO_RAW_FETCH, NO_BROWSER_STORAGE, NO_INDEXED_DB, NO_CACHE_STORAGE, NO_CONSOLE, NO_DEFERRED_FOCUS] },
  },
  {
    // Tests construct fake transports and assert on storage behaviour.
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', 'vitest.setup.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Build tooling runs in Node and reports to a terminal.
    files: ['scripts/**/*.mjs', 'dev/**/*.mjs', 'infra/cloudflare/**/*.mjs', '*.config.{js,ts,mjs}', 'apps/*/*.config.{ts,mjs}'],
    rules: { 'no-restricted-syntax': 'off', 'no-undef': 'off' },
  },
)
