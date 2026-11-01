import {
  isLegacyMigratePath,
  migrateRedirectUrl,
} from './migrate-route-redirects.mjs'
import { legacyPatientPath } from './legacy-patient-redirects.mjs'

const API_PATH = /^\/api\/v1(?:\/|$)/
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const ORIGIN_AUTH_TOKEN = /^[A-Za-z0-9._~+/-]{32,256}$/

const DEPLOYMENT_PROFILES = Object.freeze({
  production: Object.freeze({
    apiOrigin: 'https://api.healthidentitydirectory.com',
    hosts: Object.freeze({
      web: 'app.healthidentitydirectory.com',
      public: 'healthidentitydirectory.com',
      ehr: 'ehr.healthidentitydirectory.com',
      lab: 'lab.healthidentitydirectory.com',
      pharmacy: 'pharmacy.healthidentitydirectory.com',
      ocr: 'migrate.healthidentitydirectory.com',
      outreach: 'outreach.healthidentitydirectory.com',
      admin: 'admin.healthidentitydirectory.com',
    }),
  }),
  staging: Object.freeze({
    apiOrigin: 'https://api.staging.healthidentitydirectory.com',
    hosts: Object.freeze({
      web: 'staging.healthidentitydirectory.com',
      public: 'www.staging.healthidentitydirectory.com',
      ehr: 'ehr.staging.healthidentitydirectory.com',
      lab: 'lab.staging.healthidentitydirectory.com',
      pharmacy: 'pharmacy.staging.healthidentitydirectory.com',
      ocr: 'migrate.staging.healthidentitydirectory.com',
      outreach: 'outreach.staging.healthidentitydirectory.com',
      admin: 'admin.staging.healthidentitydirectory.com',
    }),
  }),
})

// No Content-Security-Policy yet (hand-off D6). Whenever one is added, the portal hosts need `worker-src 'self'` (the
// push worker, /sw.js, B6) and `manifest-src 'self'` (/health-id.webmanifest). The Permissions-Policy below governs
// no push or notification feature, so it stays as it is.
const SECURITY_HEADERS = Object.freeze({
  'cross-origin-opener-policy': 'same-origin',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
})

const PERMISSIONS_BY_APP = Object.freeze({
  web: 'camera=(self), microphone=(self), geolocation=()',
  public: 'camera=(), microphone=(), geolocation=()',
  ehr: 'camera=(), microphone=(), geolocation=()',
  lab: 'camera=(), microphone=(), geolocation=()',
  pharmacy: 'camera=(), microphone=(), geolocation=()',
  ocr: 'camera=(self), microphone=(), geolocation=()',
  outreach: 'camera=(self), microphone=(), geolocation=(self)',
  admin: 'camera=(), microphone=(), geolocation=()',
})

/**
 * Every product is its own site with its own front page (owner, 2026-11-01). The team built each product's landing
 * page on the public site at /products/<slug>; a product site answers its own "/" with that page, fetched from the
 * public site's Worker through the PUBLIC_SITE service binding, and the public site sends /products/<slug> to the
 * product site (308), so each page has one address. Each product site's own page, by deployment app name.
 * apps/public-web/content/site.ts (PRODUCT_SITE_SUBDOMAINS) names the same five, for the public site's own links.
 * Someone signed in there goes from "/" to the workspace instead (frontPage).
 */
const PRODUCT_LANDING_PAGES = Object.freeze({
  ehr: Object.freeze({ slug: 'ehr', name: 'Health ID EHR' }),
  lab: Object.freeze({ slug: 'laboratory', name: 'Health ID Laboratory' }),
  pharmacy: Object.freeze({ slug: 'pharmacy', name: 'Health ID Pharmacy' }),
  ocr: Object.freeze({ slug: 'migrate', name: 'Health ID Migrate' }),
  outreach: Object.freeze({ slug: 'outreach', name: 'Health ID Outreach' }),
})

/**
 * The patient portal's front page (app., staging.) for someone not signed in there: the public site's patient page,
 * the Health ID Identity landing page (owner, 2026-11-01), served the same way as a product site's. It keeps its own
 * address on the public site, which is not redirected and stays its canonical address. Someone signed in gets the
 * portal at "/", as before.
 */
const PATIENT_LANDING_PAGE = Object.freeze({ path: '/patients', name: 'Health ID' })

/** The portal's patient sign-in page, where the patient landing page's sign-in leads: "/" would show it again. */
const PATIENT_SIGN_IN_PATH = '/sign-in'

