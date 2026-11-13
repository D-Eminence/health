import type { OutreachCase, OutreachConsentLanguage } from '../../../staff/api'

/*
 * Outreach campaigns as the owner decided them on 13 November 2026 (BACKEND-NEEDS.md, "Outreach campaigns (owner
 * decisions 13 Nov 2026)"): an organisation plans a medical outreach campaign for one or more focuses, invites its team,
 * registers people (each gets their own Health ID record at once, marked "identity not yet checked"), screens them at
 * one or several stations, decides an outcome, refers and follows up, and sees counts on a dashboard and a report.
 *
 * This module holds the plain types and small pure rules every screen shares. It imports nothing at run time, so the
 * templates, the offline queue and tests can use it without the staff client. The calls are in campaignApi.ts, the
 * default screening packages and the outcome suggestion in screeningTemplates.ts, the offline queue in offlineQueue.ts.
 *
 * Words: every label here is what a person reads on screen. No codes, no internal ids.
 */

// ------------------------------------------------------------------------------------------------ focuses, stations --

/** What a campaign screens for. A campaign has one or more. */
export type ScreeningFocus =
  | 'hepatitis_b' | 'hiv' | 'diabetes' | 'hypertension'
  | 'breast_cancer' | 'cervical_cancer' | 'prostate_cancer'
  | 'malaria' | 'eye_health' | 'general_check'

/** The focuses in the order the plan offers them, with their words. */
export const SCREENING_FOCUSES: ReadonlyArray<{ readonly value: ScreeningFocus; readonly label: string; readonly hint: string }> = [
  { value: 'hepatitis_b', label: 'Hepatitis B', hint: 'Rapid test for hepatitis B (HBsAg). A sensitive result.' },
  { value: 'hiv', label: 'HIV', hint: 'Rapid HIV test with its own consent and counselling. A sensitive result.' },
  { value: 'diabetes', label: 'Diabetes', hint: 'Blood sugar, weight, height and BMI.' },
  { value: 'hypertension', label: 'High blood pressure', hint: 'Blood pressure and pulse.' },
  { value: 'breast_cancer', label: 'Breast cancer', hint: 'Clinical breast exam.' },
  { value: 'cervical_cancer', label: 'Cervical cancer', hint: 'Visual inspection with acetic acid (VIA).' },
  { value: 'prostate_cancer', label: 'Prostate cancer', hint: 'Symptom questions, and a PSA test where available.' },
  { value: 'malaria', label: 'Malaria', hint: 'Malaria rapid test (mRDT) and temperature.' },
  { value: 'eye_health', label: 'Eye health', hint: 'Distance vision for each eye, and near vision.' },
  { value: 'general_check', label: 'General health check', hint: 'Blood pressure, pulse, temperature, weight, height, BMI and oxygen level.' },
]

/**
 * A type of outreach that is not on the list, typed by the coordinator ("Other" → "Sickle cell"): `custom:<slug>`, with
 * its words. It has no template: its tests, measurements and questions are the ones the coordinator adds.
 */
export type CustomFocusId = `custom:${string}`
export interface CustomFocus { readonly id: CustomFocusId; readonly label: string }
/** What a campaign is for, as its plan keeps it: one of the list, or one of the organisation's own. */
export type PlanFocus = ScreeningFocus | CustomFocus
/** A focus as counts and tests name it: one of the list, or `custom:<slug>`. */
export type FocusId = ScreeningFocus | CustomFocusId

export const isCustomFocusId = (focus: string): focus is CustomFocusId => focus.startsWith('custom:')
export const focusIdOf = (focus: PlanFocus): FocusId => (typeof focus === 'string' ? focus : focus.id)

