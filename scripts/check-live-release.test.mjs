// Tests for scripts/check-live-release.mjs, run with `npm run test:live-release`. Everything here is served from
// 127.0.0.1 by the test itself: no live site is ever read. The words are made up.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { EXPECTATIONS, judge, scriptsInHtml, scriptsInScript, SITES, spellings } from './check-live-release.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-live-release.mjs')

/** A static site: `files` by path, anything else 404. Records every request it gets. */
async function site(files) {
  const requests = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, headers: request.headers, body })
      const file = files[request.url.split('?')[0]]
      if (typeof file === 'function') return file(request, response)
      if (file === undefined) { response.writeHead(404); return response.end('not here') }
      response.writeHead(200, { 'content-type': request.url.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' })
      response.end(file)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return { origin, requests, close: () => new Promise(resolve => server.close(resolve)) }
}

function run(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('close', code => resolve({ code, output }))
  })
}

let dir
test.before(async () => { dir = await mkdtemp(join(tmpdir(), 'live-release-check-')) })
test.after(async () => { await rm(dir, { recursive: true, force: true }) })

async function expectationsFile(name, list) {
  const path = join(dir, name)
  await writeFile(path, JSON.stringify(list))
  return path
}

/** A Vite-like build: the entry loads a page chunk by a dynamic import, through __vite__mapDeps. */
function build(other, { lazyWords = 'The lamp is lit in the north tower.', switchValue = '!0' } = {}) {
  return {
    '/provider/sign-in': `<!doctype html><html><head>
      <script type="module" crossorigin src="/assets/index-Ab12Cd34.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/vendor-Ef56Gh78.js">
      <link rel="stylesheet" href="/assets/index-Zz99Yy88.css">
      <script src="${other}/assets/tracker-Qq11Ww22.js"></script>
      </head><body><div id="root"></div></body></html>`,
    '/': '<!doctype html><html><body><nav><a href="#demo">Ask the ferryman</a></nav><script src="/_next/static/chunks/page-1.js"></script></body></html>',
    '/assets/index-Ab12Cd34.js': 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/Page-Ij90Kl12.js","assets/vendor-Ef56Gh78.js"])))=>i.map(i=>d[i]);'
      + 'const Page=lazy(async()=>({default:(await a(async()=>{let{Page:e}=await import(`./Page-Ij90Kl12.js`);return{Page:e}},__vite__mapDeps([0,1]))).Page}));'
      + 'fetch("/api/v1/never.js");',
    '/assets/vendor-Ef56Gh78.js': 'export const v=1;',
    '/assets/Page-Ij90Kl12.js': `function rl(e){return\`The ferry for \${e} leaves at dawn. Bring your own lantern.\`}var il={live:${switchValue}};`
      + `const W=\`${lazyWords}\`;const Q=\`The harbour master’s bell rings twice.\`;`,
    '/_next/static/chunks/page-1.js': 'const x="Ask the ferryman";const y="Words only in a shared script";',
  }
}

const LIST = [
  { id: 'lazy-present', label: '#1 lamp words', sites: ['ehr'], text: 'The lamp is lit in the north tower.', expect: 'present', enabled: true },
  { id: 'old-absent', label: '#2 old words gone', sites: ['ehr'], text: 'The lamp is out.', expect: 'absent', enabled: true },
  { id: 'curly', label: '#3 curly apostrophe', sites: ['ehr'], text: 'The harbour master’s bell rings twice.', expect: 'present', enabled: true },
  { id: 'switch', label: '#4 ferry switched on', sites: ['ehr'], text: 'Bring your own lantern.', expect: 'present', enabled: true,
    switch: { name: 'FERRY.live', within: 100, pattern: '\\{\\s*live\\s*:\\s*(!0|!1|true|false)\\s*\\}', on: ['!0', 'true'] } },
  { id: 'later', label: '#5 not due yet', sites: ['ehr'], text: 'Words nobody wrote.', expect: 'present', enabled: false },
  { id: 'front-absent', label: '#6 shared-script words not on the front page', sites: ['ehr'], text: 'Words only in a shared script', expect: 'absent', enabled: true, where: 'front' },
]

