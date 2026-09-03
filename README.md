# Health ID frontend

The frontend layer of the Health ID platform. A **consumer** of the existing
Health ID backend — it contains no backend code, no database access, and no
second interpretation of the system.

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — the architecture and why it is shaped this way
- [docs/OPEN-QUESTIONS.md](./docs/OPEN-QUESTIONS.md) — what the existing system does not answer yet

## Getting started

```bash
npm install
cp .env.example apps/patient-web/.env.local    # then edit
cp .env.example apps/public-web/.env.local     # then edit
npm run check                                  # typecheck + lint + tests
```

There is no default gateway address. A build without `*_HID_API_BASE_URL`
fails, by design.

```bash
npm run dev --workspace @hid/public-web    # :3100
npm run dev --workspace @hid/patient-web   # :3200
```

## Layout

| Path | Purpose |
| --- | --- |
| `apps/public-web` | Public site. Next.js. Granted one backend service; cannot reach anything clinical |
| `apps/patient-web` | Patient application. Vite |
| `packages/config` | Environment resolution and the public-environment guard |
| `packages/contracts` | Verified endpoint registry, domain vocabulary, application boundaries |
| `packages/http` | The transport layer — the only place `fetch` is called |
| `packages/api` | Typed service modules, bound to one application's boundary |
| `packages/auth` | Principals, in-memory session, route guards |
| `packages/observability` | PHI-safe logging and redaction |
| `packages/ui` | Design tokens and shared primitives |

## Rules the tooling enforces

Not conventions — checks that fail a build:

- No `fetch` outside `@hid/http`; no `@supabase/supabase-js`, database driver or
  cloud SDK anywhere
- No `localStorage` / `sessionStorage` / `indexedDB` outside `@hid/auth`, which
  persists exactly one non-identifying value
- No `console` outside `@hid/observability`, which redacts before it writes
- No cross-application imports
- No secret-shaped environment variable or value in a public bundle
- An application cannot call a service it is not granted — a **compile** error

```bash
npm run check              # typecheck, lint, tests
npm run audit:boundaries   # repository-level architecture checks
```

## Status

119 tests passing; both applications build. **No integration has been tested
against staging or production** — nothing here has spoken to a real Health ID
environment. See the integration sequence in the architecture document.
