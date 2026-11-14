/**
 * Health ID Outreach on Supabase (temporary, until the AWS backend serves Outreach).
 *
 * Answers the /api/v1 calls the Outreach screens make, in the page, from a Supabase project: the same request and
 * response shapes as the Health ID gateway (packages/contracts), so the screens are unchanged and move to AWS by
 * switching this file off. Sign-in is Supabase Auth (email and password; the first sign-in sets the password). What an
 * organisation records is rows in outreach_docs, readable only by the emails listed for it (schema.sql).
 *
 * Writes check each row's version, so two phones saving the same person at once never overwrite each other.
 */
import { createClient } from '@supabase/supabase-js'
import { flagVital } from '../apps/patient-web/src/ehr-blue/departments/outreach/screeningTemplates.ts'

const URL_ = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const configured = Boolean(URL_ && KEY)
const supabase = configured ? createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null

const MIN = 60_000
const DAY = 24 * 60 * MIN
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString()
const day = days => iso(days * DAY).slice(0, 10)
const problem = (status, code, detail) => [status, { type: 'about:blank', title: code, status, code, detail }]
const random = (alphabet, length) => Array.from(crypto.getRandomValues(new Uint32Array(length)), value => alphabet[value % alphabet.length]).join('')
const newId = prefix => `${prefix}-${Date.now().toString(36)}${random('abcdefghijklmnopqrstuvwxyz0123456789', 6)}`
const digits = phone => String(phone ?? '').replace(/\D/g, '').slice(-10)
const maskPhone = phone => phone ? `•••• ••• ${String(phone).replace(/\D/g, '').slice(-4)}` : null
const clone = value => JSON.parse(JSON.stringify(value))

const PERMISSIONS_ALL = ['outreach.registration.read', 'outreach.registration.write', 'outreach.campaign.read',
  'outreach.screening.write', 'outreach.sensitive.read']
const SENSITIVE_TESTS = new Set(['hbsag', 'hiv_rapid'])
const FOCUS_WORDS = { hepatitis_b: 'Hepatitis B', hiv: 'HIV', diabetes: 'Diabetes', hypertension: 'High blood pressure', breast_cancer: 'Breast cancer',
  cervical_cancer: 'Cervical cancer', prostate_cancer: 'Prostate cancer', malaria: 'Malaria', eye_health: 'Eye health', general_check: 'General health check' }
const FOCUS_VITALS = { hypertension: ['bp_systolic', 'bp_diastolic'], diabetes: ['blood_sugar'],
  general_check: ['bp_systolic', 'bp_diastolic', 'pulse', 'temperature', 'blood_sugar', 'spo2', 'bmi'] }

// ---------------------------------------------------------------- session --

let context = null // { user, email, org: { id, name }, mine: access row }

async function loadContext() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) { context = null; return null }
  const email = String(session.user.email ?? '').toLowerCase()
  if (context && context.user.id === session.user.id) return context
  const { data: rows, error } = await supabase.from('outreach_access').select('org_id, email, name, role').eq('email', email)
  if (error) throw error
  const mine = rows?.[0]
  if (!mine) { context = { user: session.user, email, org: null, mine: null }; return context }
  const { data: org } = await supabase.from('outreach_orgs').select('id, name').eq('id', mine.org_id).single()
  context = { user: session.user, email, org: org ?? { id: mine.org_id, name: 'Outreach' }, mine }
  cache = { at: 0, org: null, docs: new Map() }
  return context
}

function staffSession() {
  const { user, email, org, mine } = context
  const organiser = mine.role === 'organiser'
  const facility = {
    id: org.id, membershipId: user.id, organizationId: org.id, name: org.name, code: 'OUTREACH',
    roles: [organiser ? 'outreach_organiser' : 'outreach_volunteer'], isPrimary: true,
    permissions: organiser ? [...PERMISSIONS_ALL, 'outreach.campaign.write'] : PERMISSIONS_ALL,
  }
  return {
    actor: { kind: 'staff', id: user.id, email, displayName: mine.name || email, roles: facility.roles, permissions: [], facilities: [facility], facility },
    expiresAt: iso(7 * DAY), facilitySelection: 'selected',
  }
}

/**
 * Sign-in by email only (owner, 14 Nov 2026): being on a team is enough. Supabase still needs a password, so each
 * email's password is worked out from the email itself (the same way in reset-passwords.sql); nobody types one.
 * What protects the records is the team list: the database shows an organisation's records only to its listed emails.
 */