/** The workspace's entrance on a product site, where its landing page's sign-in leads; it asks for a sign-in itself. */
const STAFF_WORKSPACE_PATH = '/provider'

/**
 * The production patient portal serves patients only (owner, 2026-11-01): staff sign in on the EHR site, where
 * hid-system accepts staff-login, never on app. (owner decision, 2026-10-22). One fixed address, nothing from the
 * request copied into it. Staging's portal keeps its own staff sign-in.
 */
const PRODUCTION_PORTAL_HOST = 'app.healthidentitydirectory.com'
const PRODUCTION_STAFF_SIGN_IN = 'https://ehr.healthidentitydirectory.com/provider/sign-in'

/**
 * The portal addresses that are the staff sign-in: the workspace's entrance, which asks for one, and the sign-in page,
 * each with or without a closing slash (the portal's router opens the same page either way). The portal's other
 * /provider pages stay its own: hid-system accepts their security checks (staff-reset, provider-enrollment,
 * staff-invitation, the clinician pages) only there for now.
 */
const PORTAL_STAFF_SIGN_IN_PATHS = Object.freeze(['/provider', '/provider/', '/provider/sign-in', '/provider/sign-in/'])

/** Where the production patient portal sends staff to sign in, or '' on any other site. */
function portalStaffSignIn(deployment) {
  return deployment.application === 'web' && deployment.expectedHost === PRODUCTION_PORTAL_HOST ? PRODUCTION_STAFF_SIGN_IN : ''
}

/** The addresses of a site's front page. */
const FRONT_PAGE_PATHS = Object.freeze(['/', '/index.html'])

/**
 * The cookie whose presence says a browser holds a sign-in on this site. Identity's sign-in sets three host-only
 * cookies, named from its AUTH_COOKIE_NAME ('hid_access' by default, unchanged in production Terraform): see
 * hid-system services/identity-api/src/auth/session-cookies.ts. 'hid_access' (HttpOnly) lasts 15 minutes and
 * 'hid_access_refresh' is sent to /api/v1/auth only; 'hid_access_csrf' is sent on every path and lasts as long as the
 * sign-in (up to 8 hours idle, 24 hours in all). The edge only looks for a non-empty one: it cannot and must not tell
 * whether that sign-in is still good. The app does, renewing it quietly or asking for a sign-in. All three are
 * SameSite=Strict, so a browser arriving from another site sends none of them: see signInRecheck.
 */
const SIGNED_IN_COOKIE = 'hid_access_csrf'

/**
 * How long a tab waits before its landing page asks the edge again for this site's front page (signInRecheck), and
 * where it notes when it last did: in the tab's own storage for this site.
 */
const SIGN_IN_RECHECK_MS = 10000
const SIGN_IN_RECHECK_KEY = 'hid-front-page-recheck'

/** The products a facility signs up for on the portal's /provider/enroll (public-web APPLICATION_PRODUCTS). */
const APPLICATION_PRODUCTS = Object.freeze(['ehr', 'migrate', 'laboratory', 'pharmacy'])

/**
 * Sent by a product site when it asks the public site for its own landing page through the binding: the public site
 * then answers the page instead of sending it back to the product site. It names the product site, and opens only
 * that site's page. It is not a secret: the page is public, so a hand-made request that carries it gets nothing more
 * than the page at the public site's address, which people and search engines never ask for this way. The patient
 * portal sends it too; the public site's patient page needs nothing to open.
 */
const LANDING_SITE_HEADER = 'x-hid-landing-site'

/**
 * The public site's own files a landing page loads, which a product site's or the patient portal's build does not
 * have: Next.js's hashed scripts, styles and fonts (/_next/static/), the brand images (/brand/) and the two icons.
 * Listed one by one so that nothing else of the public site can be read through another site. The patient portal's
 * build, which every product site serves too, has none of them (its files are /assets/, /icons/, /sw.js and
 * /health-id.webmanifest), and the public site's retiring /service-worker.js is deliberately not one of them. A
 * site's own file always wins.
 */
const PUBLIC_STATIC_PREFIXES = Object.freeze(['/_next/static/', '/brand/'])
const PUBLIC_STATIC_FILES = Object.freeze(['/icon.png', '/apple-icon.png'])

/**
 * Request headers a product site passes on to the public site for a static file, so that a browser's copy can be
 * revalidated: never a cookie, Authorization or a client address. The landing page itself is asked for with none.
 */
const PUBLIC_SITE_REQUEST_HEADERS = Object.freeze(['accept', 'if-none-match', 'if-modified-since'])

