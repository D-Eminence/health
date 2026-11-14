import { describe, expect, it } from 'vitest'
import {
  addOwnQuestion, canSave, consentTextFor, emptyDraft, HIV_CONSENT_TEXT, planInput, setStationMode, toggleItem, withFocuses,
} from '../../../../../ehr-blue/departments/outreach/plan/planDraft'
import { packageFor } from '../../../../../ehr-blue/departments/outreach/screeningTemplates'

/* The plan's rules the wizard and Setup share (owner decisions of 13 November 2026). Fictional data only. */

const options = { consentEdited: false }

describe('a new plan', () => {
  it('starts with smart defaults: split stations, English and Pidgin, nothing to save until it has a focus and a site', () => {
    const draft = emptyDraft('Demo Health Volunteers')
    expect(draft.organisationName).toBe('Demo Health Volunteers')
    expect(draft.stationMode).toBe('split')
    expect(draft.consent.languages).toEqual(['en', 'pcm'])
    expect(canSave(draft)).toBe(false)
    const ready = { ...withFocuses(draft, ['hypertension'], options), sites: [{ id: 's-1', name: 'Demo Town Hall', community: '', lga: '', address: '' }] }
    expect(canSave(ready)).toBe(true)
  })

  it('takes the merged package of the focuses, and writes the consent in plain words from it', () => {
    const draft = withFocuses(emptyDraft(''), ['hepatitis_b', 'hypertension'], options)
    expect(draft.package).toEqual(packageFor(['hepatitis_b', 'hypertension']))
    expect(draft.consent.text).toContain('check your blood pressure')
    expect(draft.consent.text).toContain('test for hepatitis B')
    expect(draft.consent.text).toContain('only the counsellor and the clinician see your hepatitis B result')
    expect(draft.stations).toEqual(['register', 'vitals', 'tests', 'results'])
  })

  it('adds the separate HIV consent and the counselling station with the HIV test, and takes them away with it', () => {
    const draft = withFocuses(emptyDraft(''), ['hiv'], options)
    expect(draft.consent.hivText).toBe(HIV_CONSENT_TEXT)
    expect(draft.stations).toContain('counselling')
    const off = toggleItem(draft, 'tests', 'hiv_rapid', false, options)
    expect(off.consent.hivText).toBeNull()
    expect(off.package.tests).toEqual([])
  })

  it('keeps what was switched off and the questions added when the focuses change', () => {
    let draft = withFocuses(emptyDraft(''), ['hypertension'], options)
    draft = toggleItem(draft, 'vitals', 'pulse', false, options)
    draft = addOwnQuestion(draft, 'Do you have a cough', options)
    draft = withFocuses(draft, ['hypertension', 'malaria'], options)
    expect(draft.package.vitals.map(vital => vital.id)).toEqual(['bp_systolic', 'bp_diastolic', 'temperature'])
    expect(draft.package.questions.at(-1)?.text).toBe('Do you have a cough?')
  })

  it('takes BMI away with weight or height, and keeps the coordinator’s own consent text once edited', () => {
    let draft = withFocuses(emptyDraft(''), ['diabetes'], options)
    draft = toggleItem(draft, 'vitals', 'height', false, options)
    expect(draft.package.vitals.map(vital => vital.id)).toEqual(['weight', 'blood_sugar'])
    const own = withFocuses({ ...draft, consent: { ...draft.consent, text: 'Our own words.' } }, ['diabetes', 'malaria'], { consentEdited: true })
    expect(own.consent.text).toBe('Our own words.')
    expect(consentTextFor(own.package)).toContain('test for malaria')
  })

  it('uses every station for one person, and sends only named sites and partners', () => {
    const draft = setStationMode(withFocuses(emptyDraft(''), ['general_check'], options), 'one_person', options)
    expect(draft.stations).toEqual(['register', 'vitals', 'tests', 'counselling', 'results'])
    const input = planInput({ ...draft, sites: [{ id: 's-1', name: ' Hall ', community: '', lga: '', address: '' }, { id: 's-2', name: ' ', community: 'x', lga: '', address: '' }],
      partners: [{ id: 'p-1', name: '', phone: '', address: '', treats: [] }] })
    expect(input.sites).toEqual([{ id: 's-1', name: 'Hall', community: '', lga: '', address: '' }])
    expect(input.partners).toEqual([])
  })
})
