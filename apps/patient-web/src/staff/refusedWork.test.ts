import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Facility } from './api'
import { AUDIT_WORK, LAB_WORK, NO_OUTREACH, PHARMACY_WORK, pharmacyWorkFor, refusedWorkText, type NamedRole, type RefusedWork } from './refusedWork'
import { roleInSentence, roleLabel } from './staffAccess'

describe('the role a refusal names', () => {
  /** Every NamedRole, once: the type lists them, so leaving one out here, or adding one there only, fails to build. */
  const NAMED: Readonly<Record<NamedRole, true>> = {
    doctor: true, clinician: true, nurse: true, lab: true, pharmacist: true, receptionist: true, records_officer: true, billing: true,
    outreach_officer: true,
  }

  // A code with no words reads "Staff" and "a staff member" (staffAccess.ts), never itself: so those are what to rule out.
  it.each(Object.keys(NAMED))('%s has words, so the step names the role, never its code or "a staff member"', code => {
    expect(roleLabel(code)).not.toBe('Staff')
    expect(roleLabel(code)).not.toBe(code)
    expect(roleLabel(code)).toMatch(/^[A-Z][a-z ]+$/)
    expect(roleInSentence(code)).not.toBe('a staff member')
    expect(roleInSentence(code)).toMatch(/^an? [a-z ]+$/)
  })

  it('cannot name a role the list has no words for', () => {
    // @ts-expect-error: a code ROLE_LABELS does not name would ask for no role in particular ("Add a staff member…").
    const unnamed: RefusedWork = { ...LAB_WORK, doneBy: ['unnamed_role'] }
    expect(unnamed.doneBy?.map(roleInSentence)).toEqual(['a staff member'])
  })

  it('cannot leave out the role that does the work', () => {
    // @ts-expect-error: with no role, the administrator's step would read "Add  on the Staff page." Work no role is named
    // for says so with null (AUDIT_WORK).
    const nobody: RefusedWork = { ...LAB_WORK, doneBy: [] }
    expect(nobody.doneBy).toEqual([])
  })
})

/*
 * Outreach's refusal (the owner's answer of 2 November): one sentence for everyone, as Document OCR's is, so it asks
 * nobody. On hid-system main no role has held any Outreach permission since migration 0091, so a facility administrator
 * could not give it.
 */
describe('Outreach’s refusal', () => {
  it('says Outreach isn’t available at the facility yet, as Document OCR does, asking nobody and naming no permission', () => {
    expect(NO_OUTREACH).toBe('Outreach isn’t available at your facility yet.')
    expect(NO_OUTREACH).not.toMatch(/administrator|Staff page|opens once|[a-z]\.[a-z]|_|\/|permission|membership|workforce|code/i)
  })
})

/*
 * Audit by who reads its refusal (#104's rule, the owner's decision for #107). No locked list names it
 * (staff/routes/ReviewBanner.tsx), so it never opens only after the check and no role is named: an administrator is
 * never told it opens after the check, nor to add someone, only that their role doesn't include it. Everyone else is
 * told to ask the facility administrator. On Novu the administrator holds it (P4b SPEC 3.3), so their cases here are
 * for an administrator role without it; off Novu no administrator has words of their own. Every facility here is
 * fictional.
 */
