import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { CookieJar, JSDOM } from 'jsdom'

/**
 * A product site's front page in workerd, the runtime Cloudflare runs, as wrangler's own local runtime (Miniflare)
 * runs it: the lab site and the public site are each this repository's frontend Worker, joined by the PUBLIC_SITE
 * service binding as prepare-staging-workers.py declares it, so HTMLRewriter and the binding are the real ones. Each
 * site's static files come from a small stand-in for its asset binding.
 */
const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
/** The Worker and every module beside it, as wrangler bundles them: the entry module first. */
const MODULES = ['frontend-worker.mjs', ...readdirSync(SOURCE).filter(name => name.endsWith('.mjs') && name !== 'frontend-worker.mjs')]
  .map(name => ({ type: 'ESModule', path: join(SOURCE, name) }))
const TOKEN = 'test-origin-authorization-token-not-a-secret-123456'

/** The parts of the public site's exported laboratory page the edge rewrites, as Next.js writes them. */
const LABORATORY_PAGE = '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>'
  + '<link rel="preload" href="/_next/static/media/inter.p.woff2" as="font" crossorigin="" type="font/woff2"/>'
  + '<link rel="preload" href="/brand/logo.png" as="image"/>'
  + '<link rel="stylesheet" href="/_next/static/css/site.css" data-precedence="next"/>'
  + '<script src="/_next/static/chunks/main-app.js" async=""></script>'
  + '<title>Health ID Laboratory | Health ID</title>'
  + '<link rel="icon" href="/icon.png?e84ead3bb5a2b28a" type="image/png" sizes="48x48"/></head>'
  + '<body><a href="#main">Skip to content</a>'
  + '<nav><a href="/"><img src="/brand/logo.png" alt="Health ID"/></a><a href="/pricing">Pricing</a>'
  + '<a href="/products/ehr">EHR</a><a href="/products/laboratory">Laboratory</a><a href="/products/api">API</a>'
  + '<a href="/providers#products">Providers</a>'
  + '<a href="https://app.healthidentitydirectory.com/provider/sign-in">Sign in</a>'
  + '<a class="hero-demo-button" href="/provider/apply?product=laboratory">Setup Your Facility</a></nav>'
  + '<main id="main"><a href="#demo">Book a demo</a><a href="/blog?tag=a&amp;page=2">Blog</a>'
  + '<a href="/products/laboratory#pricing">See pricing</a></main>'
  + '<footer><a href="https://app.healthidentitydirectory.com/sign-in">Patient sign in</a>'
  + '<a href="mailto:support@healthidentitydirectory.com">Email us</a></footer>'
  + '<script>self.__next_f.push([1,"a:[\\"$\\",\\"a\\",null,{\\"href\\":\\"/pricing\\"}]"])</script></body></html>'

/** The parts of the public site's exported patient page (the Health ID Identity landing page) the edge rewrites. */
const PATIENTS_PAGE = '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>'
  + '<link rel="stylesheet" href="/_next/static/css/site.css" data-precedence="next"/>'
  + '<script src="/_next/static/chunks/main-app.js" async=""></script>'
  + '<title>For patients | Health ID</title>'
  + '<link rel="icon" href="/icon.png?e84ead3bb5a2b28a" type="image/png" sizes="48x48"/></head>'
  + '<body><a href="#main">Skip to content</a>'
  + '<nav><a href="/"><img src="/brand/logo.png" alt="Health ID"/></a><a href="/patients#steps">How it works</a>'
  + '<a href="/patients#control">Your control</a>'
  + '<a href="https://app.healthidentitydirectory.com/sign-in">Sign in</a>'
  + '<a href="https://app.healthidentitydirectory.com/enroll">Get your Health ID</a></nav>'
  + '<main id="main"><a href="https://app.healthidentitydirectory.com/enroll">Create your Health ID</a>'
  + '<a href="https://app.healthidentitydirectory.com/sign-in">I already have a Health ID</a>'
  + '<a href="https://app.healthidentitydirectory.com/">Open Health ID</a>'
  + '<a href="/products/laboratory">Laboratory</a><a href="/providers">For providers</a>'
  // The module showcase's Identity card (content/module-showcase.ts), whose call to action is sign-up.
  + '<a class="module-showcase-cta" href="https://app.healthidentitydirectory.com/enroll">Get your Health ID</a></main>'
  + '<footer><a href="/privacy">Privacy</a><a href="mailto:support@healthidentitydirectory.com">Email us</a>'
  // The public site's staff sign-in (content/site.ts APP_ENTRY.staffSignIn), at the portal it was built with.
  + '<a href="https://app.healthidentitydirectory.com/provider/sign-in">Provider sign in</a></footer>'
  + '</body></html>'

/** The patient portal's own index.html, which a signed-in patient gets at "/". */
const PORTAL_INDEX = '<!doctype html><div id="root"></div>'

