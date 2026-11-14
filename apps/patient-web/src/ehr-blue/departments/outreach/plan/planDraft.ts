import type { OutreachConsentLanguage } from '../../../../staff/api'
import type {
  CampaignSite, FocusId, KitStock, OutreachPlan, OutreachPlanInput, PlanFocus, QuestionDefinition, ReferralPartner, ScreeningPackage,
  StationKind, StationMode, TestDefinition, VitalDefinition,
} from '../campaignTypes'
import { focusIdOf, focusLabel, SCREENING_FOCUSES, STATIONS } from '../campaignTypes'
import { mergePackages, packageFor } from '../screeningTemplates'

/*
 * A campaign's plan as the plan screens edit it (owner decisions of 13 November 2026): plain rules with no React, so
 * the wizard, the Setup tab and tests share them. A draft is the plan's input (OutreachPlanInput); normalise() keeps it
 * consistent after every change: an HIV test brings its own consent and the counselling station, stations follow the
 * mode, and the consent text follows the focuses until the coordinator writes their own.
 */

export type PlanDraft = OutreachPlanInput

/** The languages a consent notice can be read in; English is always offered. */
export const CONSENT_LANGUAGES: ReadonlyArray<{ readonly value: OutreachConsentLanguage; readonly label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'yo', label: 'Yoruba' },
  { value: 'ha', label: 'Hausa' },
  { value: 'ig', label: 'Igbo' },
  { value: 'pcm', label: 'Pidgin' },
]

export const HIV_CONSENT_TEXT = 'The HIV test is your choice. A counsellor talks with you before the test and when you get the result. '
  + 'Your result goes into your own Health ID record, and only the counsellor and the clinician on this team see it. '
  + 'You can say no to the HIV test and still have every other check.'

/** A local id for a site, partner, kit or question made on this device (the server keeps it). */
export function localId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

/** Today in Nigerian time (YYYY-MM-DD): a consent notice's version. */
export function lagosToday(now = new Date()): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** Whether the package has a test that needs its own consent and counselling (HIV). */
export function needsSeparateConsent(pkg: ScreeningPackage): boolean {
  return pkg.tests.some(test => test.separateConsent || test.counselling)
}

/** What the team will do, in the words of a consent notice, from the package. */
function checksInWords(pkg: ScreeningPackage): string[] {
  const vitals = new Set(pkg.vitals.map(vital => vital.id))
  const tests = new Set(pkg.tests.map(test => test.id))
  const words: string[] = []
  if (vitals.has('bp_systolic') || vitals.has('bp_diastolic')) words.push('check your blood pressure')
  if (vitals.has('temperature')) words.push('take your temperature')
  if (vitals.has('weight') || vitals.has('height')) words.push('weigh and measure you')
  if (vitals.has('spo2')) words.push('check your oxygen level')
  if (vitals.has('blood_sugar')) words.push('check your blood sugar with a finger prick')
  if (tests.has('hbsag')) words.push('test for hepatitis B')
  if (tests.has('hiv_rapid')) words.push('offer an HIV test')
  if (tests.has('malaria_rdt')) words.push('test for malaria')
  if (tests.has('breast_exam')) words.push('examine your breasts')
  if (tests.has('via')) words.push('do a cervical check')
  if (tests.has('psa')) words.push('do a PSA blood test')
  if (tests.has('acuity_right') || tests.has('acuity_left') || tests.has('near_vision')) words.push('check your eyesight')
  for (const test of pkg.tests) if (!['hbsag', 'hiv_rapid', 'malaria_rdt', 'breast_exam', 'via', 'psa', 'acuity_right', 'acuity_left', 'near_vision'].includes(test.id)) {
    words.push(`do the ${test.name.toLowerCase()}`)
  }
  if (pkg.questions.length) words.push('ask you a few questions about your health')
  return words
}