function problem(status, code, detail, correlationId) {
  return new Response(JSON.stringify({
    type: 'about:blank',
    title: status === 502 ? 'Service unavailable' : 'Request rejected',
    status,
    detail,
    code,
    correlationId,
  }), {
    status,
    headers: {
      'content-type': 'application/problem+json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'cloudflare-cdn-cache-control': 'no-store',
      'x-correlation-id': correlationId,
      ...SECURITY_HEADERS,
    },
  })
}

function correlationId(request) {
  const supplied = request.headers.get('x-correlation-id')?.trim()
  return supplied && CORRELATION_ID.test(supplied) ? supplied : crypto.randomUUID()
}

function configuredDeployment(environment) {
  const profile = DEPLOYMENT_PROFILES[environment.DEPLOYMENT_ENV]
  const application = typeof environment.APP_NAME === 'string' ? environment.APP_NAME : ''
  const expectedHost = profile?.hosts[application]
  if (!profile || !expectedHost
    || environment.API_ORIGIN !== profile.apiOrigin
    || environment.EXPECTED_HOST !== expectedHost
    || !ORIGIN_AUTH_TOKEN.test(environment.ORIGIN_AUTH_TOKEN ?? '')) {
    throw new Error('Worker deployment configuration is incomplete or inconsistent')
  }
  return {
    application,
    expectedHost,
    hosts: profile.hosts,
    landing: landingOf(application, profile.hosts),
    migrateOrigin: `https://${profile.hosts.ocr}`,
    portalOrigin: `https://${profile.hosts.web}`,
    publicOrigin: `https://${profile.hosts.public}`,
    origin: new URL(profile.apiOrigin),
    originAuthToken: environment.ORIGIN_AUTH_TOKEN,
  }
}

/**
 * What a site answers at its front page ("/"), or null where that is its own app's, as before (the public site, the
 * admin site). To someone not signed in there: the public site's page at `path`, with `canonical` as its address and
 * `name` on the page that says it is not available. To someone signed in: the staff workspace's entrance on a product
 * site, and the patient portal itself on the portal.
 */
function landingOf(application, hosts) {
  if (Object.hasOwn(PRODUCT_LANDING_PAGES, application)) {
    const page = PRODUCT_LANDING_PAGES[application]
    return Object.freeze({ path: `/products/${page.slug}`, name: page.name, canonical: `https://${hosts[application]}/`,
      signIn: STAFF_WORKSPACE_PATH, signedIn: 'workspace' })
  }
  if (application === 'web') {
    return Object.freeze({ path: PATIENT_LANDING_PAGE.path, name: PATIENT_LANDING_PAGE.name,
      canonical: `https://${hosts.public}${PATIENT_LANDING_PAGE.path}`, signIn: PATIENT_SIGN_IN_PATH, signedIn: 'portal' })
  }
  return null
}

/**
 * Whether `cookies` (a Cookie header, or a page's document.cookie) holds a non-empty cookie named `name`: only its
 * presence, never its value. A name differing in any way (another cookie of the sign-in, another case, a prefix or
 * suffix) is not it. Browsers join cookies with "; "; cookies joined with ", " are read the same way.
 *
 * The edge asks it of a request (holdsSignIn) and the landing page, which carries it as its source text, asks it of
 * document.cookie (signInRecheck), so both follow one rule. It holds nothing it does not define: no nested function,
 * no name from outside.
 */
function carriesCookie(cookies, name) {
  if (!cookies) return false
  var pairs = String(cookies).split(/[;,]/)
  for (var i = 0; i < pairs.length; i++) {
    var equals = pairs[i].indexOf('=')
    if (equals === -1 || pairs[i].slice(0, equals).trim() !== name) continue
    var value = pairs[i].slice(equals + 1).trim()
    if (value !== '' && value !== '""') return true
  }
  return false
}

/** Whether the request carries a non-empty SIGNED_IN_COOKIE (carriesCookie). */
function holdsSignIn(request) {
  return carriesCookie(request.headers.get('cookie'), SIGNED_IN_COOKIE)
}