const PASSWORD_SALT = 'health-id-outreach-2026'
async function passwordFor(email) {
  const bytes = new TextEncoder().encode(`${email}:${PASSWORD_SALT}`)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function signIn(body) {
  const email = String(body?.email ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return problem(400, 'OUTREACH_SIGN_IN_EMAIL', 'Enter your email address.')
  const password = await passwordFor(email)
  let { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error && /email not confirmed/i.test(error.message)) {
    return problem(400, 'OUTREACH_SIGN_IN_UNCONFIRMED', 'This email is waiting for an email check. Your organiser can release it: run reset-passwords.sql in Supabase.')
  }
  if (error && /invalid login credentials/i.test(error.message)) {
    // The first sign-in makes the account (Supabase "Confirm email" is off).
    const made = await supabase.auth.signUp({ email, password })
    if (made.error) {
      if (/already registered|already exists/i.test(made.error.message)) {
        return problem(400, 'OUTREACH_SIGN_IN_OLD_PASSWORD', 'This email still has an old password. Your organiser can fix it: run reset-passwords.sql in Supabase, then sign in again.')
      }
      return problem(400, 'OUTREACH_SIGN_IN_REFUSED', `Supabase refused the new account: ${made.error.message}`)
    }
    if (!made.data.session) {
      return problem(400, 'OUTREACH_SIGN_IN_UNCONFIRMED', 'Supabase is still asking for an email check. Your organiser needs to turn off "Confirm email" in Supabase and run reset-passwords.sql.')
    }
    error = null
  }
  if (error) return problem(400, 'OUTREACH_SIGN_IN_REFUSED', `Supabase refused the sign-in: ${error.message}`)
  context = null
  await loadContext()
  if (!context?.org) {
    await supabase.auth.signOut()
    context = null
    return problem(403, 'OUTREACH_NOT_ON_A_TEAM', `${email} isn’t on an outreach team yet. Ask your coordinator to add this exact email under Team, then sign in again.`)
  }
  return [200, staffSession()]
}

// ---------------------------------------------------------------- records --

let cache = { at: 0, org: null, docs: new Map() }
const docKey = (kind, id) => `${kind}|${id}`

async function refresh(force = false) {
  if (!force && cache.org === context.org.id && Date.now() - cache.at < 2500) return
  const docs = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('outreach_docs').select('kind, id, campaign_id, data, version')
      .eq('org_id', context.org.id).order('id').range(from, from + 999)
    if (error) throw error
    for (const row of data) docs.set(docKey(row.kind, row.id), { ...row, data: { ...row.data } })
    if (data.length < 1000) break
  }
  cache = { at: Date.now(), org: context.org.id, docs }
}

const all = kind => [...cache.docs.values()].filter(row => row.kind === kind)
const campaigns = () => all('campaign').map(row => ({ ...row.data, rowVersion: row.version })).sort((a, b) => String(b.startsAt).localeCompare(String(a.startsAt)))
const campaignOf = id => campaigns().find(campaign => campaign.id === id)
const planOf = id => { const row = cache.docs.get(docKey('plan', id)); return row ? { ...row.data, rowVersion: row.version } : undefined }
const teamOf = id => cache.docs.get(docKey('team', id))?.data.members ?? []
const visits = () => all('visit').map(row => row.data).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
const visitOf = id => cache.docs.get(docKey('visit', id))?.data

class Conflict extends Error {}

async function insertDoc(kind, id, campaignId, data) {
  const { error } = await supabase.from('outreach_docs').insert({ org_id: context.org.id, kind, id, campaign_id: campaignId, data, version: 1 })
  if (error) throw error
  cache.docs.set(docKey(kind, id), { kind, id, campaign_id: campaignId, data, version: 1 })
}

/** Changes one row safely: reads it fresh, applies `change`, saves only if no one saved it meanwhile (else tries again). */
async function changeDoc(kind, id, change) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: row, error } = await supabase.from('outreach_docs').select('kind, id, campaign_id, data, version')
      .eq('org_id', context.org.id).eq('kind', kind).eq('id', id).maybeSingle()
    if (error) throw error
    if (!row) return { missing: true }
    const data = clone(row.data)
    const answer = change(data, row.version)
    if (answer?.unchanged) return answer
    const { data: saved, error: saveError } = await supabase.from('outreach_docs').update({ data, version: row.version + 1 })
      .eq('org_id', context.org.id).eq('kind', kind).eq('id', id).eq('version', row.version).select('version')
    if (saveError) throw saveError
    if (saved?.length) {
      cache.docs.set(docKey(kind, id), { ...row, data, version: row.version + 1 })
      return { ...answer, data, version: row.version + 1 }
    }
  }
  throw new Conflict()
}

// ----------------------------------------------------------------- people --

const you = campaignId => teamOf(campaignId).find(member => member.status !== 'removed' && member.email && member.email === context.email) ?? null
const organiser = () => context.mine.role === 'organiser'
function yourRoles(campaignId) {
  const own = you(campaignId)
  if (own) return own.roles
  return organiser() ? ['coordinator'] : []
}
const seesSensitive = campaignId => yourRoles(campaignId).some(role => role === 'counsellor' || role === 'clinician')
const isCoordinator = campaignId => yourRoles(campaignId).includes('coordinator')

/** A team member who signs in for the first time is marked as joined. */
async function markJoined(campaignId) {
  const own = you(campaignId)
  if (!own || own.status !== 'invited') return
  await changeDoc('team', campaignId, data => {
    const member = data.members.find(entry => entry.memberId === own.memberId)
    if (!member || member.status !== 'invited') return { unchanged: true }
    member.status = 'accepted'; member.joinedAt = iso(); member.rowVersion += 1
    return {}
  })
}

function visitFor(visit) {
  const campaignId = visit.campaignId
  const { applied: _applied, localCommandId: _command, ...shown } = visit
  if (seesSensitive(campaignId)) return { ...shown, sensitiveHidden: false }
  const hidden = visit.tests.some(test => SENSITIVE_TESTS.has(test.testId))
  const sensitiveOutcome = visit.outcome && /hepatitis b|hiv/i.test(visit.outcome.reason ?? '')
  return { ...shown, tests: visit.tests.filter(test => !SENSITIVE_TESTS.has(test.testId)),
    outcome: visit.outcome && sensitiveOutcome ? { ...visit.outcome, reason: 'Shared by a counsellor or clinician.' } : visit.outcome,
    referral: visit.referral && sensitiveOutcome ? { ...visit.referral, reason: 'Shared by a counsellor or clinician.' } : visit.referral,
    sensitiveHidden: hidden }
}

function newVisitCode(campaignId) {
  const used = new Set(visits().filter(visit => visit.campaignId === campaignId).map(visit => visit.visitCode))
  for (;;) {
    const chars = random('234679ACDEFGHJKMNPQRTWXY', 5)
    const code = `${chars.slice(0, 2)}-${chars.slice(2)}`
    if (!used.has(code)) return code
  }
}

// --------------------------------------------------------------- counting --

