import { isHidApiError, NO_RETRY } from '@hid/http'
import { outreachCampaignRequest, staffApi, type OutreachCaseInput } from '../../../staff/api'
import { errorText } from '../parts/errors'
import type {
  AnswersInput, CampaignDashboard, CampaignFollowUps, CampaignReport, CampaignTeam, CampaignTeamMember, ConsentCodeRequest,
  ConsentCodeSent, ConsentRecord, FollowUp, FollowUpInput, FollowUpUpdate, Outcome, OutcomeInput, OutreachPlan,
  OutreachPlanInput, OutreachVisit, ParticipantSearch, ParticipantSearchResult, Referral, ReferralInput, ReferralUpdate,
  SlipSmsRequest, SlipSmsSent, TeamInvite, TeamMemberChange, TestsInput, VitalsInput,
} from './campaignTypes'

/*
 * The calls of Outreach campaigns (owner decisions of 13 November 2026; BACKEND-NEEDS.md "Outreach campaigns (owner
 * decisions 13 Nov 2026)"). Every route is under /api/v1/outreach/registration-cases/ and is `proposed` in
 * packages/contracts (registry.ts): no hid-system release serves it yet, and each answers 404 until one does. A screen
 * treats that 404 as "not offered" (isNotOffered / whenOffered) and says so plainly, as Outreach's campaign management
 * does with its governance read.
 *
 * Registration stays on the served POST /api/v1/outreach/registration-cases (staffApi.createOutreachCase), unchanged;
 * createVisit only reads its answer as a visit (Health ID, patient id and visit code come back once Outreach sends them).
 *
 * Every POST carries an Idempotency-Key: the localCommandId the device made for it (newLocalCommandId), kept with the
 * command in the offline queue, so a resend after a lost answer or from the queue makes one record, never two. The
 * client never sends a write again on its own (NO_RETRY); the queue or the person does, with the same key. PUT and PATCH
 * carry If-Match with the version they were read at (412 VERSION_CONFLICT when it changed since).
 */

const BASE = '/api/v1/outreach/registration-cases'
const enc = encodeURIComponent
const campaignPath = (campaignId: string, rest: string) => `${BASE}/campaigns/${enc(campaignId)}/${rest}`
const casePath = (caseId: string, rest: string) => `${BASE}/${enc(caseId)}/${rest}`
const ifMatch = (rowVersion: number) => ({ 'If-Match': `"${rowVersion}"` })
const keyed = (localCommandId: string) => ({ 'Idempotency-Key': localCommandId })

/** A new command id, made on this device: the write's Idempotency-Key, and its key in the offline queue. */
export function newLocalCommandId(): string {
  return crypto.randomUUID()
}

function post<T>(facilityId: string, path: string, body: unknown, localCommandId: string): Promise<T> {
  return outreachCampaignRequest<T>(facilityId, { method: 'POST', path, body, headers: keyed(localCommandId), retry: NO_RETRY })
}
function patch<T>(facilityId: string, path: string, body: unknown, rowVersion: number, localCommandId?: string): Promise<T> {
  return outreachCampaignRequest<T>(facilityId, { method: 'PATCH', path, body,
    headers: { ...ifMatch(rowVersion), ...(localCommandId ? keyed(localCommandId) : {}) }, retry: NO_RETRY })
}
function get<T>(facilityId: string, path: string, signal?: AbortSignal, query?: Record<string, string>): Promise<T> {
  return outreachCampaignRequest<T>(facilityId, { method: 'GET', path, ...(signal ? { signal } : {}), ...(query ? { query } : {}) })
}

