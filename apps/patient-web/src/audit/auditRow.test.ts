import { describe, expect, it } from 'vitest'
import { AUDIT_ACTION_LABELS, LEGACY_ACTION_LABELS } from './actionLabels'
import { auditRow, matchesAuditSearch } from './auditRow'

/**
 * One audit event as one plain sentence (docs/AUDIT_ACTION_LABELS.md, owner rule of 1 Nov 2026): what was done, by
 * whom, and Allowed, Refused or Failed. The action code is never part of what is shown; it can still be searched for.
 * Every event here is fictional.
 */
type Event = Parameters<typeof auditRow>[0]
const event = (action: string, overrides: Partial<Event> = {}): Event =>
  ({ action, outcome: 'success', actorType: 'staff', resourceType: null, ...overrides })
const what = (action: string, overrides: Partial<Event> = {}) => auditRow(event(action, overrides))?.what

describe('an audit event in words', () => {
  it('says what was done with the spec’s label, who did it, and that it was allowed', () => {
    expect(auditRow(event('identity.patient.lookup'))).toEqual({
      what: 'Looked up a patient by Health ID', who: 'Staff member', outcome: 'success', outcomeText: 'Allowed' })
    expect(auditRow(event('auth.facility.select'))?.what).toBe('Switched to this facility')
  })

  it('says a refused or failed attempt as what was tried, with Refused or Failed', () => {
    expect(auditRow(event('identity.patient.lookup', { outcome: 'denied' }))).toEqual({
      what: 'Tried to look up a patient by Health ID', who: 'Staff member', outcome: 'denied', outcomeText: 'Refused' })
    expect(auditRow(event('ehr.encounter.list', { outcome: 'failure' }))).toEqual({
      what: "Tried to view a patient's visits", who: 'Staff member', outcome: 'failure', outcomeText: 'Failed' })
    expect(what('auth.login', { outcome: 'denied' })).toBe('Tried to sign in')
    expect(what('identity.patient-access-pin.verify', { outcome: 'denied' }))
      .toBe('Tried to get time-limited access to a patient\'s record with their PIN')
    expect(what('identity.patient.enroll', { outcome: 'failure' })).toBe('Tried to set up a patient\'s portal account')
    // "Signed or updated": both verbs become the plain form.
    expect(what('ehr.note.update', { outcome: 'denied' })).toBe('Tried to sign or update a clinical note')
    // A label that does not start with a doing word stays as written; the outcome says the rest.
    expect(auditRow(event('auth.session.read', { outcome: 'denied' }))).toMatchObject({ what: 'Signed-in session checked', outcomeText: 'Refused' })
    expect(what('ehr.order-route.received', { outcome: 'failure' })).toBe('Order received from another facility')
  })

  it('keeps the words of a label that already says its outcome', () => {
    expect(auditRow(event('identity.nin.verify', { outcome: 'denied' }))).toMatchObject({ what: 'NIN could not be verified', outcomeText: 'Refused' })
    expect(what('identity.nin.protect', { outcome: 'failure' })).toBe('NIN check stopped by a system error')
    expect(what('security.authorization.denied', { outcome: 'denied' })).toBe('Refused: their role here does not allow this action')
    expect(what('auth.authorization.denied', { outcome: 'denied' })).toBe('Access refused before choosing a facility')
    expect(what('identity.patient-access-pin.verify-denied', { outcome: 'denied' }))
      .toBe('Patient PIN not accepted (wrong PIN, unknown patient or too many tries)')
    expect(what('ehr.document.scan.rejected', { outcome: 'failure' })).toBe('Document failed the safety check and was blocked')
    expect(what('ocr.worker.lease_recovered', { outcome: 'failure' })).toBe('Document reading stopped responding (tried again if attempts remain)')
    expect(what('identity.record-access-notice.email.failed', { outcome: 'failure' })).toBe('Record-opened email to patient failed')
    expect(what('identity.patient-account-deletion.email.retry-scheduled', { outcome: 'failure' })).toBe('Account deletion email will be retried')
    expect(what('identity.emergency-contact.notification.failed', { outcome: 'failure' })).toBe('Emergency contact alert failed')
  })

  it('uses a label’s own words for an outcome or a kind of record where the spec gives them', () => {
    expect(what('identity.organization.cac-verification')).toBe('Checked the organization\'s CAC registration')
    expect(what('identity.organization.cac-verification', { outcome: 'denied' })).toBe('CAC registration not confirmed')
    expect(what('identity.organization.cac-verification', { outcome: 'failure' })).toBe('CAC check could not be completed')
    expect(what('identity.organization.self-service.cac-quota', { outcome: 'denied' })).toBe('CAC lookup limit reached')
    expect(what('identity.record-access-notice.note', { outcome: 'denied' })).toBe('No \'record opened\' notice needed')
    expect(what('ehr.patient.chat.answer')).toBe('Record assistant answered a question about a patient')
    expect(what('ehr.patient.chat.answer', { outcome: 'failure' })).toBe('Record assistant could not give an answer backed by the record')
    expect(what('ehr.record.read', { resourceType: 'patient-reported-health-profile' })).toBe('Viewed the health information a patient entered themself')
    expect(what('ehr.record.read', { resourceType: 'offline-chart-section' })).toBe('Viewed part of a patient\'s record on a device while offline')
    expect(what('ehr.record.read', { resourceType: 'offline-chart-section', outcome: 'denied' }))
      .toBe('Tried to view part of a patient\'s record on a device while offline')
    expect(what('pharmacy.work-item.list', { resourceType: 'pharmacy-work-item-collection' })).toBe('Viewed the pharmacy worklist')
    expect(what('pharmacy.work-item.list', { resourceType: 'pharmacy-work-item' })).toBe('Pharmacy worklist showed a patient from another facility\'s order')
    // No label ever shows its "if refused" part.
    for (const action of Object.keys(AUDIT_ACTION_LABELS)) {
      for (const outcome of ['success', 'denied', 'failure'] as const) expect(what(action, { outcome })).not.toContain('//')
    }
  })

  it('says a request sent again as repeated', () => {
    expect(what('ehr.encounter.create.replay')).toBe('Started a new visit (repeated)')
    expect(what('lab.result.verify.replay', { outcome: 'denied' })).toBe('Tried to verify a lab result (repeated)')
    // A replay with its own label keeps it.
    expect(what('identity.nin.resolve.replay')).toBe('Repeated a NIN registration request')
    expect(what('identity.access-request.replay')).toBe('Repeated an access request')
    expect(what('ehr.document.scan.idempotent-replay')).toBe('Safety check result sent again (nothing changed)')
  })

  it('says activity from the previous Health ID system in its words, or generally', () => {
    expect(what('organization_registered', { actorType: 'legacy' })).toBe('Facility registered on the previous Health ID system')
    expect(what('staff_onboarding_completed')).toBe('Staff member joined from an invitation on the previous Health ID system')
    expect(auditRow(event('access_requested', { actorType: 'legacy' }))).toMatchObject({
      what: 'Activity from the previous Health ID system', who: 'Previous Health ID system' })
    expect(what('records.viewed.by-clinic', { actorType: 'legacy' })).toBe('Activity from the previous Health ID system')
  })

  it('words a code the spec does not list by the fallback rule, never by the code', () => {
    expect(what('lab.sample-batch.create')).toBe('Lab: Added sample batch')
    expect(what('ehr.encounter.list.export')).toBe('Patient record: Exported list')
    expect(what('ehr.encounter.archive')).toBe('Patient record activity')
    expect(what('pharmacy.stock-count.updated')).toBe('Pharmacy: Changed stock count')
    expect(what('ocr.job.import')).toBe('Scanned documents: Imported scanned-document reading')
    expect(what('identity.consent-grant.extend')).toBe('Patient access and registration activity')
    expect(what('outreach.campaign.close')).toBe('Outreach: Closed outreach campaign')
    expect(what('commercial.lead.list')).toBe('Health ID website: Viewed the list of lead')
    expect(what('billing.invoice.send')).toBe('Other: Sent invoice')
    expect(what('lab.qc_run.create')).toBe('Lab: Added qc run')
    // With nothing between the area and the doing word, there is no thing to name.
    expect(what('audit.export')).toBe('Audit log activity')
    expect(what('ehr..read')).toBe('Patient record activity')
    expect(what('lab.sample-batch.create.replay')).toBe('Lab: Added sample batch (repeated, nothing changed)')
    expect(what('lab.sample-batch.idempotent-replay')).toBe('Lab activity (repeated, nothing changed)')
    expect(what('ocr.job.export', { actorType: 'system' })).toBe('Automatic: Scanned documents: Exported scanned-document reading')
    expect(what('lab.sample-batch.close', { actorType: 'workload' })).toBe('Automatic: Lab: Closed sample batch')
    expect(what('billing.invoice.list', { actorType: 'platform' })).toBe('Health ID support: Other: Viewed the list of invoice')
    // A code ending in "denied" was refused, whatever its outcome column says.
    expect(auditRow(event('pharmacy.stock.verify-denied'))).toMatchObject({ what: 'Pharmacy: Checked stock', outcome: 'denied', outcomeText: 'Refused' })
    expect(auditRow(event('identity.access.denied'))).toMatchObject({ what: 'Patient access and registration activity', outcomeText: 'Refused' })
    expect(auditRow(event('lab.sample-batch.create', { outcome: 'failure' }))).toMatchObject({ what: 'Lab: Added sample batch', outcomeText: 'Failed' })
  })

  it('never shows a code, whatever the action', () => {
    const actions = [...Object.keys(AUDIT_ACTION_LABELS), ...Object.keys(LEGACY_ACTION_LABELS), 'lab.sample-batch.create',
      'identity.access.denied', 'hospital.first', 'ehr.encounter.create.replay', 'access_requested', 'unknownaction', 'a.b', 'ehr..read',
      'audit.export', '']
    for (const action of actions) {
      for (const outcome of ['success', 'denied', 'failure'] as const) {
        const row = auditRow(event(action, { outcome }))
        expect(row).not.toBeNull()
        const shown = `${row?.what} ${row?.who} ${row?.outcomeText}`
        if (action) expect(shown).not.toContain(action)
        // Nothing that reads like a code: no dotted names, no snake_case.
        expect(shown).not.toMatch(/[a-z]\.[a-z]|[a-z]_[a-z]/i)
      }
    }
  })

  it('leaves the request log out', () => {
    expect(auditRow(event('api.get./api/v1/ehr/patients/:patientId/encounters', { resourceType: 'http-request' }))).toBeNull()
    expect(auditRow(event('api.identity.authorization.check.request'))).toBeNull()
  })

  it('says who did it in words, never an actor type as stored', () => {
    const who = (actorType: string) => auditRow(event('auth.login', { actorType }))?.who
    expect(who('staff')).toBe('Staff member')
    expect(who('patient')).toBe('Patient')
    expect(who('system')).toBe('Health ID (automatic)')
    expect(who('workload')).toBe('Health ID background service')
    expect(who('platform')).toBe('Health ID support')
    expect(who('legacy')).toBe('Previous Health ID system')
    expect(who('service')).toBe('Someone')
    expect(who('membership-7f3a')).toBe('Someone')
  })

  it('says an outcome it does not know as not recorded', () => {
    expect(auditRow(event('auth.login', { outcome: 'pending' as unknown as Event['outcome'] }))).toMatchObject({ what: 'Signed in', outcome: null, outcomeText: 'Outcome not recorded' })
  })
})

describe('searching audit events', () => {
  const lookup = event('ehr.encounter.create', { outcome: 'denied' })
  const matches = (query: string, value: Event = lookup) => matchesAuditSearch(value, query)

  it('finds an event by its words, who did it, its outcome, or its code, which is never shown', () => {
    expect(matches('')).toBe(true)
    expect(matches('  NEW visit ')).toBe(true)
    expect(matches('tried start')).toBe(true)
    expect(matches('staff member')).toBe(true)
    expect(matches('refused')).toBe(true)
    expect(matches('ehr.encounter.create')).toBe(true)
    expect(matches('encounter')).toBe(true)
    expect(matches('allowed')).toBe(false)
    expect(matches('vital')).toBe(false)
  })

  it('does not search what it does not show beside the code: the resource type or the actor type as stored', () => {
    expect(matches('encounter-resource', { ...lookup, resourceType: 'encounter-resource' })).toBe(false)
    expect(matches('workload', { ...lookup, actorType: 'workload' })).toBe(false)
    expect(matches('background service', { ...lookup, actorType: 'workload' })).toBe(true)
  })
})
