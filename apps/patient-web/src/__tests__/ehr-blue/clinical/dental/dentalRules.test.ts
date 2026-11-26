import { HidApiError } from '@hid/http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PERMANENT_LOWER, PERMANENT_UPPER, PRIMARY_LOWER, PRIMARY_UPPER, anaestheticText, canReadDental, canWriteDental, chartRows,
  dentalServed, doneMoment, doneTimeProblem, findingsOutside, followUpProblem, followUpWindow, forgetDentalServed, learnFrom,
  memberText, notServed, orderedSurfaces, reasonProblem, refusalWords, siteText, surfaceWord, surfacesText, teethOf,
  toothInDentition, toothPlace, toothText,
} from '../../../../ehr-blue/clinical/dental/dentalRules'

/*
 * The dental clinic's rules in plain words (hid-system DEN-1): the FDI tooth chart (ISO 3950) as a dentist reads it, the
 * surfaces as they read on each tooth, the follow-up window and done time in Lagos time, and the refusals' words,
 * including "not switched on yet" for DENTAL_NOT_AVAILABLE or an ehr-api without the dental routes.
 */
afterEach(() => forgetDentalServed())

const refused = (status: number, code: string) => new HidApiError(status, 'Refused.', { code })

describe('the FDI tooth chart', () => {
  it('draws each arch facing the patient: their right on the left of the screen', () => {
    expect(PERMANENT_UPPER).toEqual([18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28])
    expect(PERMANENT_LOWER).toEqual([48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38])
    expect(PRIMARY_UPPER).toEqual([55, 54, 53, 52, 51, 61, 62, 63, 64, 65])
    expect(PRIMARY_LOWER).toEqual([85, 84, 83, 82, 81, 71, 72, 73, 74, 75])
    expect(chartRows('permanent').map(row => row.teeth.length)).toEqual([16, 16])
    expect(chartRows('primary').map(row => row.teeth.length)).toEqual([10, 10])
    expect(chartRows('mixed').map(row => row.label)).toEqual(['Upper teeth', 'Upper baby teeth', 'Lower baby teeth', 'Lower teeth'])
    expect(teethOf('mixed')).toHaveLength(52)
  })

  it('keeps each tooth to its dentition, as the server’s DENTAL_TOOTH_INVALID rule', () => {
    expect(toothInDentition(36, 'permanent')).toBe(true)
    expect(toothInDentition(19, 'permanent')).toBe(false)
    expect(toothInDentition(55, 'permanent')).toBe(false)
    expect(toothInDentition(55, 'primary')).toBe(true)
    expect(toothInDentition(56, 'primary')).toBe(false)
    expect(toothInDentition(36, 'mixed') && toothInDentition(85, 'mixed')).toBe(true)
    expect(findingsOutside([{ tooth: 36, condition: 'decayed', surfaces: 'MO', note: null }, { tooth: 75, condition: 'missing', surfaces: null, note: null }], 'permanent')
      .map(finding => finding.tooth)).toEqual([75])
  })

  it('names each tooth by its place', () => {
    expect(toothPlace(36)).toBe('lower left first molar')
    expect(toothPlace(11)).toBe('upper right central incisor')
    expect(toothPlace(48)).toBe('lower right third molar')
    expect(toothPlace(63)).toBe('upper left baby canine')
    expect(toothText(36)).toBe('Tooth 36 (lower left first molar)')
  })

  it('names surfaces as they read on the tooth, in M, O, D, B, L order', () => {
    expect(surfaceWord('O', 36)).toBe('Occlusal')
    expect(surfaceWord('O', 11)).toBe('Incisal')
    expect(surfaceWord('B', 13)).toBe('Labial')
    expect(surfaceWord('B', 46)).toBe('Buccal')
    expect(surfaceWord('L', 26)).toBe('Palatal')
    expect(surfaceWord('L', 36)).toBe('Lingual')
    expect(orderedSurfaces(['L', 'O', 'M', 'O'])).toBe('MOL')
    expect(surfacesText('MO', 36)).toBe('MO (mesial, occlusal)')
  })
})

describe('procedures', () => {
  it('says where a procedure was done and with what anaesthetic', () => {
    const base = { tooth: null, surfaces: null, quadrant: null, arch: null }
    expect(siteText({ ...base, site: 'tooth_surfaces', tooth: 36, surfaces: 'MO' })).toBe('Tooth 36 (lower left first molar), surfaces MO (mesial, occlusal)')
    expect(siteText({ ...base, site: 'quadrant', quadrant: 4 })).toBe('Lower right quadrant')
    expect(siteText({ ...base, site: 'arch', arch: 'upper' })).toBe('Upper arch')
    expect(siteText({ ...base, site: 'whole_mouth' })).toBe('Whole mouth')
    expect(anaestheticText({ agentCode: 'lidocaine_2_adrenaline', agentName: 'Lidocaine 2% with adrenaline 1:80,000', agentOther: null,
      techniqueCode: 'inferior_alveolar_block', techniqueName: 'Inferior alveolar nerve block', cartridges: 1.5 }))
      .toBe('Lidocaine 2% with adrenaline 1:80,000 · Inferior alveolar nerve block · 1.5 cartridges')
    expect(anaestheticText({ agentCode: 'none', agentName: 'No local anaesthetic', agentOther: null, techniqueCode: null, techniqueName: null, cartridges: null }))
      .toBe('No local anaesthetic')
    expect(anaestheticText({ agentCode: 'other', agentName: 'Other', agentOther: 'Fictional agent', techniqueCode: 'infiltration',
      techniqueName: 'Infiltration', cartridges: 1 })).toBe('Fictional agent · Infiltration · 1 cartridge')
  })

  it('asks for a reason of at least 8 characters', () => {
    expect(reasonProblem('wrong')).toBe('Say why in at least 8 characters.')
    expect(reasonProblem('Charted the wrong tooth')).toBe('')
  })
})

