import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_WORK, LAB_WORK, OUTREACH_WORK, PHARMACY_WORK, pharmacyWorkFor, refusedWorkText, type NamedRole, type RefusedWork } from './refusedWork'
import { roleInSentence, roleLabel } from './staffAccess'

describe('the role a refusal names', () => {
  /** Every NamedRole, once: the type lists them, so leaving one out here, or adding one there only, fails to build. */
  const NAMED: Readonly<Record<NamedRole, true>> = { doctor: true, clinician: true, nurse: true, lab: true, pharmacist: true, receptionist: true }

  // A code with no words reads "Staff" and "a staff member" (staffAccess.ts), never itself: so those are what to rule out.
  it.each(Object.keys(NAMED))('%s has words, so the step names the role, never its code or "a staff member"', code => {
    expect(roleLabel(code)).not.toBe('Staff')
    expect(roleInSentence(code)).not.toBe('a staff member')
    expect(roleInSentence(code)).toMatch(/^an? [a-z ]+$/)
  })

  it('cannot name a role the list has no words for', () => {
    // @ts-expect-error: a code ROLE_LABELS does not name would ask for no role in particular ("Add a staff member…").
    const unnamed: RefusedWork = { ...LAB_WORK, doneBy: 'unnamed_role' }
    expect(roleInSentence(unnamed.doneBy as string)).toBe('a staff member')
  })
})

/*
 * Outreach and Audit by who reads their refusal (#104's rule, the owner's decision for #107). No locked list names either
 * (staff/routes/ReviewBanner.tsx), so neither opens only after the check and no role is named: an administrator is
 * never told either opens after the check, nor to add someone, only that their role doesn't include it. Everyone else
 * is told to ask the facility administrator. On Novu the administrator holds both (P4b SPEC 3.3), so their cases here
 * are for an administrator role without them; off Novu no administrator has words of their own. Every facility here is
 * fictional.
 */
describe('Outreach and Audit, by who reads the refusal', () => {
  const KINDS = ['hospital', 'clinic', 'laboratory', 'pharmacy', 'other']
  /** A facility administrator's own permissions here, without the page's: only workforce.manage makes them one. */
  const ADMINISTRATOR = ['organization.manage', 'workforce.manage']
  const at = (review: string, organizationType: string) => ({ selfService: { review, organizationType } })
  const ASK = ' Ask your facility administrator.'
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
  afterEach(() => { vi.unstubAllEnvs() })

  describe.each([
    ['Outreach', OUTREACH_WORK, 'Your role at this facility doesn’t include outreach campaigns or registering people in the field.'],
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
      expect(refusedWorkText({}, ADMINISTRATOR, work)).toBe(`${role}${ASK}`)
      expect(refusedWorkText(undefined, ADMINISTRATOR, work)).toBe(`${role}${ASK}`)
    })

    // Only Novu checks self-signed-up facilities (P4b), so on today's backend nobody is that facility's administrator.
    it.each(['', 'main-v1'])('the administrator of a checked hospital on today’s backend (%j): told to ask the facility administrator', contract => {
      vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
      expect(refusedWorkText(at('reviewed', 'hospital'), ADMINISTRATOR, work)).toBe(`${role}${ASK}`)
    })
  })

  it('names no permission, code or address in any sentence, whoever reads it', () => {
    const readers: Array<[Parameters<typeof refusedWorkText>[0], string[]]> = [[undefined, []], [at('reviewed', 'hospital'), []],
      ...KINDS.flatMap(kind => [[at('reviewed', kind), ADMINISTRATOR], [at('pending', kind), ADMINISTRATOR]] as Array<[ReturnType<typeof at>, string[]]>)]
    for (const work of [OUTREACH_WORK, AUDIT_WORK, PHARMACY_WORK, LAB_WORK]) {
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
  const at = (review: string, organizationType: string) => ({ selfService: { review, organizationType } })
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
