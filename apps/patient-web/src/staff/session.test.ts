import { afterEach, describe, expect, it, vi } from 'vitest'

// The session state lives in the module, so each test loads it afresh.
afterEach(() => { vi.resetModules() })

/** How a waiting step has ended once everything already due has run, or that it still waits. */
function outcome(step: Promise<void>) {
  const ended = step.then(() => 'resumed', (error: { code?: string }) => error.code)
  return Promise.race([ended, new Promise<string>(resolve => { setTimeout(() => resolve('still waiting'), 0) })])
}

describe('a protected step waiting for its staff session', () => {
  it('waits while the session is not ready, and resumes once it is', async () => {
    const session = await import('./session')
    const step = session.untilStaffSessionReady(session.staffSessionGeneration())

    expect(await outcome(step)).toBe('still waiting')
    session.setStaffSessionReady(true)
    expect(await outcome(step)).toBe('resumed')
  })

  it('is abandoned once its session ends, without waiting for the next to be ready', async () => {
    const session = await import('./session')
    const step = session.untilStaffSessionReady(session.staffSessionGeneration())

    session.startStaffSessionGeneration()
    expect(await outcome(step)).toBe('REQUEST_CANCELLED')
  })

  it('is abandoned, not resumed, when a later session is ready', async () => {
    const session = await import('./session')
    const sentIn = session.staffSessionGeneration()
    session.startStaffSessionGeneration()
    session.setStaffSessionReady(true)

    expect(await outcome(session.untilStaffSessionReady(sentIn))).toBe('REQUEST_CANCELLED')
  })
})
