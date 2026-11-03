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

## Error reporting

The portal and the public site can send error reports to Sentry (owner's
approval, 2026-11-03). It is off: `sentry_dsn` is `null` in
`config/staging.json` and `config/production.json`, and a build without a DSN
adds no listener and sends nothing.

To switch it on for an environment, set `sentry_dsn` to the Sentry project's
public DSN (`https://<32 hex key>@<host>[/<prefix>]/<project id>`; the release
check refuses anything else) and build a release. `build-staging.py` then gives
every app `*_SENTRY_DSN`; it gives every app `*_BUILD`, the first 12 characters
of the source commit, either way. Set it back to `null` and rebuild to switch it
off.

A report holds the error's type, its stack (script addresses without query or
hash, function names, line and column), the route name (`/card/:id`, never the
address itself), the environment's name and the build. It never holds the
error's message, anything typed into a page, a page address, a Health ID, an
email, a phone number, an account or user id, cookies or an IP address, and
there is no session replay. Each kind of error is sent once per page load, ten
reports at most.

In the Sentry project, before switching it on: turn on "Prevent Storing of IP
Addresses" and data scrubbing (the Data Scrubber with the default scrubbers),
under Security & Privacy. When a Content-Security-Policy is added (hand-off D6),
its `connect-src` must allow the ingest host the DSN names, or reports are
blocked.

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

Each product site (`ehr`, `lab`, `pharmacy`, `migrate`, `outreach`) and the
patient portal (`staging`) answers its `/` to someone not signed in there with a
landing page from the public site: a product's page, or the public site's
`/patients` page on the portal. It gets it through a service binding,
`PUBLIC_SITE`, to the public site's Worker (`hid-public-staging`), which
`prepare-staging-workers.py` declares. Someone signed in there (a non-empty
`hid_access_csrf` cookie) goes from a product site's `/` to `/provider`, and
gets the portal at the portal's `/`. The public site's Worker must exist when a
site that binds to it is uploaded; it is never deleted. A site whose binding is
missing answers its `/` to someone not signed in with a plain "not available
right now" page and keeps every other address. After deploying, check in a
private window that each product site's `/` shows its landing page with its own
canonical address and the portal's `/` the patient page (canonical
`https://www.staging.healthidentitydirectory.com/patients`); after signing in,
that a product site's `/` opens its workspace and the portal's `/` the portal,
also from a link in another site (for example in webmail), where the landing
page asks once more from the site itself; and that the public site's `/products/<slug>` answers 308 to that product site
while its `/patients` stays where it is.

## Developer handoff

The supplied new patient UI does not render the `importedRecords` response from
the current EHR service, and its API registry has no chatbot integration. These
are recorded frontend feature gaps; the migrated database and backend endpoints
remain intact. This release does not claim those UI journeys are implemented.
Admin roles, QoreID activation and provider sandbox acceptance are governed
separately from a successful frontend deployment.
