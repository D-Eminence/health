import { describe, expect, it } from 'vitest'
import {
  EMPTY_SEARCH, NEXT_STEP, STAGE_WORDS, VISIT_QUEUE_REFUSALS, assigneeText, canSeePatients, canUseWaitingList,
  checkedInText, healthIdEnding, searchKeys, stageText, triageText,
} from '../../../../ehr-blue/departments/waiting/waitingRules'

/** The stages hid-system 0135 has (services/ehr-api/src/ehr/worklist/visit-queue.dto.ts VISIT_QUEUE_STAGES). */
const VISIT_QUEUE_STAGES = ['waiting', 'triage', 'ready', 'with_clinician', 'finished', 'left', 'cancelled'] as const

/* The waiting list's rules in plain words (hid-system 0135, EHR-C7). Every name and Health ID ending is fictional. */
describe('waiting list rules', () => {
  it('is for members holding both encounter read and write: front desk, nurses, clinicians, doctors; not lab or pharmacy', () => {
    expect(canUseWaitingList(['ehr.encounter.read', 'ehr.encounter.write'])).toBe(true)
    expect(canUseWaitingList(['ehr.encounter.read'])).toBe(false)
    expect(canUseWaitingList(['ehr.encounter.write'])).toBe(false)
    // Only a nurse, clinician or doctor (encounter and note writing) can be put down to see the patient.
    expect(canSeePatients(['ehr.encounter.read', 'ehr.encounter.write'])).toBe(false)
    expect(canSeePatients(['ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.write'])).toBe(true)
  })

  it('names every stage the backend has in plain words, never its code', () => {
    expect(Object.keys(STAGE_WORDS)).toEqual([...VISIT_QUEUE_STAGES])
    for (const stage of VISIT_QUEUE_STAGES) {
      expect(STAGE_WORDS[stage]).toBeTruthy()
      expect(stageText(stage)).not.toMatch(/_/)
    }
    expect(stageText('with_clinician')).toBe('Being seen')
    expect(stageText('left')).toBe('Left before being seen')
    expect(stageText('something_new')).toBe('Stage not known')
    expect(Object.values(NEXT_STEP).map(step => step!.stage)).toEqual(['triage', 'ready', 'with_clinician', 'finished'])
  })

  it('says the triage level with what it means', () => {
    expect(triageText(1)).toBe('Level 1: most urgent')
    expect(triageText(5)).toBe('Level 5: not urgent')
    expect(triageText(null)).toBe('No triage level yet')
  })

  it('names only the session’s own membership as who will see the patient', () => {
    expect(assigneeText({ assignedMembershipId: null }, 'member-1')).toBe('No one yet')
    expect(assigneeText({ assignedMembershipId: 'member-1' }, 'member-1')).toBe('You')
    expect(assigneeText({ assignedMembershipId: 'member-2' }, 'member-1')).toBe('Another staff member')
  })

  it('shows only the last 4 characters of a Health ID, and refuses in plain words', () => {
    expect(healthIdEnding('ZZ22')).toBe('•••• ZZ22')
    for (const words of Object.values(VISIT_QUEUE_REFUSALS)) {
      expect(words).not.toMatch(/unverified|permission/i)
    }
  })

  it('sends only the search keys typed, trimmed, the Health ID in capitals', () => {
    expect(searchKeys(EMPTY_SEARCH)).toBeNull()
    expect(searchKeys({ ...EMPTY_SEARCH, firstName: '  Testa ', lastName: 'Queueperson', healthId: ' hid-zzzz22 ' }))
      .toEqual({ firstName: 'Testa', lastName: 'Queueperson', healthId: 'HID-ZZZZ22' })
  })

  it('says what a check-in answered', () => {
    expect(checkedInText('checked_in', 'Testa Queueperson')).toBe('Testa Queueperson is checked in and waiting.')
    expect(checkedInText('already_on_list', 'Testa Queueperson')).toBe('Testa Queueperson is already on the waiting list.')
  })
})