const PUBLIC_FILES = {
  '/products/laboratory': ['text/html; charset=utf-8', LABORATORY_PAGE],
  '/patients': ['text/html; charset=utf-8', PATIENTS_PAGE],
  '/_next/static/chunks/main-app.js': ['application/javascript', 'console.log("public site")'],
  '/brand/logo.png': ['image/png', 'logo'],
  '/service-worker.js': ['application/javascript', 'self.registration.unregister()'],
}

/** A stand-in asset binding: the files given, a 404 page or the single-page fallback, and a log of what it saw. */
function assetWorker(files, notFound) {
  return `const files = ${JSON.stringify(files)}
export default { async fetch(request) {
  const url = new URL(request.url)
  if (url.pathname === '/__seen') return Response.json(globalThis.seen ?? [])
  ;(globalThis.seen ??= []).push({ path: url.pathname, headers: [...request.headers] })
  const file = files[url.pathname]
  if (file) return new Response(file[1], { headers: { 'content-type': file[0], etag: '"' + url.pathname.length + '"' } })
  return ${notFound === 'spa'
    ? `new Response(${JSON.stringify(PORTAL_INDEX)}, { headers: { 'content-type': 'text/html; charset=utf-8' } })`
    : `new Response('<p>Not found</p>', { status: 404, headers: { 'content-type': 'text/html' } })`}
} }`
}

function frontend(name, app, host, bindings) {
  return {
    name, modules: MODULES, modulesRoot: SOURCE,
    compatibilityDate: '2026-10-01',
    bindings: { DEPLOYMENT_ENV: 'production', APP_NAME: app, EXPECTED_HOST: host,
      API_ORIGIN: 'https://api.healthidentitydirectory.com', ORIGIN_AUTH_TOKEN: TOKEN },
    serviceBindings: bindings,
  }
}

let mf, lab, labWithoutBinding, publicSite, labAssets, publicAssets, portal, portalAssets

before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({
    workers: [
      frontend('lab', 'lab', 'lab.healthidentitydirectory.com', { ASSETS: 'lab-assets', PUBLIC_SITE: 'public' }),
      frontend('lab-unbound', 'lab', 'lab.healthidentitydirectory.com', { ASSETS: 'lab-assets' }),
      frontend('public', 'public', 'healthidentitydirectory.com', { ASSETS: 'public-assets' }),
      frontend('web', 'web', 'app.healthidentitydirectory.com', { ASSETS: 'web-assets', PUBLIC_SITE: 'public' }),
      { name: 'lab-assets', modules: true, compatibilityDate: '2026-10-01',
        script: assetWorker({ '/sw.js': ['application/javascript', 'self.addEventListener("push", () => {})'],
          '/brand/own.png': ['image/png', 'the product site\'s own'] }, 'spa') },
      { name: 'web-assets', modules: true, compatibilityDate: '2026-10-01',
        script: assetWorker({ '/sw.js': ['application/javascript', 'self.addEventListener("push", () => {})'] }, 'spa') },
      { name: 'public-assets', modules: true, compatibilityDate: '2026-10-01', script: assetWorker(PUBLIC_FILES, '404') },
    ],
  }))
  ;[lab, labWithoutBinding, publicSite, labAssets, publicAssets, portal, portalAssets] = await Promise.all(
    ['lab', 'lab-unbound', 'public', 'lab-assets', 'public-assets', 'web', 'web-assets'].map(name => mf.getWorker(name)))
})

after(async () => { await mf?.dispose() })

async function seen(assets) {
  return (await assets.fetch('https://assets.invalid/__seen')).json()
}