describe('Audit, by who reads the refusal', () => {
  const KINDS = ['hospital', 'clinic', 'laboratory', 'pharmacy', 'other']
  /** A facility administrator's own permissions here, without the page's: only workforce.manage makes them one. */
  const ADMINISTRATOR = ['organization.manage', 'workforce.manage']
  const at = (review: string, organizationType: string) => ({ selfService: { review, organizationType }, roles: [] as string[] })
  const ASK = ' Ask your facility administrator.'
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
  afterEach(() => { vi.unstubAllEnvs() })

  describe.each([
    ['Audit', AUDIT_WORK, 'Your role at this facility doesn’t include reviewing audit events.'],
  ])('%s', (_name, work, role) => {
    it.each(KINDS)('the administrator of a checked facility (%s): the role sentence only, asking nobody and adding no one', kind => {
      expect(refusedWorkText(at('reviewed', kind), ADMINISTRATOR, work)).toBe(role)
    })

    it.each(KINDS)('the administrator of a facility (%s) Health ID support is still checking: the role sentence only, as it never waits for the check', kind => {
      expect(refusedWorkText(at('pending', kind), ['workforce.manage'], work)).toBe(role)
    })

    it('anyone else at a checked facility: the role sentence, then to ask the facility administrator', () => {
      expect(refusedWorkText(at('reviewed', 'hospital'), ['ehr.encounter.read'], work)).toBe(`${role}${ASK}`)
    })

    it('an administrator at a facility Health ID support manages: told to ask the facility administrator', () => {
      expect(refusedWorkText({ roles: [] }, ADMINISTRATOR, work)).toBe(`${role}${ASK}`)
      expect(refusedWorkText(undefined, ADMINISTRATOR, work)).toBe(`${role}${ASK}`)
    })

    // Only Novu checks self-signed-up facilities (P4b), so on today's backend nobody is that facility's administrator.
    it.each(['', 'main-v1'])('the administrator of a checked hospital on today’s backend (%j): told to ask the facility administrator', contract => {
      vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
      expect(refusedWorkText(at('reviewed', 'hospital'), ADMINISTRATOR, work)).toBe(`${role}${ASK}`)
    })
  })

  // #119's askForRole names the roles that do the work: work with no role to name asks for none, whoever reads it.
  it('work with no role to name asks for no role, even where its refusal could name one', () => {
    const askingAudit: RefusedWork = { ...AUDIT_WORK, askForRole: true }
    const role = 'Your role at this facility doesn’t include reviewing audit events.'
    expect(refusedWorkText(at('reviewed', 'hospital'), ['ehr.encounter.read'], askingAudit)).toBe(`${role}${ASK}`)
    expect(refusedWorkText({ roles: ['nurse'] }, ADMINISTRATOR, askingAudit)).toBe(`${role}${ASK}`)
    expect(refusedWorkText(at('reviewed', 'hospital'), ADMINISTRATOR, askingAudit)).toBe(role)
  })

  it('names no permission, code or address in any sentence, whoever reads it', () => {
    const readers: Array<[Parameters<typeof refusedWorkText>[0], string[]]> = [[undefined, []], [at('reviewed', 'hospital'), []],
      ...KINDS.flatMap(kind => [[at('reviewed', kind), ADMINISTRATOR], [at('pending', kind), ADMINISTRATOR]] as Array<[ReturnType<typeof at>, string[]]>)]
    for (const work of [AUDIT_WORK, PHARMACY_WORK, LAB_WORK]) {
      for (const [facility, permissions] of readers) {
        expect(refusedWorkText(facility, permissions, work)).not.toMatch(/[a-z]\.[a-z]|_|\/|permission|membership|workforce|code/i)
      }
    }
  })
})

/*
 * Pharmacy's work, as the blue Pharmacy and the classic page both name it: the rule is written once (refusedWorkText), and
 * its words are #82's (ehr-blue/departments/pharmacy/pharmacyText.ts), unchanged.
 */
describe('Pharmacy, by who reads the refusal', () => {
  const ROLE = 'Your role at this facility doesn’t include pharmacy work.'
  const at = (review: string, organizationType: string) => ({ selfService: { review, organizationType }, roles: [] as string[] })
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
  afterEach(() => { vi.unstubAllEnvs() })

  it.each([
    ['the administrator of a checked pharmacy', at('reviewed', 'pharmacy'), ['workforce.manage'], `${ROLE} Add a pharmacist on the Staff page.`],
    ['the administrator of a checked laboratory, which will not get Pharmacy', at('reviewed', 'laboratory'), ['workforce.manage'], ROLE],
    ['the administrator of a clinic being checked', at('pending', 'clinic'), ['workforce.manage'], 'Pharmacy opens once Health ID support has checked your facility.'],
    ['anyone else at a checked pharmacy', at('reviewed', 'pharmacy'), [], `${ROLE} Ask your facility administrator.`],
  ])('%s', (_reader, facility, permissions, sentence) => {
    expect(refusedWorkText(facility, permissions, PHARMACY_WORK)).toBe(sentence)
  })
})

/*
 * The work a refusal of Prescriptions names, in the blue Pharmacy and the classic page alike: a role that may open another
 * Pharmacy page (it sells, keeps stock, takes payment…) is told only that prescriptions are not in it.
 */
describe('the Pharmacy work a refusal names', () => {
  it.each([[[]], [['pharmacy.dispensing.read', 'pharmacy.dispensing.create']], [['ehr.encounter.read']]])('with %j: pharmacy work', permissions => {
    expect(pharmacyWorkFor(permissions)).toBe(PHARMACY_WORK)
  })

  it.each(['pharmacy.walk-in.create', 'billing.bill.read', 'pharmacy.stock.read', 'billing.catalogue.read', 'billing.shift.own',
    'billing.settings.manage'])('with %s, which opens another Pharmacy page: prescriptions, by the same rule', permission => {
    expect(pharmacyWorkFor([permission])).toEqual({ ...PHARMACY_WORK, work: 'prescriptions' })
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
