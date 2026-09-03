import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger'
import { REDACTED } from '../redact'
import type { LogEvent, LogLevel } from '../logger'

function collectingLogger(minLevel?: LogLevel) {
  const events: LogEvent[] = []
  const logger = createLogger({
    sink: event => events.push(event),
    ...(minLevel ? { minLevel } : {}),
  })
  return { events, logger }
}

describe('createLogger', () => {
  it('redacts context before it reaches the sink', () => {
    const { events, logger } = collectingLogger()
    logger.info('record saved', { hidCode: 'HID-1234-AB', durationMs: 12 })

    expect(events[0]?.context).toEqual({ hidCode: REDACTED, durationMs: 12 })
  })

  it('redacts the message itself', () => {
    const { events, logger } = collectingLogger()
    logger.error('lookup failed for ada@example.com')

    expect(events[0]?.message).toBe(`lookup failed for ${REDACTED}`)
  })

  it('suppresses events below the minimum level', () => {
    const { events, logger } = collectingLogger('warn')
    logger.info('ignored')
    logger.warn('kept')

    expect(events.map(event => event.message)).toEqual(['kept'])
  })

  it('merges child context and still redacts it', () => {
    const { events, logger } = collectingLogger()
    logger.child({ app: 'patient-web', patientName: 'Ada' }).info('mounted')

    expect(events[0]?.context).toEqual({ app: 'patient-web', patientName: REDACTED })
  })

  it('defaults to the console sink', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    createLogger().info('hello')
    expect(spy).toHaveBeenCalledOnce()
    spy.mockRestore()
  })
})