/**
 * A script the edge adds to the head of each page it answers at a front page to someone not signed in (the landing
 * page, ahead of its link script, or the page saying it is not available). Identity's sign-in cookies are SameSite=Strict, so a browser sends none of them when
 * someone arrives from another site (a link in webmail, a chat app or a search result, or one another app opens in the
 * installed app): the edge sees no sign-in and answers this page, even to someone signed in here. The page can see the
 * cookie (SIGNED_IN_COOKIE is readable), so where it holds one, by carriesCookie's rule, it asks for its own address
 * again with location.replace, which leaves no history entry for this page. That request starts from this site, so
 * the browser sends the cookie, and the edge answers as it does anyone signed in: the workspace's entrance on a product
 * site, the portal on the portal. Like the edge, the page only looks for the cookie, never at its value.
 *
 * It asks at most once in SIGN_IN_RECHECK_MS in a tab (noted in sessionStorage before it asks), so a browser that shows
 * its scripts the cookie but still does not send it shows this page instead of loading it forever; if the tab's
 * storage cannot be read or written, it does not ask. The address's fragment is left out: a change of fragment alone
 * only scrolls the page and asks the edge nothing.
 */
function signInRecheck() {
  return `<script>(function(carries){try{if(!carries(document.cookie,${JSON.stringify(SIGNED_IN_COOKIE)}))return;`
    + `var key=${JSON.stringify(SIGN_IN_RECHECK_KEY)},now=Date.now(),last=Number(sessionStorage.getItem(key));`
    + `if(now-last>=0&&now-last<${SIGN_IN_RECHECK_MS})return;`
    + 'sessionStorage.setItem(key,String(now));location.replace(location.href.split("#")[0])}catch{}})'
    + `(${carriesCookie.toString()})</script>`
}

/** The product site whose landing page `pathname` is on the public site (/products/<slug>), or null. */
function productSiteOf(pathname, deployment) {
  const slug = /^\/products\/([a-z]+)(?:\/|\.html)?$/.exec(pathname)?.[1]
  const app = slug && Object.keys(PRODUCT_LANDING_PAGES).find(key => PRODUCT_LANDING_PAGES[key].slug === slug)
  return app ? { exact: pathname === `/products/${slug}`, host: deployment.hosts[app] } : null
}

/**
 * Where each link on a landing page leads when the page is shown on a product site or the patient portal. The page was
 * built for the public site, so its addresses are the public site's: a link to a section of this same page
 * (/patients#steps on the patient page) stays on it, as a link within the page; a link to another public page opens on
 * the public site; a product's page opens on that product's own site, at the section asked for; "Setup Your Facility"
 * opens the portal's facility sign-up, where Identity accepts its security check (productHostname.ts,
 * providerEnrollmentHref). On a product site, staff sign-in opens this site's workspace entrance, which asks for a
 * sign-in itself; on the production patient portal, which serves patients only, the EHR site's sign-in. On the patient
 * portal, a link to the portal's front page opens its sign-in instead, as that front page is this page to someone not
 * signed in. Anything else (mailto:, the patient portal's other pages, a link within
 * the page) is left as it is.
 *
 * The same function rewrites the page's links at the edge and, copied into the page as its source text, the links
 * the page draws itself in the browser (its menus), so it holds nothing it does not define: no nested function, no
 * name from outside. Each result is a fixed address (a product's with the section asked for), the public site's own,
 * or a section of this page, and maps to itself.
 */
export function landingHref(href, site) {
  var raw = String(href).trim()
  if (raw === '' || raw.charAt(0) === '#') return href
  var target
  try { target = new URL(raw, site.page) } catch { return href }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return href
  if (target.origin === site.publicOrigin) {
    var path = target.pathname.length > 1 ? target.pathname.replace(/\/+$/, '') : target.pathname
    if (target.hash !== '' && path === new URL(site.page).pathname) return target.hash
    var product = /^\/products\/([a-z]+)$/.exec(path)
    if (product && Object.prototype.hasOwnProperty.call(site.products, product[1])) return site.products[product[1]] + target.hash
    if (path === '/provider/apply') {
      var code = target.searchParams.get('product')
      return site.enroll + (code && site.applicationProducts.indexOf(code) !== -1 ? '?product=' + code : '')
    }
    return target.href
  }
  if (target.origin === site.portalOrigin) {
    if (site.staffSignIn && target.pathname === '/provider/sign-in') return site.staffSignIn
    if (site.patientSignIn && target.pathname === '/') return site.patientSignIn
  }
  return href
}

/**
 * Marks a link the edge or the page's script made a link within the page (landingHref gave it "#..." for a section of
 * this same page). The page's own router still holds the address it was built with (/patients#steps), which is another
 * page here, so the script follows such a link itself; a link the page made within itself (#demo) stays the page's.
 */
const IN_PAGE_LINK = 'data-hid-in-page'