function finalTests(visit) {
  const latest = new Map()
  for (const test of visit.tests) if (!latest.has(test.testId) || (test.attempt ?? 1) >= (latest.get(test.testId).attempt ?? 1)) latest.set(test.testId, test)
  return [...latest.values()]
}
const focusId = item => (typeof item === 'string' ? item : item.id)
function focusCounts(plan, focus, list) {
  const testIds = new Set((plan?.package?.tests ?? []).filter(test => test.focus === focus).map(test => test.id))
  if (testIds.size) {
    const results = visit => finalTests(visit).filter(test => testIds.has(test.testId) && test.result !== 'invalid')
    const positive = visit => results(visit).some(test => test.flag === 'abnormal')
    return { screened: list.filter(visit => results(visit).length).length, positive: list.filter(positive).length,
      referred: list.filter(visit => visit.referral && positive(visit)).length }
  }
  const ids = FOCUS_VITALS[focus] ?? []
  const high = visit => visit.vitals.some(entry => ids.some(id => {
    const value = entry.readings?.[id]
    return typeof value === 'number' && String(flagVital(id, value).level).startsWith('refer')
  }))
  return { screened: list.filter(visit => visit.vitals.length).length, positive: ids.length ? list.filter(high).length : 0,
    referred: ids.length ? list.filter(visit => visit.referral && high(visit)).length : 0 }
}

function screenedBy(visit, memberId) {
  return visit.vitals.some(entry => entry.recordedBy === memberId) || visit.tests.some(entry => entry.recordedBy === memberId)
    || visit.outcome?.confirmedBy?.memberId === memberId
}

function campaignDashboard(campaignId) {
  const list = visits().filter(visit => visit.campaignId === campaignId)
  const plan = planOf(campaignId)
  const done = (visit, station) => visit.stationsDone.includes(station)
  const order = plan?.stations ?? ['register', 'vitals', 'tests', 'counselling', 'results']
  const waiting = Object.fromEntries(order.slice(1).map((station, index) => [station,
    list.filter(visit => done(visit, order[index]) && !done(visit, station) && !visit.outcome).length]))
  const kits = (plan?.kits ?? []).map(kit => {
    const used = list.reduce((sum, visit) => sum + visit.tests.filter(test => test.kitId === kit.id).length, 0)
    return { kitId: kit.id, siteId: kit.siteId, testId: kit.testId, lot: kit.lot, expiresOn: kit.expiresOn, count: kit.count, used, left: kit.count - used }
  })
  const hours = new Map()
  for (const visit of list) {
    const key = `${visit.siteId}|${visit.createdAt.slice(0, 13)}:00:00.000Z`
    hours.set(key, (hours.get(key) ?? 0) + 1)
  }
  const siteName = siteId => plan?.sites?.find(site => site.id === siteId)?.name ?? 'No site'
  const testName = testId => plan?.package?.tests?.find(test => test.id === testId)?.name ?? 'test'
  const alerts = []
  for (const kit of kits) {
    if (kit.count > 0 && kit.left < kit.count * 0.25) alerts.push({ kind: 'kit_low', message: `${kit.left} ${testName(kit.testId)} kits left in lot ${kit.lot} at ${siteName(kit.siteId)}.`, siteId: kit.siteId, count: kit.left })
    if (kit.expiresOn && Date.parse(kit.expiresOn) - Date.now() < 30 * DAY) alerts.push({ kind: 'kit_expiring', message: `Kit lot ${kit.lot} at ${siteName(kit.siteId)} expires on ${kit.expiresOn}.`, siteId: kit.siteId })
  }
  const STATION_WORDS = { vitals: 'vital signs', tests: 'tests', counselling: 'counselling', results: 'results' }
  for (const [station, count] of Object.entries(waiting)) if (count >= 5) alerts.push({ kind: 'queue_long', message: `${count} people are waiting for ${STATION_WORDS[station] ?? station}.`, count })
  const today = day(0)
  const invalid = list.reduce((sum, visit) => sum + visit.tests.filter(test => test.result === 'invalid' && String(test.takenAt ?? '').slice(0, 10) === today).length, 0)
  if (invalid) alerts.push({ kind: 'invalid_tests', message: `${invalid} invalid test result${invalid === 1 ? '' : 's'} today.`, count: invalid })
  const urgentWaiting = list.filter(visit => visit.referral?.urgency === 'urgent' && visit.referral.status === 'made').length
  if (urgentWaiting) alerts.push({ kind: 'urgent_referral', message: `${urgentWaiting} urgent referral${urgentWaiting === 1 ? '' : 's'} not yet seen.`, count: urgentWaiting })
  const overdue = list.filter(visit => visit.followUp?.status === 'due' && visit.followUp.dueOn < today).length
  if (overdue) alerts.push({ kind: 'follow_up_overdue', message: `${overdue} follow-up${overdue === 1 ? ' is' : 's are'} overdue.`, count: overdue })
  return {
    asOf: iso(), target: plan?.target ?? 0,
    registered: list.length, screened: list.filter(visit => visit.vitals.length || visit.tests.length).length,
    waiting,
    outcomes: {
      normal: list.filter(visit => visit.outcome?.kind === 'normal').length,
      followUp: list.filter(visit => visit.outcome?.kind === 'follow_up').length,
      referUrgent: list.filter(visit => visit.outcome?.kind === 'refer' && visit.outcome.urgency === 'urgent').length,
      referRoutine: list.filter(visit => visit.outcome?.kind === 'refer' && visit.outcome.urgency !== 'urgent').length,
      pending: list.filter(visit => !visit.outcome).length,
    },
    byFocus: (plan?.focuses ?? []).map(item => ({ focus: focusId(item), ...(typeof item === 'string' ? {} : { label: item.label }), ...focusCounts(plan, focusId(item), list) })),
    byMember: teamOf(campaignId).filter(member => member.status !== 'invited' && member.status !== 'removed').map(member => ({ memberId: member.memberId, name: member.name, roles: member.roles,
      registered: list.filter(visit => visit.registeredBy?.memberId === member.memberId).length,
      screened: list.filter(visit => screenedBy(visit, member.memberId)).length })),
    bySite: (plan?.sites ?? []).map(site => ({ siteId: site.id, name: site.name, registered: list.filter(visit => visit.siteId === site.id).length,
      screened: list.filter(visit => visit.siteId === site.id && (visit.vitals.length || visit.tests.length)).length })),
    byHour: [...hours.entries()].map(([key, registered]) => ({ siteId: key.split('|')[0], hour: key.split('|')[1], registered })).sort((a, b) => a.hour.localeCompare(b.hour)),
    kits, alerts,
  }
}

