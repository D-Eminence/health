import { describe, expect, it, vi } from 'vitest'
import {
  buildEvent,
  errorType,
  parseDsn,
  parseStack,
  routeName,
  startErrorReporting,
  type ErrorReportingOptions,
} from '../errorReporting'

/**
 * Error reporting to Sentry under the owner's rules (2026-11-03): only when a DSN is configured, no session replay,
 * and nothing but the error's type, its stack and the route name, tagged with the build. The reporter builds each
 * event from an allow-list rather than redacting one, so these tests check what is sent, key by key.
 */

const KEY = '0123456789abcdef0123456789abcdef'
const DSN = `https://${KEY}@o12345.ingest.us.sentry.io/4504123456789`
const ENDPOINT = `https://o12345.ingest.us.sentry.io/api/4504123456789/envelope/?sentry_key=${KEY}&sentry_version=7`

const EMAIL = 'ada@example.com'
const PHONE = '+2348012345678'
const HEALTH_ID = 'HID-ADA2345'
const UUID = '123e4567-e89b-12d3-a456-426614174000'
const PAGE_URL = `https://app.example/provider/patients/${HEALTH_ID}?email=${EMAIL}#token=s3cret`
const SECRETS = [EMAIL, PHONE, HEALTH_ID, UUID, 'app.example/provider', 's3cret', 'lookup failed']

const CHROME_STACK = [
  `TypeError: lookup failed for ${EMAIL} ${PHONE}`,
  '    at loadPatient (https://app.example/assets/index-abc123.js:10:20)',
  '    at async Promise.all (index 0)',
  '    at https://app.example/assets/vendor-react-9f8e7d.js:3:400',
  '    at Object.<anonymous> (https://cdn.example/lib.mjs?v=2#x:5:6)',
  `    at inline (${PAGE_URL}:1:2)`,
  '    at eval (eval at run (https://app.example/assets/index-abc123.js:1:2), <anonymous>:1:3)',
].join('\n')

function errorWithStack(name: string, message: string, stack: string): Error {
  const error = new Error(message)
  error.name = name
  Object.defineProperty(error, 'stack', { value: stack, configurable: true })
  return error
}

interface Harness {
  readonly target: EventTarget
  readonly fetch: ReturnType<typeof vi.fn>
  readonly added: string[]
  readonly start: (overrides?: Partial<ErrorReportingOptions>) => ReturnType<typeof startErrorReporting>
}

function harness(): Harness {
  const target = new EventTarget()
  const added: string[] = []
  const add = target.addEventListener.bind(target)
  target.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) => {
    added.push(type)
    add(type, listener, options)
  }
  const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
  return {
    target,
    fetch,
    added,
    start: overrides => startErrorReporting({
      dsn: DSN,
      build: 'abc123def456',
      environment: 'production',
      currentPath: () => `/provider/patients/${HEALTH_ID}`,
      target,
      fetch,
      ...overrides,
    }),
  }
}

function errorEvent(error: unknown, message = 'Uncaught Error'): Event {
  return Object.assign(new Event('error'), { error, message })
}

function rejectionEvent(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason })
}

function sentBody(fetch: ReturnType<typeof vi.fn>, call = 0): string {
  const init = fetch.mock.calls[call]?.[1] as RequestInit | undefined
  return String(init?.body)
}

function sentEvent(fetch: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const lines = sentBody(fetch, call).split('\n')
  return JSON.parse(lines[2] ?? '{}') as Record<string, unknown>
}

