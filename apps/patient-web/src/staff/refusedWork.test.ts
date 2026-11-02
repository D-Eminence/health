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
 * (owner's answer, 2 Nov 2026), but only where one of them would bring the work, and never to someone who holds one.
 * Every facility and role here is fictional; each sentence is checked for codes as it is read.
 */
describe('refusedWorkText', () => {
  const TWO_ROLES: RefusedWork = {
    name: 'Patient registration', work: 'registering patients', doneBy: ['receptionist', 'records_officer'], askForRole: true,
    gets: new Set(['hospital', 'clinic']),
  }
  /** A self-signed-up facility's administrator: the only role there that manages staff. */
  const ADMINISTRATOR = ['organization.manage', 'workforce.manage']
  const ORDINARY = ['ehr.encounter.read']
  /** A role that does neither work here, so being told to ask for one of the roles that do could help. */
  const NURSE = ['nurse']
  type Reader = Pick<Facility, 'selfService' | 'roles'>
  const at = (review: string, organizationType: string, roles = NURSE): Reader => ({ selfService: { review, organizationType }, roles })
  const MANAGED: Reader = { roles: NURSE }
  /** A permission's name ("identity.registration.write"), or a role code ("records_officer"): neither belongs on a screen. */
  const CODES = /permission|workforce|[a-z]+\.[a-z]+|[a-z]+_[a-z]+/i

  /** The sentence, checked for codes before it is compared. */
  function said(...args: Parameters<typeof refusedWorkText>) {
    const sentence = refusedWorkText(...args)
    expect(sentence).not.toMatch(CODES)
    return sentence
  }

  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
  afterEach(() => { vi.unstubAllEnvs() })

  describe('work two roles do, whose refusal names the roles to ask for', () => {
    const ROLE = 'Your role at this facility doesn’t include registering patients.'
    const ASK = `${ROLE} Ask your facility administrator for the Receptionist or Records officer role.`
    const ASK_ONLY = `${ROLE} Ask your facility administrator.`

    it.each([
      ['anyone else at a checked hospital', at('reviewed', 'hospital'), ORDINARY],
      ['anyone else at a checked clinic', at('reviewed', 'clinic'), ORDINARY],
      ['anyone else at a facility Health ID support manages', MANAGED, ORDINARY],
      ['an administrator at a facility Health ID support manages', MANAGED, ADMINISTRATOR],
      ['an administrator with no facility', undefined, ADMINISTRATOR],
    ])('%s: told to ask the administrator for either role, by its name', (_who, facility, permissions) => {
      expect(said(facility, permissions, TWO_ROLES)).toBe(ASK)
    })

    it.each(['', 'main-v1'])('the administrator of a checked hospital on today’s backend (%j): told to ask for either role', contract => {
      vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
      expect(said(at('reviewed', 'hospital'), ADMINISTRATOR, TWO_ROLES)).toBe(ASK)
    })

    // A laboratory, pharmacy or "other" facility is never promised the work, so neither role would bring it there: its
    // own administrator has no step, and nobody else is sent to ask for a role that would not help.
    it.each([
      ['reviewed', 'laboratory'], ['reviewed', 'pharmacy'], ['reviewed', 'other'],
      ['pending', 'laboratory'], ['pending', 'pharmacy'], ['pending', 'other'],
    ])('anyone else at a %s %s, not promised the work: told to ask the administrator, naming no role', (review, organizationType) => {
      expect(said(at(review, organizationType), ORDINARY, TWO_ROLES)).toBe(ASK_ONLY)
    })

    // Holding one of the roles already, without the work (a facility's own grants can differ): asking for it again
    // would not help, so the role is not named.
    it.each([
      ['a receptionist at a checked hospital', at('reviewed', 'hospital', ['receptionist'])],
      ['a records officer at a checked clinic', at('reviewed', 'clinic', ['records_officer'])],
      ['a records officer who is also a nurse, at a facility Health ID support manages', { roles: ['nurse', 'records_officer'] }],
    ])('%s, without the work: told to ask the administrator, naming no role', (_who, facility) => {
      expect(said(facility, ORDINARY, TWO_ROLES)).toBe(ASK_ONLY)
    })

    it.each(['hospital', 'clinic'])('the administrator of a checked %s: add either role on the Staff page', organizationType => {
      expect(said(at('reviewed', organizationType), ADMINISTRATOR, TWO_ROLES)).toBe(`${ROLE} Add a receptionist or a records officer on the Staff page.`)
    })

    it.each(['laboratory', 'pharmacy', 'other'])('the administrator of a checked %s, not promised the work: the role sentence only', organizationType => {
      expect(said(at('reviewed', organizationType), ADMINISTRATOR, TWO_ROLES)).toBe(ROLE)
    })

    it.each([
      ['the administrator', 'hospital', ADMINISTRATOR], ['the administrator', 'clinic', ADMINISTRATOR],
      ['anyone else', 'hospital', ORDINARY], ['anyone else', 'clinic', ORDINARY],
    ])('%s at a %s being checked: it opens after the check', (_who, organizationType, permissions) => {
      expect(said(at('pending', organizationType), permissions, TWO_ROLES))
        .toBe('Patient registration opens once Health ID support has checked your facility.')
    })
  })

  describe('the Laboratory, done by one role, in the words it had', () => {
    const ROLE = 'Your role at this facility doesn’t include the lab’s work list and results.'

    it.each([
      ['anyone else at a checked hospital', at('reviewed', 'hospital'), ORDINARY],
      ['anyone else at a checked laboratory', at('reviewed', 'laboratory'), ORDINARY],
      ['an administrator at a facility Health ID support manages', MANAGED, ADMINISTRATOR],
    ])('%s: told to ask the administrator, naming no role', (_who, facility, permissions) => {
      expect(said(facility, permissions, LAB_WORK)).toBe(`${ROLE} Ask your facility administrator.`)
    })

    it('the administrator of a checked laboratory: add a laboratory scientist', () => {
      expect(said(at('reviewed', 'laboratory'), ADMINISTRATOR, LAB_WORK)).toBe(`${ROLE} Add a laboratory scientist on the Staff page.`)
    })

    it('the administrator of a checked pharmacy: the role sentence only', () => {
      expect(said(at('reviewed', 'pharmacy'), ADMINISTRATOR, LAB_WORK)).toBe(ROLE)
    })

    it('the administrator of a laboratory being checked: it opens after the check', () => {
      expect(said(at('pending', 'laboratory'), ADMINISTRATOR, LAB_WORK)).toBe('Laboratory opens once Health ID support has checked your facility.')
    })
  })
})
