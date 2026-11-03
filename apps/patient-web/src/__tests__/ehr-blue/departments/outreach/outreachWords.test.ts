import { describe, expect, it } from 'vitest'
import { campaignSearchText, campaignStatusLabel, caseSearchText, NO_ACTIONS, statusLabel } from '../../../../ehr-blue/departments/outreach/outreachParts'

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
