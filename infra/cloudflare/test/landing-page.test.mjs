import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { JSDOM } from 'jsdom'

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
  + '<main id="main"><a href="#demo">Book a demo</a><a href="/blog?tag=a&amp;page=2">Blog</a></main>'
  + '<footer><a href="https://app.healthidentitydirectory.com/sign-in">Patient sign in</a>'
  + '<a href="mailto:support@healthidentitydirectory.com">Email us</a></footer>'
  + '<script>self.__next_f.push([1,"a:[\\"$\\",\\"a\\",null,{\\"href\\":\\"/pricing\\"}]"])</script></body></html>'

const PUBLIC_FILES = {
  '/products/laboratory': ['text/html; charset=utf-8', LABORATORY_PAGE],
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
    ? `new Response('<!doctype html><div id="root"></div>', { headers: { 'content-type': 'text/html; charset=utf-8' } })`
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

let mf, lab, labWithoutBinding, publicSite, labAssets, publicAssets

before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({
    workers: [
      frontend('lab', 'lab', 'lab.healthidentitydirectory.com', { ASSETS: 'lab-assets', PUBLIC_SITE: 'public' }),
      frontend('lab-unbound', 'lab', 'lab.healthidentitydirectory.com', { ASSETS: 'lab-assets' }),
      frontend('public', 'public', 'healthidentitydirectory.com', { ASSETS: 'public-assets' }),
      { name: 'lab-assets', modules: true, compatibilityDate: '2026-10-01',
        script: assetWorker({ '/sw.js': ['application/javascript', 'self.addEventListener("push", () => {})'],
          '/brand/own.png': ['image/png', 'the product site\'s own'] }, 'spa') },
      { name: 'public-assets', modules: true, compatibilityDate: '2026-10-01', script: assetWorker(PUBLIC_FILES, '404') },
    ],
  }))
  ;[lab, labWithoutBinding, publicSite, labAssets, publicAssets] = await Promise.all(
    ['lab', 'lab-unbound', 'public', 'lab-assets', 'public-assets'].map(name => mf.getWorker(name)))
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
    'Sign in': 'https://lab.healthidentitydirectory.com/provider/sign-in',
    'Setup Your Facility': 'https://app.healthidentitydirectory.com/provider/enroll?product=laboratory',
    'Book a demo': '#demo',
    Blog: 'https://healthidentitydirectory.com/blog?tag=a&amp;page=2',
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

test('the public site sends its Laboratory page to the lab site, and keeps its own pages', async () => {
  const redirected = await publicSite.fetch('https://healthidentitydirectory.com/products/laboratory', { redirect: 'manual' })
  assert.equal(redirected.status, 308)
  assert.equal(redirected.headers.get('location'), 'https://lab.healthidentitydirectory.com/')
  const api = await publicSite.fetch('https://healthidentitydirectory.com/products/api', { redirect: 'manual' })
  assert.equal(api.status, 404)
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
