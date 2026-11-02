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
    // A label that does not start with a doing word says it did not happen after it, so the line never claims it did.
    expect(auditRow(event('auth.session.read', { outcome: 'denied' }))).toMatchObject({ what: 'Signed-in session checked (refused)', outcomeText: 'Refused' })
    expect(what('ehr.order-route.received', { outcome: 'failure' })).toBe('Order received from another facility (didn\'t go through)')
    expect(what('ehr.order-route.patient-list', { outcome: 'denied' })).toBe('Patient viewed orders sent elsewhere (refused)')
    expect(what('admin.account.disabled', { outcome: 'failure' })).toBe('Support disabled an account (didn\'t go through)')
    // "Released facility's orders closed" says what happened to the orders: it is not something someone tried.
    expect(what('admin.self-service-facility.release-order-routes', { outcome: 'denied' })).toBe('Released facility\'s orders closed (refused)')
  })

  it('keeps the words of a label that already says its outcome', () => {
    expect(auditRow(event('identity.nin.verify', { outcome: 'denied' }))).toMatchObject({ what: 'NIN could not be verified', outcomeText: 'Refused' })
    expect(what('identity.nin.protect', { outcome: 'failure' })).toBe('NIN check stopped by a system error')
    // The page shows Refused beside it, so the label's own "Refused: " is not said twice.
    expect(auditRow(event('security.authorization.denied', { outcome: 'denied' }))).toMatchObject({
      what: 'Their role here does not allow this action', outcome: 'denied', outcomeText: 'Refused' })
    expect(what('security.authorization', { outcome: 'denied' })).toBe('Their role here does not allow this action')
    expect(what('auth.authorization.denied', { outcome: 'denied' })).toBe('Access refused before choosing a facility')
    expect(what('identity.patient-access-pin.verify-denied', { outcome: 'denied' }))
      .toBe('Patient PIN not accepted (wrong PIN, unknown patient or too many tries)')
    expect(what('ehr.document.scan.rejected', { outcome: 'failure' })).toBe('Document failed the safety check and was blocked')
    expect(what('ocr.worker.lease_recovered', { outcome: 'failure' })).toBe('Document reading stopped responding (tried again if attempts remain)')
    expect(what('identity.record-access-notice.email.failed', { outcome: 'failure' })).toBe('Record-opened email to patient failed')
    expect(what('identity.patient-account-deletion.email.retry-scheduled', { outcome: 'failure' })).toBe('Account deletion email will be retried')
    expect(what('identity.emergency-contact.notification.failed', { outcome: 'failure' })).toBe('Emergency contact alert failed')
    // Four more labels say their own outcome (owner decision, 1 Nov 2026): no "(didn't go through)" or "Tried to" is added.
    expect(auditRow(event('ehr.order-route.not-completed', { outcome: 'failure' }))).toMatchObject({ what: 'Order could not be completed', outcomeText: 'Failed' })
    expect(auditRow(event('identity.emergency-contact.notification.intent-failed', { outcome: 'failure' })))
      .toMatchObject({ what: 'Could not queue emergency contact alert', outcomeText: 'Failed' })
    expect(auditRow(event('identity.emergency-contact.verification-failed', { outcome: 'failure' })))
      .toMatchObject({ what: 'Emergency contact verification failed', outcomeText: 'Failed' })
    expect(auditRow(event('identity.patient-account-deletion.confirmation-rejected', { outcome: 'denied' })))
      .toMatchObject({ what: 'Account deletion confirmation refused', outcomeText: 'Refused' })
  })

  it('takes the outcome a label says when the row was stored as a success', () => {
    // ocr.publication.fail is written with outcome success; its label carries the failure, so the row is Failed, not Allowed.
    expect(auditRow(event('ocr.publication.fail'))).toEqual({
      what: 'Scanned document could not be added', who: 'Staff member', outcome: 'failure', outcomeText: 'Failed' })
    expect(auditRow(event('security.authorization'))).toMatchObject({ what: 'Their role here does not allow this action', outcomeText: 'Refused' })
    expect(auditRow(event('identity.patient-access-pin.verify-denied'))).toMatchObject({ outcome: 'denied', outcomeText: 'Refused' })
    expect(auditRow(event('identity.record-access-notice.email.failed'))).toMatchObject({ outcome: 'failure', outcomeText: 'Failed' })
    expect(auditRow(event('ocr.publication.fail', { outcome: 'pending' as unknown as Event['outcome'] }))).toMatchObject({ outcomeText: 'Failed' })
    expect(auditRow(event('ehr.order-route.not-completed'))).toEqual({
      what: 'Order could not be completed', who: 'Staff member', outcome: 'failure', outcomeText: 'Failed' })
    expect(auditRow(event('identity.emergency-contact.notification.intent-failed', { actorType: 'system' }))).toEqual({
      what: 'Could not queue emergency contact alert', who: 'Health ID (automatic)', outcome: 'failure', outcomeText: 'Failed' })
    expect(auditRow(event('identity.emergency-contact.verification-failed', { actorType: 'patient' }))).toEqual({
      what: 'Emergency contact verification failed', who: 'Patient', outcome: 'failure', outcomeText: 'Failed' })
    expect(auditRow(event('identity.patient-account-deletion.confirmation-rejected', { actorType: 'patient' }))).toEqual({
      what: 'Account deletion confirmation refused', who: 'Patient', outcome: 'denied', outcomeText: 'Refused' })
    // A stored refusal or failure stays as stored: "NIN could not be verified" is written as either.
    expect(auditRow(event('identity.nin.verify', { outcome: 'failure' }))).toMatchObject({ outcome: 'failure', outcomeText: 'Failed' })
    expect(auditRow(event('identity.nin.verify', { outcome: 'denied' }))).toMatchObject({ outcome: 'denied', outcomeText: 'Refused' })
    // Except a label that says Refused itself: the security refusals drop their "Refused: " because the row shows Refused,
    // so a refusal stored as a failure still reads Refused, never "Their role here does not allow this action · Failed".
    expect(auditRow(event('security.authorization', { outcome: 'failure' }))).toEqual({
      what: 'Their role here does not allow this action', who: 'Staff member', outcome: 'denied', outcomeText: 'Refused' })
    expect(auditRow(event('security.authorization.denied', { outcome: 'failure', resourceType: 'http-request' }))).toEqual({
      what: 'Their role here does not allow this action', who: 'Staff member', outcome: 'denied', outcomeText: 'Refused' })
    // A label that says nothing about its outcome keeps the stored one.
    expect(auditRow(event('identity.staff-invitation.delivery'))).toMatchObject({ outcomeText: 'Allowed' })
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
    // The label is built from the last two parts: for a two-part code, the thing is its first part.
    expect(what('audit.export')).toBe('Audit log: Exported audit')
    expect(what('billing.send')).toBe('Other: Sent billing')
    // With nothing to name, or a part that is not plain words (an ID, a path, mixed case), it is not shown.
    expect(what('ehr..read')).toBe('Patient record activity')
    expect(what('ehr.d0a1b2c3-4567-89ab.read')).toBe('Patient record activity')
    expect(what('ehr.facility/abc.read')).toBe('Patient record activity')
    expect(what('lab.QcRun.create')).toBe('Lab activity')
    expect(what('lab.sample-batch.create.replay')).toBe('Lab: Added sample batch (repeated, nothing changed)')
    expect(what('lab.sample-batch.idempotent-replay')).toBe('Lab activity (repeated, nothing changed)')
    // Automatic, and Health ID support, are said once in a row (owner decision): "Health ID (automatic)" and "Health ID
    // support" already say it beside the row, so the spec's lead-in is not added for them.
    expect(auditRow(event('ocr.job.export', { actorType: 'system' }))).toMatchObject({
      what: 'Scanned documents: Exported scanned-document reading', who: 'Health ID (automatic)' })
    expect(auditRow(event('billing.invoice.list', { actorType: 'platform' }))).toMatchObject({
      what: 'Other: Viewed the list of invoice', who: 'Health ID support' })
    // "Health ID background service" does not say automatic, so its rows still start "Automatic: ".
    expect(auditRow(event('lab.sample-batch.close', { actorType: 'workload' }))).toMatchObject({
      what: 'Automatic: Lab: Closed sample batch', who: 'Health ID background service' })
    expect(what('lab.sample-batch.create', { actorType: 'workload', outcome: 'denied' })).toBe('Automatic: Lab: Tried to add sample batch')
    expect(what('lab.QcRun.create', { actorType: 'workload' })).toBe('Automatic: Lab activity')
    // A support code's area is Health ID support, which who did it already says; with no verb to name, it is "Activity".
    expect(auditRow(event('admin.foo.list', { actorType: 'platform' }))).toMatchObject({ what: 'Viewed the list of foo', who: 'Health ID support' })
    expect(auditRow(event('admin.foo.bar', { actorType: 'platform' }))).toMatchObject({ what: 'Activity', who: 'Health ID support' })
    expect(what('admin.foo.bar', { actorType: 'platform', outcome: 'denied' })).toBe('Activity (refused)')
    expect(what('admin.foo.bar', { actorType: 'platform', outcome: 'failure' })).toBe('Activity (didn\'t go through)')
    expect(auditRow(event('admin.foo.denied', { actorType: 'platform' }))).toMatchObject({ what: 'Activity (refused)', outcomeText: 'Refused' })
    // Done by anyone else, the area still says it was Health ID support's.
    expect(what('admin.foo.list', { actorType: 'system' })).toBe('Health ID support: Viewed the list of foo')
    expect(what('admin.foo.list', { actorType: 'workload' })).toBe('Automatic: Health ID support: Viewed the list of foo')
    expect(what('admin.foo.bar')).toBe('Health ID support activity')
    // A code ending in "denied" was refused, whatever its outcome column says; the line says what was tried.
    expect(auditRow(event('pharmacy.stock.verify-denied'))).toMatchObject({ what: 'Pharmacy: Tried to check stock', outcome: 'denied', outcomeText: 'Refused' })
    expect(auditRow(event('identity.access.denied'))).toMatchObject({ what: 'Patient access and registration activity (refused)', outcomeText: 'Refused' })
    // The outcome rule applies to the fallback's words too.
    expect(auditRow(event('lab.sample-batch.create', { outcome: 'failure' }))).toMatchObject({ what: 'Lab: Tried to add sample batch', outcomeText: 'Failed' })
    expect(what('outreach.campaign.close', { outcome: 'denied' })).toBe('Outreach: Closed outreach campaign (refused)')
    expect(what('lab.sample-batch.create.replay', { outcome: 'denied' })).toBe('Lab: Tried to add sample batch (repeated, nothing changed)')
    expect(what('ocr.job.export', { actorType: 'system', outcome: 'failure' })).toBe('Scanned documents: Exported scanned-document reading (didn\'t go through)')
    // A code saying it could not complete failed, even when stored as a success, and is not said twice.
    expect(auditRow(event('ocr.job.fail'))).toMatchObject({ what: 'Scanned documents: Could not complete scanned-document reading', outcome: 'failure', outcomeText: 'Failed' })
    expect(auditRow(event('ocr.job.fail', { outcome: 'denied' }))).toMatchObject({ outcome: 'denied', outcomeText: 'Refused' })
  })

  it('never shows a code, whatever the action', () => {
    const actions = [...Object.keys(AUDIT_ACTION_LABELS), ...Object.keys(LEGACY_ACTION_LABELS), 'lab.sample-batch.create',
      'identity.access.denied', 'hospital.first', 'ehr.encounter.create.replay', 'access_requested', 'unknownaction', 'a.b', 'ehr..read',
      'audit.export', 'ehr.d0a1b2c3-4567-89ab.read', 'ehr.facility/abc.read', 'admin.foo.list', 'ocr.job.fail', '']
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

  it('says automatic, or Health ID support, exactly once in a row (owner decision)', () => {
    const unlisted = ['lab.sample-batch.create', 'ocr.job.export', 'lab.QcRun.create', 'billing.invoice.list', 'identity.access.denied',
      'lab.sample-batch.create.replay', 'ocr.job.fail', 'admin.foo.list', 'admin.foo.bar', 'admin.foo', 'admin.foo.denied',
      'admin.foo-denied', 'admin.']
    const times = (text: string, words: RegExp) => text.match(words)?.length ?? 0
    for (const outcome of ['success', 'denied', 'failure'] as const) {
      for (const action of unlisted) {
        for (const actorType of ['system', 'workload']) {
          const row = auditRow(event(action, { actorType, outcome }))
          expect(times(`${row?.what} ${row?.who}`, /automatic/gi), `${action} by ${actorType}`).toBe(1)
        }
        const row = auditRow(event(action, { actorType: 'platform', outcome }))
        expect(times(`${row?.what} ${row?.who}`, /Health ID support/g), `${action} by Health ID support`).toBe(1)
        expect(row?.what).not.toMatch(/automatic/i)
      }
      // A listed code keeps the spec's label whoever did it: no lead-in is added to it.
      for (const action of Object.keys(AUDIT_ACTION_LABELS)) {
        const byStaff = auditRow(event(action, { outcome }))?.what
        for (const actorType of ['system', 'workload', 'platform']) expect(auditRow(event(action, { actorType, outcome }))?.what).toBe(byStaff)
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
