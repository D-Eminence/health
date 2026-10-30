import { setTimeout as sleep } from 'node:timers/promises'
import { test, expect } from '../support/devices'
import type { Device } from '../support/devices'
import type { HostName } from '../support/guard'
import { ROUTES } from '../support/selectors'

/**
 * T18 (D11), read-only: load pages on ehr., migrate. and app. and collect what the report-only Content Security Policy
 * reports: console messages and securitypolicyviolation events. The devices are read-only (the guard refuses every
 * write but a session refresh) and nothing signs in: a signed-out profile collects from the sign-in pages.
 */

interface Violation { directive: string; blocked: string; source: string; line: number; disposition: string }

const PAGES: readonly { host: HostName; profile: string; paths: readonly string[] }[] = [
  { host: 'ehr', profile: 'A', paths: [ROUTES.staff.signIn, ROUTES.staff.clinical, ROUTES.staff.patients, ROUTES.staff.audit] },
  { host: 'migrate', profile: 'A', paths: [ROUTES.staff.signIn, ROUTES.staff.ocr, ROUTES.staff.migrate] },
  { host: 'app', profile: 'patient1', paths: [ROUTES.portal.signIn, ROUTES.portal.home, ROUTES.portal.access] },
]

test('T18 CSP report-only: collect the violations on ehr., migrate. and app.', async ({ kit, card }) => {
  test.setTimeout(20 * 60_000)
  const found: Record<string, { header: boolean; console: string[]; events: Violation[] }> = {}

  for (const { host, profile, paths } of PAGES) {
    const device: Device = await kit.reader(profile, host)
    const seen = { header: false, console: [] as string[], events: [] as Violation[] }
    found[host] = seen
    try {
      await device.page.addInitScript(() => {
        const list: unknown[] = []
        Object.defineProperty(window, '__hidCspViolations', { value: list })
        document.addEventListener('securitypolicyviolation', event => {
          list.push({ directive: event.violatedDirective, blocked: event.blockedURI, source: event.sourceFile, line: event.lineNumber, disposition: event.disposition })
        })
      })
      device.page.on('console', message => {
        if (/Content[- ]Security[- ]Policy|\[Report Only\]/i.test(message.text())) seen.console.push(`${message.type()}: ${message.text().slice(0, 400)}`)
      })
      device.page.on('response', response => {
        if (!response.request().isNavigationRequest() || !response.headers()['content-security-policy-report-only']) return
        try { if (response.request().frame() === device.page.mainFrame()) seen.header = true } catch { /* not a page's request */ }
      })
      for (const path of paths) {
        await card.step(`${host}: ${path}`, async () => {
          await device.page.goto(device.url(path))
          await device.page.waitForLoadState('load')
          await sleep(4000)
          const events = await device.page.evaluate(() => (window as unknown as { __hidCspViolations?: Violation[] }).__hidCspViolations ?? [])
          seen.events.push(...events)
          await card.snap(device, `${host} ${path}`)
        })
      }
    } finally { await device.close() }
    card.note(`${host}: report-only header ${seen.header ? 'present' : 'absent'}; ${seen.console.length} console message(s); ${seen.events.length} violation event(s)`)
  }

  await card.info.attach('csp report-only violations', { body: JSON.stringify(found, null, 2), contentType: 'application/json' })
  for (const [host, seen] of Object.entries(found)) {
    expect.soft(seen.header, `${host}: HTML responses carry Content-Security-Policy-Report-Only`).toBe(true)
  }
})