function organisationSummary() {
  const monthOf = time => new Date(time).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }).slice(0, 7)
  const month = monthOf(Date.now())
  const now = Date.now()
  const list = campaigns()
  const dashboards = list.filter(campaign => planOf(campaign.id)).map(campaign => ({ plan: planOf(campaign.id), dashboard: campaignDashboard(campaign.id) }))
  const people = visits().filter(visit => visit.campaignId)
  const byFocus = new Map()
  for (const { plan, dashboard } of dashboards) {
    for (const item of plan.focuses ?? []) {
      const focus = focusId(item)
      const row = byFocus.get(focus) ?? { focus, label: typeof item === 'string' ? FOCUS_WORDS[focus] ?? focus : item.label, campaigns: 0, screened: 0, positive: 0, referred: 0 }
      row.campaigns += 1
      const counts = dashboard.byFocus.find(entry => entry.focus === focus)
      if (counts) { row.screened += counts.screened; row.positive += counts.positive; row.referred += counts.referred }
      byFocus.set(focus, row)
    }
  }
  const rows = [...byFocus.values()]
  const sum = read => dashboards.reduce((total, { dashboard }) => total + read(dashboard), 0)
  return {
    campaigns: {
      total: list.length,
      running: list.filter(campaign => campaign.status === 'active' && Date.parse(campaign.startsAt) <= now && (!campaign.endsAt || Date.parse(campaign.endsAt) > now)).length,
      planned: list.filter(campaign => campaign.status === 'planned').length,
      closed: list.filter(campaign => campaign.status === 'closed').length,
    },
    people: { reached: new Set(people.map(visit => visit.patientId ?? visit.id)).size, thisMonth: people.filter(visit => monthOf(visit.createdAt) === month).length },
    screened: sum(dash => dash.screened),
    positive: sum(dash => dash.byFocus.reduce((total, row) => total + row.positive, 0)),
    referred: sum(dash => dash.outcomes.referUrgent + dash.outcomes.referRoutine),
    byFocus: rows,
    conditions: rows.filter(row => row.focus !== 'general_check' && row.screened > 0)
      .map(row => ({ condition: row.focus, label: row.label, screened: row.screened, positive: row.positive })),
  }
}

const memberWithCounts = (campaignId, member) => {
  const list = visits().filter(visit => visit.campaignId === campaignId)
  return { ...member, registered: list.filter(visit => visit.registeredBy?.memberId === member.memberId).length,
    screened: list.filter(visit => screenedBy(visit, member.memberId)).length }
}

// ----------------------------------------------------------------- routes --

