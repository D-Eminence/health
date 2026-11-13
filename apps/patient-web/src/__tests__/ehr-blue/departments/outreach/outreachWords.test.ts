import { describe, expect, it } from 'vitest'
import {
  campaignSearchText, campaignStatusLabel, caseSearchText, caseTone, nextStepText, normalizeOutreachPhone, NO_ACTIONS, outreachPhoneAccepted, statusLabel,
} from '../../../../ehr-blue/departments/outreach/outreachParts'

/* Outreach's statuses in plain words (the owner's rule: no codes on screen), with a plain fallback for any other. */

describe('Outreach words', () => {
  it.each([
    ['planned', 'Not started'], ['draft', 'Not started'], ['active', 'Running'], ['closed', 'Finished'],
    ['paused', 'Paused'], ['cancelled', 'Cancelled'],
  ])('says a %s campaign is "%s"', (status, words) => {
    expect(campaignStatusLabel(status)).toBe(words)
  })

  it.each(['something_new', 'toString', '', 'ACTIVE'])('never prints a campaign status it has no word for (%j)', status => {
    expect(campaignStatusLabel(status)).toBe('Status not known')
  })

  it('says a case status in words, and one it has no word for plainly', () => {
    expect(statusLabel('identity_resolution_pending')).toBe('Waiting to link')
    expect(statusLabel('identity_resolved')).toBe('Linked')
    expect(statusLabel('awaiting_something_new')).toBe('Status not known')
    expect(statusLabel('constructor')).toBe('Status not known')
  })

  it.each([
    ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['closed', 'Closed'], ['duplicate', 'Duplicate'],
  ])('says a case that ended as %s is "%s", in a neutral tone', (status, words) => {
    expect(statusLabel(status)).toBe(words)
    expect(caseTone(status)).toBe('neutral')
    expect(nextStepText({ id: 'x', status, rowVersion: 1 }, true)).toBe('Done: nothing more to do')
  })

  it('shows only linked cases in green, and waiting ones in amber', () => {
    expect(caseTone('identity_resolved')).toBe('success')
    expect(caseTone('resolved_existing_identity')).toBe('success')
    expect(caseTone('identity_resolution_pending')).toBe('warn')
    expect(caseTone('awaiting_something_new')).toBe('neutral')
  })

  it('does not call a case it has no word for done', () => {
    expect(nextStepText({ id: 'x', status: 'awaiting_something_new', rowVersion: 1 }, true)).toBe('Nothing else to do here.')
  })

  it('searches only what is on screen: the words, never the ids', () => {
    const campaign = { id: 'c0a00000-0000-4000-8000-000000000001', name: 'Eye week', status: 'active', services: [], startsAt: '2026-01-01T00:00:00.000Z', rowVersion: 1 }
    expect(campaignSearchText(campaign)).toContain('Running')
    expect(campaignSearchText(campaign)).not.toContain(campaign.id)
    const item = { id: 'c0a5e000-0000-4000-8000-000000000001', status: 'identity_resolution_pending', fullName: 'Ada', rowVersion: 1 }
    expect(caseSearchText(item)).toContain('Waiting to link')
    expect(caseSearchText(item)).not.toContain(item.id)
  })

  it('says plainly when nothing is left to do', () => {
    expect(NO_ACTIONS).toBe('Nothing else to do here.')
  })
})

/*
 * A phone number as Outreach reads it (hid-system services/outreach-api create-registration-case.dto.ts
 * normalizeOutreachPhone and its E.164 check, ported exactly), with the server's own examples (outreach-tenant.spec.ts
 * "Registration DTO: consent and E.164 phones") and the numbers the audit found refused only at sync.
 */
describe('a phone number, as Outreach takes it', () => {
  it.each([
    ['08012345678', '+2348012345678'],
    ['0801 234 5678', '+2348012345678'],
    ['+234 0801 234 5678', '+2348012345678'],
    ['2348012345678', '+2348012345678'],
    ['+44 7700 900123', '+447700900123'],
  ])('takes %s, as %s', (typed, expected) => {
    expect(normalizeOutreachPhone(typed)).toBe(expected)
    expect(outreachPhoneAccepted(typed)).toBe(true)
  })

  it.each([
    'call me',
    // No leading 0, one digit short, two numbers in one field, too few digits.
    '8031234567', '0803123456', '08031234567 / 08039876543', '12',
  ])('refuses %j, as Outreach would', typed => {
    expect(outreachPhoneAccepted(typed)).toBe(false)
  })

  it('reads a number of spaces, dots, dashes and brackets only as no number', () => {
    expect(normalizeOutreachPhone('  ')).toBeUndefined()
    expect(outreachPhoneAccepted(' (-) ')).toBe(true)
  })
})
