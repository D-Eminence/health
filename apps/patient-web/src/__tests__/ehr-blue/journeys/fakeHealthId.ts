import { vi } from 'vitest'
import { json, problem } from '../frame/blueHarness'

/**
 * A small, stateful Health ID for the Lab journeys (lab-journey.test.tsx): one fake behind fetch that answers the EHR's
 * lab requests, Lab and the orders between facilities as ehr-api, lab-api and identity-api do at hid-system 34d69557,
 * for whoever is signed in now. Every person, facility, patient and value here is fictional.
 *
 * What it keeps to, from the backend:
 * - Lab lists this facility's own work only to a member holding their own grant to the patient (0086
 *   lab.work_item_allows, 0012 grant_row.membership_id): a grant is per member, made here by Find the patient.
 *   Work from another facility's order is listed through its route once accepted (order_route_allows).
 * - The list sends no test or result statuses and no patient card on own work (lab-work-items.service.ts:224-231);
 *   `sendsOpenWork` adds the one field the backend already works out (open_work, :79), as proposed (PLAN B1).
 * - One accession per work item (0019:40); a sample goes required → collected → received or rejected (0019:184-185).
 * - Checking a result is refused to the person who entered that version, as a fixed 500 (0021:76-77, problem.ts);
 *   releasing needs a check of the same version (lab-executions.service.ts:142).
 * - A doctor reads only released versions (releasedView, :194-197); a route carries released results back.
 */

export const RIVERSIDE = { id: 'f0000000-0000-4000-8000-00000000a1e1', name: 'Riverside Teaching Hospital (fictional)' }
export const LAKESIDE = { id: 'f0000000-0000-4000-8000-00000000b1e1', name: 'Lakeside Diagnostics (fictional)' }
export const PATIENT = {
  id: 'a0000000-0000-4000-8000-00000000c0de', hid: 'HID-ZDEMAAA2', name: 'Ngozi Example (fictional)', dateOfBirth: '1990-04-12', sex: 'female',
}
export const ENCOUNTER_ID = 'e0000000-0000-4000-8000-00000000c0de'

const LAB_WORK = ['lab.work-item.read', 'lab.accession.create', 'lab.accession.read', 'lab.specimen.collect', 'lab.specimen.receive',
  'lab.specimen.reject', 'lab.execution.read', 'lab.execution.start', 'lab.execution.complete', 'lab.result.enter', 'lab.result.correct',
  'lab.result.verify', 'lab.result.release', 'lab.result.revise-released', 'lab.result.released.read']

export interface Person {
  readonly account: string
  readonly name: string
  readonly facility: typeof RIVERSIDE
  readonly roles: readonly string[]
  readonly permissions: readonly string[]
  readonly selfService?: { review: string; organizationType: string }
}

export const PEOPLE = {
  bello: { account: 'staff-bello', name: 'Dr Ade Bello (fictional)', facility: RIVERSIDE, roles: ['doctor'],
    permissions: ['identity.patient.read', 'ehr.encounter.read', 'ehr.lab-request.read', 'ehr.lab-request.write', 'lab.work-item.accept',
      'lab.result.released.read', 'ehr.order-route.send'] },
  scientistA: { account: 'staff-lab-a', name: 'Ada Scientist (fictional)', facility: RIVERSIDE, roles: ['lab_scientist'],
    permissions: ['identity.patient.read', ...LAB_WORK] },
  scientistB: { account: 'staff-lab-b', name: 'Bayo Scientist (fictional)', facility: RIVERSIDE, roles: ['lab_scientist'],
    permissions: ['identity.patient.read', ...LAB_WORK] },
  scientistC: { account: 'staff-lab-c', name: 'Chidi Scientist (fictional)', facility: RIVERSIDE, roles: ['lab_scientist'],
    permissions: ['identity.patient.read', ...LAB_WORK] },
  lakeside: { account: 'staff-lakeside', name: 'Lola Scientist (fictional)', facility: LAKESIDE, roles: ['lab_scientist'],
    permissions: [...LAB_WORK, 'lab.order-route.receive'], selfService: { review: 'reviewed', organizationType: 'laboratory' } },
  lakesideB: { account: 'staff-lakeside-b', name: 'Musa Scientist (fictional)', facility: LAKESIDE, roles: ['lab_scientist'],
    permissions: [...LAB_WORK, 'lab.order-route.receive'], selfService: { review: 'reviewed', organizationType: 'laboratory' } },
} satisfies Record<string, Person>