test('the lab site\'s front page is the Laboratory page, its links rewritten for the lab site', async () => {
  const response = await lab.fetch('https://lab.healthidentitydirectory.com/', {
    headers: { cookie: '__Host-hid_session=secret', authorization: 'Bearer secret', 'cf-connecting-ip': '192.0.2.7' },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^text\/html/)
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()')
  const page = await response.text()
  const links = Object.fromEntries([...page.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)</g)].map(match => [match[2] || 'logo', match[1]]))
  assert.deepEqual(links, {
    'Skip to content': '#main',
    logo: 'https://healthidentitydirectory.com/',
    Pricing: 'https://healthidentitydirectory.com/pricing',
    EHR: 'https://ehr.healthidentitydirectory.com/',
    Laboratory: 'https://lab.healthidentitydirectory.com/',
    API: 'https://healthidentitydirectory.com/products/api',
    Providers: 'https://healthidentitydirectory.com/providers#products',
    // The workspace's entrance on this site, which asks for a sign-in itself.
    'Sign in': 'https://lab.healthidentitydirectory.com/provider',
    'Setup Your Facility': 'https://app.healthidentitydirectory.com/provider/enroll?product=laboratory',
    'Book a demo': '#demo',
    Blog: 'https://healthidentitydirectory.com/blog?tag=a&amp;page=2',
    // A section of this same page: it stays here.
    'See pricing': '#pricing',
    'Patient sign in': 'https://app.healthidentitydirectory.com/sign-in',
    'Email us': 'mailto:support@healthidentitydirectory.com',
  })
  // One canonical address, the lab site's front page, and the page's own script, once each, in its head.
  const head = page.slice(0, page.indexOf('</head>'))
  assert.equal(page.match(/rel="canonical"/g).length, 1)
  assert.match(head, /<link rel="canonical" href="https:\/\/lab\.healthidentitydirectory\.com\/">/)
  assert.equal(page.match(/<script>\(function\(rewrite,site\)/g).length, 1)
  assert.ok(head.includes('<script>(function(rewrite,site)'))
  // Its files keep their addresses: the lab site serves them (below). Everything else is the page as built.
  for (const unchanged of ['href="/_next/static/css/site.css"', 'src="/_next/static/chunks/main-app.js"',
    'href="/icon.png?e84ead3bb5a2b28a"', 'src="/brand/logo.png"', 'self.__next_f.push(', '<title>Health ID Laboratory | Health ID</title>']) {
    assert.ok(page.includes(unchanged), unchanged)
  }
  // The public site was asked for its page with none of the visitor's cookie, credentials or address.
  const asked = (await seen(publicAssets)).find(entry => entry.path === '/products/laboratory')
  const names = asked.headers.map(([name]) => name)
  for (const name of ['cookie', 'authorization', 'cf-connecting-ip', 'x-hid-client-ip', 'x-forwarded-for']) {
    assert.ok(!names.includes(name), name)
  }
})

/** The canonical address the release reads on a product site's front page (deploy-production-workers.py). */
const RELEASE_READS = /<link rel="canonical" href="https:\/\/lab\.healthidentitydirectory\.com\/">/g

test('a page that names its own canonical address carries the lab site\'s instead, once, in one shape', async () => {
  // As Next.js writes it when a page sets metadata.alternates.canonical, and as a page could otherwise say it.
  const named = [
    '<link rel="canonical" href="https://healthidentitydirectory.com/products/laboratory"/>',
    '<link rel="Canonical" href="/products/laboratory">',
    '<link href="https://healthidentitydirectory.com/products/laboratory" rel="alternate canonical" />',
  ]
  const own = new Miniflare(convertV4MiniflareOptions({
    workers: [
      frontend('lab', 'lab', 'lab.healthidentitydirectory.com', { ASSETS: 'lab-assets', PUBLIC_SITE: 'public' }),
      frontend('public', 'public', 'healthidentitydirectory.com', { ASSETS: 'public-assets' }),
      { name: 'lab-assets', modules: true, compatibilityDate: '2026-10-01', script: assetWorker({}, 'spa') },
      { name: 'public-assets', modules: true, compatibilityDate: '2026-10-01', script: assetWorker({ '/products/laboratory':
        ['text/html; charset=utf-8', LABORATORY_PAGE.replace('</head>', named.slice(0, 2).join('') + '</head>')
          .replace('</main>', named[2] + '</main>')] }, '404') },
    ],
  }))
  try {
    const page = await (await (await own.getWorker('lab')).fetch('https://lab.healthidentitydirectory.com/')).text()
    // The page's own are gone; the lab site's is the only one, in the head, exactly as the release reads it.
    assert.deepEqual(page.match(/<link[^>]*\brel="[^"]*canonical[^"]*"[^>]*>/gi), [RELEASE_READS.source.replaceAll('\\', '')])
    assert.equal(page.match(RELEASE_READS).length, 1)
    assert.ok(page.indexOf(RELEASE_READS.source.replaceAll('\\', '')) < page.indexOf('</head>'))
    assert.doesNotMatch(page, /<link[^>]*products\/laboratory/i)
  } finally {
    await own.dispose()
  }
})

/** Each link's text and address on a page. */
function linksOf(page) {
  return [...page.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)</g)].map(match => [match[2] || 'logo', match[1]])
}

test('lab sends staff signed in there from its front page to the workspace, in the real runtime', async () => {
  const before = (await seen(publicAssets)).length
  for (const path of ['/', '/index.html?utm_source=email']) {
    const response = await lab.fetch(`https://lab.healthidentitydirectory.com${path}`,
      { headers: { cookie: 'theme=dark; hid_access_csrf=4f9c2b' }, redirect: 'manual' })
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), 'https://lab.healthidentitydirectory.com/provider')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(response.headers.get('vary'), 'Cookie')
  }
  // The public site was not asked.
  assert.equal((await seen(publicAssets)).length, before)
  // Its landing page, too, is private and varies with the cookie.
  const landing = await lab.fetch('https://lab.healthidentitydirectory.com/')
  assert.equal(landing.headers.get('cache-control'), 'private, no-store')
  assert.equal(landing.headers.get('vary'), 'Cookie')
  await landing.text()
})