export const outreachCampaignApi = {
  // ------------------------------------------------------------------------------------------------------- plan --
  /** The campaign's plan. 404 OUTREACH_PLAN_NOT_FOUND when none was saved yet (the plan screen starts from templates). */
  plan: (facilityId: string, campaignId: string, signal?: AbortSignal) =>
    get<OutreachPlan>(facilityId, campaignPath(campaignId, 'plan'), signal),
  /** Saves the whole plan against the version it was read at (0 for the first save). Coordinators only. */
  savePlan: (facilityId: string, campaignId: string, plan: OutreachPlanInput, rowVersion: number) =>
    outreachCampaignRequest<OutreachPlan>(facilityId, { method: 'PUT', path: campaignPath(campaignId, 'plan'), body: plan,
      headers: ifMatch(rowVersion), retry: NO_RETRY }),

  // ------------------------------------------------------------------------------------------------------- team --
  team: (facilityId: string, campaignId: string, signal?: AbortSignal) =>
    get<CampaignTeam>(facilityId, campaignPath(campaignId, 'team'), signal),
  /** Invites by phone (SMS) or email. The same phone or email again answers the invitation already made. */
  inviteTeamMember: (facilityId: string, campaignId: string, invite: TeamInvite, localCommandId: string) =>
    post<CampaignTeamMember>(facilityId, campaignPath(campaignId, 'team'), invite, localCommandId),
  changeTeamMember: (facilityId: string, campaignId: string, member: Pick<CampaignTeamMember, 'memberId' | 'rowVersion'>, change: TeamMemberChange) =>
    patch<CampaignTeamMember>(facilityId, campaignPath(campaignId, `team/${enc(member.memberId)}`), change, member.rowVersion),
  /** Takes someone off the team (an invitation not yet accepted is withdrawn). What they captured stays, and counts. */
  removeTeamMember: (facilityId: string, campaignId: string, member: Pick<CampaignTeamMember, 'memberId' | 'rowVersion'>) =>
    outreachCampaignRequest<null>(facilityId, { method: 'DELETE', path: campaignPath(campaignId, `team/${enc(member.memberId)}`),
      headers: ifMatch(member.rowVersion), retry: NO_RETRY }),

  // -------------------------------------------------------------------------------------- registration, visits --
  /** Before registering: is this person known, by phone or Health ID? Minimal matches only, never a record. */
  searchParticipants: (facilityId: string, campaignId: string, search: ParticipantSearch, signal?: AbortSignal) =>
    get<ParticipantSearchResult>(facilityId, campaignPath(campaignId, 'participants/search'), signal,
      search.phone !== undefined ? { phone: search.phone } : { healthId: search.healthId }),
  /**
   * Registers a person (the served POST, request unchanged) and reads the answer as a visit. Outreach makes their
   * Health ID record at once (identity not yet checked) and gives the visit its code.
   */
  createVisit: (facilityId: string, input: OutreachCaseInput, command: { localCommandId: string; temporaryPatientId: string }) =>
    staffApi.createOutreachCase(facilityId, input, command) as Promise<OutreachVisit>,
  /** A station finds the visit by the code on the slip. 404 OUTREACH_VISIT_NOT_FOUND when no visit has it. */
  visitByCode: (facilityId: string, campaignId: string, visitCode: string, signal?: AbortSignal) =>
    get<OutreachVisit>(facilityId, campaignPath(campaignId, `visits/by-code/${enc(visitCode)}`), signal),

  // --------------------------------------------------------------------------------- station writes (queueable) --
  recordVitals: (facilityId: string, caseId: string, input: VitalsInput, localCommandId: string) =>
    post<OutreachVisit>(facilityId, casePath(caseId, 'vitals'), input, localCommandId),
  recordTests: (facilityId: string, caseId: string, input: TestsInput, localCommandId: string) =>
    post<OutreachVisit>(facilityId, casePath(caseId, 'tests'), input, localCommandId),
  recordAnswers: (facilityId: string, caseId: string, input: AnswersInput, localCommandId: string) =>
    post<OutreachVisit>(facilityId, casePath(caseId, 'answers'), input, localCommandId),
  /** Counsellors and clinicians only (403 OUTREACH_OUTCOME_ROLE_REQUIRED otherwise). */
  recordOutcome: (facilityId: string, caseId: string, input: OutcomeInput, localCommandId: string) =>
    post<Outcome>(facilityId, casePath(caseId, 'outcome'), input, localCommandId),
  makeReferral: (facilityId: string, caseId: string, input: ReferralInput, localCommandId: string) =>
    post<Referral>(facilityId, casePath(caseId, 'referral'), input, localCommandId),
  updateReferral: (facilityId: string, caseId: string, rowVersion: number, update: ReferralUpdate, localCommandId?: string) =>
    patch<Referral>(facilityId, casePath(caseId, 'referral'), update, rowVersion, localCommandId),
  scheduleFollowUp: (facilityId: string, caseId: string, input: FollowUpInput, localCommandId: string) =>
    post<FollowUp>(facilityId, casePath(caseId, 'follow-up'), input, localCommandId),
  updateFollowUp: (facilityId: string, caseId: string, rowVersion: number, update: FollowUpUpdate, localCommandId?: string) =>
    patch<FollowUp>(facilityId, casePath(caseId, 'follow-up'), update, rowVersion, localCommandId),

  // ------------------------------------------------------------------------------------------- consent, slips --
  /** Sends a consent code by SMS to the phone on the case. Online only: a code can't wait in a queue. */
  sendConsentCode: (facilityId: string, caseId: string, input: ConsentCodeRequest, localCommandId: string) =>
    post<ConsentCodeSent>(facilityId, casePath(caseId, 'consent-code'), input, localCommandId),
  /** The code the person read back. 400 OTP_INVALID, 410 OTP_EXPIRED, 429 OTP_ATTEMPTS_EXHAUSTED. */
  verifyConsentCode: (facilityId: string, caseId: string, input: { challengeId: string; code: string }, localCommandId: string) =>
    post<ConsentRecord>(facilityId, casePath(caseId, 'consent-code/verify'), input, localCommandId),
  /** Sends the visit code, or the results (never a sensitive result), by SMS to the phone on the case. */
  sendSlipSms: (facilityId: string, caseId: string, input: SlipSmsRequest, localCommandId: string) =>
    post<SlipSmsSent>(facilityId, casePath(caseId, 'slip-sms'), input, localCommandId),

  // ---------------------------------------------------------------------------------------- dashboard, after --
  dashboard: (facilityId: string, campaignId: string, signal?: AbortSignal) =>
    get<CampaignDashboard>(facilityId, campaignPath(campaignId, 'dashboard'), signal),
  followUps: (facilityId: string, campaignId: string, signal?: AbortSignal) =>
    get<CampaignFollowUps>(facilityId, campaignPath(campaignId, 'follow-ups'), signal),
  report: (facilityId: string, campaignId: string, signal?: AbortSignal) =>
    get<CampaignReport>(facilityId, campaignPath(campaignId, 'report'), signal),
}

