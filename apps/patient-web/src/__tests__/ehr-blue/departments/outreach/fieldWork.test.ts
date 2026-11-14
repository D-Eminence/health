import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../staff/api', () => ({ staffApi: {} }))
import { stationsFor } from '../../../../ehr-blue/departments/outreach/campaignTypes'
import { barSections, worksInField } from '../../../../ehr-blue/departments/outreach/outreachNav'
import { datesInWords } from '../../../../ehr-blue/departments/outreach/insight/insightParts'

describe('someone working in the field', () => {
  it('is offered only the stations their roles work at', () => {
    expect(stationsFor(['registrar'])).toEqual(['register'])
    expect(stationsFor(['vitals', 'tester'])).toEqual(['vitals', 'tests'])
    expect(stationsFor(['counsellor'])).toEqual(['counselling', 'results'])
    expect(stationsFor(['clinician'])).toEqual(['results'])
    // A coordinator, or roles not read yet: every station.
    expect(stationsFor(['coordinator'])).toHaveLength(5)
    expect(stationsFor([])).toHaveLength(5)
  })

  it('has their own sections in the phone tab bar; a coordinator has Today beside Overview and Campaigns', () => {
    expect(worksInField(['today', 'people'])).toBe(true)
    expect(barSections(['today', 'people', 'followups'])).toEqual(['today', 'people', 'followups'])
    expect(worksInField(['overview', 'today', 'people', 'followups', 'team', 'setup'])).toBe(false)
    expect(barSections(['overview', 'today', 'people', 'followups', 'team', 'setup'])).toEqual(['today'])
    expect(barSections(['overview', 'people'])).toEqual([])
  })

  it('reads dates in Outreach’s sentences in words', () => {
    expect(datesInWords('Kit lot HB-2307 expires on 2026-12-03.')).toBe('Kit lot HB-2307 expires on 3 Dec 2026.')
  })
})