describe('parseDsn', () => {
  it('reads a public DSN and builds the envelope endpoint with query authentication', () => {
    expect(parseDsn(DSN)).toEqual({
      publicKey: KEY,
      host: 'o12345.ingest.us.sentry.io',
      projectId: '4504123456789',
      endpoint: ENDPOINT,
    })
  })

  it('keeps a path prefix before the project id', () => {
    expect(parseDsn(`https://${KEY}@sentry.example.org/errors/sentry/42`)?.endpoint)
      .toBe(`https://sentry.example.org/errors/sentry/api/42/envelope/?sentry_key=${KEY}&sentry_version=7`)
  })

  it('turns reporting off for anything else', () => {
    for (const value of [
      undefined, null, '', 'not a dsn',
      `http://${KEY}@o1.ingest.sentry.io/1`,
      `https://${KEY}:secretpart@o1.ingest.sentry.io/1`,
      `https://${KEY.slice(1)}@o1.ingest.sentry.io/1`,
      `https://${KEY}0@o1.ingest.sentry.io/1`,
      `https://${KEY.toUpperCase().replace(/[0-9]/g, 'G')}@o1.ingest.sentry.io/1`,
      `https://${KEY}@o1.ingest.sentry.io/project`,
      `https://${KEY}@o1.ingest.sentry.io/1?x=1`,
      `https://${KEY}@o1.ingest.sentry.io/1#x`,
      `https://${KEY}@o1.ingest.sentry.io/1/`,
      `https://${KEY}@o1.ingest.sentry.io:8443/1`,
      `https://${KEY}@127.0.0.1/1`,
      `https://${KEY}@localhost/1`,
      `https://${KEY}@o1.ingest.sentry.io/../1`,
      ` ${DSN}`,
    ]) {
      expect(parseDsn(value as string), String(value)).toBeNull()
    }
  })
})

describe('routeName', () => {
  it('keeps word segments and replaces every other segment with :id', () => {
    expect(routeName('/')).toBe('/')
    expect(routeName('')).toBe('/')
    expect(routeName('/card/abc123')).toBe('/card/:id')
    expect(routeName(`/provider/patients/${HEALTH_ID}`)).toBe('/provider/patients/:id')
    expect(routeName(`/records/${UUID}/attachments`)).toBe('/records/:id/attachments')
    expect(routeName('/provider/join/status')).toBe('/provider/join/status')
    expect(routeName('/Records/ada%40example.com')).toBe('/:id/:id')
    expect(routeName('/blog/setting-up-your-facility')).toBe('/blog/setting-up-your-facility')
  })

  it('drops the query and the hash', () => {
    expect(routeName(`/card?token=s3cret#${HEALTH_ID}`)).toBe('/card')
    expect(routeName('/card#token')).toBe('/card')
  })

  it('treats a segment longer than forty characters as an id', () => {
    expect(routeName(`/${'a'.repeat(40)}`)).toBe(`/${'a'.repeat(40)}`)
    expect(routeName(`/${'a'.repeat(41)}`)).toBe('/:id')
  })

  it('is unchanged by a second pass, so a route name stays a route name', () => {
    for (const path of ['/card/abc123', '/provider/patients/HID-1', '/']) {
      expect(routeName(routeName(path))).toBe(routeName(path))
    }
  })
})

