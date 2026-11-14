/**
 * The only logging surface Health ID frontends use.
 *
 * Every payload passes through `redact()` before it reaches a sink, so a
 * careless `logger.info('saved', record)` cannot put a patient's data into a
 * browser console, a session replay, or an error report.
 */

import { redact } from './redact'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEvent {
  readonly level: LogLevel
  readonly message: string
  readonly context: Record<string, unknown>
}

export type LogSink = (event: LogEvent) => void

export interface LoggerOptions {
  /** Suppresses everything below this level. Defaults to `info`. */
  readonly minLevel?: LogLevel
  /** Where redacted events go. Defaults to the console. */
  readonly sink?: LogSink
  /** Merged into every event. Must contain no PHI; it is redacted regardless. */
  readonly baseContext?: Record<string, unknown>
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
  child(context: Record<string, unknown>): Logger
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const consoleSink: LogSink = event => {
  const method = event.level === 'debug' ? 'log' : event.level
  // The single sanctioned console call in the workspace; the lint rule that
  // forbids `console` elsewhere is scoped to exempt this file.
  console[method](`[hid] ${event.message}`, event.context)
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = options.minLevel ?? 'info'
  const sink = options.sink ?? consoleSink
  const baseContext = options.baseContext ?? {}

  const emit = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return

    const merged = { ...baseContext, ...(context ?? {}) }
    sink({
      level,
      message: redact(message) as string,
      context: redact(merged) as Record<string, unknown>,
    })
  }

  return {
    debug: (message, context) => emit('debug', message, context),
    info: (message, context) => emit('info', message, context),
    warn: (message, context) => emit('warn', message, context),
    error: (message, context) => emit('error', message, context),
    child: context =>
      createLogger({ ...options, sink, minLevel, baseContext: { ...baseContext, ...context } }),
  }
}