/** A custom focus's slug in words when its label isn't given: "custom:sickle-cell" → "Sickle cell". */
function slugWords(focus: string): string {
  const words = focus.replace(/^custom:/, '').replace(/[-_]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other'
}

/** A focus in words: the list's own words, a custom focus's label (or its slug in words), else "Other". */
export function focusLabel(focus: string | PlanFocus, label?: string | null): string {
  if (typeof focus !== 'string') return focus.label
  const listed = SCREENING_FOCUSES.find(item => item.value === focus)
  if (listed) return listed.label
  if (isCustomFocusId(focus)) return label?.trim() || slugWords(focus)
  return 'Other'
}

/** Typed words as a slug: "Sickle Cell!" → "sickle-cell". */
const slugOf = (words: string) => words.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

/**
 * The focus a person typed under "Other": one of the list when the words name it (any case: "malaria", "HIV", "high
 * blood pressure", "hypertension"), else their own (`custom:<slug>`, the words as typed, first letter capital). Null
 * when nothing usable was typed.
 */
export function focusFromWords(typed: string): PlanFocus | null {
  const words = typed.trim().replace(/\s+/g, ' ')
  const slug = slugOf(words)
  if (!slug) return null
  const listed = SCREENING_FOCUSES.find(item => item.label.toLowerCase() === words.toLowerCase() || item.value === slug.replace(/-/g, '_')
    || item.value.replace(/_/g, ' ') === words.toLowerCase())
  if (listed) return listed.value
  return { id: `custom:${slug}`, label: words.charAt(0).toUpperCase() + words.slice(1) }
}

/** One person does everything for each visitor, or the work is split between stations. */
export type StationMode = 'one_person' | 'split'

/** The stations of a split campaign, in the order a visitor goes through them. */
export type StationKind = 'register' | 'vitals' | 'tests' | 'counselling' | 'results'

export const STATIONS: ReadonlyArray<{ readonly value: StationKind; readonly label: string; readonly hint: string }> = [
  { value: 'register', label: 'Registration', hint: 'Finds or registers the person and gives their visit code.' },
  { value: 'vitals', label: 'Vital signs', hint: 'Blood pressure, pulse, temperature, weight and height.' },
  { value: 'tests', label: 'Tests', hint: 'Rapid tests and examinations.' },
  { value: 'counselling', label: 'Counselling', hint: 'Talks the person through sensitive tests and results.' },
  { value: 'results', label: 'Results and next steps', hint: 'Confirms the outcome, refers, and books the follow-up.' },
]

/** Who works at each station (owner, 14 Nov 2026: a person is offered only the stations their roles do). */
const STATION_ROLES: Readonly<Record<StationKind, readonly TeamRole[]>> = {
  register: ['registrar'], vitals: ['vitals'], tests: ['tester'], counselling: ['counsellor'], results: ['counsellor', 'clinician'],
}

/** The stations these roles work at: every one for a coordinator, or where the roles aren't known. */
export function stationsFor(roles: readonly string[]): StationKind[] {
  if (!roles.length || roles.includes('coordinator')) return STATIONS.map(item => item.value)
  return STATIONS.filter(item => STATION_ROLES[item.value].some(role => roles.includes(role))).map(item => item.value)
}

export function stationLabel(station: string | null | undefined): string {
  return STATIONS.find(item => item.value === station)?.label ?? 'No station'
}

// --------------------------------------------------------------------------------------------------------- team --

/** A person's roles in a campaign. One person can have several. */
export type TeamRole = 'coordinator' | 'registrar' | 'vitals' | 'tester' | 'counsellor' | 'clinician' | 'data_checker'

export const TEAM_ROLES: ReadonlyArray<{ readonly value: TeamRole; readonly label: string; readonly hint: string }> = [
  { value: 'coordinator', label: 'Coordinator', hint: 'Plans the campaign, invites the team and sees every count.' },
  { value: 'registrar', label: 'Registrar', hint: 'Registers people and gives visit codes.' },
  { value: 'vitals', label: 'Vital signs', hint: 'Takes blood pressure, temperature, weight and height.' },
  { value: 'tester', label: 'Tester', hint: 'Does the rapid tests and examinations.' },
  { value: 'counsellor', label: 'Counsellor', hint: 'Counsels, gives sensitive results and confirms outcomes.' },
  { value: 'clinician', label: 'Clinician', hint: 'Confirms outcomes and referrals, and sees sensitive results.' },
  { value: 'data_checker', label: 'Data checker', hint: 'Checks records for mistakes. Sees counts, not sensitive results.' },
]

export function roleLabel(role: string): string {
  return TEAM_ROLES.find(item => item.value === role)?.label ?? 'Team member'
}

/** Only these roles see sensitive results (HIV, hepatitis B), besides the person themselves. */
export const SENSITIVE_RESULT_ROLES: ReadonlySet<TeamRole> = new Set(['counsellor', 'clinician'])
/** Only these roles confirm an outcome. */
export const OUTCOME_ROLES: ReadonlySet<TeamRole> = new Set(['counsellor', 'clinician'])

/** Whether someone with these roles may see sensitive results. The server decides too; this only hides what it would refuse. */
export function canSeeSensitive(roles: readonly string[]): boolean {
  return roles.some(role => SENSITIVE_RESULT_ROLES.has(role as TeamRole))
}
export function canConfirmOutcome(roles: readonly string[]): boolean {
  return roles.some(role => OUTCOME_ROLES.has(role as TeamRole))
}

/** Where an invitation stands. 'removed' is a member taken off the team; their counts stay. */
export type TeamMemberStatus = 'invited' | 'accepted' | 'declined' | 'expired' | 'removed'

export interface CampaignTeamMember {
  readonly memberId: string
  /** Their name once they accept; until then the name the coordinator typed, or null. */
  readonly name: string | null
  /** The phone or email they were invited by: at least one is set. The phone is masked to anyone but coordinators. */
  readonly phone: string | null
  readonly email: string | null
  readonly roles: readonly TeamRole[]
  readonly siteId: string | null
  readonly station: StationKind | null
  readonly status: TeamMemberStatus
  readonly invitedAt: string
  readonly joinedAt: string | null
  /** How many people they registered in this campaign. */
  readonly registered: number
  /** How many people they screened (any station after registration). */
  readonly screened: number
  readonly rowVersion: number
}

/** GET …/team: everyone on the team, and the caller's own place in it (null when the caller is not on it). */
export interface CampaignTeam {
  readonly members: readonly CampaignTeamMember[]
  readonly you: { readonly memberId: string; readonly roles: readonly TeamRole[]; readonly siteId: string | null; readonly station: StationKind | null } | null
}

/** POST …/team: invite by phone (SMS) or email; at least one role. */
export interface TeamInvite {
  readonly name?: string
  readonly phone?: string
  readonly email?: string
  readonly roles: readonly TeamRole[]
  readonly siteId?: string
  readonly station?: StationKind
}

/** PATCH …/team/:memberId: what changes; null clears the site or the station. */
export interface TeamMemberChange {
  readonly roles?: readonly TeamRole[]
  readonly siteId?: string | null
  readonly station?: StationKind | null
}

// --------------------------------------------------------------------------------------------------------- plan --

export interface CampaignSite {
  readonly id: string
  readonly name: string
  readonly community: string
  /** Local government area. */
  readonly lga: string
  readonly address: string
  /** Days at this site (YYYY-MM-DD), when it differs from the campaign's. */
  readonly startsOn?: string | null
  readonly endsOn?: string | null
  /** People this site aims to see; the plan's target is for the whole campaign. */
  readonly target?: number | null
}

/** The vital signs a package can take. BMI is worked out from weight and height, never typed. */
export type BuiltInVitalId = 'bp_systolic' | 'bp_diastolic' | 'pulse' | 'temperature' | 'weight' | 'height' | 'bmi' | 'spo2' | 'blood_sugar'
/** A measurement the coordinator added for their own type of outreach ("Add a measurement"): `own-…`. */
export type VitalId = BuiltInVitalId | `own-${string}`

export interface VitalDefinition {
  readonly id: VitalId
  readonly name: string
  readonly unit: string
  /** The range a typed value must be in (anything outside is a typing mistake, not a reading). */
  readonly min: number
  readonly max: number
  /** Decimal places a value is typed with. */
  readonly decimals: number
  /** The usual range, shown beside the field. */
  readonly normalText: string
  /** Worked out from other readings (BMI): shown, not typed. */
  readonly derived?: boolean
  /** A short help line (for example the mg/dL note on blood sugar). */
  readonly note?: string
}

/** How a result reads: fine, needs attention, needs attention today, or must be done again. */
export type ResultFlag = 'normal' | 'abnormal' | 'urgent' | 'invalid'

export interface TestResultOption {
  readonly value: string
  readonly label: string
  readonly flag: ResultFlag
}

/** Who a test or question is for. Absent means everyone. */
export interface AppliesTo {
  readonly sex?: 'female' | 'male'
  readonly minAge?: number
}

export interface TestDefinition {
  readonly id: string
  readonly name: string
  readonly focus: FocusId
  /** 'choice': pick one of `results`. 'number': type a value in `unit` (PSA). */
  readonly kind: 'choice' | 'number'
  readonly results: readonly TestResultOption[]
  readonly unit?: string
  /** For a number: at or above this is abnormal. */
  readonly abnormalFrom?: number
  /** Only counsellors, clinicians and the person see the result (HIV, hepatitis B). */
  readonly sensitive: boolean
  /** Uses a kit with a lot number, counted against the site's kits. Examinations use none. */
  readonly usesKit: boolean
  /** Needs its own consent, separate from registration (HIV). */
  readonly separateConsent?: boolean
  /** Needs counselling before and after (HIV). */
  readonly counselling?: boolean
  readonly appliesTo?: AppliesTo
  /** Shown under the test: how to do it or read it, in a line. */
  readonly note?: string
}

/** What a question's answer can lead to, before a person confirms the outcome. */
export type FindingLevel = 'normal' | 'follow_up' | 'refer_routine' | 'refer_urgent'

export interface QuestionDefinition {
  readonly id: string
  readonly text: string
  readonly kind: 'yesno' | 'choice'
  readonly options?: readonly string[]
  readonly focus: FocusId
  readonly appliesTo?: AppliesTo
  /** The answer that raises a finding ('yes', or one of `options`), with the finding and its plain reason. */
  readonly flagWhen?: string
  readonly flagLevel?: FindingLevel
  readonly flagReason?: string
}

export interface ScreeningPackage {
  readonly vitals: readonly VitalDefinition[]
  readonly tests: readonly TestDefinition[]
  readonly questions: readonly QuestionDefinition[]
}

export interface ReferralPartner {
  readonly id: string
  readonly name: string
  readonly phone: string
  readonly address: string
  /** What they treat: the focuses a referral to them is for. */
  readonly treats: readonly FocusId[]
  readonly notes?: string | null
}

/** The consent notices a campaign uses. HIV testing has its own, separate notice. */
export interface CampaignConsentTexts {
  readonly text: string
  readonly version: string
  readonly hivText?: string | null
  readonly hivVersion?: string | null
  /** The languages the notice is read in; English is always offered. */
  readonly languages?: readonly OutreachConsentLanguage[]
}

/** A site's stock of one test kit lot. */
export interface KitStock {
  readonly id: string
  readonly siteId: string
  readonly testId: string
  readonly lot: string
  /** YYYY-MM-DD. */
  readonly expiresOn: string
  /** How many tests the lot had at the start. */
  readonly count: number
  /** Answers only: how many were used (invalid ones included). */
  readonly used?: number
}

/** A campaign's plan (GET/PUT …/campaigns/:campaignId/plan). PUT takes the same fields without rowVersion. */
export interface OutreachPlan {
  readonly campaignId: string
  readonly organisationName: string
  /** People the campaign aims to see. */
  readonly target: number
  /** The types of outreach: the list's (`hepatitis_b`) and the organisation's own (`{ id: 'custom:malaria-in-pregnancy', label }`). */
  readonly focuses: readonly PlanFocus[]
  readonly sites: readonly CampaignSite[]
  readonly package: ScreeningPackage
  readonly stationMode: StationMode
  /** The stations a split campaign uses, in order; one_person uses all of them on one device. */
  readonly stations: readonly StationKind[]
  readonly partners: readonly ReferralPartner[]
  readonly consent: CampaignConsentTexts
  readonly kits: readonly KitStock[]
  readonly rowVersion: number
  readonly updatedAt?: string | null
}

export type OutreachPlanInput = Omit<OutreachPlan, 'campaignId' | 'rowVersion' | 'updatedAt'>

// ------------------------------------------------------------------------------------------ participants, visits --

/**
 * One match from the search before registration (by phone or Health ID). Never a record: initials, age, sex and a
 * masked phone, enough for the person to say "that's me". When they are already registered in this campaign, the
 * visit's id and code come too, so the station goes on with that visit instead of registering them again.
 */
export interface ParticipantMatch {
  readonly matchId: string
  readonly initials: string
  readonly ageYears: number | null
  readonly sex: string | null
  /** For example "•••• ••• 4567". */
  readonly maskedPhone: string | null
  /** Whether they have a Health ID already (never the Health ID itself, unless the search was by it). */
  readonly hasHealthId: boolean
  readonly inThisCampaign: boolean
  readonly caseId: string | null
  readonly visitCode: string | null
}

export interface ParticipantSearchResult {
  readonly matches: readonly ParticipantMatch[]
}

export type ParticipantSearch = { readonly phone: string; readonly healthId?: never } | { readonly healthId: string; readonly phone?: never }

/** One set of vital signs as sent: the readings typed (BMI is worked out by the server too). */
export interface VitalsInput {
  readonly siteId?: string | null
  readonly readings: Partial<Record<VitalId, number>>
  /** Blood sugar taken fasting (nothing eaten for 8 hours); random otherwise. */
  readonly fasting?: boolean
  readonly takenAt: string
}

export interface VitalsEntry extends VitalsInput {
  readonly entryId: string
  readonly recordedBy: string | null
}

/** One test result as sent. A retest after an invalid result is a second entry with attempt 2. */
export interface TestResultInput {
  readonly testId: string
  /** The option picked, for a 'choice' test. */
  readonly result?: string
  /** The value typed, for a 'number' test (PSA). */
  readonly value?: number
  readonly kitId?: string | null
  readonly kitLot?: string | null
  readonly attempt: 1 | 2
  readonly takenAt: string
}

/**
 * Consent given for a test that needs its own (HIV). By code: the person read back the code sent to their phone
 * (…/consent-code/verify answers its id). Witnessed: a team member watched them agree.
 */
export type ScreeningConsentInput =
  | { readonly method: 'code'; readonly consentId: string }
  | { readonly method: 'witnessed'; readonly witnessName: string; readonly language: OutreachConsentLanguage; readonly version: string; readonly guardianName?: string }

export interface TestsInput {
  readonly siteId?: string | null
  readonly results: readonly TestResultInput[]
  /** Required with a test that needs separate consent (HIV); the server refuses the test without it. */
  readonly consent?: ScreeningConsentInput
}

export interface TestResultEntry extends TestResultInput {
  readonly entryId: string
  readonly flag: ResultFlag
  readonly recordedBy: string | null
}

export type AnswerValue = 'yes' | 'no' | string

export interface AnswersInput {
  readonly answers: ReadonlyArray<{ readonly questionId: string; readonly value: AnswerValue }>
}

export type OutcomeKind = 'normal' | 'follow_up' | 'refer'
export type Urgency = 'urgent' | 'routine'

/** The outcome as sent: what the counsellor or clinician confirmed, and what was suggested. */
export interface OutcomeInput {
  readonly kind: OutcomeKind
  /** Required for 'refer'. */
  readonly urgency?: Urgency
  /** In plain words; the suggestion's reasons unless the person changed them. */
  readonly reason: string
  readonly suggestedKind?: OutcomeKind
  readonly suggestedUrgency?: Urgency
}

export interface Outcome extends OutcomeInput {
  readonly confirmedBy: { readonly memberId: string; readonly name: string | null; readonly roles: readonly TeamRole[] }
  readonly confirmedAt: string
}

export type ReferralStatus = 'made' | 'arrived' | 'not_arrived' | 'closed'

export interface ReferralInput {
  readonly partnerId: string
  readonly urgency: Urgency
  readonly reason: string
}

export interface Referral extends ReferralInput {
  readonly referralId: string
  readonly status: ReferralStatus
  readonly notes: string | null
  readonly madeAt: string
  readonly updatedAt: string
  readonly rowVersion: number
}

export interface ReferralUpdate {
  readonly status: ReferralStatus
  readonly notes?: string
}

export type FollowUpStatus = 'due' | 'reached' | 'not_reached' | 'closed'

export interface FollowUpInput {
  /** YYYY-MM-DD. */
  readonly dueOn: string
  readonly reason: string
}

export interface FollowUp extends FollowUpInput {
  readonly followUpId: string
  readonly status: FollowUpStatus
  readonly notes: string | null
  /** How many times someone tried to reach them. */
  readonly attempts: number
  readonly updatedAt: string
  readonly rowVersion: number
}

export interface FollowUpUpdate {
  readonly status: FollowUpStatus
  readonly notes?: string
  /** Moves the follow-up to another day (YYYY-MM-DD). */
  readonly dueOn?: string
}

/**
 * A person's visit in a campaign: today's registration case (OutreachCase, unchanged) with what the campaign adds. Every
 * person registered gets their own Health ID record at once (owner decision of 13 November 2026), so `healthId` and
 * `patientId` come back on the registration's answer; `identityChecked` is false until someone checks their identity
 * (a NIN, later). Each station's work comes back on the visit; sensitive results only to those allowed to see them
 * (`sensitiveHidden` says some were left out).
 */
export interface OutreachVisit extends OutreachCase {
  readonly healthId?: string | null
  readonly patientId?: string | null
  readonly visitCode?: string | null
  readonly identityChecked?: boolean
  readonly siteId?: string | null
  readonly stationsDone?: readonly StationKind[]
  readonly registeredBy?: { readonly memberId: string; readonly name: string | null } | null
  readonly vitals?: readonly VitalsEntry[]
  readonly tests?: readonly TestResultEntry[]
  readonly answers?: AnswersInput['answers']
  readonly outcome?: Outcome | null
  readonly referral?: Referral | null
  readonly followUp?: FollowUp | null
  readonly sensitiveHidden?: boolean
}

/** POST …/consent-code: what the code is for. The code goes by SMS to the person's phone on the case. */
export interface ConsentCodeRequest {
  readonly purpose: 'registration' | 'hiv'
  readonly language: OutreachConsentLanguage
  readonly version: string
  readonly guardianName?: string
}

export interface ConsentCodeSent {
  readonly challengeId: string
  readonly sentTo: string
  readonly expiresAt: string
  readonly resendAfterSeconds: number
}

/** What is stored for a consent: who, when, how, in which language, to which notice. */
export interface ConsentRecord {
  readonly consentId: string
  readonly purpose: 'registration' | 'hiv'
  readonly method: 'code' | 'witnessed'
  readonly language: OutreachConsentLanguage
  readonly version: string
  readonly recordedBy: string | null
  readonly witnessName: string | null
  readonly guardianName: string | null
  readonly recordedAt: string
}

export interface SlipSmsRequest {
  /** 'visit_code' after registration; 'results' at the end, never with a sensitive result in it. */
  readonly kind: 'visit_code' | 'results'
  readonly language?: OutreachConsentLanguage
}

export interface SlipSmsSent {
  readonly sentTo: string
  readonly deliveryOutcome: 'accepted' | 'definitive_failure' | 'unknown'
}

// --------------------------------------------------------------------------------------------- dashboard, report --

export interface CampaignAlert {
  readonly kind: 'kit_low' | 'kit_expiring' | 'urgent_referral' | 'invalid_tests' | 'queue_long' | 'follow_up_overdue'
  readonly message: string
  readonly siteId?: string | null
  readonly count?: number
}

/** GET …/dashboard: counts only, worked out by the server from the visits. Sensitive positives are counts, never people. */
export interface CampaignDashboard {
  readonly asOf: string
  readonly target: number
  readonly registered: number
  readonly screened: number
  /** Visits waiting at each station now (registered, not yet done there). */
  readonly waiting: Readonly<Partial<Record<StationKind, number>>>
  readonly outcomes: { readonly normal: number; readonly followUp: number; readonly referUrgent: number; readonly referRoutine: number; readonly pending: number }
  /** Per focus; a custom focus carries its words in `label`. */
  readonly byFocus: ReadonlyArray<{ readonly focus: FocusId; readonly label?: string | null; readonly screened: number; readonly positive: number; readonly referred: number }>
  readonly byMember: ReadonlyArray<{ readonly memberId: string; readonly name: string | null; readonly roles: readonly TeamRole[]; readonly registered: number; readonly screened: number }>
  readonly bySite: ReadonlyArray<{ readonly siteId: string; readonly name: string; readonly registered: number; readonly screened: number }>
  /** Registrations per site per hour; `hour` is the hour's start (ISO). */
  readonly byHour: ReadonlyArray<{ readonly siteId: string; readonly hour: string; readonly registered: number }>
  readonly kits: ReadonlyArray<{ readonly kitId: string; readonly siteId: string; readonly testId: string; readonly lot: string; readonly expiresOn: string; readonly count: number; readonly used: number; readonly left: number }>
  readonly alerts: readonly CampaignAlert[]
}

/**
 * GET …/organisation/summary: the organisation's numbers across every campaign it has run, for its owner (counts only,
 * never a person). Positives of sensitive focuses (HIV, hepatitis B) are counts, as on a campaign's dashboard.
 */
export interface OrganisationSummary {
  readonly campaigns: { readonly total: number; readonly running: number; readonly planned: number; readonly closed: number }
  /** People registered in any campaign (each person once); `thisMonth` since the 1st, Lagos time. */
  readonly people: { readonly reached: number; readonly thisMonth: number }
  readonly screened: number
  readonly positive: number
  readonly referred: number
  /** Per type of outreach, custom ones included (their words in `label`). */
  readonly byFocus: ReadonlyArray<{ readonly focus: FocusId; readonly label: string; readonly campaigns: number; readonly screened: number; readonly positive: number; readonly referred: number }>
  /** Per condition looked for: how many were checked for it and how many were found to have it. */
  readonly conditions: ReadonlyArray<{ readonly condition: string; readonly label: string; readonly screened: number; readonly positive: number }>
}

/** One row of GET …/follow-ups: who to call, when, and why (a sensitive reason is said only to those allowed). */
export interface CampaignFollowUpRow {
  readonly caseId: string
  readonly visitCode: string | null
  readonly fullName: string | null
  readonly phone: string | null
  readonly siteId: string | null
  readonly followUp: FollowUp
  readonly referral: (Referral & { readonly partnerName: string | null }) | null
  readonly sensitive: boolean
}

export interface CampaignFollowUps {
  readonly items: readonly CampaignFollowUpRow[]
}

/** GET …/report: counts only, nothing about any one person, for the organisation and its funders. */
export interface CampaignReport {
  readonly campaignName: string
  readonly organisationName: string
  readonly startsOn: string
  readonly endsOn: string | null
  readonly sites: ReadonlyArray<{ readonly siteId: string; readonly name: string; readonly lga: string; readonly registered: number; readonly screened: number }>
  readonly target: number
  readonly registered: number
  readonly screened: number
  readonly bySex: { readonly female: number; readonly male: number; readonly other: number }
  readonly byAgeBand: ReadonlyArray<{ readonly band: string; readonly count: number }>
  readonly byFocus: CampaignDashboard['byFocus']
  readonly outcomes: CampaignDashboard['outcomes']
  readonly referrals: { readonly made: number; readonly arrived: number; readonly notArrived: number; readonly waiting: number }
  readonly followUps: { readonly due: number; readonly reached: number; readonly notReached: number; readonly closed: number }
  readonly kitsUsed: number
  readonly invalidTests: number
  /** Counts under this are shown as "fewer than N", so no small group can be picked out. */
  readonly smallCountThreshold: number
}

// ------------------------------------------------------------------------------------------------- visit codes --

/**
 * Visit codes (BACKEND-NEEDS.md): two characters, a dash, three characters, like K7-4F2. Made by Outreach, unique in the
 * campaign, random, and carrying nothing about the person. Characters that are easily mixed up (0/O, 1/I/L, U/V, 5/S,
 * Z, 8/B) are never used, so a code read aloud or typed from a slip finds the right person.
 */
export const VISIT_CODE_ALPHABET = '234679ACDEFGHJKMNPQRTWXY'
const VISIT_CODE = new RegExp(`^[${VISIT_CODE_ALPHABET}]{2}-[${VISIT_CODE_ALPHABET}]{3}$`)

/** A typed code as Outreach takes it: capitals, no spaces, the dash put in ("k74f2" → "K7-4F2"). Null when it can't be one. */
export function normaliseVisitCode(typed: string): string | null {
  const bare = typed.toUpperCase().replace(/[\s-]/g, '')
  if (bare.length !== 5) return null
  const code = `${bare.slice(0, 2)}-${bare.slice(2)}`
  return VISIT_CODE.test(code) ? code : null
}

export function isVisitCode(value: string): boolean {
  return VISIT_CODE.test(value)
}

export const VISIT_CODE_HINT = 'Five letters and numbers on their slip, like K7-4F2.'
export const VISIT_CODE_FORMAT = 'Check the code: five letters and numbers, like K7-4F2.'