describe('parseStack', () => {
  it('reads Chrome and Edge frames, oldest first, and keeps only script URLs without query or hash', () => {
    expect(parseStack(CHROME_STACK)).toEqual([
      { filename: '<anonymous>', function: 'eval', lineno: 1, colno: 3 },
      { filename: '<anonymous>', function: 'inline', lineno: 1, colno: 2 },
      { filename: 'https://cdn.example/lib.mjs', function: 'Object.<anonymous>', lineno: 5, colno: 6 },
      { filename: 'https://app.example/assets/vendor-react-9f8e7d.js', function: '?', lineno: 3, colno: 400 },
      { filename: '<anonymous>', function: 'async Promise.all' },
      { filename: 'https://app.example/assets/index-abc123.js', function: 'loadPatient', lineno: 10, colno: 20 },
    ])
  })

  it('reads Firefox frames', () => {
    const stack = [
      'loadPatient@https://app.example/assets/index-abc123.js:10:20',
      'render/<@https://app.example/assets/index-abc123.js:11:5',
      '@https://app.example/assets/index-abc123.js:12:1',
      'run@https://app.example/assets/index-abc123.js line 2 > eval:1:3',
      '',
    ].join('\n')
    expect(parseStack(stack)).toEqual([
      { filename: '<anonymous>', function: 'run', lineno: 1, colno: 3 },
      { filename: 'https://app.example/assets/index-abc123.js', function: '?', lineno: 12, colno: 1 },
      { filename: 'https://app.example/assets/index-abc123.js', function: '?', lineno: 11, colno: 5 },
      { filename: 'https://app.example/assets/index-abc123.js', function: 'loadPatient', lineno: 10, colno: 20 },
    ])
  })

  it('reads Safari frames', () => {
    const stack = [
      'loadPatient@https://app.example/assets/index-abc123.cjs:10:20',
      'forEach@[native code]',
      'global code@https://app.example/assets/index-abc123.js:1:9',
    ].join('\n')
    expect(parseStack(stack)).toEqual([
      { filename: 'https://app.example/assets/index-abc123.js', function: 'global code', lineno: 1, colno: 9 },
      { filename: '<anonymous>', function: 'forEach' },
      { filename: 'https://app.example/assets/index-abc123.cjs', function: 'loadPatient', lineno: 10, colno: 20 },
    ])
  })

  it('replaces page URLs, blob:, data:, extension and eval sources with <anonymous>', () => {
    const sources = [
      `https://app.example/card/abc123?token=s3cret`,
      'https://app.example/card#token',
      'https://app.example/assets/index.js.map',
      'blob:https://app.example/123e4567-e89b-12d3-a456-426614174000',
      'data:text/javascript;base64,YWxlcnQoMSk=',
      'chrome-extension://abcdefghijklmnop/content.js',
      'moz-extension://123e4567/content.js',
      'safari-web-extension://123e4567/content.js',
      'webpack-internal:///./src/main.js',
      'file:///home/user/app.js',
      '<anonymous>',
    ]
    for (const source of sources) {
      const [frame] = parseStack(`Error\n    at handler (${source}:1:2)`)
      expect(frame?.filename, source).toBe('<anonymous>')
      const [gecko] = parseStack(`handler@${source}:1:2`)
      expect(gecko?.filename, source).toBe('<anonymous>')
    }
  })

  it('reduces a script URL to its origin and path', () => {
    const [frame] = parseStack(`Error\n    at f (https://user:pass@app.example/assets/a.js?token=s3cret&hid=${HEALTH_ID}#x:1:2)`)
    expect(frame?.filename).toBe('https://app.example/assets/a.js')
  })

  it('keeps a function name only when it looks like one', () => {
    const names = [
      ['handleClick', 'handleClick'],
      ['HTMLButtonElement.<anonymous>', 'HTMLButtonElement.<anonymous>'],
      ['new Patient', 'new Patient'],
      ['Array.map', 'Array.map'],
      [`lookup ${EMAIL}`, '?'],
      ['fn/<', '?'],
      ['a'.repeat(81), '?'],
      [`${'a'.repeat(80)}`, 'a'.repeat(80)],
    ]
    for (const [name, expected] of names) {
      const [frame] = parseStack(`${name}@https://app.example/assets/a.js:1:2`)
      expect(frame?.function, name).toBe(expected)
    }
  })

  it('keeps at most forty frames, the ones nearest the throw', () => {
    const lines = Array.from({ length: 60 }, (_, index) => `    at f${index} (https://app.example/assets/a.js:${index + 1}:1)`)
    const frames = parseStack(`Error\n${lines.join('\n')}`)
    expect(frames).toHaveLength(40)
    expect(frames.at(-1)?.function).toBe('f0')
    expect(frames[0]?.function).toBe('f39')
  })

  it('reads nothing from text that is not a stack', () => {
    expect(parseStack('')).toEqual([])
    expect(parseStack(`lookup failed for ${EMAIL}`)).toEqual([])
  })
})

