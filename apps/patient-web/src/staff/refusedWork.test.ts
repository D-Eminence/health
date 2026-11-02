import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Facility } from './api'
import { LAB_WORK, refusedWorkText, type NamedRole, type RefusedWork } from './refusedWork'
import { roleInSentence, roleLabel } from './staffAccess'

describe('the role a refusal names', () => {
  /** Every NamedRole, once: the type lists them, so leaving one out here, or adding one there only, fails to build. */
  const NAMED: Readonly<Record<NamedRole, true>> = {
    doctor: true, clinician: true, nurse: true, lab: true, pharmacist: true, receptionist: true, records_officer: true, billing: true,
    outreach_officer: true,
  }

  it.each(Object.keys(NAMED))('%s has words, so the step names the role, never its code', code => {
    expect(roleLabel(code)).not.toBe(code)
    expect(roleLabel(code)).toMatch(/^[A-Z][a-z ]+$/)
    expect(roleInSentence(code)).toMatch(/^an? [a-z ]+$/)
  })

  it('cannot name a role the list has no words for', () => {
    // @ts-expect-error: a code ROLE_LABELS does not name would reach the screen as it is ("Add an unnamed_role…").
    const unnamed: RefusedWork = { ...LAB_WORK, doneBy: ['unnamed_role'] }
    expect(roleInSentence(unnamed.doneBy[0])).toBe('an unnamed_role')
  })

  it('cannot leave out the role that does the work', () => {
    // @ts-expect-error: with no role, the administrator's step would read "Add  on the Staff page."
    const nobody: RefusedWork = { ...LAB_WORK, doneBy: [] }
    expect(nobody.doneBy).toEqual([])
  })
})

/*
 * The sentence by who reads it. LAB_WORK is done by one role and asks the administrator alone: its words stay as they
 * were. TWO_ROLES is work two roles do, whose refusal names the roles to ask for, as Patient registration's does
 * (owner's answer, 2 Nov 2026). Every facility here is fictional.
 */
describe('refusedWorkText', () => {
  const TWO_ROLES: RefusedWork = {
    name: 'Patient registration', work: 'registering patients', doneBy: ['receptionist', 'records_officer'], askForRole: true,
    gets: new Set(['hospital', 'clinic']),
  }
  /** A self-signed-up facility's administrator: the only role there that manages staff. */
  const ADMINISTRATOR = ['organization.manage', 'workforce.manage']
  const ORDINARY = ['ehr.encounter.read']
  const at = (review: string, organizationType: string): Pick<Facility, 'selfService'> => ({ selfService: { review, organizationType } })
  const MANAGED: Pick<Facility, 'selfService'> = {}
  /** A permission's name, or a role code: neither belongs on a screen. */
  const CODES = /permission|workforce|\.manage|[a-z]+_[a-z]+/i

  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
  afterEach(() => { vi.unstubAllEnvs() })

  describe('work two roles do, whose refusal names the roles to ask for', () => {
    const ROLE = 'Your role at this facility doesn’t include registering patients.'
    const ASK = `${ROLE} Ask your facility administrator for the Receptionist or Records officer role.`

    it.each([
      ['anyone else at a checked hospital', at('reviewed', 'hospital'), ORDINARY],
      ['anyone else at a laboratory being checked', at('pending', 'laboratory'), ORDINARY],
      ['an administrator at a facility Health ID support manages', MANAGED, ADMINISTRATOR],
      ['an administrator with no facility', undefined, ADMINISTRATOR],
    ])('%s: told to ask the administrator for either role, by its name', (_who, facility, permissions) => {
      const said = refusedWorkText(facility, permissions, TWO_ROLES)
      expect(said).toBe(ASK)
      expect(said).not.toMatch(CODES)
    })

    it.each(['', 'main-v1'])('the administrator of a checked hospital on today’s backend (%j): told to ask for either role', contract => {
      vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
      expect(refusedWorkText(at('reviewed', 'hospital'), ADMINISTRATOR, TWO_ROLES)).toBe(ASK)
    })

    it.each(['hospital', 'clinic'])('the administrator of a checked %s: add either role on the Staff page', organizationType => {
      const said = refusedWorkText(at('reviewed', organizationType), ADMINISTRATOR, TWO_ROLES)
      expect(said).toBe(`${ROLE} Add a receptionist or a records officer on the Staff page.`)
      expect(said).not.toMatch(CODES)
    })

    it.each(['laboratory', 'pharmacy', 'other'])('the administrator of a checked %s, not promised the work: the role sentence only', organizationType => {
      expect(refusedWorkText(at('reviewed', organizationType), ADMINISTRATOR, TWO_ROLES)).toBe(ROLE)
    })

    it.each(['hospital', 'clinic'])('the administrator of a %s being checked: it opens after the check', organizationType => {
      expect(refusedWorkText(at('pending', organizationType), ADMINISTRATOR, TWO_ROLES))
        .toBe('Patient registration opens once Health ID support has checked your facility.')
    })
  })

  describe('the Laboratory, done by one role, in the words it had', () => {
    const ROLE = 'Your role at this facility doesn’t include the lab’s work list and results.'

    it.each([
      ['anyone else at a checked hospital', at('reviewed', 'hospital'), ORDINARY],
      ['an administrator at a facility Health ID support manages', MANAGED, ADMINISTRATOR],
    ])('%s: told to ask the administrator, naming no role', (_who, facility, permissions) => {
      expect(refusedWorkText(facility, permissions, LAB_WORK)).toBe(`${ROLE} Ask your facility administrator.`)
    })

    it('the administrator of a checked laboratory: add a laboratory scientist', () => {
      expect(refusedWorkText(at('reviewed', 'laboratory'), ADMINISTRATOR, LAB_WORK)).toBe(`${ROLE} Add a laboratory scientist on the Staff page.`)
    })

    it('the administrator of a checked pharmacy: the role sentence only', () => {
      expect(refusedWorkText(at('reviewed', 'pharmacy'), ADMINISTRATOR, LAB_WORK)).toBe(ROLE)
    })

    it('the administrator of a laboratory being checked: it opens after the check', () => {
      expect(refusedWorkText(at('pending', 'laboratory'), ADMINISTRATOR, LAB_WORK)).toBe('Laboratory opens once Health ID support has checked your facility.')
    })
  })
})