test('the patient portal shows a stranger the Health ID page from the public site, and its buttons sign in and sign up there', async () => {
  const response = await portal.fetch('https://app.healthidentitydirectory.com/', {
    headers: { cookie: 'hid_access=eyJhbGciOi; theme=dark', authorization: 'Bearer secret', 'cf-connecting-ip': '192.0.2.7' },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('vary'), 'Cookie')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()')
  const page = await response.text()
  assert.deepEqual(linksOf(page), [
    ['Skip to content', '#main'],
    ['logo', 'https://healthidentitydirectory.com/'],
    // Its own sections stay on this page, which scrolls to them, as on the public site.
    ['How it works', '#steps'],
    ['Your control', '#control'],
    // Sign in at the portal's sign-in, never its "/" (which is this page to a stranger); sign up at its /enroll.
    ['Sign in', 'https://app.healthidentitydirectory.com/sign-in'],
    ['Get your Health ID', 'https://app.healthidentitydirectory.com/enroll'],
    ['Create your Health ID', 'https://app.healthidentitydirectory.com/enroll'],
    ['I already have a Health ID', 'https://app.healthidentitydirectory.com/sign-in'],
    ['Open Health ID', 'https://app.healthidentitydirectory.com/sign-in'],
    ['Laboratory', 'https://lab.healthidentitydirectory.com/'],
    ['For providers', 'https://healthidentitydirectory.com/providers'],
    ['Get your Health ID', 'https://app.healthidentitydirectory.com/enroll'],
    ['Privacy', 'https://healthidentitydirectory.com/privacy'],
    ['Email us', 'mailto:support@healthidentitydirectory.com'],
    // The portal serves patients only: staff sign in on the EHR site, straight from this page.
    ['Provider sign in', 'https://ehr.healthidentitydirectory.com/provider/sign-in'],
  ])
  // The two the edge made links within the page say so, for the page's script; the page's own (#main) do not.
  assert.deepEqual([...page.matchAll(/<a[^>]*\bdata-hid-in-page\b[^>]*>([^<]*)</g)].map(match => match[1]),
    ['How it works', 'Your control'])
  // Every "Get your Health ID" is a step to sign-up, the Identity card's too: never the main site's copy of this page.
  const getYourHealthId = linksOf(page).filter(([text]) => /get your health id/i.test(text))
  assert.equal(getYourHealthId.length, 2)
  for (const [, href] of getYourHealthId) assert.equal(href, 'https://app.healthidentitydirectory.com/enroll')
  // Its canonical address stays the public site's patient page, once, in its head.
  const head = page.slice(0, page.indexOf('</head>'))
  assert.deepEqual(page.match(/<link[^>]*\brel="[^"]*canonical[^"]*"[^>]*>/gi),
    ['<link rel="canonical" href="https://healthidentitydirectory.com/patients">'])
  assert.ok(head.includes('<link rel="canonical" href="https://healthidentitydirectory.com/patients">'))
  assert.equal(page.match(/<script>\(function\(rewrite,site\)/g).length, 1)
  assert.ok(page.includes('<title>For patients | Health ID</title>'))
  // Asked for at its one address, with none of the visitor's cookie, credentials or address.
  const asked = (await seen(publicAssets)).filter(entry => entry.path === '/patients')
  assert.equal(asked.length, 1)
  const names = asked[0].headers.map(([name]) => name)
  for (const name of ['cookie', 'authorization', 'cf-connecting-ip', 'x-hid-client-ip', 'x-forwarded-for']) {
    assert.ok(!names.includes(name), name)
  }
  // The portal's own build was not asked for its front page.
  assert.ok(!(await seen(portalAssets)).some(entry => entry.path === '/'))
})

test('the patient portal is a signed-in patient\'s front page, as before', async () => {
  for (const path of ['/', '/?from=notification']) {
    const response = await portal.fetch(`https://app.healthidentitydirectory.com${path}`,
      { headers: { cookie: 'hid_access=eyJhbGciOi; hid_access_csrf=4f9c2b' } })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), PORTAL_INDEX)
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(response.headers.get('vary'), 'Cookie')
  }
  // The portal's own build answered, with the visitor's request as it was.
  const own = (await seen(portalAssets)).filter(entry => entry.path === '/')
  assert.equal(own.length, 2)
  assert.ok(own.every(entry => entry.headers.some(([name, value]) => name === 'cookie' && value.includes('hid_access_csrf=4f9c2b'))))
  // Every other portal page is its own for anyone: sign-in, sign-up, the push worker.
  for (const path of ['/sign-in', '/enroll', '/notifications']) {
    assert.equal(await (await portal.fetch(`https://app.healthidentitydirectory.com${path}`)).text(), PORTAL_INDEX, path)
  }
  assert.match(await (await portal.fetch('https://app.healthidentitydirectory.com/sw.js')).text(), /push/)
})

