import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_WORK, LAB_WORK, OUTREACH_WORK, PHARMACY_WORK, refusedWorkText, type NamedRole, type RefusedWork } from './refusedWork'
import { roleInSentence, roleLabel } from './staffAccess'

describe('the role a refusal names', () => {
  /** Every NamedRole, once: the type lists them, so leaving one out here, or adding one there only, fails to build. */
  const NAMED: Readonly<Record<NamedRole, true>> = { doctor: true, clinician: true, nurse: true, lab: true, pharmacist: true, receptionist: true }

  it.each(Object.keys(NAMED))('%s has words, so the step names the role, never its code', code => {
    expect(roleLabel(code)).not.toBe(code)
    expect(roleInSentence(code)).toMatch(/^an? [a-z ]+$/)
  })

  it('cannot name a role the list has no words for', () => {
    // @ts-expect-error: a code ROLE_LABELS does not name would ask for no role in particular ("Add a member of staff…").
    const unnamed: RefusedWork = { ...LAB_WORK, doneBy: 'unnamed_role' }
    expect(roleInSentence(unnamed.doneBy as string)).toBe('a member of staff')
  })
})

/*
 * Outreach and Audit by who reads their refusal (#104's rule, the owner's decision for #107). Every kind of facility that
 * signs itself up has both from the start: no locked list names them (staff/routes/ReviewBanner.tsx), and its
 * administrator holds both while Health ID support checks it and after. So an administrator is never told either opens
 * after the check, nor to add someone, who would not give it to them: only that their role doesn't include it. Everyone
 * else is told to ask the facility administrator. Every facility here is fictional.
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
