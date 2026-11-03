/**
 * Error reports for the Health ID websites, sent to Sentry without the Sentry SDK.
 *
 * The owner's rules (approved 2026-11-03): reporting starts only when a DSN is configured; there is no session
 * replay; nothing is sent but the error's type, its stack and the route name, and each report is tagged with the
 * build. So no input value, no URL with an id in it, no user id and no IP address.
 *
 * This is an allow-list, not a redactor. Each event is built from nothing, out of four things: the error's type (its
 * name, if it looks like a name), its stack frames (a script's own URL without query or hash, a function name that
 * looks like one, and line and column numbers), the route name (each path segment that is not a plain lowercase word
 * becomes `:id`) and the build. The error's message is never read into an event, and nothing about the browser, the
 * page or the person is added. Sentry's own SDK would collect breadcrumbs, the page URL, request headers and more by
 * default; a small reporter that cannot send them is easier to trust than a configuration that turns them off.
 *
 * Without a DSN (or with one that is not exactly a public DSN) nothing happens: no listener, no request.
 */

const DSN_PATTERN =
  /^https:\/\/([0-9a-f]{32})@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})((?:\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*)\/([0-9]{1,20})$/

/** A path segment kept in a route name: a lowercase word or words joined by hyphens. Anything else is an id. */
const ROUTE_WORD = /^[a-z][a-z-]{0,39}$/
const MAX_ROUTE_LENGTH = 200

const MAX_FRAMES = 40
const MAX_STACK_LENGTH = 50_000
const CHROME_FRAME = /^\s*at\s+(.*)$/
const LOCATION = /^(.*):(\d+):(\d+)$/
const NATIVE_CODE = '[native code]'
const FUNCTION_NAME = /^[\w$.<>[\] ]{1,80}$/
const SCRIPT_PATH = /\.[mc]?js$/
const ANONYMOUS = '<anonymous>'

const TYPE_NAME = /^[A-Za-z_$][\w$.]{0,59}$/
const BUILD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const ENVIRONMENT_NAME = /^[a-z][a-z0-9-]{0,31}$/
const MECHANISM_NAME = /^[a-z][a-z0-9_.-]{0,31}$/

const DEFAULT_MAX_REPORTS = 10

export interface SentryDsn {
  readonly publicKey: string
  readonly host: string
  readonly projectId: string
  /**
   * Where events are posted. The key travels in the query, so the request needs no custom header and stays a CORS
   * simple request: no preflight, nothing for the ingest host to allow but the origin.
   */
  readonly endpoint: string
}

export interface StackFrame {
  readonly filename: string
  readonly function: string
  readonly lineno?: number
  readonly colno?: number
}

export interface ReportedException {
  readonly type: string
  readonly stacktrace?: { readonly frames: readonly StackFrame[] }
  readonly mechanism: { readonly type: string; readonly handled: false }
}

/** Everything an event holds. Nothing else is ever added. */
export interface ReportedEvent {
  readonly event_id: string
  readonly timestamp: number
  readonly platform: 'javascript'
  readonly level: 'error'
  readonly environment: string
  readonly release: string
  readonly tags: { readonly build: string; readonly route: string }
  readonly exception: { readonly values: readonly ReportedException[] }
  readonly sdk: { readonly name: 'hid.observability'; readonly version: '1'; readonly settings: { readonly infer_ip: 'never' } }
}

export interface ReportInput {
  readonly error: unknown
  /** The route name, or a path to make one from: it is passed through `routeName` either way. */
  readonly route: string
  readonly build: string
  readonly environment: string
  /** How the error arrived: `onerror`, `onunhandledrejection`, `react`. */
  readonly mechanism: string
}

export type ReportTransport = (url: string, init: RequestInit) => unknown

export interface ErrorReportingOptions {
  /** The public DSN. Missing or not exactly a public DSN: reporting stays off. */
  readonly dsn: string | null | undefined
  /** The build the site was made from (the first 12 characters of its commit). */
  readonly build: string
  /** The environment's name: `production`, `staging` or `local`. */
  readonly environment: string
  /** The page's path when an error happens; only its route name is sent. */
  readonly currentPath: () => string
  /** Where `error` and `unhandledrejection` are heard. Defaults to `window` in a browser. */
  readonly target?: EventTarget
  /** Defaults to the browser's fetch. */
  readonly fetch?: ReportTransport
  /** Reports sent per page load at most. Defaults to 10. */
  readonly maxReports?: number
}

export interface ErrorReporter {
  /** Reports an error caught elsewhere (a React root or error boundary). Never throws. */
  report(error: unknown, mechanism?: string): void
  /** Removes the listeners; later reports are dropped. */
  stop(): void
}

/** The parts of a public DSN, or null for anything that is not exactly one (reporting then stays off). */
export function parseDsn(dsn: unknown): SentryDsn | null {
  if (typeof dsn !== 'string' || dsn.length > 512) return null
  const match = DSN_PATTERN.exec(dsn)
  if (!match) return null
  const [, publicKey = '', host = '', prefix = '', projectId = ''] = match
  return {
    publicKey,
    host,
    projectId,
    endpoint: `https://${host}${prefix}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7`,
  }
}

/**
 * The route name of a path: no query or hash, and every segment that is not a plain lowercase word replaced by
 * `:id`. `/card/abc123` is `/card/:id`; `/provider/patients/HID-ADA2345` is `/provider/patients/:id`.
 */
export function routeName(pathname: string): string {
  const path = (typeof pathname === 'string' ? pathname : '').split(/[?#]/, 1)[0] ?? ''
  const segments = path.split('/')
    .filter(segment => segment !== '')
    .map(segment => (ROUTE_WORD.test(segment) ? segment : ':id'))
  let name = `/${segments.join('/')}`
  while (name.length > MAX_ROUTE_LENGTH) {
    segments.pop()
    name = `/${segments.join('/')}/*`
  }
  return name
}

/**
 * The frames of a Chrome or Edge (`    at fn (url:line:col)`), Firefox or Safari (`fn@url:line:col`) stack, oldest
 * first as Sentry expects, at most the 40 nearest the throw. A file is kept only as an http(s) script URL's origin and
 * path; page URLs, blob:, data:, eval and extension sources become `<anonymous>`. A function name that does not look
 * like one becomes `?`.
 */
export function parseStack(stack: string): StackFrame[] {
  if (typeof stack !== 'string' || stack === '') return []
  const lines = stack.slice(0, MAX_STACK_LENGTH).split('\n')
  const chrome = lines.some(line => CHROME_FRAME.test(line))
  const frames: StackFrame[] = []
  for (const line of lines) {
    if (frames.length >= MAX_FRAMES) break
    const frame = chrome ? chromeFrame(line) : geckoFrame(line)
    if (frame) frames.push(frame)
  }
  return frames.reverse()
}

/** An Error's name if it looks like a type name, else `Error`; a thrown or rejected value that is not an Error is named for how it arrived. */
export function errorType(value: unknown, source: 'throw' | 'rejection' = 'throw'): string {
  if (!isError(value)) return source === 'rejection' ? 'NonErrorRejection' : 'NonErrorThrow'
  const name = read(() => value.name)
  return typeof name === 'string' && TYPE_NAME.test(name) ? name : 'Error'
}

/** One event, from the allow-list only. The error's message is never read into it. */
export function buildEvent(input: ReportInput): ReportedEvent {
  const build = plainName(input.build, BUILD_NAME, 'unknown')
  const mechanism = plainName(input.mechanism, MECHANISM_NAME, 'generic')
  const type = errorType(input.error, mechanism === 'onunhandledrejection' ? 'rejection' : 'throw')
  const frames = isError(input.error) ? parseStack(stackWithoutMessage(input.error)) : []
  return {
    event_id: eventId(),
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: plainName(input.environment, ENVIRONMENT_NAME, 'unknown'),
    release: build,
    tags: { build, route: routeName(input.route) },
    exception: {
      values: [{
        type,
        // Sentry refuses an empty frame list, so a value with no readable stack sends none.
        ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
        mechanism: { type: mechanism, handled: false },
      }],
    },
    sdk: { name: 'hid.observability', version: '1', settings: { infer_ip: 'never' } },
  }
}

const reporters = new WeakMap<EventTarget, ErrorReporter>()

/**
 * Starts reporting when `dsn` is a public DSN, and returns null (having done nothing) otherwise. Listens for `error`
 * and `unhandledrejection` on the target, once per target however often it is started. Each kind of error (its type
 * and the frame it was thrown from) is reported once per page load, and at most `maxReports` reports are sent.
 */
export function startErrorReporting(options: ErrorReportingOptions): ErrorReporter | null {
  const dsn = parseDsn(options.dsn)
  if (!dsn) return null

  const target = options.target ?? (typeof window === 'undefined' ? undefined : window)
  const existing = target ? reporters.get(target) : undefined
  if (existing) return existing

  const send: ReportTransport = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const maxReports = Number.isSafeInteger(options.maxReports) && (options.maxReports ?? 0) >= 0
    ? (options.maxReports as number) : DEFAULT_MAX_REPORTS
  const seen = new Set<string>()
  let sent = 0
  let stopped = false

  const report = (error: unknown, mechanism = 'generic') => {
    if (stopped || sent >= maxReports) return
    try {
      const route = read(() => options.currentPath())
      const event = buildEvent({
        error, mechanism, route: typeof route === 'string' ? route : '/', build: options.build, environment: options.environment,
      })
      const key = sameErrorKey(event)
      if (seen.has(key)) return
      seen.add(key)
      sent += 1
      const pending = send(dsn.endpoint, {
        method: 'POST',
        body: envelope(event),
        keepalive: true,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      })
      // A report that cannot be sent is dropped: it is never logged, retried or reported.
      Promise.resolve(pending).catch(() => undefined)
    } catch {
      // Reporting must never be the cause of another error.
    }
  }

  const onError = (event: Event) => {
    const { error, message } = event as Event & { readonly error?: unknown; readonly message?: unknown }
    // A script from another origin throws as "Script error." with nothing else: nothing to report.
    if (error == null && typeof message === 'string' && /^Script error\.?$/.test(message)) return
    report(error, 'onerror')
  }
  const onRejection = (event: Event) => {
    report((event as Event & { readonly reason?: unknown }).reason, 'onunhandledrejection')
  }

  const reporter: ErrorReporter = {
    report,
    stop() {
      stopped = true
      if (!target) return
      target.removeEventListener('error', onError)
      target.removeEventListener('unhandledrejection', onRejection)
      if (reporters.get(target) === reporter) reporters.delete(target)
    },
  }

  if (target) {
    target.addEventListener('error', onError)
    target.addEventListener('unhandledrejection', onRejection)
    reporters.set(target, reporter)
  }
  return reporter
}

function chromeFrame(line: string): StackFrame | null {
  const match = CHROME_FRAME.exec(line)
  if (!match) return null
  const rest = (match[1] ?? '').trim()
  if (rest === '') return null
  if (!rest.endsWith(')')) return frame(undefined, rest)
  const open = matchingParenthesis(rest)
  if (open < 0) return frame(undefined, rest)
  return frame(open === 0 ? undefined : rest.slice(0, open).trim(), rest.slice(open + 1, -1))
}

/** The index of the `(` that the final `)` closes, or -1. Eval frames nest a location inside the location. */
function matchingParenthesis(text: string): number {
  let depth = 0
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index]
    if (character === ')') depth += 1
    else if (character === '(') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function geckoFrame(line: string): StackFrame | null {
  // The last @: a function name that holds one is then refused whole rather than cut into something that passes.
  const at = line.lastIndexOf('@')
  if (at < 0) return null
  const location = line.slice(at + 1).trim()
  // Text that is not a frame (a message, say) has no line and column.
  if (location !== NATIVE_CODE && !LOCATION.test(location)) return null
  const name = line.slice(0, at).trim()
  return frame(name === '' ? undefined : name, location)
}

function frame(name: string | undefined, location: string): StackFrame {
  const match = LOCATION.exec(location)
  const lineno = match ? position(match[2]) : undefined
  const colno = match ? position(match[3]) : undefined
  return {
    filename: scriptUrl(match ? match[1] ?? '' : location),
    function: name !== undefined && FUNCTION_NAME.test(name) ? name : '?',
    ...(lineno === undefined ? {} : { lineno }),
    ...(colno === undefined ? {} : { colno }),
  }
}

function position(digits: string | undefined): number | undefined {
  const value = Number(digits)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** An http(s) script's origin and path; anything else, a page's own URL included, is `<anonymous>`. */
function scriptUrl(file: string): string {
  if (!/^https?:\/\//.test(file)) return ANONYMOUS
  let url: URL
  try {
    url = new URL(file)
  } catch {
    return ANONYMOUS
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !SCRIPT_PATH.test(url.pathname)) return ANONYMOUS
  return `${url.origin}${url.pathname}`
}

function isError(value: unknown): value is Error {
  if (value instanceof Error) return true
  // An Error from another realm (a frame) fails instanceof but keeps its tag.
  return read(() => Object.prototype.toString.call(value)) === '[object Error]'
}

/**
 * The stack without the message. Chrome starts a stack with the message, which may be anything the page held, and a
 * message line shaped like a frame would otherwise be read as one.
 */
function stackWithoutMessage(error: Error): string {
  const stack = read(() => error.stack)
  if (typeof stack !== 'string') return ''
  const message = read(() => error.message)
  return typeof message === 'string' && message !== '' ? stack.replace(message, '') : stack
}

function plainName(value: string, pattern: RegExp, fallback: string): string {
  return typeof value === 'string' && pattern.test(value) ? value : fallback
}

/** Two errors are the same when they have the same type and were thrown from the same place. */
function sameErrorKey(event: ReportedEvent): string {
  const [value] = event.exception.values
  const top = value?.stacktrace?.frames.at(-1)
  return JSON.stringify([value?.type, top?.filename, top?.function, top?.lineno, top?.colno])
}

function envelope(event: ReportedEvent): string {
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n')
}

function eventId(): string {
  const bytes = new Uint8Array(16)
  try {
    globalThis.crypto.getRandomValues(bytes)
  } catch {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Reads a value that a getter, a proxy or a hostile object could make throw. */
function read<T>(get: () => T): T | undefined {
  try {
    return get()
  } catch {
    return undefined
  }
}