const versionOf = headers => {
  const value = headers?.get?.('if-match')
  return value == null ? null : Number(String(value).replace(/^W\//, '').replace(/"/g, ''))
}
const idemKey = (headers, body) => headers?.get?.('idempotency-key') ?? body?.localCommandId ?? null
const BASE = '/outreach/registration-cases'

async function campaignRoutes(method, path, body, headers) {
  const list = `${BASE}/campaigns`
  if (method === 'GET' && path === list) return [200, campaigns()]
  if (method === 'GET' && path === `${list}/governance`) return [200, { rule: 'campaign_admins', organiserStatus: 'unverified' }]
  if (method === 'POST' && path === list) {
    if (!organiser()) return problem(403, 'OUTREACH_CAMPAIGN_ADMIN_REQUIRED', 'Only organisers can start a campaign')
    if (!body?.name || !body?.startsAt) return problem(400, 'VALIDATION_FAILED', 'Give the campaign a name and a start date')
    if (body.endsAt && Date.parse(body.endsAt) <= Date.parse(body.startsAt)) return problem(400, 'OUTREACH_CAMPAIGN_DATES_INVALID', 'An Outreach campaign must end after it starts')
    const id = newId('camp')
    const campaign = { id, name: String(body.name).trim(), status: 'planned', services: body.services ?? ['registration'], startsAt: body.startsAt, endsAt: body.endsAt ?? null }
    await insertDoc('campaign', id, id, campaign)
    await insertDoc('team', id, id, { members: [{ memberId: newId('tm'), name: context.mine.name || context.email, phone: null, email: context.email,
      roles: ['coordinator', 'clinician'], siteId: null, station: null, status: 'accepted', invitedAt: iso(), joinedAt: iso(), rowVersion: 1 }] })
    return [201, { ...campaign, rowVersion: 1 }]
  }
  const match = new RegExp(`^${list}/([^/]+)/(status|members|staff)$`).exec(path)
  if (!match) return null
  const campaignId = decodeURIComponent(match[1])
  const campaign = campaignOf(campaignId)
  if (!campaign) return problem(404, 'OUTREACH_CAMPAIGN_NOT_FOUND', 'The Outreach campaign was not found')
  // The campaign record's members: its team, coordinators as admins; "you" by the signed-in account.
  const membershipOf = member => (member.email && member.email === context.email ? context.user.id : member.memberId)
  const team = teamOf(campaignId).filter(member => member.status !== 'removed')
  if (match[2] === 'members' && method === 'GET') {
    const rows = team.map(member => ({ id: member.memberId, campaignId, membershipId: membershipOf(member),
      role: member.roles.includes('coordinator') ? 'admin' : 'enumerator', createdAt: member.invitedAt }))
    if (organiser() && !team.some(member => member.email === context.email)) rows.push({ id: `org-${context.user.id}`, campaignId, membershipId: context.user.id, role: 'admin', createdAt: iso() })
    return [200, rows]
  }
  if (match[2] === 'staff' && method === 'GET') {
    const roleOf = member => (member.roles.includes('coordinator') ? 'admin' : 'enumerator')
    const own = team.find(member => member.email === context.email)
    return [200, { yourRole: own ? roleOf(own) : organiser() ? 'admin' : null,
      people: team.map(member => ({ membershipId: membershipOf(member), name: member.name || member.email, campaignRole: roleOf(member) })) }]
  }
  if (match[2] === 'status' && method === 'POST') {
    if (!isCoordinator(campaignId)) return problem(403, 'OUTREACH_CAMPAIGN_ADMIN_REQUIRED', 'Only this Outreach campaign\'s coordinators can change it')
    const expected = versionOf(headers) ?? body?.expectedRowVersion ?? null
    if (expected != null && expected !== campaign.rowVersion) return problem(412, 'VERSION_CONFLICT', 'The Outreach campaign changed; reload before retrying')
    if (campaign.status === 'closed') return problem(409, 'OUTREACH_CAMPAIGN_CLOSED', 'A closed Outreach campaign cannot be reopened')
    const result = await changeDoc('campaign', campaignId, data => { data.status = body.status; return {} })
    return [200, { ...result.data, rowVersion: result.version }]
  }
  if (match[2] === 'members' && method === 'POST') return problem(409, 'OUTREACH_USE_TEAM', 'Add people from the campaign’s Team')
  return null
}

async function register(body, headers) {
  if (!body) return problem(400, 'VALIDATION_FAILED', 'Nothing was sent')
  const key = idemKey(headers, body)
  if (key) {
    await refresh(true)
    const earlier = visits().find(visit => visit.localCommandId === key)
    if (earlier) return [201, visitFor(earlier)]
  }
  const campaignId = body.campaignId ?? null
  if (campaignId && !campaignOf(campaignId)) return problem(404, 'OUTREACH_CAMPAIGN_NOT_FOUND', 'The Outreach campaign was not found')
  if (!String(body.fullName ?? '').trim()) return problem(400, 'VALIDATION_FAILED', 'Enter their name')
  const samePhone = body.phone && digits(body.phone).length === 10 ? visits().find(visit => digits(visit.phone) === digits(body.phone) && String(visit.fullName).toLowerCase() === String(body.fullName).trim().toLowerCase()) : undefined
  const own = campaignId ? you(campaignId) : null
  const id = newId('ov')
  const visit = {
    id, campaignId, status: 'identity_resolution_pending', createdAt: iso(),
    fullName: String(body.fullName).trim(), ageYears: body.ageYears ?? null, sex: body.sex ?? 'unknown',
    temporaryPatientId: body.temporaryPatientId ?? `tmp_${Date.now().toString(16)}`, phone: body.phone ?? null, operationalNotes: body.operationalNotes ?? null,
    community: body.community ?? null, rowVersion: 1, possibleDuplicate: Boolean(samePhone),
    // The same person seen before keeps their one Health ID record.
    healthId: samePhone?.healthId ?? `HID-${random('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8)}`, patientId: samePhone?.patientId ?? crypto.randomUUID(),
    visitCode: campaignId ? newVisitCode(campaignId) : null, identityChecked: false,
    siteId: body.siteId ?? own?.siteId ?? null, stationsDone: ['register'], registeredBy: own ? { memberId: own.memberId, name: own.name } : { memberId: null, name: context.mine.name || context.email },
    consent: body.consent ?? null, vitals: [], tests: [], answers: [], outcome: null, referral: null, followUp: null,
    localCommandId: key, applied: [],
  }
  await insertDoc('visit', id, campaignId, visit)
  return [201, visitFor(visit)]
}

async function campaignScreeningRoutes(method, path, body, headers) {
  const match = new RegExp(`^${BASE}/campaigns/([^/]+)/(plan|team|team/[^/]+|participants/search|visits/by-code/[^/]+|dashboard|follow-ups|report)$`).exec(path)
  if (!match) return null
  const campaignId = decodeURIComponent(match[1])
  const campaign = campaignOf(campaignId)
  if (!campaign) return problem(404, 'OUTREACH_CAMPAIGN_NOT_FOUND', 'The Outreach campaign was not found')
  const rest = match[2]
  if (rest === 'plan') {
    const plan = planOf(campaignId)
    if (method === 'GET') return plan ? [200, plan] : problem(404, 'OUTREACH_PLAN_NOT_FOUND', 'This campaign has no plan yet')
    if (method !== 'PUT') return null
    if (!isCoordinator(campaignId)) return problem(403, 'OUTREACH_COORDINATOR_REQUIRED', 'Only coordinators can change the plan')
    if (versionOf(headers) !== (plan?.rowVersion ?? 0)) return problem(412, 'VERSION_CONFLICT', 'The plan changed; reload before saving')
    if (!Array.isArray(body?.focuses) || !body.focuses.length || !Array.isArray(body?.sites) || !body.sites.length) {
      return problem(422, 'OUTREACH_PLAN_INVALID', 'A plan needs at least one focus and one site')
    }
    const { rowVersion: _version, ...rest_ } = body
    const saved = { ...rest_, campaignId, organisationName: body.organisationName ?? context.org.name, updatedAt: iso() }
    if (!plan) { await insertDoc('plan', campaignId, campaignId, saved); return [200, { ...saved, rowVersion: 1 }] }
    const result = await changeDoc('plan', campaignId, (data, version) => {
      if (version !== plan.rowVersion) throw new Conflict()
      Object.keys(data).forEach(field => delete data[field]); Object.assign(data, saved); return {}
    })
    return [200, { ...result.data, rowVersion: result.version }]
  }
  if (rest === 'team') {
    if (method === 'GET') {
      await markJoined(campaignId)
      const own = you(campaignId)
      return [200, { members: teamOf(campaignId).filter(member => member.status !== 'removed').map(member => memberWithCounts(campaignId, member)),
        you: own ? { memberId: own.memberId, roles: own.roles, siteId: own.siteId, station: own.station } : organiser() ? { memberId: null, roles: ['coordinator'], siteId: null, station: null } : null }]
    }
    if (method !== 'POST') return null
    if (!isCoordinator(campaignId)) return problem(403, 'OUTREACH_COORDINATOR_REQUIRED', 'Only coordinators can invite')
    const email = body?.email ? String(body.email).trim().toLowerCase() : null
    const phone = body?.phone ? String(body.phone).trim() : null
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return problem(400, 'OUTREACH_TEAM_CONTACT_INVALID', 'Give their email address: they sign in with it')
    if (!Array.isArray(body.roles) || !body.roles.length) return problem(400, 'VALIDATION_FAILED', 'Choose at least one role')
    // Their email opens this organisation's records to them once they sign in.
    const { error } = await supabase.from('outreach_access').insert({ org_id: context.org.id, email, name: body.name ?? null, role: 'volunteer' })
    if (error && error.code !== '23505') throw error
    let made = null
    const result = await changeDoc('team', campaignId, data => {
      const existing = data.members.find(member => member.status !== 'removed' && member.email === email)
      if (existing) { made = existing; return { unchanged: true } }
      made = { memberId: newId('tm'), name: body.name ?? null, phone, email, roles: body.roles, siteId: body.siteId ?? null, station: body.station ?? null,
        status: 'invited', invitedAt: iso(), joinedAt: null, rowVersion: 1 }
      data.members.push(made)
      return {}
    })
    if (result.missing) await insertDoc('team', campaignId, campaignId, { members: [made = { memberId: newId('tm'), name: body.name ?? null, phone, email, roles: body.roles,
      siteId: body.siteId ?? null, station: body.station ?? null, status: 'invited', invitedAt: iso(), joinedAt: null, rowVersion: 1 }] })
    return [result.unchanged ? 200 : 201, memberWithCounts(campaignId, made)]
  }
  if (rest.startsWith('team/')) {
    if (method !== 'PATCH' && method !== 'DELETE') return null
    if (!isCoordinator(campaignId)) return problem(403, 'OUTREACH_COORDINATOR_REQUIRED', 'Only coordinators can change the team')
    const memberId = decodeURIComponent(rest.slice(5))
    let answer = null
    await changeDoc('team', campaignId, data => {
      const member = data.members.find(entry => entry.memberId === memberId && entry.status !== 'removed')
      if (!member) { answer = problem(404, 'OUTREACH_TEAM_MEMBER_NOT_FOUND', 'That team member was not found'); return { unchanged: true } }
      if (versionOf(headers) !== member.rowVersion) { answer = problem(412, 'VERSION_CONFLICT', 'The team member changed; reload before retrying'); return { unchanged: true } }
      const coordinators = data.members.filter(entry => entry.status !== 'removed' && entry.roles.includes('coordinator'))
      if (member.roles.includes('coordinator') && coordinators.length === 1 && (method === 'DELETE' || (Array.isArray(body?.roles) && !body.roles.includes('coordinator')))) {
        answer = problem(409, 'OUTREACH_TEAM_LAST_COORDINATOR', 'A campaign needs a coordinator'); return { unchanged: true }
      }
      if (method === 'DELETE') { member.status = 'removed'; member.rowVersion += 1; answer = [204, null]; return {} }
      if (body?.roles !== undefined) member.roles = body.roles
      if (body?.siteId !== undefined) member.siteId = body.siteId
      if (body?.station !== undefined) member.station = body.station
      member.rowVersion += 1
      answer = [200, member]
      return {}
    })
    if (answer?.[0] === 200) answer = [200, memberWithCounts(campaignId, answer[1])]
    return answer
  }
  if (rest === 'participants/search') {
    if (method !== 'POST') return null
    await refresh(true)
    const phone = body?.phone ? String(body.phone) : null
    const healthId = body?.healthId ? String(body.healthId).trim().toUpperCase() : null
    if (!phone === !healthId) return problem(400, 'OUTREACH_SEARCH_INVALID', 'Search by a phone number or a Health ID')
    const found = visits().filter(visit => phone ? digits(phone).length === 10 && digits(visit.phone) === digits(phone) : visit.healthId === healthId)
    return [200, { matches: found.map(visit => ({ matchId: `match-${visit.patientId}-${visit.id}`, initials: visit.fullName.split(/\s+/).map(part => part[0]).join('').toUpperCase(),
      ageYears: visit.ageYears, sex: visit.sex, maskedPhone: maskPhone(visit.phone), hasHealthId: true, inThisCampaign: visit.campaignId === campaignId,
      caseId: visit.campaignId === campaignId ? visit.id : null, visitCode: visit.campaignId === campaignId ? visit.visitCode : null })) }]
  }
  if (method !== 'GET') return null
  if (rest.startsWith('visits/by-code/')) {
    await refresh(true)
    const code = decodeURIComponent(rest.slice('visits/by-code/'.length)).toUpperCase()
    const visit = visits().find(entry => entry.campaignId === campaignId && entry.visitCode === code)
    return visit ? [200, visitFor(visit)] : problem(404, 'OUTREACH_VISIT_NOT_FOUND', 'No visit has this code in this campaign')
  }
  if (rest === 'dashboard') return [200, campaignDashboard(campaignId)]
  if (rest === 'follow-ups') {
    const sensitive = seesSensitive(campaignId)
    const plan = planOf(campaignId)
    const items = visits().filter(visit => visit.campaignId === campaignId && visit.followUp).map(visit => {
      const private_ = /hepatitis b|hiv|liver/i.test(`${visit.followUp.reason ?? ''} ${visit.referral?.reason ?? ''}`)
      const hide = private_ && !sensitive
      return { caseId: visit.id, visitCode: visit.visitCode, fullName: visit.fullName, phone: visit.phone, siteId: visit.siteId,
        followUp: hide ? { ...visit.followUp, reason: 'Follow-up' } : visit.followUp,
        referral: visit.referral ? { ...visit.referral, reason: hide ? 'Shared by a counsellor or clinician.' : visit.referral.reason,
          partnerName: plan?.partners?.find(partner => partner.id === visit.referral.partnerId)?.name ?? null } : null,
        sensitive: private_ }
    }).sort((a, b) => String(a.followUp.dueOn).localeCompare(String(b.followUp.dueOn)))
    return [200, { items }]
  }
  if (rest === 'report') {
    const list = visits().filter(visit => visit.campaignId === campaignId)
    const dash = campaignDashboard(campaignId)
    const plan = planOf(campaignId)
    const band = age => age == null ? 'Unknown' : age < 18 ? 'Under 18' : age < 30 ? '18 to 29' : age < 45 ? '30 to 44' : age < 60 ? '45 to 59' : '60 and over'
    return [200, {
      campaignName: campaign.name, organisationName: plan?.organisationName ?? context.org.name, startsOn: String(campaign.startsAt).slice(0, 10), endsOn: campaign.endsAt ? String(campaign.endsAt).slice(0, 10) : null,
      sites: (plan?.sites ?? []).map(site => { const counts = dash.bySite.find(entry => entry.siteId === site.id); return { siteId: site.id, name: site.name, lga: site.lga ?? null, registered: counts?.registered ?? 0, screened: counts?.screened ?? 0 } }),
      target: dash.target, registered: dash.registered, screened: dash.screened,
      bySex: { female: list.filter(visit => visit.sex === 'female').length, male: list.filter(visit => visit.sex === 'male').length,
        other: list.filter(visit => visit.sex !== 'female' && visit.sex !== 'male').length },
      byAgeBand: ['Under 18', '18 to 29', '30 to 44', '45 to 59', '60 and over'].map(name => ({ band: name, count: list.filter(visit => band(visit.ageYears) === name).length })),
      byFocus: dash.byFocus, outcomes: dash.outcomes,
      referrals: { made: list.filter(visit => visit.referral).length, arrived: list.filter(visit => visit.referral?.status === 'arrived').length,
        notArrived: list.filter(visit => visit.referral?.status === 'not_arrived').length, waiting: list.filter(visit => visit.referral?.status === 'made').length },
      followUps: { due: list.filter(visit => visit.followUp?.status === 'due').length, reached: list.filter(visit => visit.followUp?.status === 'reached').length,
        notReached: list.filter(visit => visit.followUp?.status === 'not_reached').length, closed: list.filter(visit => visit.followUp?.status === 'closed').length },
      kitsUsed: dash.kits.reduce((sum, kit) => sum + kit.used, 0),
      invalidTests: list.reduce((sum, visit) => sum + visit.tests.filter(test => test.result === 'invalid').length, 0),
      smallCountThreshold: 5,
    }]
  }
  return null
}

async function caseRoutes(method, path, body, headers) {
  const match = new RegExp(`^${BASE}/([^/]+)/(vitals|tests|answers|outcome|referral|follow-up|consent-code|consent-code/verify|slip-sms|link-existing)$`).exec(path)
  if (!match || match[1] === 'campaigns') return null
  if (method !== 'POST' && method !== 'PATCH') return null
  const id = decodeURIComponent(match[1])
  const kind = match[2]
  if (!body && kind !== 'link-existing') return problem(400, 'VALIDATION_FAILED', 'Nothing was sent')
  // Codes by text message need an SMS service, which this temporary setup doesn't have: the screens offer the other ways.
  if (kind === 'consent-code' || kind === 'consent-code/verify' || kind === 'slip-sms' || kind === 'link-existing') return null
  const key = idemKey(headers, body)
  const appliedKey = key ? `${kind}|${key}` : null
  let answer = null
  const result = await changeDoc('visit', id, visit => {
    if (appliedKey && visit.applied?.includes(appliedKey)) {
      answer = [201, kind === 'outcome' ? visit.outcome : kind === 'referral' ? visit.referral : kind === 'follow-up' ? visit.followUp : visitFor(visit)]
      return { unchanged: true }
    }
    const campaignId = visit.campaignId
    const own = you(campaignId)
    const by = own?.memberId ?? null
    const plan = planOf(campaignId)
    const addStation = (...stations) => { for (const station of stations) if (!visit.stationsDone.includes(station)) visit.stationsDone.push(station) }
    const done = value => { visit.rowVersion += 1; if (appliedKey) visit.applied = [...(visit.applied ?? []), appliedKey].slice(-50); answer = value; return {} }
    if (method === 'POST' && kind === 'vitals') {
      visit.vitals.push({ entryId: `${visit.id}-v${visit.vitals.length + 1}`, ...body, localCommandId: undefined, recordedBy: by, takenAt: body.takenAt ?? iso() })
      addStation('vitals')
      return done([201, null])
    }
    if (method === 'POST' && kind === 'tests') {
      const results = Array.isArray(body.results) ? body.results : []
      if (results.some(entry => SENSITIVE_TESTS.has(entry.testId)) && !seesSensitive(campaignId) && !yourRoles(campaignId).includes('tester')) {
        answer = problem(403, 'OUTREACH_SENSITIVE_ROLE_REQUIRED', 'Only counsellors, clinicians and testers record this test'); return { unchanged: true }
      }
      if (results.some(entry => entry.testId === 'hiv_rapid') && !body.consent) { answer = problem(422, 'OUTREACH_HIV_CONSENT_REQUIRED', 'HIV testing needs its own consent'); return { unchanged: true } }
      for (const entry of results) {
        const kit = entry.kitLot ? plan?.kits?.find(item => item.lot === entry.kitLot && item.testId === entry.testId && (!visit.siteId || item.siteId === visit.siteId)) : null
        if (kit && kit.expiresOn && kit.expiresOn < day(0)) { answer = problem(422, 'OUTREACH_KIT_EXPIRED', 'That kit lot has expired'); return { unchanged: true } }
        const definition = plan?.package?.tests?.find(test => test.id === entry.testId)
        const option = definition?.results?.find(item => item.value === entry.result)
        const flag = option?.flag ?? (definition?.kind === 'number' && typeof entry.value === 'number' && definition.abnormalFrom != null && entry.value >= definition.abnormalFrom ? 'abnormal' : 'normal')
        visit.tests.push({ entryId: `${visit.id}-t${visit.tests.length + 1}`, ...entry, kitId: kit?.id ?? entry.kitId ?? null, flag, recordedBy: by, takenAt: entry.takenAt ?? iso() })
      }
      addStation('tests')
      return done([201, null])
    }
    if (method === 'POST' && kind === 'answers') {
      const answers = new Map(visit.answers.map(entry => [entry.questionId, entry]))
      for (const entry of body.answers ?? []) answers.set(entry.questionId, entry)
      visit.answers = [...answers.values()]
      return done([201, null])
    }
    if (method === 'POST' && kind === 'outcome') {
      if (!yourRoles(campaignId).some(role => role === 'counsellor' || role === 'clinician')) { answer = problem(403, 'OUTREACH_OUTCOME_ROLE_REQUIRED', 'Only a counsellor or clinician confirms the outcome'); return { unchanged: true } }
      if (body.kind === 'refer' && !body.urgency) { answer = problem(400, 'VALIDATION_FAILED', 'A referral needs its urgency'); return { unchanged: true } }
      const { localCommandId: _command, ...outcome } = body
      visit.outcome = { ...outcome, confirmedBy: { memberId: by, name: own?.name ?? context.mine.name ?? context.email, roles: yourRoles(campaignId) }, confirmedAt: iso() }
      addStation('counselling', 'results')
      return done([201, visit.outcome])
    }
    if (kind === 'referral') {
      if (method === 'POST') {
        if (!plan?.partners?.some(partner => partner.id === body.partnerId)) { answer = problem(422, 'OUTREACH_PARTNER_UNKNOWN', 'Choose a partner from the plan'); return { unchanged: true } }
        const { localCommandId: _command, ...referral } = body
        visit.referral = { referralId: `ref-${visit.id}`, ...referral, status: 'made', notes: null, madeAt: iso(), updatedAt: iso(), rowVersion: 1 }
        return done([201, visit.referral])
      }
      if (!visit.referral) { answer = problem(404, 'OUTREACH_REFERRAL_NOT_FOUND', 'This visit has no referral'); return { unchanged: true } }
      if (versionOf(headers) !== visit.referral.rowVersion) { answer = problem(412, 'VERSION_CONFLICT', 'The referral changed; reload before retrying'); return { unchanged: true } }
      visit.referral = { ...visit.referral, status: body.status ?? visit.referral.status, notes: body.notes ?? visit.referral.notes, updatedAt: iso(), rowVersion: visit.referral.rowVersion + 1 }
      return done([200, visit.referral])
    }
    if (kind === 'follow-up') {
      if (method === 'POST') {
        const { localCommandId: _command, ...followUp } = body
        visit.followUp = { followUpId: `fu-${visit.id}`, ...followUp, status: 'due', notes: null, attempts: 0, updatedAt: iso(), rowVersion: 1 }
        return done([201, visit.followUp])
      }
      if (!visit.followUp) { answer = problem(404, 'OUTREACH_FOLLOW_UP_NOT_FOUND', 'This visit has no follow-up'); return { unchanged: true } }
      if (versionOf(headers) !== visit.followUp.rowVersion) { answer = problem(412, 'VERSION_CONFLICT', 'The follow-up changed; reload before retrying'); return { unchanged: true } }
      const tried = body.status === 'reached' || body.status === 'not_reached'
      visit.followUp = { ...visit.followUp, status: body.status ?? visit.followUp.status, notes: body.notes ?? visit.followUp.notes, dueOn: body.dueOn ?? visit.followUp.dueOn,
        attempts: visit.followUp.attempts + (tried ? 1 : 0), updatedAt: iso(), rowVersion: visit.followUp.rowVersion + 1 }
      return done([200, visit.followUp])
    }
    answer = null
    return { unchanged: true }
  })
  if (result.missing) return problem(404, 'OUTREACH_VISIT_NOT_FOUND', 'The visit was not found')
  // The station writes answer with the visit as it now stands.
  if (answer && answer[1] === null && answer[0] === 201) answer = [201, visitFor(result.data ?? visitOf(id))]
  return answer
}

/** Answers one /api/v1 call (path without /api/v1), or null when this setup doesn't serve it (the screens then say so). */
export async function respond(method, path, { body, headers } = {}) {
  if (!configured) return problem(503, 'OUTREACH_NOT_CONFIGURED', 'This copy of Outreach isn’t connected to its database yet.')
  try {
    if (path === '/auth/login' && method === 'POST') return await signIn(body)
    if (path === '/auth/logout' && method === 'POST') { await supabase.auth.signOut(); context = null; return [204, null] }
    const ready = await loadContext()
    if (path === '/auth/session' || path === '/auth/refresh' || path === '/auth/facility') {
      if (!ready) return problem(401, 'UNAUTHENTICATED', 'Sign in')
      if (!ready.org) return problem(401, 'UNAUTHENTICATED', 'Your email isn’t on an outreach team yet.')
      return [200, staffSession()]
    }
    if (!ready?.org) return problem(401, 'UNAUTHENTICATED', 'Sign in')
    if (!path.startsWith('/outreach/')) return null
    if (method === 'GET') await refresh()
    else await refresh(true)
    if (method === 'GET' && path === BASE) return [200, visits().map(visitFor)]
    if (method === 'POST' && path === BASE) return await register(body, headers)
    if (method === 'GET' && path === `${BASE}/organisation/summary`) return [200, organisationSummary()]
    const one = method === 'GET' && new RegExp(`^${BASE}/(ov-[^/]+)$`).exec(path)
    if (one) { const visit = visitOf(decodeURIComponent(one[1])); return visit ? [200, visitFor(visit)] : problem(404, 'OUTREACH_VISIT_NOT_FOUND', 'The visit was not found') }
    return (await campaignRoutes(method, path, body, headers))
      ?? (await campaignScreeningRoutes(method, path, body, headers))
      ?? (await caseRoutes(method, path, body, headers))
  } catch (error) {
    if (error instanceof Conflict) return problem(409, 'VERSION_CONFLICT', 'Someone else saved this at the same time. Try again.')
    // A network failure: the screens keep the work on the phone and send it later.
    if (error instanceof TypeError || /fetch|network/i.test(String(error?.message))) throw error
    return problem(500, 'OUTREACH_STORE_ERROR', 'Something went wrong saving this. Try again.')
  }
}