/** Gives a landing page link the address landingHref gives it, marked if that makes it a link within the page. */
function rewriteLandingLink(element, site) {
  const href = element.getAttribute('href')
  const next = landingHref(href, site)
  if (next === href) return
  element.setAttribute('href', next)
  if (next.charAt(0) === '#') element.setAttribute(IN_PAGE_LINK, '')
}

/** What landingHref needs for this site, all fixed by the deployment: nothing from a request. */
function landingSite(deployment) {
  const products = {}
  for (const [app, page] of Object.entries(PRODUCT_LANDING_PAGES)) products[page.slug] = `https://${deployment.hosts[app]}/`
  const signIn = `https://${deployment.expectedHost}${deployment.landing.signIn}`
  return {
    page: `${deployment.publicOrigin}${deployment.landing.path}`,
    publicOrigin: deployment.publicOrigin,
    portalOrigin: deployment.portalOrigin,
    products,
    staffSignIn: deployment.landing.signedIn === 'workspace' ? signIn : portalStaffSignIn(deployment),
    patientSignIn: deployment.landing.signedIn === 'portal' ? signIn : '',
    enroll: `${deployment.portalOrigin}/provider/enroll`,
    applicationProducts: APPLICATION_PRODUCTS,
  }
}

/**
 * The page's own script, at the end of its head. Next.js follows a link the page renders itself in the browser, by the
 * address it was built with, not the one the edge wrote; this script fixes each link's address as the visitor
 * reaches it (pointer, keyboard, touch, context menu) and, on a plain click, lets the browser follow it itself, so
 * every link leaves for the address landingHref gives it. A section of this same page (IN_PAGE_LINK) is followed by
 * the script, within the page, and the click is passed on already prevented: the page's own handlers still see it
 * (its menu closes) and its router, which skips a prevented click, does not visit the address it was built with. A
 * link the page made within itself (#demo) is left to the page.
 */
function landingScript(site) {
  const config = JSON.stringify(site).replace(/</g, '\\u003c')
  return '<script>(function(rewrite,site){'
    + 'function link(event){var node=event.target;var a=node&&node.closest?node.closest("a[href]"):null;'
    + 'if(a){var href=a.getAttribute("href");var next=rewrite(href,site);if(next!==href){a.setAttribute("href",next);'
    + `if(next.charAt(0)==="#")a.setAttribute("${IN_PAGE_LINK}","")}}return a}`
    + '["pointerdown","mouseover","focusin","contextmenu"].forEach(function(type){addEventListener(type,link,true)});'
    + 'addEventListener("click",function(event){var a=link(event);'
    + 'if(!a||event.defaultPrevented||event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey'
    + '||(a.target&&a.target!=="_self")||a.hasAttribute("download"))return;'
    + 'var href=a.getAttribute("href");if(href.charAt(0)!=="#"){event.stopPropagation();return}'
    + `if(a.hasAttribute("${IN_PAGE_LINK}")){event.preventDefault();location.assign(href)}},true)`
    + `})(${landingHref.toString()},${config})</script>`
}