test('the patient portal sends its staff entrance and sign-in to the EHR site\'s sign-in, signed in or not', async () => {
  for (const path of ['/provider', '/provider/sign-in', '/provider/sign-in?returnTo=https://evil.example']) {
    for (const headers of [{}, { cookie: 'hid_access_csrf=4f9c2b' }]) {
      const response = await portal.fetch(`https://app.healthidentitydirectory.com${path}`, { headers, redirect: 'manual' })
      assert.equal(response.status, 302, path)
      assert.equal(response.headers.get('location'), 'https://ehr.healthidentitydirectory.com/provider/sign-in', path)
      await response.arrayBuffer()
    }
  }
  // Staff recovery, facility sign-up, invitations and the clinician pages stay the portal's own until hid-system
  // accepts their security checks on the product sites.
  for (const path of ['/provider/recover', '/provider/enroll', '/provider/invitation', '/provider/join', '/provider/join/status']) {
    assert.equal(await (await portal.fetch(`https://app.healthidentitydirectory.com${path}`)).text(), PORTAL_INDEX, path)
  }
})

test('the patient portal serves the public site\'s static files the Health ID page loads', async () => {
  const script = await portal.fetch('https://app.healthidentitydirectory.com/_next/static/chunks/main-app.js')
  assert.equal(script.status, 200)
  assert.equal(await script.text(), 'console.log("public site")')
  const logo = await portal.fetch('https://app.healthidentitydirectory.com/brand/logo.png')
  assert.equal(await logo.text(), 'logo')
  // Never the public site's retiring worker.
  const retiring = await portal.fetch('https://app.healthidentitydirectory.com/service-worker.js')
  assert.notEqual(await retiring.text(), 'self.registration.unregister()')
})

test('the public site sends its Laboratory page to the lab site, and keeps its own pages', async () => {
  const redirected = await publicSite.fetch('https://healthidentitydirectory.com/products/laboratory', { redirect: 'manual' })
  assert.equal(redirected.status, 308)
  assert.equal(redirected.headers.get('location'), 'https://lab.healthidentitydirectory.com/')
  const api = await publicSite.fetch('https://healthidentitydirectory.com/products/api', { redirect: 'manual' })
  assert.equal(api.status, 404)
  // The patient page stays at its address, for anyone.
  const patients = await publicSite.fetch('https://healthidentitydirectory.com/patients',
    { redirect: 'manual', headers: { cookie: 'hid_access_csrf=4f9c2b' } })
  assert.equal(patients.status, 200)
  assert.equal(await patients.text(), PATIENTS_PAGE)
})

test('the lab site serves the public site\'s static files it lacks, and its own files first', async () => {
  const script = await lab.fetch('https://lab.healthidentitydirectory.com/_next/static/chunks/main-app.js',
    { headers: { cookie: 'session=secret' } })
  assert.equal(script.status, 200)
  assert.equal(await script.text(), 'console.log("public site")')
  assert.equal(script.headers.get('content-type'), 'application/javascript')
  const logo = await lab.fetch('https://lab.healthidentitydirectory.com/brand/logo.png')
  assert.equal(await logo.text(), 'logo')
  const own = await lab.fetch('https://lab.healthidentitydirectory.com/brand/own.png')
  assert.equal(await own.text(), 'the product site\'s own')
  // Never the public site's retiring worker, nor any page of it; the portal's push worker stays its own.
  const retiring = await lab.fetch('https://lab.healthidentitydirectory.com/service-worker.js')
  assert.notEqual(await retiring.text(), 'self.registration.unregister()')
  const push = await lab.fetch('https://lab.healthidentitydirectory.com/sw.js')
  assert.match(await push.text(), /push/)
  const missing = await lab.fetch('https://lab.healthidentitydirectory.com/_next/static/chunks/gone.js')
  assert.equal(missing.status, 404)
  // The lab site's own files were looked for first.
  assert.ok((await seen(labAssets)).some(entry => entry.path === '/_next/static/chunks/main-app.js'))
  const sent = (await seen(publicAssets)).filter(entry => entry.path.startsWith('/_next/') || entry.path.startsWith('/brand/'))
  assert.ok(sent.every(entry => !entry.headers.some(([name]) => name === 'cookie')))
  assert.ok(!(await seen(publicAssets)).some(entry => ['/service-worker.js', '/sw.js', '/brand/own.png'].includes(entry.path)))
})

test('the lab site keeps its workspace and says so in plain words when it has no public-site binding', async () => {
  const workspace = await lab.fetch('https://lab.healthidentitydirectory.com/provider/sign-in')
  assert.equal(await workspace.text(), '<!doctype html><div id="root"></div>')
  const unavailable = await labWithoutBinding.fetch('https://lab.healthidentitydirectory.com/')
  assert.equal(unavailable.status, 503)
  const page = await unavailable.text()
  assert.match(page, /This page is not available right now/)
  assert.doesNotMatch(page, /binding|worker|PUBLIC_SITE/i)
})