// --------------------------------------------------------------------------------------------- station commands --

/**
 * A station's write, as the offline queue keeps it: what it is and what it sends. Updates (referral_update,
 * follow_up_update) carry the version they were read at.
 */
export type StationCommand =
  | { readonly kind: 'vitals'; readonly body: VitalsInput }
  | { readonly kind: 'tests'; readonly body: TestsInput }
  | { readonly kind: 'answers'; readonly body: AnswersInput }
  | { readonly kind: 'outcome'; readonly body: OutcomeInput }
  | { readonly kind: 'referral'; readonly body: ReferralInput }
  | { readonly kind: 'referral_update'; readonly body: ReferralUpdate; readonly rowVersion: number }
  | { readonly kind: 'follow_up'; readonly body: FollowUpInput }
  | { readonly kind: 'follow_up_update'; readonly body: FollowUpUpdate; readonly rowVersion: number }

export type StationCommandKind = StationCommand['kind']

/** What each command's answer is. */
export type StationCommandAnswer = OutreachVisit | Outcome | Referral | FollowUp

/** Sends one station command for a case, with its localCommandId as Idempotency-Key. */
export function sendStationCommand(facilityId: string, caseId: string, command: StationCommand, localCommandId: string): Promise<StationCommandAnswer> {
  const api = outreachCampaignApi
  switch (command.kind) {
    case 'vitals': return api.recordVitals(facilityId, caseId, command.body, localCommandId)
    case 'tests': return api.recordTests(facilityId, caseId, command.body, localCommandId)
    case 'answers': return api.recordAnswers(facilityId, caseId, command.body, localCommandId)
    case 'outcome': return api.recordOutcome(facilityId, caseId, command.body, localCommandId)
    case 'referral': return api.makeReferral(facilityId, caseId, command.body, localCommandId)
    case 'referral_update': return api.updateReferral(facilityId, caseId, command.rowVersion, command.body, localCommandId)
    case 'follow_up': return api.scheduleFollowUp(facilityId, caseId, command.body, localCommandId)
    case 'follow_up_update': return api.updateFollowUp(facilityId, caseId, command.rowVersion, command.body, localCommandId)
  }
}

/** What each station command is, in words (the queue's list). */
export const STATION_COMMAND_LABELS: Readonly<Record<StationCommandKind, string>> = {
  vitals: 'Vital signs', tests: 'Test results', answers: 'Answers to questions', outcome: 'Outcome',
  referral: 'Referral', referral_update: 'Referral update', follow_up: 'Follow-up', follow_up_update: 'Follow-up update',
}

// ------------------------------------------------------------------------------------------------- not offered --

/**
 * Whether a failure means this Outreach does not serve the route yet (404 from the gateway or a service without it),
 * so the screen says "not available yet". A 404 Outreach gives about a thing (OUTREACH_VISIT_NOT_FOUND and the like) is
 * an answer, not this.
 */