describe('Lagos days and times', () => {
  // 23:30 UTC on 2 Dec is 00:30 on 3 Dec in Lagos.
  const now = new Date('2026-12-02T23:30:00.000Z')

  it('takes a follow-up from tomorrow to two years ahead, in Lagos days', () => {
    expect(followUpWindow(now)).toEqual({ min: '2026-12-04', max: '2028-12-03' })
    expect(followUpProblem('2026-12-03', now)).toBe('Choose a follow-up date from tomorrow to two years ahead.')
    expect(followUpProblem('2026-12-04', now)).toBe('')
    expect(followUpProblem('2028-12-04', now)).toBe('Choose a follow-up date from tomorrow to two years ahead.')
    expect(followUpWindow(new Date('2028-02-29T10:00:00.000Z')).max).toBe('2030-02-28')
  })

  it('reads a done time typed on the 24-hour clock as today in Lagos, from the visit’s start to now', () => {
    expect(doneMoment('00:10', now)).toBe('2026-12-02T23:10:00.000Z')
    expect(doneMoment('9:30', now)).toBeNull()
    expect(doneTimeProblem('00:10', '2026-12-02T23:00:00.000Z', now)).toBe('')
    expect(doneTimeProblem('00:50', '2026-12-02T23:00:00.000Z', now)).toBe('The time it was done can be from the start of this visit to now.')
    expect(doneTimeProblem('00:05', '2026-12-02T23:20:00.000Z', now)).toBe('The time it was done can be from the start of this visit to now.')
    expect(doneTimeProblem('', '2026-12-02T23:20:00.000Z', now)).toBe('')
  })
})

describe('who and refusals', () => {
  it('names the member, never their id', () => {
    const names = new Map([['member-2', 'Dr Fictional Dentist']])
    expect(memberText('member-1', 'member-1', names)).toBe('You')
    expect(memberText('MEMBER-2', 'member-1', names)).toBe('Dr Fictional Dentist')
    expect(memberText('member-3', 'member-1', names)).toBe('A staff member here')
  })

  it('is for dentists only (Q-DEN-1 A)', () => {
    expect(canReadDental(['ehr.encounter.read', 'ehr.note.read'])).toBe(false)
    expect(canReadDental(['ehr.dental.read'])).toBe(true)
    expect(canWriteDental(['ehr.dental.write'])).toBe(false)
    expect(canWriteDental(['ehr.dental.read', 'ehr.dental.write'])).toBe(true)
  })

  it('says not switched on yet for the flag or an ehr-api without the routes, never the server’s codes', () => {
    expect(notServed(refused(503, 'DENTAL_NOT_AVAILABLE'))).toBe(true)
    expect(notServed(refused(404, 'API_ROUTE_NOT_FOUND'))).toBe(true)
    expect(notServed(refused(404, 'DENTAL_VISIT_NOT_FOUND'))).toBe(false)
    expect(notServed(refused(404, 'ENCOUNTER_NOT_FOUND'))).toBe(false)
    expect(refusalWords(refused(503, 'DENTAL_NOT_AVAILABLE'), 'x')).toBe('The dental clinic is not switched on yet.')
    expect(refusalWords(refused(409, 'DENTAL_CHART_CHANGED'), 'x')).toBe('Someone saved this chart after you opened it. Reload it to start from the newest chart.')
    expect(refusalWords(refused(403, 'PERMISSION_DENIED'), 'x')).toBe('Only dentists of this facility can open or record the dental chart.')
    expect(refusalWords(refused(400, 'VALIDATION_FAILED'), 'x', 'Check the chart.')).toBe('Check the chart.')
    expect(refusalWords(new Error('boom'), 'Fallback.')).toBe('Fallback.')
  })

  it('learns once and for all that the routes are served; until then a refusal may say they are not', () => {
    expect(dentalServed()).toBeNull()
    learnFrom(refused(503, 'DENTAL_NOT_AVAILABLE'))
    expect(dentalServed()).toBe(false)
    learnFrom()
    expect(dentalServed()).toBe(true)
    learnFrom(refused(503, 'DENTAL_NOT_AVAILABLE'))
    expect(dentalServed()).toBe(true)
    forgetDentalServed()
    learnFrom(new HidApiError(0, 'Offline.', { code: 'NETWORK_ERROR' }))
    expect(dentalServed()).toBeNull()
  })
})