test('in the browser, every link on the page leaves for the address the edge gives it', async () => {
  const page = await (await lab.fetch('https://lab.healthidentitydirectory.com/')).text()
  const dom = new JSDOM(page.replace(/<script src[^>]*><\/script>|<script>self\.__next_f[^<]*<\/script>/g, ''),
    { url: 'https://lab.healthidentitydirectory.com/', runScripts: 'dangerously' })
  const { document } = dom.window
  try {
    // What the page's own router sees: a click it would turn into navigation inside this site.
    const routed = []
    document.addEventListener('click', event => { routed.push(event.target.closest('a')?.getAttribute('href')) })
    // A link the page draws itself after loading (its menus), with the address it was built with.
    const menu = document.createElement('a')
    menu.setAttribute('href', '/products/pharmacy')
    menu.textContent = 'Pharmacy'
    document.body.append(menu)
    const navigation = []
    dom.virtualConsole?.on?.('jsdomError', () => {})
    menu.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    assert.equal(menu.getAttribute('href'), 'https://pharmacy.healthidentitydirectory.com/')
    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    menu.dispatchEvent(click)
    navigation.push(click.defaultPrevented)
    // The browser follows it (nothing prevents the click); the router never sees it.
    assert.deepEqual(navigation, [false])
    assert.deepEqual(routed, [])
    // A link within the page is the page's own: its handler sees it.
    const demo = [...document.querySelectorAll('a')].find(link => link.getAttribute('href') === '#demo')
    demo.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    assert.deepEqual(routed, ['#demo'])
    // A new-tab click is the browser's: the address is fixed when the pointer goes down, and the page sees the click.
    const tab = document.createElement('a')
    tab.setAttribute('href', '/contact')
    document.body.append(tab)
    tab.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }))
    assert.equal(tab.getAttribute('href'), 'https://healthidentitydirectory.com/contact')
    tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }))
    assert.deepEqual(routed, ['#demo', 'https://healthidentitydirectory.com/contact'])
  } finally {
    dom.window.close()
  }
})

test('in the browser, the Health ID page on the portal never sends a stranger back to its own front page', async () => {
  const page = await (await portal.fetch('https://app.healthidentitydirectory.com/')).text()
  const dom = new JSDOM(page.replace(/<script src[^>]*><\/script>/g, ''),
    { url: 'https://app.healthidentitydirectory.com/', runScripts: 'dangerously' })
  const { document } = dom.window
  try {
    const routed = []
    document.addEventListener('click', event => { routed.push(event.target.closest('a')?.getAttribute('href')) })
    // A link the page draws itself after loading, with the address it was built with: the portal's front page.
    const open = document.createElement('a')
    open.setAttribute('href', 'https://app.healthidentitydirectory.com/')
    document.body.append(open)
    open.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    assert.equal(open.getAttribute('href'), 'https://app.healthidentitydirectory.com/sign-in')
    // Its sign-in button is followed by the browser itself, so the page's router never turns it into "/".
    const signIn = [...document.querySelectorAll('a')].find(link => link.textContent === 'Sign in')
    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    signIn.dispatchEvent(click)
    assert.equal(click.defaultPrevented, false)
    assert.equal(signIn.getAttribute('href'), 'https://app.healthidentitydirectory.com/sign-in')
    assert.deepEqual(routed, [])
  } finally {
    dom.window.close()
  }
})

test('in the browser, the Health ID page on the portal scrolls to its own sections, and never leaves for them', async () => {
  const page = await (await portal.fetch('https://app.healthidentitydirectory.com/')).text()
  const dom = new JSDOM(page.replace(/<script src[^>]*><\/script>/g, ''),
    { url: 'https://app.healthidentitydirectory.com/', runScripts: 'dangerously' })
  const { document } = dom.window
  try {
    // What the page itself does with a click on a link: its menu closes (its own handler), and its router would turn
    // the address it was built with, /patients#steps, into a visit to /patients on this site unless the click's
    // default is already prevented (next/link skips a prevented click).
    const seen = []
    document.addEventListener('click', event => {
      seen.push([event.target.closest('a')?.getAttribute('href'), event.defaultPrevented])
    })
    const click = target => {
      const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
      target.dispatchEvent(event)
      return event
    }
    // "How it works" in the navigation, as the edge wrote it.
    const steps = [...document.querySelectorAll('a')].find(link => link.textContent === 'How it works')
    assert.equal(steps.getAttribute('href'), '#steps')
    click(steps)
    assert.equal(dom.window.location.href, 'https://app.healthidentitydirectory.com/#steps')
    // The page sees the click (its menu closes), already prevented (its router leaves it alone).
    assert.deepEqual(seen, [['#steps', true]])
    // "Your control" in the menu the page draws itself after loading, with the address it was built with.
    const menu = document.createElement('a')
    menu.setAttribute('href', '/patients#control')
    menu.textContent = 'Your control'
    document.body.append(menu)
    menu.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    assert.equal(menu.getAttribute('href'), '#control')
    click(menu)
    assert.equal(dom.window.location.href, 'https://app.healthidentitydirectory.com/#control')
    assert.deepEqual(seen.at(-1), ['#control', true])
    // A link the page made within itself stays the page's own: not prevented, and nothing done for it.
    const skip = [...document.querySelectorAll('a')].find(link => link.textContent === 'Skip to content')
    const own = click(skip)
    assert.equal(own.defaultPrevented, false)
    assert.deepEqual(seen.at(-1), ['#main', false])
    assert.equal(dom.window.location.href, 'https://app.healthidentitydirectory.com/#control')
    // A new-tab click on a section is the browser's.
    const tab = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })
    steps.dispatchEvent(tab)
    assert.equal(tab.defaultPrevented, false)
  } finally {
    dom.window.close()
  }
})