const membership = (person: Person) => `member-${person.account}`

interface Revision {
  version: number; value: Record<string, unknown>; enteredBy: string; enteredAt: string; verifiedBy?: string; releasedAt?: string
  correctionReason: string | null; revisionKind: string
}
interface Work {
  id: string; facilityId: string; sourceEhrOrderId: string; priority: string; acceptedAt: string; testName: string
  routeId: string | null
  accession: null | { id: string; accessionNumber: string; status: string; specimens: Array<{ id: string; specimenIdentifier: string; accessionId: string; specimenType: string; containerType: null; status: string; version: number }> }
  execution: null | { id: string; status: string; version: number; method: string | null; startedAt: string; completedAt: string | null }
  result: null | { id: string; revisions: Revision[] }
}
interface Route {
  id: string; reference: string; orderId: string; receivingFacilityId: string; version: number; effectiveState: string; endedKind: string | null
  createdAt: string; acceptedAt: string | null; endedAt: string | null; workItemId: string | null; access: 'work' | 'read' | 'none'
  notCompleted: null | { reason: string; sampleTaken: boolean | null; resultRecorded: boolean | null }
}
interface LabRequest {
  id: string; testCodeSystem: string; testCode: string; testDisplay: string; priority: string; specimenTypeCode: string | null
  clinicalInformation: string | null; status: string; rowVersion: number; createdAt: string
}

const NOW = () => new Date().toISOString()
const TEST = { codeSystem: 'LOINC', code: '718-7', name: 'Hemoglobin' }

