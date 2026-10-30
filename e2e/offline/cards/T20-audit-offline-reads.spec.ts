import { test, expect } from '../support/devices'
import { readRunClaim } from '../support/env'
import { DEMO } from '../support/guard'
import { PORTAL } from '../support/selectors'

/**
 * T20 (§2.10 C2, §2.11): offline chart opens reach the audit log as ehr.record.read with offline details, and the
 * patient's "Who viewed or changed your record" shows the views. The facility audit page does not show details, so the
 * card reads them from GET /api/v1/audit/events (the page's own call, then older pages with the kit's GET). Run after
 * the cards that open charts offline (T1 to T14); it counts only events since this run started.
 */

interface AuditEvent { sequenceId?: string; occurredAt?: string; action?: string; sourceSystem?: string; details?: Record<string, unknown> | null }
interface AuditPage { items?: AuditEvent[]; nextBeforeSequenceId?: string | null }

test('T20 audit: offline ehr.record.read events with offline details, and the patient\'s access log shows the views', async ({ kit, ehrA: device, patient1, card }) => {
  test.setTimeout(20 * 60_000)
  const startedAt = readRunClaim(kit.env.runId)?.startedAt ?? new Date(Date.now() - 6 * 3_600_000).toISOString()

  const offline = await card.step('Facility audit: offline ehr.record.read events since this run started', async () => {
    await device.ready()
    const first = device.page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/v1/audit/events', { timeout: 60_000 })
    await device.goTo('audit')
    let page = await (await first).json() as AuditPage
    const events: AuditEvent[] = [...(page.items ?? [])]
    const headers = { 'X-Facility-ID': DEMO.facilities.hospital, 'X-Purpose-Of-Use': 'healthcare-operations' }
    for (let more = 0; more < 20 && page.nextBeforeSequenceId && (events.at(-1)?.occurredAt ?? '') >= startedAt; more++) {
      const answer = await device.guard.get(`/api/v1/audit/events?limit=50&beforeSequenceId=${encodeURIComponent(page.nextBeforeSequenceId)}`, headers)
      if (!answer.ok()) break
      page = await answer.json() as AuditPage
      events.push(...(page.items ?? []))
    }
    const offlineReads = events.filter(event => event.action === 'ehr.record.read' && (event.occurredAt ?? '') >= startedAt
      && (event.sourceSystem === 'health-id-offline' || event.details?.offline === true))
    const summary = offlineReads.map(event => ({
      occurredAt: event.occurredAt, sourceSystem: event.sourceSystem,
      section: event.details?.section, clock: event.details?.clock, clamped: event.details?.clamped, seq: event.details?.seq,
    }))
    await card.info.attach('offline audit events', { body: JSON.stringify({ since: startedAt, read: events.length, offline: summary }, null, 2), contentType: 'application/json' })
    card.note(`Read ${events.length} audit events; ${offlineReads.length} offline ehr.record.read since ${startedAt}`)
    await card.snap(device, 'facility audit')
    expect(offlineReads.length, 'no offline ehr.record.read events since this run started (T1 and later open charts offline)').toBeGreaterThan(0)
    for (const event of offlineReads) expect(event.details?.offline, 'details.offline').toBe(true)
    return offlineReads.length
  })

  await card.step('Demo Patient One: "Who viewed or changed your record" shows the views', async () => {
    await patient1.ready()
    await patient1.openAccess()
    await expect(patient1.page.getByRole('heading', { name: PORTAL.accessLogTitle })).toBeVisible({ timeout: 45_000 })
    await expect(patient1.page.getByText(PORTAL.accessLogViewed).first(), 'no "Viewed your record" entry').toBeVisible({ timeout: 45_000 })
    card.note(`The audit log had ${offline} offline view(s); the patient's access log shows "${PORTAL.accessLogViewed}".`)
    await card.snap(patient1, 'who viewed or changed your record')
  })
})