function list(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** The campaign's consent notice in plain words, from what it checks. */
export function consentTextFor(pkg: ScreeningPackage): string {
  const checks = checksInWords(pkg)
  const sensitive = pkg.tests.filter(test => test.sensitive).map(test => (test.id === 'hiv_rapid' ? 'HIV' : test.id === 'hbsag' ? 'hepatitis B' : test.name))
  return [
    `We will record your name, age, sex, phone number and community${checks.length ? `, and ${list(checks)}` : ''}.`,
    'Everything goes into your own Health ID record. Only the screening team sees it'
      + (sensitive.length ? `, and only the counsellor and the clinician see your ${list(sensitive)} result${sensitive.length > 1 ? 's' : ''}.` : '.'),
    'You can say no to any check or test.',
  ].join(' ')
}

/** The stations a split campaign uses by default, for this package. */
export function defaultStations(pkg: ScreeningPackage): StationKind[] {
  return STATIONS.map(station => station.value).filter(station => station === 'register' || station === 'results'
    || (station === 'vitals' && pkg.vitals.length > 0) || (station === 'tests' && pkg.tests.length > 0)
    || (station === 'counselling' && needsSeparateConsent(pkg)))
}

/** A new plan with smart defaults: split into stations, English and Pidgin, a consent notice in plain words. */
export function emptyDraft(organisationName: string, focuses: readonly PlanFocus[] = []): PlanDraft {
  const pkg = packageFor(focuses)
  return normalise({
    organisationName, target: 200, focuses: [...focuses], sites: [], package: pkg, stationMode: 'split', stations: defaultStations(pkg),
    partners: [], consent: { text: consentTextFor(pkg), version: lagosToday(), hivText: null, hivVersion: null, languages: ['en', 'pcm'] }, kits: [],
  }, { consentEdited: false })
}

/** A saved plan as a draft (its input). */
export function draftFrom(plan: OutreachPlan): PlanDraft {
  const { campaignId: _campaignId, rowVersion: _rowVersion, updatedAt: _updatedAt, ...input } = plan
  return input
}

/** Questions the coordinator added (not from a template). */
export function isOwnQuestion(question: QuestionDefinition): boolean {
  return question.id.startsWith('own-')
}

/** Any vital, test or question the coordinator added (not from a template): its id starts `own-`. */
export const isOwnItem = (item: { readonly id: string }) => item.id.startsWith('own-')

/**
 * Keeps a draft consistent after a change: the HIV consent and the counselling station come with a test that needs
 * them (and go with it), stations follow the mode, and, while the coordinator hasn't written their own, the consent text
 * follows the package.
 */
export function normalise(draft: PlanDraft, options: { consentEdited: boolean }): PlanDraft {
  const pkg = draft.package
  const separate = needsSeparateConsent(pkg)
  const consent = {
    ...draft.consent,
    text: options.consentEdited ? draft.consent.text : consentTextFor(pkg),
    hivText: separate ? (draft.consent.hivText || HIV_CONSENT_TEXT) : null,
    hivVersion: separate ? (draft.consent.hivVersion || draft.consent.version || lagosToday()) : null,
    languages: draft.consent.languages?.includes('en') ? draft.consent.languages : (['en', ...(draft.consent.languages ?? [])] as OutreachConsentLanguage[]),
  }
  const all = STATIONS.map(station => station.value)
  let stations: StationKind[] = draft.stationMode === 'one_person' ? all : all.filter(station => draft.stations.includes(station))
  if (draft.stationMode === 'split') {
    if (!stations.includes('register')) stations = ['register', ...stations]
    if (separate && !stations.includes('counselling')) stations = all.filter(station => station === 'counselling' || stations.includes(station))
  }
  const testIds = new Set(pkg.tests.filter(test => test.usesKit).map(test => test.id))
  const siteIds = new Set(draft.sites.map(site => site.id))
  return { ...draft, consent, stations, kits: draft.kits.filter(kit => testIds.has(kit.testId) && siteIds.has(kit.siteId)) }
}

/**
 * The focuses changed: the package is the new focuses' template, keeping what the coordinator switched off (for items
 * the old template had too) and the questions they added.
 */
export function withFocuses(draft: PlanDraft, focuses: readonly PlanFocus[], options: { consentEdited: boolean }): PlanDraft {
  const before = packageFor(draft.focuses)
  const after = packageFor(focuses)
  const offBefore = (kind: 'vitals' | 'tests' | 'questions') => new Set(before[kind].map(item => item.id)
    .filter(id => !draft.package[kind].some(item => item.id === id)))
  const off = { vitals: offBefore('vitals'), tests: offBefore('tests'), questions: offBefore('questions') }
  // What the coordinator added stays, unless it was for a focus of their own that is gone now.
  const kept = new Set(focuses.map(focusIdOf))
  const stays = (item: { readonly id: string; readonly focus?: string }) => isOwnItem(item) && (!item.focus?.startsWith('custom:') || kept.has(item.focus as FocusId))
  const pkg = mergePackages([{
    vitals: [...after.vitals.filter(item => !off.vitals.has(item.id)), ...draft.package.vitals.filter(item => stays(item))],
    tests: [...after.tests.filter(item => !off.tests.has(item.id)), ...draft.package.tests.filter(stays)],
    questions: [...after.questions.filter(item => !off.questions.has(item.id)), ...draft.package.questions.filter(stays)],
  }])
  // The list's focuses in its order, then the organisation's own in the order they were added (each once).
  const custom = focuses.filter((focus, index) => typeof focus !== 'string' && focuses.findIndex(other => focusIdOf(other) === focus.id) === index)
  const ordered: PlanFocus[] = [...SCREENING_FOCUSES.map(item => item.value).filter(value => focuses.includes(value)), ...custom]
  const stations = draft.stationMode === 'split' && draft.focuses.length === 0 ? defaultStations(pkg) : draft.stations
  return normalise({ ...draft, focuses: ordered, package: pkg, stations }, options)
}

/** Everything the package could have for these focuses: the template and what the draft already has (own questions). */
export function packageChoices(draft: PlanDraft): ScreeningPackage {
  return mergePackages([packageFor(draft.focuses), draft.package])
}

/** Switches one vital, test or question on or off, keeping the template's order. */
export function toggleItem(draft: PlanDraft, kind: 'vitals' | 'tests' | 'questions', id: string, on: boolean, options: { consentEdited: boolean }): PlanDraft {
  const choices = packageChoices(draft)
  const keep = new Set(draft.package[kind].map(item => item.id))
  if (on) keep.add(id)
  else keep.delete(id)
  // BMI is worked out from weight and height: it goes with either of them.
  if (kind === 'vitals' && !(keep.has('weight') && keep.has('height'))) keep.delete('bmi')
  const pkg = { ...draft.package, [kind]: (choices[kind] as ReadonlyArray<{ id: string }>).filter(item => keep.has(item.id)) } as ScreeningPackage
  return normalise({ ...draft, package: pkg }, options)
}

export function addOwnQuestion(draft: PlanDraft, text: string, options: { consentEdited: boolean }): PlanDraft {
  const words = text.trim()
  const question: QuestionDefinition = { id: localId('own'), text: words.endsWith('?') ? words : `${words}?`, kind: 'yesno', focus: focusOfOwn(draft) }
  return normalise({ ...draft, package: { ...draft.package, questions: [...draft.package.questions, question] } }, options)
}

/** What an item the coordinator adds is for: their own type of outreach when there is one, else the first focus. */
function focusOfOwn(draft: PlanDraft) {
  const own = draft.focuses.find(focus => typeof focus !== 'string')
  return own ? focusIdOf(own) : draft.focuses[0] ? focusIdOf(draft.focuses[0]) : 'general_check'
}

/** The result options a test the coordinator adds starts with. */
export const OWN_TEST_RESULTS = 'Positive, Negative, Invalid'

/**
 * Adds a test of the coordinator's own ("Add a test"): its name, its results (typed, comma between; "Positive" and the
 * like flag it as abnormal, "Invalid" means test again), and whether its result is private (counsellors and clinicians
 * only). It is a quick check with no kit count.
 */
export function addOwnTest(draft: PlanDraft, input: { name: string; results: string; sensitive: boolean }, options: { consentEdited: boolean }): PlanDraft {
  const labels = [...new Set(input.results.split(',').map(word => word.trim()).filter(Boolean))]
  const results = (labels.length >= 2 ? labels : OWN_TEST_RESULTS.split(', ')).map(label => {
    const word = label.toLowerCase()
    const flag = /invalid|again/.test(word) ? 'invalid' as const : /^(positive|reactive|abnormal|yes|found|present|high)/.test(word) ? 'abnormal' as const : 'normal' as const
    return { value: word.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'result', label, flag }
  })
  const test: TestDefinition = { id: localId('own'), name: input.name.trim(), focus: focusOfOwn(draft), kind: 'choice', results, sensitive: input.sensitive, usesKit: false }
  return normalise({ ...draft, package: { ...draft.package, tests: [...draft.package.tests, test] } }, options)
}

/** Adds a measurement of the coordinator's own ("Add a measurement"): its name and unit, typed as a number. */
export function addOwnVital(draft: PlanDraft, input: { name: string; unit: string }, options: { consentEdited: boolean }): PlanDraft {
  const vital: VitalDefinition = { id: localId('own') as VitalDefinition['id'], name: input.name.trim(), unit: input.unit.trim(), min: 0, max: 100000, decimals: 1, normalText: '' }
  return normalise({ ...draft, package: { ...draft.package, vitals: [...draft.package.vitals, vital] } }, options)
}

/** Takes away a vital, test or question the coordinator added. */
export function removeOwnItem(draft: PlanDraft, kind: 'vitals' | 'tests' | 'questions', id: string, options: { consentEdited: boolean }): PlanDraft {
  const pkg = { ...draft.package, [kind]: (draft.package[kind] as ReadonlyArray<{ id: string }>).filter(item => item.id !== id) } as ScreeningPackage
  return normalise({ ...draft, package: pkg }, options)
}

export function removeOwnQuestion(draft: PlanDraft, id: string, options: { consentEdited: boolean }): PlanDraft {
  return normalise({ ...draft, package: { ...draft.package, questions: draft.package.questions.filter(item => item.id !== id) } }, options)
}

export function setStationMode(draft: PlanDraft, mode: StationMode, options: { consentEdited: boolean }): PlanDraft {
  return normalise({ ...draft, stationMode: mode, stations: mode === 'split' ? defaultStations(draft.package) : draft.stations }, options)
}

export const emptySite = (): CampaignSite => ({ id: localId('site'), name: '', community: '', lga: '', address: '' })
export const emptyPartner = (focuses: readonly PlanFocus[]): ReferralPartner => ({ id: localId('partner'), name: '', phone: '', address: '', treats: focuses.map(focusIdOf) })

/** The plan can be saved once it says what it is for and where (Outreach refuses it without a focus and a site). */
export function canSave(draft: PlanDraft): boolean {
  return draft.focuses.length > 0 && draft.sites.some(site => site.name.trim())
}

/** What a draft sends: sites and partners without a name are left out, text trimmed. */
export function planInput(draft: PlanDraft): OutreachPlanInput {
  const trim = (value: string | null | undefined) => (value ?? '').trim()
  return {
    ...draft,
    organisationName: trim(draft.organisationName),
    sites: draft.sites.filter(site => trim(site.name)).map(site => ({ ...site, name: trim(site.name), community: trim(site.community), lga: trim(site.lga), address: trim(site.address) })),
    partners: draft.partners.filter(partner => trim(partner.name)).map(partner => ({ ...partner, name: trim(partner.name), phone: trim(partner.phone), address: trim(partner.address) })),
    kits: draft.kits.filter(kit => trim(kit.lot) && kit.count > 0 && kit.expiresOn).map(kit => ({ ...kit, lot: trim(kit.lot) })),
  }
}

/** How many of a kit lot are left. */
export function kitLeft(kit: KitStock): number {
  return Math.max(0, kit.count - (kit.used ?? 0))
}

export function focusesText(focuses: readonly PlanFocus[]): string {
  const words = [...SCREENING_FOCUSES.filter(item => focuses.includes(item.value)).map(item => item.label),
    ...focuses.filter(focus => typeof focus !== 'string').map(focus => focusLabel(focus))]
  return words.length ? list(words) : 'Not chosen yet'
}

export function languagesText(languages: readonly OutreachConsentLanguage[] | undefined): string {
  return list(CONSENT_LANGUAGES.filter(item => item.value === 'en' || languages?.includes(item.value)).map(item => item.label))
}

/** "Lagos Island, Ajegunle" — what is known of a site's place. */
export function placeText(site: CampaignSite): string {
  return [site.community, site.lga].map(value => value.trim()).filter(Boolean).join(', ')
}

export { list as listInWords }
