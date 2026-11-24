import { describe, expect, it } from 'vitest'
import {
  EMPTY_SEARCH, NEXT_STEP, STAGE_WORDS, VISIT_QUEUE_REFUSALS, assigneeText, canSeePatients, canUseWaitingList,
  checkInWhen, checkedInText, closedTitle, cutShort, fromEarlierDay, healthIdEnding, lagosToday, searchKeys, stageText, triageText,
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

  it('says the day of a check-in from an earlier day, by the Lagos day', () => {
    // 23:30 UTC on 22 Nov is already 23 Nov in Lagos (UTC+1).
    expect(lagosToday(new Date('2026-11-22T23:30:00.000Z'))).toBe('2026-11-23')
    const today = '2026-11-23'
    expect(fromEarlierDay({ checkInDay: '2026-11-22' }, today)).toBe(true)
    expect(fromEarlierDay({ checkInDay: today }, today)).toBe(false)
    expect(checkInWhen({ checkInDay: today, checkedInAt: '2026-11-23T09:05:00.000Z' }, today)).toMatch(/^\d\d:\d\d$/)
    expect(checkInWhen({ checkInDay: '2026-11-22', checkedInAt: '2026-11-22T15:40:00.000Z' }, today)).toMatch(/^22 Nov, \d\d:\d\d$/)
    expect(checkInWhen({ checkInDay: '2025-12-31', checkedInAt: '2025-12-31T15:40:00.000Z' }, today)).toMatch(/^31 Dec 2025, \d\d:\d\d$/)
  })

  it('says where a cut list was cut: in the patients waiting only when they fill it', () => {
    expect(cutShort(null, 0)).toEqual({ open: false, closed: false })
    expect(cutShort({ hasMore: true, limit: 200, withClosed: false }, 200)).toEqual({ open: true, closed: false })
    expect(cutShort({ hasMore: true, limit: 200, withClosed: true }, 150)).toEqual({ open: false, closed: true })
    expect(cutShort({ hasMore: true, limit: 200, withClosed: true }, 200)).toEqual({ open: true, closed: true })
    expect(cutShort({ hasMore: false, limit: 200, withClosed: true }, 150)).toEqual({ open: false, closed: false })
    expect(closedTitle(50, false)).toBe('Finished or left today (50)')
    expect(closedTitle(50, true)).toBe('Finished or left today (at least 50)')
    expect(closedTitle(0, true)).toBe('Finished or left today')
  })
})