export function isNotOffered(error: unknown): boolean {
  return isHidApiError(error) && error.status === 404 && !error.code.startsWith('OUTREACH_')
}

export type Offered<T> = { readonly offered: true; readonly value: T } | { readonly offered: false }

/** Runs a call, answering { offered: false } when the route isn't served yet; any other failure is thrown. */
export async function whenOffered<T>(call: () => Promise<T>): Promise<Offered<T>> {
  try { return { offered: true, value: await call() } }
  catch (error) {
    if (isNotOffered(error)) return { offered: false }
    throw error
  }
}

export const NOT_OFFERED = 'This isn’t available on Health ID yet. Your work here is not affected.'

// ---------------------------------------------------------------------------------------------- refusals, words --

/** Outreach's refusals on campaign routes, in words that say what to do next. Never the code. */
const CAMPAIGN_FLOW_REFUSALS: Readonly<Record<string, string>> = {
  VERSION_CONFLICT: 'Someone changed this just now. It has been read again: check it, then try again.',
  OUTREACH_PLAN_NOT_FOUND: 'This campaign has no plan yet. Start one from the templates.',
  OUTREACH_PLAN_INVALID: 'Something in the plan isn’t complete. Check each step, then save again.',
  OUTREACH_COORDINATOR_REQUIRED: 'Only this campaign’s coordinators can do this. Ask one of them.',
  OUTREACH_CAMPAIGN_ADMIN_REQUIRED: 'Only this campaign’s coordinators can do this. Ask one of them.',
  OUTREACH_TEAM_MEMBER_EXISTS: 'This person is already on the team.',
  OUTREACH_TEAM_CONTACT_INVALID: 'Enter a phone number like 08012345678, or an email address.',
  OUTREACH_TEAM_LAST_COORDINATOR: 'A campaign needs at least one coordinator. Make someone else coordinator first.',
  OUTREACH_VISIT_NOT_FOUND: 'No visit has this code in this campaign. Check the code on their slip.',
  OUTREACH_CAMPAIGN_NOT_ACTIVE: 'This campaign isn’t open now. Ask a coordinator to open it.',
  OUTREACH_CAMPAIGN_CLOSED: 'This campaign is finished. Nothing more can be recorded in it.',
  OUTREACH_STATION_ROLE_REQUIRED: 'Your role in this campaign can’t record this. Ask a coordinator to add the role.',
  OUTREACH_OUTCOME_ROLE_REQUIRED: 'Only a counsellor or clinician can confirm the outcome.',
  OUTREACH_SENSITIVE_ROLE_REQUIRED: 'Only a counsellor or clinician can see or record this result.',
  OUTREACH_HIV_CONSENT_REQUIRED: 'The HIV test needs its own consent first: send a code to their phone, or record that it was witnessed.',
  OUTREACH_CONSENT_REQUIRED: 'Record their consent first.',
  OUTREACH_KIT_EXPIRED: 'This kit lot has expired. Use a lot that hasn’t.',
  OUTREACH_KIT_UNKNOWN: 'This kit lot isn’t in the campaign plan. Choose a lot from the list.',
  OUTREACH_TEST_NOT_IN_PACKAGE: 'This test isn’t part of this campaign’s screening.',
  OUTREACH_RETEST_NOT_ALLOWED: 'A test can be repeated only once, and only after an invalid result.',
  OUTREACH_PARTNER_UNKNOWN: 'Choose a referral partner from the campaign plan.',
  OUTREACH_PHONE_REQUIRED: 'This person has no phone number on their registration, so nothing can be sent to them.',
  OUTREACH_SMS_UNAVAILABLE: 'Text messages can’t be sent just now. Give them the printed slip instead.',
  OUTREACH_SEARCH_INVALID: 'Enter a phone number like 08012345678, or a Health ID starting with HID-.',
  OTP_INVALID: 'That code is not right. Ask them to read it again.',
  OTP_EXPIRED: 'That code has expired. Send a new one.',
  OTP_ATTEMPTS_EXHAUSTED: 'Too many wrong codes. Send a new code, or record consent as witnessed.',
}

/** A refusal on a campaign route in plain words, or `fallback` (through the shared errorText) for anything else. */
export function campaignFlowErrorText(error: unknown, fallback: string): string {
  if (isNotOffered(error)) return NOT_OFFERED
  if (isHidApiError(error) && Object.hasOwn(CAMPAIGN_FLOW_REFUSALS, error.code)) return CAMPAIGN_FLOW_REFUSALS[error.code]!
  return errorText(error, fallback)
}