test('passes when present words are found through a dynamic import and absent words are not found', async () => {
  const other = await site({ '/assets/tracker-Qq11Ww22.js': 'const t="The lamp is out.";' })
  const ehr = await site(build(other.origin))
  try {
    const { code, output } = await run(['--expectations', await expectationsFile('ok.json', LIST), '--base-url-override', `ehr=${ehr.origin}`])
    assert.equal(code, 0, output)
    assert.match(output, /^PASS {2}ehr +#1 lamp words: found in \/assets\/Page-Ij90Kl12\.js$/m)
    assert.match(output, /^PASS {2}ehr +#2 old words gone: not found/m)
    assert.match(output, /^PASS {2}ehr +#3 curly apostrophe: found in \/assets\/Page-Ij90Kl12\.js$/m)
    assert.match(output, /^PASS {2}ehr +#4 ferry switched on: .*FERRY\.live is on \(\{live:!0\}\)/m)
    assert.match(output, /^PASS {2}ehr +#6 /m)
    assert.doesNotMatch(output, /#5 not due yet/)
    assert.match(output, /Summary: 5 passed, 0 failed, 0 not checked\. Off: later\./)
    // The other site's script (which carries the old words) was never asked for.
    assert.equal(other.requests.length, 0)
    assert.match(output, /1 on other sites not read/)
    // Each file once, GET only, no body, no cookie or credentials, a plain client name; never an API path.
    const paths = ehr.requests.map(r => r.url).sort()
    assert.deepEqual(paths, ['/', '/assets/Page-Ij90Kl12.js', '/assets/index-Ab12Cd34.js', '/assets/vendor-Ef56Gh78.js', '/provider/sign-in'])
    for (const request of ehr.requests) {
      assert.equal(request.method, 'GET')
      assert.equal(request.body, '')
      assert.equal(request.headers.cookie, undefined)
      assert.equal(request.headers.authorization, undefined)
      assert.equal(request.headers['user-agent'], 'hid-live-release-check/1 (read-only)')
    }
  } finally {
    await ehr.close()
    await other.close()
  }
})

test('fails, with exit code 1, when present words are missing or absent words are still there', async () => {
  const other = await site({})
  const ehr = await site(build(other.origin, { lazyWords: 'The lamp is out.' }))
  try {
    const { code, output } = await run(['--expectations', await expectationsFile('fail.json', LIST), '--base-url-override', `ehr=${ehr.origin}`])
    assert.equal(code, 1, output)
    assert.match(output, /^FAIL {2}ehr +#1 lamp words: not found in 4 file\(s\)$/m)
    assert.match(output, /^FAIL {2}ehr +#2 old words gone: still there, in \/assets\/Page-Ij90Kl12\.js$/m)
    assert.match(output, /Summary: 3 passed, 2 failed, 0 not checked\./)
  } finally {
    await ehr.close()
    await other.close()
  }
})

test('says the code shipped but is switched off when the switch reads off, and says so plainly when it cannot be read', async () => {
  const other = await site({})
  const off = await site(build(other.origin, { switchValue: '!1' }))
  const unreadable = await site(build(other.origin, { switchValue: 'window.flag' }))
  try {
    const list = await expectationsFile('switch.json', LIST.filter(e => e.id === 'switch'))
    const first = await run(['--expectations', list, '--base-url-override', `ehr=${off.origin}`])
    assert.equal(first.code, 1, first.output)
    assert.match(first.output, /^FAIL {2}ehr +#4 ferry switched on: .*FERRY\.live is off \(\{live:!1\}\): the code shipped, switched off$/m)
    const second = await run(['--expectations', list, '--base-url-override', `ehr=${unreadable.origin}`])
    assert.equal(second.code, 1, second.output)
    assert.match(second.output, /FERRY\.live could not be read next to them, so this proves only that the code shipped, not that it is switched on/)
  } finally {
    await off.close()
    await unreadable.close()
    await other.close()
  }
})

test('exits 2, naming the site, when a site cannot be read; a redirect to another site is not followed', async () => {
  const away = await site({})
  const redirecting = await site({ '/provider/sign-in': (request, response) => {
    response.writeHead(302, { location: `${away.origin}/provider/sign-in` })
    response.end()
  } })
  const closed = await site({})
  await closed.close()
  try {
    const list = await expectationsFile('down.json', LIST.filter(e => e.id === 'lazy-present'))
    const down = await run(['--expectations', list, '--base-url-override', `ehr=${closed.origin}`])
    assert.equal(down.code, 2, down.output)
    assert.match(down.output, /^SKIP {2}ehr +#1 lamp words: not checked, the site could not be read$/m)
    assert.match(down.output, /Could not read ehr: .*could not be read/)
    const moved = await run(['--expectations', list, '--base-url-override', `ehr=${redirecting.origin}`])
    assert.equal(moved.code, 2, moved.output)
    assert.match(moved.output, /redirects to another site .*not followed/)
    assert.equal(away.requests.length, 0)
  } finally {
    await redirecting.close()
    await away.close()
  }
})

test('--enable turns on an expectation that is off; --list shows which are on', async () => {
  const other = await site({})
  const ehr = await site(build(other.origin))
  try {
    const list = await expectationsFile('enable.json', LIST)
    const enabled = await run(['--expectations', list, '--base-url-override', `ehr=${ehr.origin}`, '--enable', 'later'])
    assert.equal(enabled.code, 1, enabled.output)
    assert.match(enabled.output, /^FAIL {2}ehr +#5 not due yet: not found/m)
    const before = ehr.requests.length + other.requests.length
    const listed = await run(['--expectations', list, '--list'])
    assert.equal(listed.code, 0)
    assert.match(listed.output, /^off {2}later {2}#5 not due yet/m)
    assert.equal(ehr.requests.length + other.requests.length, before, 'the --list run reads nothing')
  } finally {
    await ehr.close()
    await other.close()
  }
})

test('finds scripts the way Vite writes them, and nothing that merely ends in .js', () => {
  assert.deepEqual(scriptsInHtml('<script type="module" src="/assets/a-1.js"></script><link rel="modulepreload" href="/assets/b-2.js"><link rel="stylesheet" href="/assets/c.css"><script>inline()</script>'),
    ['/assets/a-1.js', '/assets/b-2.js'])
  assert.deepEqual(scriptsInScript('import(`./X-1.js`);m.f=["assets/Y-2.js"];"/assets/Z-3.js";"next.config.js";"react.js"'),
    ['./X-1.js', 'assets/Y-2.js', '/assets/Z-3.js'])
})

test('reads words the way a build may escape them', () => {
  assert.ok(spellings('patient’s').includes('patient\\u2019s'))
  const files = [{ name: 'a.js', text: 'const s="patient\\u2019s approval"' }]
  assert.equal(judge({ text: 'patient’s approval', expect: 'present' }, files).ok, true)
})

test('the release list names only known sites, unique ids, and present or absent', () => {
  const ids = new Set()
  for (const e of EXPECTATIONS) {
    assert.ok(!ids.has(e.id), e.id)
    ids.add(e.id)
    assert.ok(['present', 'absent'].includes(e.expect), e.id)
    assert.ok(e.sites.length && e.sites.every(s => Object.hasOwn(SITES, s)), e.id)
    assert.ok(e.text && !e.text.includes('${'), e.id)
    assert.doesNotMatch(e.label + e.text, /[\u2013\u2014]/, e.id)
  }
})