function landingUnavailable(deployment) {
  const name = deployment.landing.name
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title>${signInRecheck()}</head>`
    + `<body style="font-family:system-ui,sans-serif;margin:0;padding:48px 24px;color:#101828">`
    + `<main style="max-width:560px;margin:0 auto"><h1 style="font-size:28px">This page is not available right now</h1>`
    + `<p style="font-size:17px;line-height:1.5">Please try again in a few minutes.</p>`
    + `<p style="font-size:17px;line-height:1.5"><a href="${deployment.landing.signIn}">Sign in to ${name}</a></p>`
    + `<p style="font-size:17px;line-height:1.5"><a href="${deployment.publicOrigin}/">Go to the Health ID website</a></p>`
    + `</main></body></html>`
  return withSecurityHeaders(new Response(body, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '60' },
  }), false, 'public', '/')
}

/**
 * A request to the public site's Worker for one fixed public-site address, with the headers given and, from the
 * visitor's request, only those `passed` names.
 */
function publicSiteRequest(request, deployment, pathname, headers, passed = []) {
  const sent = new Headers(headers)
  for (const name of passed) {
    const value = request.headers.get(name)
    if (value !== null && !sent.has(name)) sent.set(name, value)
  }
  return new Request(`${deployment.publicOrigin}${pathname}`, { method: request.method, headers: sent, redirect: 'manual' })
}

function publicSiteBinding(environment) {
  const binding = environment.PUBLIC_SITE
  return binding && typeof binding.fetch === 'function' ? binding : null
}

/** This site's landing page: its page from the public site, with its links rewritten for this site. */
async function landingPage(request, deployment, environment) {
  const binding = publicSiteBinding(environment)
  if (!binding) return landingUnavailable(deployment)
  let source
  try {
    // None of the visitor's headers, cookie and validators included: the page is the same for every stranger.
    source = await binding.fetch(publicSiteRequest(request, deployment, deployment.landing.path,
      { accept: 'text/html', [LANDING_SITE_HEADER]: deployment.expectedHost }))
  } catch {
    return landingUnavailable(deployment)
  }
  const type = source.headers.get('content-type') ?? ''
  if (source.status !== 200 || !/^text\/html\s*(?:;|$)/i.test(type)) return landingUnavailable(deployment)
  // A new response: none of the public site's validators (this body differs from its file) and never a cookie.
  const page = new Response(request.method === 'HEAD' ? null : source.body, { status: 200, headers: { 'content-type': type } })
  const site = landingSite(deployment)
  const rewritten = request.method === 'HEAD' ? page : new HTMLRewriter()
    .on('a[href]', { element(element) { rewriteLandingLink(element, site) } })
    // The page's own canonical address, in whatever shape or case, is the public site's: it goes, and this site's is
    // written once, at the end of the head, in the one shape the release reads (deploy-production-workers.py).
    .on('link[rel]', { element(element) {
      if (/(?:^|\s)canonical(?:\s|$)/i.test(element.getAttribute('rel') ?? '')) element.remove()
    } })
    .on('head', { element(element) {
      element.onEndTag(end => {
        end.before(`<link rel="canonical" href="${deployment.landing.canonical}">`, { html: true })
        end.before(signInRecheck(), { html: true })
        end.before(landingScript(site), { html: true })
      })
    } })
    .transform(page)
  return withSecurityHeaders(rewritten, false, 'public', '/')
}

/**
 * A site's front page, decided by whether the browser holds a sign-in there (holdsSignIn). Someone not signed in sees
 * the landing page. Someone signed in goes to a product site's workspace entrance (one fixed address on this site,
 * nothing kept from the request), or is answered the patient portal as before. Someone signed in who arrives from
 * another site sends no cookie and gets the landing page, which then asks again from this site (signInRecheck), so the
 * browser sends the cookie and they get the same answer as anyone signed in. The two answers differ for the same
 * address, so neither is ever kept for anyone else: every answer is private and not to be stored, and varies with the
 * cookie. Cloudflare keeps none of a Worker's own answers in its cache (the Worker runs first on every request,
 * run_worker_first, and uses no cache here), so these headers speak to browsers and any cache in between.
 */
async function frontPage(request, url, deployment, environment) {
  let response
  if (!holdsSignIn(request)) {
    response = await landingPage(request, deployment, environment)
  } else if (deployment.landing.signedIn === 'workspace') {
    response = withSecurityHeaders(Response.redirect(`https://${deployment.expectedHost}${STAFF_WORKSPACE_PATH}`, 302),
      false, deployment.application, url.pathname)
  } else {
    response = withSecurityHeaders(await environment.ASSETS.fetch(request), false, deployment.application, url.pathname)
  }
  response.headers.set('cache-control', 'private, no-store')
  const vary = response.headers.get('vary')
  if (!vary) response.headers.set('vary', 'Cookie')
  else if (!vary.split(',').some(name => name.trim().toLowerCase() === 'cookie')) response.headers.set('vary', `${vary}, Cookie`)
  return response
}