/**
 * The script the edge adds to a page for someone not signed in, which asks the edge again when the browser holds
 * the sign-in cookie but did not send it (SameSite=Strict, on arrival from another site).
 */
const RECHECK = /<script>(\(function\(carries\)[\s\S]*?)<\/script>/g

function recheckOf(page) {
  const scripts = [...page.matchAll(RECHECK)].map(match => match[1])
  assert.equal(scripts.length, 1, 'the page carries the sign-in re-check once')
  return scripts[0]
}

/**
 * Runs the page's re-check as a browser would on loading the page, with `cookie` as the page's document.cookie, at
 * `href`, at `now`, with `storage` as the tab's sessionStorage. It answers each address the page asked for again.
 */
function runRecheck(script, { cookie = '', href = 'https://app.healthidentitydirectory.com/', now = 1_800_000_000_000, storage = new Map() } = {}) {
  const asked = []
  const sessionStorage = storage instanceof Map
    ? { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, String(value)) } }
    : storage
  runInContext(script, createContext({
    document: { cookie },
    location: { href, replace: address => { asked.push(address) } },
    sessionStorage,
    Date: { now: () => now },
  }))
  return asked
}

test('a page for someone not signed in carries the sign-in re-check, on the portal, on a product site, and when the public site is away', async () => {
  const pages = {
    portal: await (await portal.fetch('https://app.healthidentitydirectory.com/')).text(),
    lab: await (await lab.fetch('https://lab.healthidentitydirectory.com/')).text(),
    unavailable: await (await labWithoutBinding.fetch('https://lab.healthidentitydirectory.com/')).text(),
  }
  for (const [name, page] of Object.entries(pages)) {
    const script = recheckOf(page)
    const head = page.slice(0, page.indexOf('</head>'))
    assert.ok(head.includes(script), `${name}: in the head`)
    // Before the page's link script, which it needs nothing from: it holds its own copy of the edge's cookie rule.
    if (name !== 'unavailable') assert.ok(head.indexOf(script) < head.indexOf('<script>(function(rewrite,site)'), name)
    assert.match(script, /^\(function\(carries\)\{try\{if\(!carries\(document\.cookie,"hid_access_csrf"\)\)return;/, name)
  }
  // Someone signed in gets no such page: the workspace's entrance, or the portal's own build, untouched.
  const signedIn = { headers: { cookie: 'hid_access_csrf=4f9c2b' }, redirect: 'manual' }
  assert.equal((await lab.fetch('https://lab.healthidentitydirectory.com/', signedIn)).status, 302)
  assert.equal(await (await portal.fetch('https://app.healthidentitydirectory.com/', signedIn)).text(), PORTAL_INDEX)
})

test('in the browser, a page shown to someone the browser holds signed in asks for its own address again, once', async () => {
  const script = recheckOf(await (await portal.fetch('https://app.healthidentitydirectory.com/')).text())
  // document.cookie as browsers give it: the sign-in cookie, alone or among others.
  for (const cookie of ['hid_access_csrf=x', 'theme=dark; hid_access_csrf=4f9c2b', 'hid_access_csrf=4f9c2b; theme=dark', ' hid_access_csrf = x ']) {
    const storage = new Map()
    assert.deepEqual(runRecheck(script, { cookie, storage }), ['https://app.healthidentitydirectory.com/'], cookie)
    assert.equal(storage.get('hid-front-page-recheck'), '1800000000000', cookie)
  }
  // Its address as it is, query and all, but never its fragment: a change of fragment alone would only scroll.
  assert.deepEqual(runRecheck(script, { cookie: 'hid_access_csrf=x', href: 'https://app.healthidentitydirectory.com/?from=email#steps' }),
    ['https://app.healthidentitydirectory.com/?from=email'])
  assert.deepEqual(runRecheck(script, { cookie: 'hid_access_csrf=x', href: 'https://lab.healthidentitydirectory.com/index.html' }),
    ['https://lab.healthidentitydirectory.com/index.html'])
  // No sign-in cookie, an empty one, or only another name: the page stays, and notes nothing.
  for (const cookie of ['', 'theme=dark', 'hid_access_csrf=', 'hid_access_csrf=""', 'hid_access_csrf= ""', 'hid_access_csrf',
    'hid_access=eyJhbGciOi', 'hid_access_refresh=x', 'HID_ACCESS_CSRF=x', 'Hid_Access_Csrf=x', '__Host-hid_access_csrf=x',
    'hid_access_csrf_old=x', 'xhid_access_csrf=x', 'theme=hid_access_csrf']) {
    const storage = new Map()
    assert.deepEqual(runRecheck(script, { cookie, storage }), [], cookie)
    assert.equal(storage.size, 0, cookie)
  }
})

test('in the browser, the page asks again at most once in ten seconds in a tab, and never where it cannot note it', async () => {
  const script = recheckOf(await (await lab.fetch('https://lab.healthidentitydirectory.com/')).text())
  const cookie = 'hid_access_csrf=x'
  const href = 'https://lab.healthidentitydirectory.com/'
  const storage = new Map()
  const start = 1_800_000_000_000
  assert.equal(runRecheck(script, { cookie, href, now: start, storage }).length, 1)
  // The browser showed the page again (it did not send the cookie): no second ask within ten seconds.
  assert.deepEqual(runRecheck(script, { cookie, href, now: start + 1, storage }), [])
  assert.deepEqual(runRecheck(script, { cookie, href, now: start + 9_999, storage }), [])
  // Ten seconds on, a new visit asks again, once.
  assert.equal(runRecheck(script, { cookie, href, now: start + 10_000, storage }).length, 1)
  assert.deepEqual(runRecheck(script, { cookie, href, now: start + 10_001, storage }), [])
  // A clock put back behind the time noted does not stop it for good.
  assert.equal(runRecheck(script, { cookie, href, now: start, storage }).length, 1)
  // A note it cannot read as a time is no note.
  assert.equal(runRecheck(script, { cookie, href, storage: new Map([['hid-front-page-recheck', 'soon']]) }).length, 1)
  // Where the tab's storage cannot be read or written, it does not ask (so it cannot ask forever), and nothing throws.
  const refuses = which => ({
    getItem: () => { if (which === 'read') throw new Error('blocked'); return null },
    setItem: () => { if (which === 'write') throw new Error('blocked') },
  })
  assert.deepEqual(runRecheck(script, { cookie, href, storage: refuses('read') }), [])
  assert.deepEqual(runRecheck(script, { cookie, href, storage: refuses('write') }), [])
})

test('the page and the edge read the same cookies as a sign-in', async () => {
  const script = recheckOf(await (await lab.fetch('https://lab.healthidentitydirectory.com/')).text())
  for (const cookie of ['hid_access_csrf=4f9c2b', 'theme=dark; hid_access_csrf=4f9c2b', 'theme=dark, hid_access_csrf=4f9c2b',
    '  hid_access_csrf = 4f9c2b  ', 'hid_access_csrf=4f9c2b; hid_access_csrf=', 'hid_access_csrf=; hid_access_csrf=4f9c2b',
    'hid_access_csrf=', 'hid_access_csrf=""', 'hid_access_csrf= ; theme=dark', 'hid_access_csrf', 'hid_access=eyJhbGciOi',
    'hid_access_refresh=x', 'HID_ACCESS_CSRF=4f9c2b', '__Host-hid_access_csrf=4f9c2b', 'hid_access_csrf_old=4f9c2b',
    'theme=hid_access_csrf', 'a=b,hid_access_csrf=4f9c2b', 'a=b;;hid_access_csrf=4f9c2b']) {
    const edge = await lab.fetch('https://lab.healthidentitydirectory.com/', { headers: { cookie }, redirect: 'manual' })
    await edge.arrayBuffer()
    const page = runRecheck(script, { cookie, href: 'https://lab.healthidentitydirectory.com/' })
    assert.equal(page.length === 1, edge.status === 302, cookie)
  }
})

test('in the browser, the page reads the tab\'s own cookies and storage, and leaves a stranger\'s tab as it was', async () => {
  for (const [signedIn, cookies] of [[true, ['theme=dark', 'hid_access_csrf=4f9c2b; Secure; SameSite=Strict']], [false, ['theme=dark', 'hid_access=x; Secure']]]) {
    const page = await (await portal.fetch('https://app.healthidentitydirectory.com/')).text()
    const cookieJar = new CookieJar()
    for (const cookie of cookies) cookieJar.setCookieSync(`${cookie}; Path=/`, 'https://app.healthidentitydirectory.com/')
    const dom = new JSDOM(page.replace(/<script src[^>]*><\/script>/g, ''),
      { url: 'https://app.healthidentitydirectory.com/', runScripts: 'dangerously', cookieJar })
    try {
      // The time it noted just before asking for the page again (jsdom loads no page for that).
      const noted = dom.window.sessionStorage.getItem('hid-front-page-recheck')
      if (signedIn) assert.match(noted ?? '', /^\d{13}$/)
      else assert.equal(noted, null)
    } finally {
      dom.window.close()
    }
  }
})