/** Stubs fetch with the fake. `sendsOpenWork`: Lab sends each item's openWork (the proposed one-field change). */
export function fakeHealthId({ sendsOpenWork }: { sendsOpenWork: boolean }) {
  let person: Person = PEOPLE.bello
  const grants = new Map<string, Set<string>>()
  const requests: LabRequest[] = []
  const work: Work[] = []
  const routes: Route[] = []
  /** Every request sent, as "account METHOD path". */
  const sent: string[] = []
  /** Requests this fake has no answer for (answered 418): the journey checks Lab and the EHR asked nothing it doesn't know. */
  const unexpected: string[] = []
  let ids = 0
  const next = (prefix: string) => `${prefix}0000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`

  const granted = (who: Person) => grants.get(membership(who))?.has(PATIENT.id) === true
  const grant = (who: Person) => grants.set(membership(who), new Set([...(grants.get(membership(who)) ?? []), PATIENT.id]))
  const routeOf = (item: Work) => routes.find(route => route.id === item.routeId) ?? null
  // Lab's list and reads: own work with the member's own grant, routed work through its accepted route.
  const visible = (item: Work) => item.facilityId === person.facility.id
    && (item.routeId === null ? granted(person) : (routeOf(item)?.access ?? 'none') !== 'none')
  const current = (item: Work) => item.result?.revisions.at(-1) ?? null
  const releasedVersions = (item: Work) => (item.result?.revisions ?? []).filter(revision => revision.releasedAt)
  // As lab-api's open_work: open until its result's current version is released, whatever the route's state.
  const open = (item: Work) => !(current(item)?.releasedAt)

  function revisionView(revision: Revision) {
    return { version: revision.version, ...revision.value, entrySource: 'manual',
      verificationStatus: revision.verifiedBy ? 'verified' : 'unverified',
      releaseStatus: revision.releasedAt ? 'released' : revision.verifiedBy ? 'verified_not_released' : 'not_released',
      enteredAt: revision.enteredAt, releasedAt: revision.releasedAt ?? null, correctionReason: revision.correctionReason }
  }
  function resultView(item: Work, only?: (revision: Revision) => boolean) {
    if (!item.result) return null
    const latest = current(item)!
    const released = releasedVersions(item).at(-1)
    return { id: item.result.id, executionId: item.execution!.id,
      status: latest.releasedAt ? 'released' : latest.verifiedBy ? 'verified_not_released' : 'entered_unverified',
      verificationStatus: latest.verifiedBy ? 'verified' : 'unverified', currentVersion: latest.version,
      currentReleasedVersion: released?.version ?? null,
      revisions: item.result.revisions.filter(only ?? (() => true)).map(revisionView) }
  }
  const executionView = (item: Work) => item.execution && { ...item.execution, accessionId: item.accession!.id,
    specimenId: item.accession!.specimens[0]!.id, requestedTestId: `${item.id}-test`, test: TEST, patientId: PATIENT.id,
    facilityId: item.facilityId, result: resultView(item) }

  function workItemView(item: Work) {
    const route = routeOf(item)
    return {
      id: item.id, patientId: PATIENT.id, facilityId: item.facilityId, sourceEhrOrderId: item.sourceEhrOrderId, sourceEhrOrderVersion: 1,
      status: 'accepted', priority: item.priority, acceptedAt: item.acceptedAt, version: 1, testName: item.testName,
      accessionId: item.accession?.id ?? null, accessionNumber: item.accession?.accessionNumber ?? null,
      specimenStatuses: item.accession?.specimens.map(specimen => specimen.status) ?? [],
      ...(sendsOpenWork ? { openWork: open(item) } : {}),
      // Only routed work carries who the patient is (project(row, cards)).
      ...(route ? {
        orderRoute: { id: route.id, reference: route.reference, effectiveState: route.effectiveState, access: route.access,
          orderingFacilityName: RIVERSIDE.name, ordererName: PEOPLE.bello.name, version: route.version, endedKind: route.endedKind },
        patient: { fullName: PATIENT.name, sex: PATIENT.sex, dateOfBirth: PATIENT.dateOfBirth, healthIdLast4: PATIENT.hid.slice(-4) },
      } : {}),
    }
  }
  const findWork = (predicate: (item: Work) => boolean) => work.find(item => visible(item) && predicate(item))

  function labRequestView(request: LabRequest) {
    const latest = routes.filter(entry => entry.orderId === request.id).at(-1)
    return { id: request.id, patientId: PATIENT.id, encounterId: ENCOUNTER_ID, createdAt: request.createdAt, testCodeSystem: request.testCodeSystem,
      testCode: request.testCode, testDisplay: request.testDisplay, priority: request.priority, specimenTypeCode: request.specimenTypeCode,
      clinicalInformation: request.clinicalInformation, status: request.status, rowVersion: request.rowVersion,
      // The order's latest route rides on the list (ehr-api, P4c).
      ...(latest ? { orderRoute: routeSummary(latest) } : {}) }
  }
  function routeSummary(route: Route) {
    return { id: route.id, reference: route.reference, kind: 'lab_request', version: route.version, effectiveState: route.effectiveState,
      receivingFacility: { id: LAKESIDE.id, name: LAKESIDE.name, available: true }, createdAt: route.createdAt,
      respondBy: new Date(Date.parse(route.createdAt) + 7 * 86_400_000).toISOString(), acceptedAt: route.acceptedAt, completedAt: null,
      endedAt: route.endedAt, endedKind: route.endedKind, declineReason: null, acceptLocked: false, resendAllowed: false,
      notCompleted: route.notCompleted }
  }
  function routeView(route: Route) {
    const item = work.find(entry => entry.id === route.workItemId)
    const results = item ? releasedVersions(item).map(revision => ({ resultId: item.result!.id, resultVersion: revision.version, kind: 'released',
      test: TEST, resultType: 'numeric', numericValue: revision.value.numericValue ?? null, textValue: null, unit: revision.value.unit ?? null,
      referenceRange: revision.value.referenceRange ?? null, abnormalFlag: revision.value.abnormalFlag ?? null, revisionKind: revision.revisionKind,
      correctionReason: revision.correctionReason, occurredAt: revision.releasedAt ?? null })) : []
    return { ...routeSummary(route),
      attestation: { textVersion: 'order-route-lab-attestation-v1', attestedByName: PEOPLE.bello.name, attestedAt: route.createdAt,
        receivingFacilityName: LAKESIDE.name }, events: [], results }
  }

  function send(request: LabRequest, receivingFacilityId: string): Route {
    const sentRoute: Route = { id: next('d'), reference: `7Q2K${String(ids).padStart(4, '0')}`, orderId: request.id, receivingFacilityId, version: 1,
      effectiveState: 'sent', endedKind: null, createdAt: NOW(), acceptedAt: null, endedAt: null, workItemId: null, access: 'none', notCompleted: null }
    routes.push(sentRoute)
    return sentRoute
  }
  function accept(sentRoute: Route): Work {
    const request = requests.find(entry => entry.id === sentRoute.orderId)!
    const item: Work = { id: next('w'), facilityId: LAKESIDE.id, sourceEhrOrderId: request.id, priority: request.priority, acceptedAt: NOW(),
      testName: request.testDisplay, routeId: sentRoute.id, accession: null, execution: null, result: null }
    work.push(item)
    Object.assign(sentRoute, { effectiveState: 'accepted', version: sentRoute.version + 1, acceptedAt: NOW(), workItemId: item.id, access: 'work' })
    return item
  }

  function answer(method: string, path: string, query: URLSearchParams, body: Record<string, unknown> | undefined): Response {
    const route = `${method} ${path}`
    // ---------------------------------------------------------------------------------------------- identity
    if (route === 'POST /api/v1/identity/patient-lookup') {
      if (body?.hid !== PATIENT.hid) return problem(404, 'PATIENT_NOT_FOUND', 'Patient not found')
      // Finding the patient here stands in for their Access PIN: the grant is this member's (0072, 0095).
      grant(person)
      return json({ authorization: { decision: 'allow', consentGrantId: `grant-${person.account}`, scope: 'write_records',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(), breakGlass: false },
      patient: { patientId: PATIENT.id, hid: PATIENT.hid, fullName: PATIENT.name, dateOfBirth: PATIENT.dateOfBirth, gender: PATIENT.sex } })
    }
    if (route === 'POST /api/v1/identity/consent-status') {
      return json({ patientId: PATIENT.id, facilityId: person.facility.id, purpose: 'direct-care', readAllowed: granted(person), writeAllowed: granted(person) })
    }
    if (route === 'GET /api/v1/identity/order-destinations') {
      return json({ items: [{ facilityId: LAKESIDE.id, facilityName: LAKESIDE.name, organizationName: 'Lakeside Diagnostics Ltd (fictional)',
        registeredAddress: '2 Example Close, Ibadan', newOnHealthId: false }] })
    }
    // --------------------------------------------------------------------------------------------------- ehr
    const encounters = `/api/v1/ehr/patients/${PATIENT.id}/encounters`
    const encounter = { id: ENCOUNTER_ID, patientId: PATIENT.id, facilityId: RIVERSIDE.id, encounterType: 'ambulatory', status: 'in_progress',
      startedAt: '2026-11-03T08:00:00.000Z', chiefComplaint: 'Tired for a month (fictional)', rowVersion: 1 }
    if (route === `GET ${encounters}`) return json({ items: [encounter], nextCursor: null })
    if (route === `GET ${encounters}/${ENCOUNTER_ID}`) return json(encounter)
    const labRequests = `${encounters}/${ENCOUNTER_ID}/lab-requests`
    if (route === `GET ${labRequests}`) return json({ items: requests.map(labRequestView), nextCursor: null, crossFacilityOrders: true })
    if (route === `POST ${labRequests}`) {
      const request: LabRequest = { id: next('c'), testCodeSystem: String(body?.testCodeSystem), testCode: String(body?.testCode),
        testDisplay: String(body?.testDisplay), priority: String(body?.priority ?? 'routine'), specimenTypeCode: (body?.specimenTypeCode as string) ?? null,
        clinicalInformation: (body?.clinicalInformation as string) ?? null, status: String(body?.status), rowVersion: 1, createdAt: NOW() }
      requests.push(request)
      if (request.status !== 'active') return json(labRequestView(request), 201)
      // An active request is handed to this facility's Lab under the clinician's own context (lab-requests.service.ts:189-196).
      work.push({ id: next('w'), facilityId: RIVERSIDE.id, sourceEhrOrderId: request.id, priority: request.priority, acceptedAt: NOW(),
        testName: request.testDisplay, routeId: null, accession: null, execution: null, result: null })
      return json({ ...labRequestView(request), labHandoff: { state: 'accepted' } }, 201)
    }
    if (route === 'GET /api/v1/ehr/order-route-attestation') {
      return json({ kind: query.get('kind'), version: 'order-route-lab-attestation-v1',
        text: 'I confirm that {patient} agreed that {orderingFacility} sends this test request to {receivingFacility}.' })
    }
    let match = /^\/api\/v1\/ehr\/patients\/[^/]+\/encounters\/[^/]+\/lab-requests\/([^/]+)\/order-routes$/.exec(path)
    if (match) {
      const request = requests.find(entry => entry.id === match![1])
      if (!request) return problem(404, 'LAB_REQUEST_NOT_FOUND', 'Lab request not found')
      if (method === 'GET') return json({ items: routes.filter(entry => entry.orderId === request.id).reverse().map(routeView) })
      if (method === 'POST') {
        request.status = 'active'
        request.rowVersion += 1
        const sentRoute = send(request, String(body?.receivingFacilityId))
        const view = routeView(sentRoute)
        return json({ route: view, order: { id: request.id, status: request.status, rowVersion: request.rowVersion }, replayed: false }, 201)
      }
    }
    // ------------------------------------------------------------------------------------------------- lab
    if (route === 'GET /api/v1/lab/work-items') {
      const items = work.filter(visible).map(workItemView)
      const receives = person.permissions.includes('lab.order-route.receive')
      return json({ items, crossFacilityOrders: true, crossFacilityWork: true,
        ...(receives ? { receives: true, routesHere: { waiting: routes.some(entry => entry.effectiveState === 'sent'), held: items.some(item => item.orderRoute) },
          cannotComplete: true, lateCorrection: false } : {}) })
    }
    match = /^\/api\/v1\/lab\/ehr-orders\/([^/]+)\/released-results$/.exec(path)
    if (method === 'GET' && match) {
      const item = work.find(entry => entry.sourceEhrOrderId === match![1] && entry.facilityId === person.facility.id)
      if (!item || !granted(person)) return problem(404, 'LAB_WORK_ITEM_NOT_FOUND', 'Lab work item not found')
      const released = releasedVersions(item)
      return json({ workItemId: item.id, sourceEhrOrderId: item.sourceEhrOrderId, sourceEhrOrderVersion: 1, patientId: PATIENT.id,
        acceptedAt: item.acceptedAt, test: TEST,
        results: released.length > 0 ? [resultView(item, revision => Boolean(revision.releasedAt))] : [] })
    }
    match = /^\/api\/v1\/lab\/work-items\/([^/]+)\/accession$/.exec(path)
    if (method === 'POST' && match) {
      const item = findWork(entry => entry.id === match![1])
      if (!item) return problem(404, 'LAB_WORK_ITEM_NOT_FOUND', 'Lab work item not found')
      if (item.accession) return problem(409, 'LAB_ACCESSION_EXISTS', 'Work item already has an accession')
      const id = next('b')
      const requirement = (body?.requirements as Array<{ specimenType: string }>)[0]!
      item.accession = { id, accessionNumber: `ACC-2026-${String(ids).padStart(6, '0')}`, status: 'accessioned', specimens: [{
        id: next('5'), specimenIdentifier: `SPC-${String(ids).padStart(6, '0')}`, accessionId: id, specimenType: requirement.specimenType,
        containerType: null, status: 'required', version: 1 }] }
      return json({ ...item.accession, workItemId: item.id }, 201)
    }
    match = /^\/api\/v1\/lab\/accessions\/([^/]+)$/.exec(path)
    if (method === 'GET' && match) {
      const item = findWork(entry => entry.accession?.id === match![1])
      return item ? json({ ...item.accession, workItemId: item.id }) : problem(404, 'LAB_ACCESSION_NOT_FOUND', 'Lab accession not found')
    }
    match = /^\/api\/v1\/lab\/accessions\/([^/]+)\/specimens\/([^/]+)\/(collect|receive|reject)$/.exec(path)
    if (method === 'POST' && match) {
      const item = findWork(entry => entry.accession?.id === match![1])
      const specimen = item?.accession?.specimens.find(entry => entry.id === match![2])
      if (!item || !specimen) return problem(404, 'LAB_SPECIMEN_NOT_FOUND', 'Lab specimen not found')
      if (specimen.version !== body?.expectedVersion) return problem(412, 'VERSION_CONFLICT', 'Specimen changed since it was loaded')
      const to = { collect: 'collected', receive: 'received', reject: 'rejected' }[match[3] as 'collect']
      const allowed = (specimen.status === 'required' && to === 'collected') || (specimen.status === 'collected' && to !== 'collected')
      if (!allowed) return problem(500, 'INTERNAL_SERVER_ERROR', 'The service could not complete the request.')
      specimen.status = to
      specimen.version += 1
      return json(specimen)
    }
    match = /^\/api\/v1\/lab\/specimens\/([^/]+)\/executions$/.exec(path)
    if (match) {
      const item = findWork(entry => entry.accession?.specimens[0]?.id === match![1])
      if (!item) return problem(404, 'LAB_SPECIMEN_NOT_FOUND', 'Lab specimen not found')
      if (method === 'GET') return json({ items: item.execution ? [executionView(item)] : [] })
      item.execution = { id: next('e'), status: 'in_progress', version: 1, method: (body?.method as string) ?? null, startedAt: NOW(), completedAt: null }
      return json(executionView(item), 201)
    }
    match = /^\/api\/v1\/lab\/executions\/([^/]+)\/(complete|results)$/.exec(path)
    if (method === 'POST' && match) {
      const item = findWork(entry => entry.execution?.id === match![1])
      if (!item?.execution) return problem(404, 'LAB_EXECUTION_NOT_FOUND', 'Lab execution not found')
      if (match[2] === 'complete') {
        item.execution = { ...item.execution, status: 'completed', completedAt: NOW(), version: item.execution.version + 1 }
        return json(executionView(item))
      }
      const { expectedExecutionVersion: _version, ...value } = body ?? {}
      item.result = { id: next('r'), revisions: [{ version: 1, value, enteredBy: person.account, enteredAt: NOW(), correctionReason: null, revisionKind: 'original' }] }
      return json(resultView(item), 201)
    }
    match = /^\/api\/v1\/lab\/executions\/([^/]+)\/results\/([^/]+)\/corrections$/.exec(path)
    if (method === 'POST' && match) {
      const item = findWork(entry => entry.result?.id === match![2])
      if (!item?.result) return problem(404, 'LAB_RESULT_NOT_FOUND', 'Lab result not found')
      const { expectedExecutionVersion: _execution, expectedResultVersion, reason, revisionKind, ...value } = body ?? {}
      if (expectedResultVersion !== current(item)!.version) return problem(412, 'VERSION_CONFLICT', 'Result changed since it was loaded')
      item.result.revisions.push({ version: current(item)!.version + 1, value, enteredBy: person.account, enteredAt: NOW(),
        correctionReason: String(reason), revisionKind: String(revisionKind) })
      return json(resultView(item), 201)
    }
    match = /^\/api\/v1\/lab\/results\/([^/]+)\/(verify|release|history)$/.exec(path)
    if (match) {
      const item = findWork(entry => entry.result?.id === match![1])
      const latest = item ? current(item) : null
      if (!item || !latest) return problem(404, 'LAB_RESULT_NOT_FOUND', 'Lab result not found')
      if (match[2] === 'history') return json(resultView(item))
      if (body?.expectedResultVersion !== latest.version) return problem(412, 'VERSION_CONFLICT', 'Result changed since it was loaded')
      if (match[2] === 'verify') {
        // 0021 lab.validate_result_governance refuses the person who entered the version: errcode 23514, a fixed 500.
        if (latest.enteredBy === person.account) return problem(500, 'INTERNAL_SERVER_ERROR', 'The service could not complete the request.')
        latest.verifiedBy = person.account
        return json(resultView(item))
      }
      if (!latest.verifiedBy) return problem(409, 'RESULT_NOT_VERIFIED', 'Exact result version is not verified')
      latest.releasedAt = NOW()
      return json(resultView(item))
    }
    // ------------------------------------------------------------------------------- orders between facilities
    if (route === 'GET /api/v1/lab/order-routes' || route === 'POST /api/v1/lab/order-routes/search') {
      // A Health ID finds one patient's waiting orders; the list's GET names none (the P4c review).
      const items = route.startsWith('POST') && body?.healthId === PATIENT.hid
        ? routes.filter(entry => entry.receivingFacilityId === person.facility.id && entry.effectiveState === 'sent').map(entry => ({
          id: entry.id, reference: entry.reference, version: entry.version, effectiveState: entry.effectiveState, orderingFacilityName: RIVERSIDE.name,
          orderer: { name: PEOPLE.bello.name, licenceBody: 'MDCN' }, priority: 'routine', specimenTypeCode: 'blood',
          test: { ...TEST, name: requests.find(request => request.id === entry.orderId)!.testDisplay },
          sentAt: entry.createdAt, respondBy: new Date(Date.parse(entry.createdAt) + 7 * 86_400_000).toISOString(), acceptLocked: false, attemptsLeft: 5 }))
        : []
      return json({ items, crossFacilityOrders: true, crossFacilityWork: true, receives: true,
        routesHere: { waiting: routes.some(entry => entry.effectiveState === 'sent'), held: routes.some(entry => entry.workItemId !== null) } })
    }
    match = /^\/api\/v1\/lab\/order-routes\/([^/]+)\/(accept|wrong-patient|cannot-complete)$/.exec(path)
    if (method === 'POST' && match) {
      const sentRoute = routes.find(entry => entry.id === match![1] && entry.receivingFacilityId === person.facility.id)
      if (!sentRoute) return problem(404, 'ORDER_ROUTE_NOT_FOUND', 'Order route not found')
      if (body?.expectedVersion !== sentRoute.version) return problem(412, 'VERSION_CONFLICT', 'Order route changed since it was loaded')
      const request = requests.find(entry => entry.id === sentRoute.orderId)!
      if (match[2] === 'accept') {
        const identifier = body?.patientIdentifier as { kind: string; value: string } | undefined
        if (identifier?.kind !== 'health_id' || identifier.value !== PATIENT.hid) return problem(422, 'ORDER_ROUTE_PATIENT_MISMATCH', 'Patient does not match')
        const item = accept(sentRoute)
        return json({ route: { id: sentRoute.id, version: sentRoute.version, effectiveState: sentRoute.effectiveState }, workItemId: item.id,
          patient: { fullName: PATIENT.name, sex: PATIENT.sex, dateOfBirth: PATIENT.dateOfBirth, healthIdLast4: PATIENT.hid.slice(-4) },
          clinicalInformation: request.clinicalInformation, instructions: null, orderer: { licenceBody: 'MDCN', licenceNumber: 'MDCN/R/00000' }, replayed: false })
      }
      const endedKind = match[2] === 'wrong-patient' ? 'wrong_patient' : 'receiving_unable'
      Object.assign(sentRoute, { effectiveState: 'cancelled', version: sentRoute.version + 1, endedAt: NOW(), endedKind })
      if (match[2] === 'wrong-patient') {
        // The order ends at once and its reads end with it (0088): the work leaves the list.
        sentRoute.access = 'none'
        return json({ route: { id: sentRoute.id, version: sentRoute.version, effectiveState: sentRoute.effectiveState, endedKind },
          resultsVoided: 0, resultReportsMarked: 0, dispensingReversed: false, replayed: false })
      }
      // Can't complete (0091): its reads are kept for 7 days, read only.
      sentRoute.access = 'read'
      const item = work.find(entry => entry.id === sentRoute.workItemId)
      const taken = item?.accession?.specimens.filter(entry => entry.status !== 'required').length ?? 0
      sentRoute.notCompleted = { reason: String(body?.reason), sampleTaken: taken > 0, resultRecorded: Boolean(item?.result) }
      return json({ route: { id: sentRoute.id, version: sentRoute.version, effectiveState: sentRoute.effectiveState, endedKind }, reason: body?.reason,
        readUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(), specimensCollected: taken, resultsRecorded: 0, criticalCandidates: 0, replayed: false })
    }
    unexpected.push(`${person.account} ${route}`)
    return json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }

  function sessionOf(who: Person) {
    const here = { id: who.facility.id, membershipId: membership(who), organizationId: `org-${who.facility.id.slice(-4)}`, name: who.facility.name,
      roles: [...who.roles], permissions: [...who.permissions], isPrimary: true, ...(who.selfService ? { selfService: who.selfService } : {}) }
    return json({ actor: { kind: 'staff', id: who.account, email: `${who.account}@example.test`, displayName: who.name, roles: [...who.roles],
      permissions: [], facilities: [here], facility: here }, expiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString() })
  }

  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(init?.method ?? 'GET')
    const address = new URL(String(url))
    sent.push(`${person.account} ${method} ${address.pathname}`)
    if (method === 'GET' && address.pathname === '/api/v1/auth/session') return sessionOf(person)
    return answer(method, address.pathname, address.searchParams, typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined)
  }))

  return {
    sent, unexpected,
    /** Who is signed in from the next request on. */
    as(who: Person) { person = who },
    /** A member who already holds their own grant to the patient (their Access PIN used earlier). */
    grant(who: Person) { grant(who) },
    /** What Lab holds, for the journey's checks: the work items, and each one's latest result value. */
    work: () => work.map(item => ({ id: item.id, facilityId: item.facilityId, routed: item.routeId !== null, latest: current(item)?.value ?? null })),
    /** The orders sent between facilities, as the EHR keeps them. */
    routes: () => routes.map(route => ({ id: route.id, reference: route.reference, effectiveState: route.effectiveState, endedKind: route.endedKind })),
    /**
     * A Haemoglobin request Dr Bello sent to Lakeside Diagnostics, which accepted it with the patient's Health ID: what
     * the first Lakeside journey does through the pages, set up at once for a journey that starts after it.
     */
    sentAndAccepted() {
      const request: LabRequest = { id: next('c'), testCodeSystem: 'LOINC', testCode: '718-7', testDisplay: 'Haemoglobin', priority: 'routine',
        specimenTypeCode: null, clinicalInformation: 'Tired for a month (fictional)', status: 'active', rowVersion: 2, createdAt: NOW() }
      requests.push(request)
      return accept(send(request, LAKESIDE.id)).id
    },
  }
}
