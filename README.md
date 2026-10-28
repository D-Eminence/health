# Health ID frontend

This repository contains the public website and one authenticated portal for the
Health ID platform. It consumes the existing `hid-system` gateway and services;
it does not contain the clinical backend or a database. The integration was
first checked against `hid-system` commit `c4b5445`; later work was checked
against `hid-system` `main`, most recently at `54f79d2`. The supplied `Dashboard.zip`,
`HID.html` and `hid-1.0` are workflow and visual references, not API contracts.

| App | Local origin | Purpose |
| --- | --- | --- |
| `apps/public-web` | `http://localhost:3100` | Next.js public information, live public pricing, demo requests and links into the portal |
| `apps/patient-web` | `http://localhost:3200` | Vite authenticated portal: patient routes at `/`, provider routes at `/provider/*`, platform routes at `/admin/*` |

## Local development

Use Node.js 22 or later. Start the `hid-system` gateway on
`http://localhost:3000`, then configure the two frontends:

```bash
npm install
cp .env.example apps/public-web/.env.local
cp .env.example apps/patient-web/.env.local
npm run dev --workspace @hid/public-web
npm run dev --workspace @hid/patient-web
```

Run the two `dev` commands in separate terminals. The example sets each app's
API base URL to its own origin. In development, Next.js and Vite forward
`/api/v1/*` to `HID_LOCAL_GATEWAY_ORIGIN`. The backend must allow both local
frontend origins in its CORS configuration. A working login or demo submission
requires the corresponding backend services. Local development can omit the
public Turnstile site key only when the backend has Turnstile disabled; staging
and production require configured site and secret keys.
Do not place gateway secrets or provider credentials in `NEXT_PUBLIC_*` or
`VITE_*` variables.

```bash
npm run typecheck
npm run lint
npm run test
npm run audit:boundaries
npm run build:public-web
npm run build:patient-web
npm run audit:launch-build
```

`audit:launch-build` runs hid-system's staging refusals over the patient portal
build (`apps/patient-web/dist`): no Google sign-in (build without
`VITE_HID_GOOGLE_CLIENT_ID` at launch), service worker, source map, file
outside `index.html` and content-hashed `assets/`, or an `index.html` other than
the Vite shell staging allow-lists. One widening, for the Health ID icon in the
browser tab and on a phone's home screen: the files in `apps/patient-web/public`
(`health-id.webmanifest` and its two icons under `icons/`, fixed names), the
shell's links to them, and a `#rrggbb` `theme-color` meta. The production release
serves them from the frontend Worker's assets; hid-system's stager (its `main`
branch only) must take the same widening before a Health-id build is staged
there again.

`npm run check` runs typecheck, lint and tests in sequence. See
[architecture](./docs/ARCHITECTURE.md) for the request and session model and
[open questions](./docs/OPEN-QUESTIONS.md) for backend and deployment work.
The [gap map](./docs/HEALTH_ID_COMPLETE_FRONTEND_GAP_MAP.md) records the initial
reference audit; its baseline matrix is not a current completion report.

## Integration status

The portal now mounts patient, provider and admin workspaces under one origin.
Its browser clients use registered `/api/v1` routes, cookie sessions, CSRF
headers and backend permissions. Public pricing and demo requests use the
commercial API. Supported clinical, operational and platform screens call real
read or mutation endpoints; unsupported reference workflows are identified in
the docs rather than filled with fixture data.
Patient NIN re-verification, facility audit, provider registration-case review,
and staff/platform password recovery also use the existing Identity routes.

There is **no staging environment yet**, so these flows have not passed live
end-to-end acceptance. Production routing must forward `/api/v1` on the portal
origin to the gateway for host-only, SameSite Strict cookies and CSRF. The
backend's current Turnstile hostname rules and known API defects are described
in [open questions](./docs/OPEN-QUESTIONS.md).