describe('errorType', () => {
  it('names an Error by its name, and anything else by how it was thrown', () => {
    expect(errorType(new TypeError('x'))).toBe('TypeError')
    expect(errorType(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe('ChunkLoadError')
    expect(errorType(Object.assign(new Error('x'), { name: `Failed for ${EMAIL}` }))).toBe('Error')
    expect(errorType(Object.assign(new Error('x'), { name: 'A'.repeat(61) }))).toBe('Error')
    expect(errorType(Object.assign(new Error('x'), { name: 42 }))).toBe('Error')
    expect(errorType('lookup failed')).toBe('NonErrorThrow')
    expect(errorType({ message: 'x' })).toBe('NonErrorThrow')
    expect(errorType(undefined)).toBe('NonErrorThrow')
    expect(errorType('lookup failed', 'rejection')).toBe('NonErrorRejection')
    expect(errorType(new RangeError('x'), 'rejection')).toBe('RangeError')
  })

  it('survives an error whose name cannot be read', () => {
    const error = new Error('x')
    Object.defineProperty(error, 'name', { get() { throw new Error('no') } })
    expect(errorType(error)).toBe('Error')
  })
})

describe('buildEvent', () => {
  const ALLOWED_KEYS = ['environment', 'event_id', 'exception', 'level', 'platform', 'release', 'sdk', 'tags', 'timestamp']

  function event(error: unknown, mechanism = 'onerror') {
    return buildEvent({ error, route: '/provider/patients/:id', build: 'abc123def456', environment: 'production', mechanism })
  }

  it('sends only the type, the stack, the route name and the build', () => {
    const built = event(errorWithStack('TypeError', `lookup failed for ${EMAIL} ${PHONE}`, CHROME_STACK))
    expect(Object.keys(built).sort()).toEqual(ALLOWED_KEYS)
    expect(built.event_id).toMatch(/^[0-9a-f]{32}$/)
    expect(typeof built.timestamp).toBe('number')
    expect(Math.abs(built.timestamp - Date.now() / 1000)).toBeLessThan(5)
    expect(built.platform).toBe('javascript')
    expect(built.level).toBe('error')
    expect(built.environment).toBe('production')
    expect(built.release).toBe('abc123def456')
    expect(built.tags).toEqual({ build: 'abc123def456', route: '/provider/patients/:id' })
    expect(built.sdk).toEqual({ name: 'hid.observability', version: '1', settings: { infer_ip: 'never' } })
    expect(built.exception.values).toHaveLength(1)
    const [value] = built.exception.values
    expect(Object.keys(value ?? {}).sort()).toEqual(['mechanism', 'stacktrace', 'type'])
    expect(value?.type).toBe('TypeError')
    expect(value?.mechanism).toEqual({ type: 'onerror', handled: false })
    expect(value?.stacktrace?.frames).toEqual(parseStack(CHROME_STACK))
    for (const frame of value?.stacktrace?.frames ?? []) {
      for (const key of Object.keys(frame)) expect(['filename', 'function', 'lineno', 'colno']).toContain(key)
    }
  })

  it('never carries the message, an email, a phone number, a Health ID, a UUID or the page URL', () => {
    const message = `lookup failed for ${EMAIL} ${PHONE} ${HEALTH_ID} ${UUID} at ${PAGE_URL}`
    // A message shaped like a stack frame is still not read as one.
    const stack = `Error: ${message}\n    at Ada Lovelace (https://app.example/assets/a.js:1:2)\n${CHROME_STACK.split('\n').slice(1).join('\n')}`
    const error = errorWithStack('Error', `${message}\n    at Ada Lovelace (https://app.example/assets/a.js:1:2)`, stack)
    const text = JSON.stringify(buildEvent({ error, route: `/provider/patients/${HEALTH_ID}?email=${EMAIL}`, build: 'abc123def456',
      environment: 'production', mechanism: 'onerror' }))
    for (const secret of [...SECRETS, message, 'Ada Lovelace']) expect(text).not.toContain(secret)
    expect(text).not.toMatch(/"(?:message|value|request|user|breadcrumbs|contexts|extra|modules|server_name|fingerprint|transaction)"/)
  })

  it('leaves the frames alone when the stack does not start with the message, as in Firefox and Safari', () => {
    const stack = 'loadPatient@https://app.example/assets/a.js:10:20\nrun@https://app.example/assets/a.js:11:5'
    expect(event(errorWithStack('TypeError', 'a', stack)).exception.values[0]?.stacktrace?.frames).toEqual(parseStack(stack))
    const chrome = `ChunkLoadError: a\n    at loadPatient (https://app.example/assets/a.js:10:20)`
    expect(event(errorWithStack('ChunkLoadError', 'a', chrome)).exception.values[0]?.stacktrace?.frames)
      .toEqual([{ filename: 'https://app.example/assets/a.js', function: 'loadPatient', lineno: 10, colno: 20 }])
  })

  it('names a route even when handed a raw path', () => {
    const built = buildEvent({ error: new Error('x'), route: `/card/abc123?token=s3cret`, build: 'b', environment: 'staging', mechanism: 'react' })
    expect(built.tags.route).toBe('/card/:id')
  })

  it('sends no stacktrace for a value that is not an Error', () => {
    const built = event({ stack: `at f (${PAGE_URL}:1:2)`, message: EMAIL })
    expect(built.exception.values[0]).toEqual({ type: 'NonErrorThrow', mechanism: { type: 'onerror', handled: false } })
    expect(event('lookup failed', 'onunhandledrejection').exception.values[0]?.type).toBe('NonErrorRejection')
  })

  it('refuses a build, environment or mechanism that is not a plain name', () => {
    const built = buildEvent({ error: new Error('x'), route: '/', build: `abc ${EMAIL}`, environment: `prod ${EMAIL}`, mechanism: `on ${EMAIL}` })
    expect(built.release).toBe('unknown')
    expect(built.tags.build).toBe('unknown')
    expect(built.environment).toBe('unknown')
    expect(built.exception.values[0]?.mechanism.type).toBe('generic')
  })
})

describe('startErrorReporting', () => {
  it('does nothing at all without a valid DSN: no listeners, no network', () => {
    for (const dsn of [null, undefined, '', 'https://example.com/1']) {
      const { start, added, fetch, target } = harness()
      expect(start({ dsn })).toBeNull()
      target.dispatchEvent(errorEvent(new Error('x')))
      expect(added).toEqual([])
      expect(fetch).not.toHaveBeenCalled()
    }
  })

  it('listens for errors and unhandled rejections once a DSN is configured', () => {
    const { start, added } = harness()
    const reporter = start()
    expect(reporter).not.toBeNull()
    expect(added.sort()).toEqual(['error', 'unhandledrejection'])
    reporter?.stop()
  })

  it('adds its listeners to a target once, however often it is started', () => {
    const { start, added } = harness()
    const first = start()
    const second = start()
    expect(second).toBe(first)
    expect(added).toHaveLength(2)
    first?.stop()
    const third = start()
    expect(third).not.toBe(first)
    expect(added).toHaveLength(4)
    third?.stop()
  })

  it('posts an envelope with the route name and the build, as a CORS simple request', () => {
    const { start, fetch, target } = harness()
    const reporter = start()
    target.dispatchEvent(errorEvent(errorWithStack('TypeError', `lookup failed for ${EMAIL}`, CHROME_STACK)))
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(ENDPOINT)
    expect(init).toEqual({
      method: 'POST',
      body: expect.any(String),
      keepalive: true,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    })
    const lines = sentBody(fetch).split('\n')
    expect(lines).toHaveLength(3)
    const header = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    const sent = sentEvent(fetch)
    expect(Object.keys(header).sort()).toEqual(['event_id', 'sent_at'])
    expect(header.event_id).toBe(sent.event_id)
    expect(new Date(String(header.sent_at)).toISOString()).toBe(header.sent_at)
    expect(JSON.parse(lines[1] ?? '{}')).toEqual({ type: 'event' })
    expect(sent.tags).toEqual({ build: 'abc123def456', route: '/provider/patients/:id' })
    expect(sent.release).toBe('abc123def456')
    expect(sent.environment).toBe('production')
    for (const secret of SECRETS) expect(sentBody(fetch)).not.toContain(secret)
    reporter?.stop()
  })

  it('reads the route when the error happens', () => {
    let path = '/records'
    const { start, fetch, target } = harness()
    const reporter = start({ currentPath: () => path })
    path = `/card/${UUID}`
    target.dispatchEvent(errorEvent(new Error('x')))
    expect(sentEvent(fetch).tags).toEqual({ build: 'abc123def456', route: '/card/:id' })
    reporter?.stop()
  })

  it('reports unhandled rejections, Errors and other values alike', () => {
    const { start, fetch, target } = harness()
    const reporter = start()
    target.dispatchEvent(rejectionEvent(new RangeError(EMAIL)))
    target.dispatchEvent(rejectionEvent(`failed for ${EMAIL}`))
    expect(fetch).toHaveBeenCalledTimes(2)
    const types = [0, 1].map(call => (sentEvent(fetch, call).exception as { values: { type: string; mechanism: unknown }[] }).values[0])
    expect(types[0]).toMatchObject({ type: 'RangeError', mechanism: { type: 'onunhandledrejection', handled: false } })
    expect(types[1]).toEqual({ type: 'NonErrorRejection', mechanism: { type: 'onunhandledrejection', handled: false } })
    for (const call of [0, 1]) expect(sentBody(fetch, call)).not.toContain(EMAIL)
    reporter?.stop()
  })

  it('skips a cross-origin "Script error." that carries no error', () => {
    const { start, fetch, target } = harness()
    const reporter = start()
    target.dispatchEvent(errorEvent(null, 'Script error.'))
    target.dispatchEvent(errorEvent(undefined, 'Script error.'))
    expect(fetch).not.toHaveBeenCalled()
    target.dispatchEvent(errorEvent(new Error('Script error.'), 'Script error.'))
    expect(fetch).toHaveBeenCalledTimes(1)
    reporter?.stop()
  })

  it('reports the same error once per page load', () => {
    const { start, fetch, target } = harness()
    const reporter = start()
    const stack = 'TypeError: a\n    at f (https://app.example/assets/a.js:1:2)'
    target.dispatchEvent(errorEvent(errorWithStack('TypeError', 'a', stack)))
    target.dispatchEvent(errorEvent(errorWithStack('TypeError', 'b', stack.replace(': a', ': b'))))
    reporter?.report(errorWithStack('TypeError', 'c', stack), 'react')
    expect(fetch).toHaveBeenCalledTimes(1)
    // Another type, or another place, is another error.
    target.dispatchEvent(errorEvent(errorWithStack('RangeError', 'a', stack)))
    target.dispatchEvent(errorEvent(errorWithStack('TypeError', 'a', stack.replace(':1:2', ':1:3'))))
    expect(fetch).toHaveBeenCalledTimes(3)
    reporter?.stop()
  })

  it('sends at most maxReports reports per page load', () => {
    const { start, fetch, target } = harness()
    const reporter = start({ maxReports: 3 })
    for (let line = 1; line <= 6; line += 1) {
      target.dispatchEvent(errorEvent(errorWithStack('Error', 'x', `Error: x\n    at f (https://app.example/assets/a.js:${line}:1)`)))
    }
    expect(fetch).toHaveBeenCalledTimes(3)
    reporter?.stop()
  })

  it('sends at most ten reports by default', () => {
    const { start, fetch } = harness()
    const reporter = start()
    for (let line = 1; line <= 15; line += 1) {
      reporter?.report(errorWithStack('Error', 'x', `Error: x\n    at f (https://app.example/assets/a.js:${line}:1)`), 'react')
    }
    expect(fetch).toHaveBeenCalledTimes(10)
    reporter?.stop()
  })

  it('reports from React with its own mechanism', () => {
    const { start, fetch } = harness()
    const reporter = start()
    reporter?.report(new Error(EMAIL), 'react')
    expect((sentEvent(fetch).exception as { values: { mechanism: unknown }[] }).values[0]?.mechanism)
      .toEqual({ type: 'react', handled: false })
    reporter?.stop()
  })

  it('stops listening and sending when stopped', () => {
    const { start, fetch, target } = harness()
    const reporter = start()
    reporter?.stop()
    target.dispatchEvent(errorEvent(new Error('x')))
    reporter?.report(new Error('y'), 'react')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('swallows a failing or throwing transport and never reports it', async () => {
    const rejecting = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    const { start, target } = harness()
    const reporter = start({ fetch: rejecting })
    expect(() => target.dispatchEvent(errorEvent(new Error('x')))).not.toThrow()
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(rejecting).toHaveBeenCalledTimes(1)
    reporter?.stop()

    const throwing = vi.fn(() => { throw new TypeError('Failed to fetch') })
    const second = harness()
    const other = second.start({ fetch: throwing })
    expect(() => other?.report(new Error('x'), 'react')).not.toThrow()
    expect(throwing).toHaveBeenCalledTimes(1)
    other?.stop()
  })

  it('survives a route that cannot be read', () => {
    const { start, fetch } = harness()
    const reporter = start({ currentPath: () => { throw new Error('no location') } })
    expect(() => reporter?.report(new Error('x'), 'react')).not.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
    reporter?.stop()
  })
})
