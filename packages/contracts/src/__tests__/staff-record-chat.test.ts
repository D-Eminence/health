import { describe, expect, it } from 'vitest'
import { HID_ENDPOINTS, parsePatientChatAvailability, parsePatientChat } from '../index'
import { assertEndpointAllowed } from '../boundaries'

/**
 * Staff record chat as hid-system main serves it (ADR-069, 0101; docs/INTERFACE_CONTRACT.md, "Staff record chat"):
 * four staff routes under /ehr/patients/:patientId/chat, each needing ehr.record-chat.use, for direct care.
 */
const find = (name: string) => HID_ENDPOINTS.find(endpoint => endpoint.name === name)

describe('staff record chat registry entries', () => {
  it.each([
    ['ehr.staffPatientChatAvailability', '/api/v1/ehr/patients/:patientId/chat/availability', ['GET']],
    ['ehr.staffPatientChat', '/api/v1/ehr/patients/:patientId/chat', ['POST']],
    ['ehr.staffPatientChatHistory', '/api/v1/ehr/patients/:patientId/chat/history', ['GET', 'DELETE']],
  ])('records %s as served by main, needing ehr.record-chat.use for each method', (name, path, methods) => {
    const endpoint = find(name)
    expect(endpoint).toMatchObject({ path, status: 'surface-verified', service: 'ehr', auth: { kind: 'authenticated' } })
    expect([...endpoint!.methods]).toEqual(methods)
    for (const method of methods) expect(endpoint!.permissions?.[method as 'GET']).toEqual(['ehr.record-chat.use'])
    expect(endpoint!.note).toMatch(/direct care only/)
    expect(endpoint!.note).toMatch(/ADR-069/)
  })

  it('still records the source viewer as not served by main', () => {
    expect(find('ehr.staffPatientChatSource')).toMatchObject({ status: 'proposed' })
    expect(find('ehr.staffPatientChatSource')?.note).toMatch(/not served by hid-system main/)
  })

  it('names no two endpoints at one route and method', () => {
    const seen = new Set<string>()
    for (const endpoint of HID_ENDPOINTS) for (const method of endpoint.methods) {
      const key = `${method} ${endpoint.path}`
      expect(seen.has(key), key).toBe(false)
      seen.add(key)
    }
  })

  it('lets only the provider contexts call them', () => {
    for (const name of ['ehr.staffPatientChatAvailability', 'ehr.staffPatientChat', 'ehr.staffPatientChatHistory']) {
      for (const app of ['staff-web', 'ehr-web'] as const) expect(() => assertEndpointAllowed(app, name)).not.toThrow()
      expect(() => assertEndpointAllowed('patient-web', name)).toThrow(/Staff record chat requires a provider patient context/)
    }
  })
})

describe('staff availability and answers', () => {
  const on = { available: true, noticeVersion: 'ADR-069@2026-10-17', historyLimit: 50, maxQuestionLength: 1000, released: ['encounters', 'notes'] }
  it('reads the categories withheld from this member, and still reads the patient shape without them', () => {
    expect(parsePatientChatAvailability({ ...on, withheld: ['vitals', 'labRequests', 'labResults'] }))
      .toEqual({ ...on, withheld: ['vitals', 'labRequests', 'labResults'] })
    expect(parsePatientChatAvailability(on)).toEqual(on)
    expect(parsePatientChatAvailability({ available: false })).toEqual({ available: false })
  })

  it('refuses a withheld list that is not a list of names', () => {
    expect(() => parsePatientChatAvailability({ ...on, withheld: 'labResults' })).toThrow(/invalid availability/)
    expect(() => parsePatientChatAvailability({ ...on, withheld: [1] })).toThrow(/invalid availability/)
    expect(() => parsePatientChatAvailability({ ...on, withheld: [''] })).toThrow(/invalid availability/)
  })

  it('reads a staff answer as the patient answer (the contract is shared), and refuses the staging shape', () => {
    const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
    const reply = { status: 'answered', answer: 'A.', conversationId: id(2), messageId: id(3), createdAt: '2026-10-17T10:00:00.000Z',
      idempotentReplay: false, blocks: [{ kind: 'record', text: 'A.', references: [1] }],
      sources: [{ number: 1, kind: 'vital', id: id(4), recordedOn: '2026-10-01', effectiveOn: null, title: 'Vital signs' }],
      coverage: { complete: false, released: ['encounters'], withheld: ['labRequests', 'labResults'], truncated: true, selectedCount: 1, recordCount: 3 } }
    expect(parsePatientChat(reply).coverage.withheld).toEqual(['labRequests', 'labResults'])
    expect(() => parsePatientChat({ status: 'ready', answer: 'A.', sources: [] })).toThrow()
  })
})