function isPublicStaticPath(pathname) {
  return PUBLIC_STATIC_FILES.includes(pathname) || PUBLIC_STATIC_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

/**
 * Whether the product site's own asset binding has this file. Its single-page fallback answers a file it does not
 * have with index.html (200), which is never one of the public site's static files: none of them is a page.
 */
function ownsFile(pathname, response) {
  if (response.status === 304) return true
  if (response.status < 200 || response.status >= 300) return false
  return !/^text\/html\s*(?:;|$)/i.test(response.headers.get('content-type') ?? '') || pathname.endsWith('.html')
}

/** One of the public site's static files a landing page loads, from the public site; a 404 if it has none. */
async function publicStaticFile(request, url, deployment, environment) {
  const binding = publicSiteBinding(environment)
  let response = null
  if (binding) {
    try {
      response = await binding.fetch(publicSiteRequest(request, deployment, url.pathname, {}, PUBLIC_SITE_REQUEST_HEADERS))
    } catch {
      response = null
    }
  }
  if (!response || !(response.status === 304 || (response.status >= 200 && response.status < 300))) {
    return problem(404, 'NOT_FOUND', 'The requested file is not available.', correlationId(request))
  }
  const secured = withSecurityHeaders(response, false, deployment.application, url.pathname)
  secured.headers.delete('set-cookie')
  return secured
}

// The portal's push worker (B6, apps/patient-web/public/sw.js) and the earlier HID worker the public site retires
// (/service-worker.js): a browser checks either for an update, and must never be handed a stale copy.
const WORKER_PATHS = /^\/sw\.js$|\/service-worker\.js$/
const JAVASCRIPT = /^(?:text|application)\/(?:x-)?javascript\s*(?:;|$)/i

function withSecurityHeaders(response, apiResponse = false, application, path = '') {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value)
  if (application === 'web') headers.set('cross-origin-opener-policy', 'same-origin-allow-popups')
  headers.set('permissions-policy', PERMISSIONS_BY_APP[application]
    ?? 'camera=(), microphone=(), geolocation=()')
  if (apiResponse) {
    headers.set('cache-control', 'private, no-store, max-age=0')
    headers.set('cloudflare-cdn-cache-control', 'no-store')
    headers.set('pragma', 'no-cache')
    headers.delete('age')
    headers.delete('cf-cache-status')
  } else if (WORKER_PATHS.test(path) || new URL(response.url || 'https://static.invalid/').pathname.endsWith('/service-worker.js')) {
    headers.set('cache-control', 'no-cache, no-store, must-revalidate')
  } else if (path === '/health-id.webmanifest' && response.status >= 200 && response.status < 300) {
    headers.set('content-type', 'application/manifest+json; charset=utf-8')
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/**
 * /sw.js must be the portal's push worker or nothing: where a build has none (the public site, or a build before B6),
 * the single-page fallback would answer index.html with 200, which a browser must never be offered as a worker.
 */
function servesWorker(path, response) {
  return path !== '/sw.js' || response.status === 304
    || (response.status >= 200 && response.status < 300 && JAVASCRIPT.test(response.headers.get('content-type') ?? ''))
}

function applicationRouteRedirect(request, requestUrl, deployment) {
  if (!['GET', 'HEAD'].includes(request.method)) return null
  const adminPaths = new Set(['integrations', 'overview', 'facilities', 'principals', 'applications',
    'reviews', 'audit', 'operations', 'pricing', 'demos', 'controls', 'sign-in', 'recover'])
  const first = requestUrl.pathname.split('/')[1]
  if (deployment.application === 'admin' && adminPaths.has(first)) {
    const target = new URL(requestUrl)
    target.pathname = `/admin${requestUrl.pathname}`
    return Response.redirect(target, 308)
  }
  const products = { ehr: 'ehr', lab: 'lab', pharmacy: 'pharmacy', ocr: 'migrate', outreach: 'outreach' }
  if (products[deployment.application] && requestUrl.pathname === '/provider/recover') {
    const staging = deployment.expectedHost.includes('.staging.')
    const target = new URL(`https://${staging ? 'staging' : 'app'}.healthidentitydirectory.com/provider/recover`)
    target.searchParams.set('returnTo', products[deployment.application])
    return Response.redirect(target, 302)
  }
  // The production portal serves patients only: its staff sign-in and the workspace's entrance send staff to the EHR
  // site's sign-in (owner decisions, 2026-10-22 and 2026-11-01). One fixed address: nothing from the request is copied
  // into it. A 302 with no cache lifetime, as before, so a later change of address reaches everyone.
  const staffSignIn = portalStaffSignIn(deployment)
  if (staffSignIn && PORTAL_STAFF_SIGN_IN_PATHS.includes(requestUrl.pathname)) return Response.redirect(staffSignIn, 302)
  if (deployment.application === 'public' && requestUrl.pathname === '/products/identity') {
    return Response.redirect(new URL('/patients', requestUrl), 308)
  }
  // A product's page is that product site's front page. Only the product site itself, asking through its binding for
  // its own page at this exact address, is answered the page; everyone else goes to the product site. One fixed
  // address per product, nothing from the request; an hour's cache, so that a rollback reaches returning visitors.
  const productSite = deployment.application === 'public' ? productSiteOf(requestUrl.pathname, deployment) : null
  if (productSite && !(productSite.exact && request.headers.get(LANDING_SITE_HEADER) === productSite.host)) {
    return new Response(null, {
      status: 308, headers: { location: `https://${productSite.host}/`, 'cache-control': 'max-age=3600' },
    })
  }
  // hid-1.0's patient pages were on this host: each opens its portal page. Only the deployment's portal origin and
  // a fixed path: nothing from the request, its query included, is copied into the address.
  const portalPath = deployment.application === 'public' ? legacyPatientPath(requestUrl.pathname) : null
  if (portalPath) return Response.redirect(new URL(portalPath, deployment.portalOrigin), 308)
  if (!['GET', 'HEAD'].includes(request.method) || !isLegacyMigratePath(requestUrl.pathname)) return null
  if (deployment.application !== 'ocr' && deployment.application !== 'web') return null

  const destinationOrigin = deployment.application === 'ocr'
    ? requestUrl.origin
    : deployment.migrateOrigin
  return Response.redirect(
    migrateRedirectUrl(destinationOrigin, requestUrl.pathname, requestUrl.search),
    308,
  )
}

async function proxyApi(request, deployment, requestUrl) {
  const requestCorrelationId = correlationId(request)
  const upstream = new URL(requestUrl.pathname + requestUrl.search, deployment.origin)
  const headers = new Headers(request.headers)
  for (const name of [
    'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'forwarded', 'host', 'x-forwarded-for',
    'x-forwarded-host', 'x-forwarded-proto', 'x-hid-edge-origin', 'x-real-ip', 'x-hid-client-ip',
  ]) headers.delete(name)
  // Cloudflare supplies this value on deployed Workers. Never preserve a
  // caller's x-hid-client-ip or forwarding chain. Local requests without an
  // edge-supplied address use the gateway's peer address instead.
  const clientIp = request.headers.get('cf-connecting-ip')
  if (clientIp && clientIp.length <= 45 &&
      (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(clientIp) || /^[a-fA-F0-9:]+$/.test(clientIp) && clientIp.includes(':'))) {
    headers.set('x-hid-client-ip', clientIp)
  }
  headers.set('x-correlation-id', requestCorrelationId)
  headers.set('x-forwarded-host', requestUrl.host)
  headers.set('x-forwarded-proto', 'https')
  headers.set('x-hid-edge-origin', requestUrl.origin)
  headers.set('x-hid-origin-authorization', deployment.originAuthToken)

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: request.signal,
    // cacheTtl: 0 still forces cache eligibility and can strip Set-Cookie.
    // Authentication and patient API responses must bypass the cache entirely.
    cache: 'no-store',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body

  try {
    const response = await fetch(upstream, init)
    const secured = withSecurityHeaders(response, true, deployment.application)
    secured.headers.set('x-correlation-id', response.headers.get('x-correlation-id') ?? requestCorrelationId)
    return secured
  } catch {
    return problem(502, 'API_ORIGIN_UNAVAILABLE', 'A required platform service is temporarily unavailable.', requestCorrelationId)
  }
}

export function createFrontendWorker() {
  return {
    async fetch(request, environment) {
      const url = new URL(request.url)
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
        return problem(400, 'HTTPS_REQUIRED', 'HTTPS is required.', correlationId(request))
      }
      let deployment
      try {
        deployment = configuredDeployment(environment)
      } catch {
        return problem(502, 'EDGE_CONFIGURATION_INVALID', 'The API edge route is unavailable.', correlationId(request))
      }
      if (url.hostname !== deployment.expectedHost) {
        return problem(421, 'HOST_DENIED', 'This host is not configured for the requested application.', correlationId(request))
      }
      if (API_PATH.test(url.pathname)) return proxyApi(request, deployment, url)
      if (url.pathname.startsWith('/api/')) {
        return problem(404, 'API_ROUTE_NOT_FOUND', 'The requested API route is not available.', correlationId(request))
      }
      const redirect = applicationRouteRedirect(request, url, deployment)
      if (redirect) return withSecurityHeaders(redirect, false, deployment.application, url.pathname)
      const read = request.method === 'GET' || request.method === 'HEAD'
      if (deployment.landing && read && FRONT_PAGE_PATHS.includes(url.pathname)) {
        return frontPage(request, url, deployment, environment)
      }
      const assetResponse = await environment.ASSETS.fetch(request)
      if (deployment.landing && read && isPublicStaticPath(url.pathname) && !ownsFile(url.pathname, assetResponse)) {
        return publicStaticFile(request, url, deployment, environment)
      }
      if (!servesWorker(url.pathname, assetResponse)) {
        return problem(404, 'NOT_FOUND', 'The requested file is not available.', correlationId(request))
      }
      return withSecurityHeaders(assetResponse, false, deployment.application, url.pathname)
    },
  }
}

export default createFrontendWorker()
