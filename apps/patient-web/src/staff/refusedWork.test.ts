import { describe, expect, it } from 'vitest'
import { LAB_WORK, type NamedRole, type RefusedWork } from './refusedWork'
import { roleInSentence, roleLabel } from './staffAccess'

describe('the role a refusal names', () => {
  /** Every NamedRole, once: the type lists them, so leaving one out here, or adding one there only, fails to build. */
  const NAMED: Readonly<Record<NamedRole, true>> = { doctor: true, clinician: true, nurse: true, lab: true, pharmacist: true, receptionist: true }

  it.each(Object.keys(NAMED))('%s has words, so the step names the role, never its code', code => {
    expect(roleLabel(code)).not.toBe(code)
    expect(roleInSentence(code)).toMatch(/^an? [a-z ]+$/)
  })

  it('cannot name a role the list has no words for', () => {
    // @ts-expect-error: a code ROLE_LABELS does not name would reach the screen as it is ("Add an unnamed_role…").
    const unnamed: RefusedWork = { ...LAB_WORK, doneBy: 'unnamed_role' }
    expect(roleInSentence(unnamed.doneBy)).toBe('an unnamed_role')
  })
})
