# Frontend staging release

Source repository: `D-Eminence/Health-id`. Backend infrastructure remains in the
separate Terraform workspace. This repository builds static frontend archives,
not new database containers or Docker images.

## Public configuration and hosts

`config/staging.json` contains public configuration only. Each of the seven portal
builds uses its own HTTPS origin for browser requests. The Worker proxies only
`/api/v1` to the existing protected staging gateway. Secure cookies and CSRF
remain scoped to the originating hostname. The public website uses
`www.staging.healthidentitydirectory.com`, and links to the existing portal.

Provider widgets and login requests share the backend's product-specific
Turnstile action. Recovery runs on the canonical portal and returns only to a
known product. Existing admin bookmarks redirect to `/admin/...`.

## Repeatable builds

Use Node 22.23.2 and Python 3 from a clean committed checkout:

```text
npm ci
npm run audit:boundaries
npm run check
npm run test:edge
npm run test:release
npm audit --audit-level=high
npm run build:staging
python scripts/prepare-staging-workers.py --dry-run
```

The GitHub Actions `Staging frontend artifacts` workflow runs these commands and
uploads eight archives plus `manifest.json`. It requires no AWS credentials and
does not deploy or alter DNS. Artifacts bind the repository commit, lockfile,
public configuration, edge implementation and every asset's SHA-256. The release
publisher must validate these fields and a successful run at that exact commit.

The public site exports Next.js pages. Query-dependent facility forms hydrate
inside Suspense boundaries; images use bundled original assets, with no external
image service or Next.js server. Security headers come from the Worker.

## Deployment and acceptance

The infrastructure workspace's component publisher retains prior Worker
deployments, publishes archives to the existing protected S3 backup bucket and
deploys only exact staging hosts. It checks the current backend separately from
the frontend commit. The previous full-release receipt stays intact.

Deploy admin first, then the other portals. Check HTTPS, asset hashes, deep links,
same-origin API responses, authorized sessions, CSRF, reload, logout, recovery
and Google popup behavior. Retain the previous Worker version IDs for rollback.

Public forms require the Identity service's exact `www.staging` origin and
Turnstile public actions; the portal rollouts do not depend on that added public
host. Complete those scoped backend changes before deploying the public website.

## Developer handoff

The supplied new patient UI does not render the `importedRecords` response from
the current EHR service, and its API registry has no chatbot integration. These
are recorded frontend feature gaps; the migrated database and backend endpoints
remain intact. This release does not claim those UI journeys are implemented.
Admin roles, QoreID activation and provider sandbox acceptance are governed
separately from a successful frontend deployment.
