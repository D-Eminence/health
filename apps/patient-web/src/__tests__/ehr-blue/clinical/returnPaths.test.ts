// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCompleteHealthId } from '@hid/contracts'
import { describe, expect, it } from 'vitest'
import { clinicalReturnPath } from '../../../ehr-blue/clinical/returnPaths'

/**
 * Where a sign-in may bring a person back to in the clinical workspaces: each page by its route shape, with record ids
 * only, and every address that is refused. Ids and hosts are fictional.
 */

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../..')

const ENC = 'e0000000-0000-4000-8000-000000000001'
const REC = 'b1c6ef36-0000-4000-8000-000000000001'
const RX = 'b0000000-0000-4000-8000-000000000001'
const LAB = 'c0000000-0000-4000-8000-000000000001'
const REQ = 'a1000000-0000-4000-8000-000000000009'
const HID = 'HID-ZDEMAAA2'

/** The workspace segments ./pages.ts lists ('patients/*' gives 'patients'), read from the file itself. */
const pageSegments = [...readFileSync(resolve(src, 'ehr-blue/clinical/pages.ts'), 'utf8').matchAll(/\{ path: '([a-z-]+)\/\*'/g)]
  .map(match => match[1]!)
/** Those with a permission are today's live workspaces; the rest are samples. */
const livePages = [...readFileSync(resolve(src, 'ehr-blue/clinical/pages.ts'), 'utf8').matchAll(/\{ path: '([a-z-]+)\/\*'[^\n]*permission: '/g)]
  .map(match => match[1]!)

/** Today's Status filters, read from staff/api.ts (the lists consent/requests.ts statusFilter accepts). */
const apiText = readFileSync(resolve(src, 'staff/api.ts'), 'utf8')
const listOf = (name: string) => JSON.parse((new RegExp(`export const ${name} = (\\[[^\\]]*\\]) as const`).exec(apiText)?.[1] ?? '[]').replaceAll('\'', '"')) as string[]
const STATUS_FILTERS = [...listOf('ACCESS_REQUEST_STATUSES'), ...listOf('ACCESS_OUTCOME_FILTERS')]

describe('clinicalReturnPath: the pages a sign-in may come back to', () => {
  it('reads twenty workspaces from pages.ts, six of them live (a guard on the readers below)', () => {
    expect(pageSegments).toHaveLength(20)
    expect(livePages).toEqual(['patients', 'triage', 'clinical', 'nursing', 'emergency', 'requests'])
    expect(STATUS_FILTERS).toEqual(['pending', 'approved', 'denied', 'revoked', 'expired', 'active', 'closed'])
  })

  it('keeps every workspace list in pages.ts, live or sample, as it is', () => {
    for (const segment of pageSegments) {
      const path = `/provider/${segment}`
      expect(clinicalReturnPath(path), path).toBe(path)
    }
  })

  it.each([
    ['an encounter', `/provider/clinical/${ENC}`],
    ['a prescription raised from it', `/provider/clinical/${ENC}/orders/pharmacy/${RX}`],
    ['a lab request raised from it', `/provider/clinical/${ENC}/orders/laboratory/${LAB}`],
    ['a vitals record, by its encounter and its id', `/provider/triage/${ENC}~${REC}`],
    ['a nursing record, by its encounter and its id', `/provider/nursing/${ENC}~${REC}`],
    ['an access request', `/provider/requests/${REQ}`],
    ['a UUID of another version (the shape is checked, not the version)', '/provider/clinical/018f3c1e-7b2a-7c3d-9e4f-0123456789ab'],
    ['ids of digits only', '/provider/triage/00000000-0000-0000-0000-000000000000~12345678-9012-3456-7890-123456789012'],
  ])('keeps %s', (_name, path) => {
    expect(clinicalReturnPath(path)).toBe(path)
  })

  it('keeps an access request page with each of today’s Status filters, and no other query', () => {
    for (const status of STATUS_FILTERS) {
      const path = `/provider/requests/${REQ}?status=${status}`
      expect(clinicalReturnPath(path), path).toBe(path)
    }
  })
})

describe('clinicalReturnPath: what is never kept', () => {
  it.each([
    // Forms hold nothing to come back to; the open patient and the emergency summary are memory only.
    '/provider/clinical/new', '/provider/triage/new', '/provider/nursing/new', '/provider/requests/new', '/provider/requests/pin',
    '/provider/patients/open', '/provider/patients/pin', '/provider/emergency/summary', '/provider/emergency/new',
    `/provider/clinical/${ENC}/orders/new/pharmacy`, `/provider/clinical/${ENC}/orders/new/laboratory`,
    `/provider/clinical/new/orders/pharmacy/${RX}`, `/provider/clinical/${ENC}/orders/pharmacy/new`, '/provider/clinical/orders',
    '/provider/requests/new?status=pending', '/provider/triage/new~x', '/provider/nursing/x~new',
  ])('a form, the open patient or the emergency summary: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    // A sample record does not outlive the page; the emergency board's records are the sample engine's.
    `/provider/appointments/${REC}`, '/provider/appointments/new', '/provider/journey/visit-1', `/provider/emergency/${REC}`,
  ])('a sample record or form: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    `/provider/clinical/${HID}`, '/provider/clinical/hid-zdemaaa2', '/provider/clinical/HIDZDEMAAA2', '/provider/clinical/HID_ZDEMAAA2',
    '/provider/clinical/HID-ABCD', `/provider/clinical/x${HID}y`, `/provider/triage/${HID}~${REC}`, `/provider/nursing/${ENC}~${HID}`,
    `/provider/clinical/${ENC}/orders/pharmacy/${HID}`, `/provider/clinical/${HID}/orders/laboratory/${LAB}`, `/provider/requests/${HID}`,
    `/provider/requests/${HID}?status=pending`, `/provider/requests/${REQ}?status=${HID}`,
  ])('a Health ID with its prefix anywhere: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  /**
   * A Health ID typed as people type it: a doubled or moved separator, a mangled prefix, or no prefix at all, in any
   * case. Each is a complete Health ID once normalized (@hid/contracts healthId.ts), and none is a record id.
   */
  const healthIdSpellings: ReadonlyArray<readonly [string, string]> = [
    ['HID--ABCDEF', '/provider/clinical/HID--ABCDEF'],
    ['H-ID-ABCDEF', '/provider/clinical/H-ID-ABCDEF'],
    ['ZDEMAAA2', '/provider/clinical/ZDEMAAA2'],
    ['zdemaaa2', '/provider/clinical/zdemaaa2'],
    ['ZDEMAAA2', '/provider/triage/ZDEMAAA2~x'],
    ['zdemaaa2', `/provider/triage/${ENC}~zdemaaa2`],
    ['ZDEMAAA2', `/provider/nursing/ZDEMAAA2~${REC}`],
    ['abc234', `/provider/clinical/${ENC}/orders/pharmacy/abc234`],
    ['ABC234', `/provider/clinical/ABC234/orders/laboratory/${LAB}`],
    ['ABC234', '/provider/requests/ABC234?status=pending'],
    ['abcdef', '/provider/requests/abcdef'],
    ['ABCDEFGH23456789ABCDEFGH23456789', '/provider/clinical/ABCDEFGH23456789ABCDEFGH23456789'],
    ['abcdef23abcdef23abcdef23abcdef23', '/provider/clinical/abcdef23abcdef23abcdef23abcdef23'],
  ]

  it.each(healthIdSpellings)('a Health ID however it is typed, %s: %s', (typed, path) => {
    expect(isCompleteHealthId(typed), typed).toBe(true)
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    '/provider/clinical/hid__abcdef', '/provider/clinical/HI-DABCDEF', '/provider/clinical/HID~ABCDEF', '/provider/triage/HID~ABCDEF',
  ])('a Health ID with a prefix even the Health ID field would not take: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    ['one character', '/provider/clinical/x'],
    ['letters, digits and underscores', '/provider/triage/enc_1~rec_2'],
    ['64 letters', `/provider/clinical/${'a'.repeat(64)}`],
    ['a UUID in capitals', `/provider/clinical/${ENC.toUpperCase()}`],
    ['a UUID with one capital', '/provider/clinical/E0000000-0000-4000-8000-000000000001'],
    ['a UUID one character too long', `/provider/clinical/${ENC}0`],
    ['a UUID one character short', `/provider/clinical/${ENC.slice(0, -1)}`],
    ['a UUID with a group one too long', '/provider/clinical/e00000000-000-4000-8000-000000000001'],
    ['a UUID without its hyphens', `/provider/clinical/${ENC.replaceAll('-', '')}`],
    ['a UUID in braces', `/provider/clinical/{${ENC}}`],
    ['a UUID with a letter past f', '/provider/clinical/g0000000-0000-4000-8000-000000000001'],
    ['a UUID with underscores', `/provider/clinical/${ENC.replaceAll('-', '_')}`],
    ['an order by a short id', `/provider/clinical/${ENC}/orders/pharmacy/rx-1`],
    ['an order of an encounter in capitals', `/provider/clinical/${ENC.toUpperCase()}/orders/laboratory/${LAB}`],
    ['a record by a short encounter id', `/provider/nursing/enc-1~${REC}`],
    ['a record by a short record id', `/provider/triage/${ENC}~rec-1`],
    ['an access request by a short id', '/provider/requests/req-1?status=pending'],
    ['an access request in capitals', `/provider/requests/${REQ.toUpperCase()}`],
  ])('an id that is not a lower-case UUID, %s: %s', (_name, path) => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    '/provider/patients/p-0000aa11bb22', `/provider/patients/${ENC}`, '/provider/patients/x',
  ])('a patient by any id (Patients has no such page): %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    '/provider/clinical/%48ID-ZDEMAAA2', `/provider/clinical%2F${ENC}`, `/provider/clinical/${ENC}%3Fstatus%3Dpending`,
    '/provider/%2e%2e/admin', `/provider/clinical/${ENC}%23notes`, '/%2F%2Fevil.test', '/provider/clinical/e%00', '/provider/clinical/%65nc',
    `/provider/requests/${REQ}?status=%70ending`, `/provider/requests/${REQ}?status%3Dpending`,
  ])('an encoded address: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    '//evil.test/provider/clinical', '///provider/clinical', '/provider//clinical', `/provider/clinical//${ENC}`, '/provider/clinical/',
    `/provider/clinical/${ENC}/`, `/provider/clinical/${ENC}//orders/pharmacy/${RX}`, '//provider/clinical',
  ])('an empty segment or a trailing slash: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    '/\\evil.test', '\\\\evil.test', '/provider\\clinical', `/provider/clinical\\${ENC}`, `/provider/clinical/${ENC}\\orders\\pharmacy\\${RX}`,
  ])('a backslash: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    '/provider/clinical/..', '/provider/clinical/../../admin', '/provider/./clinical', `/provider/clinical/${ENC}/.`, '/provider/clinical/.',
    `/provider/clinical/${ENC}.json`,
  ])('a dot: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    '/provider/clinical?status=pending', '/provider/requests?status=pending', `/provider/clinical/${ENC}?status=pending`,
    `/provider/clinical/${ENC}?tab=notes`, `/provider/requests/${REQ}?status=unknown`, `/provider/requests/${REQ}?status=`,
    `/provider/requests/${REQ}?status=Pending`, `/provider/requests/${REQ}?STATUS=pending`, `/provider/requests/${REQ}?status=pending&x=1`,
    `/provider/requests/${REQ}?x=pending`, `/provider/requests/${REQ}?status=pending?status=pending`, `/provider/requests/${REQ}?`,
    `/provider/requests/${REQ}?status=pending=x`, `/provider/requests/${REQ}?status`, `/provider/requests/${REQ}??status=pending`,
    `/provider/patients?hid=${HID}`, `/provider/patients?q=ZDEMAAA2`, `/provider/requests/${REQ}?status=pending;x`, '/provider/patients?',
  ])('any other query: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    `/provider/clinical/${ENC}#notes`, `/provider/requests/${REQ}#x`, `/provider/requests/${REQ}?status=pending#x`, '/provider/clinical#',
    `/provider/clinical#${HID}`,
  ])('a fragment: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    '/provider/Clinical', `/provider/Clinical/${ENC}`, '/PROVIDER/clinical', `/provider/clinical/${ENC}/orders/Pharmacy/${RX}`,
    `/provider/clinical/${ENC}/Orders/pharmacy/${RX}`, '/Provider/requests',
  ])('another case than the route’s own: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    `/provider/triage/${ENC}`, `/provider/triage/${ENC}~`, `/provider/triage/~${REC}`, `/provider/triage/a~b~c`, `/provider/clinical/${ENC}~${REC}`,
    `/provider/requests/${ENC}~${REC}`, `/provider/nursing/~`,
  ])('a record key without exactly two ids, or where none is used: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    '', '/', '/provider', '/provider/', '/provider/home', '/provider/laboratory', `/provider/laboratory/work/${LAB}`,
    `/provider/pharmacy/prescriptions/${RX}`, '/provider/registration', '/provider/migrate', '/admin', '/provider/clinicalx',
    '/provider/nursing-task', `/provider/clinical/${ENC}/orders`, `/provider/clinical/${ENC}/orders/pharmacy`,
    `/provider/clinical/${ENC}/orders/radiology/${RX}`, `/provider/clinical/${ENC}/notes`, `/provider/requests/${REQ}/extra`,
    `/provider/clinical/${ENC}/orders/pharmacy/${RX}/x`, '/clinical', `/clinical/${ENC}`, '/patient/records',
  ])('an unknown page: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it.each([
    'https://evil.test/provider/clinical', 'http://ehr.example.test/provider/clinical', 'javascript:alert(1)', 'provider/clinical',
    ' /provider/clinical', '/provider/clinical ', '/provider/clinical\n', '/provider/clinical\t', '/provider/clinical\u0000',
    '/provider/clinıcal', '/provider/clinical/enć', '/provider/clinical@evil.test', '/provider/clinical:443',
    `/provider/clinical/${ENC}+x`,
  ])('an absolute address, a scheme, a space, a control or another character: %s', path => {
    expect(clinicalReturnPath(path)).toBeNull()
  })

  it('an id of any other length, however long the address', () => {
    expect(clinicalReturnPath(`/provider/clinical/${'a'.repeat(300)}`)).toBeNull()
    expect(clinicalReturnPath(`/provider/triage/${ENC}~${REC}${'b'.repeat(300)}`)).toBeNull()
    expect(clinicalReturnPath(`/provider/clinical/${ENC}/orders/laboratory/${LAB}`)).not.toBeNull()
  })

  it('anything that is not a string', () => {
    for (const value of [undefined, null, 42, {}, ['/provider/clinical'], { toString: () => '/provider/clinical' }]) {
      expect(clinicalReturnPath(value as never)).toBeNull()
    }
  })
})

describe('clinicalReturnPath is dark', () => {
  /** Every source file of the app but its tests. */
  function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path)
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : []
    })
  }

  it('is called by nothing in the app yet, so every page works exactly as today until the sign-in hand-off uses it', () => {
    const files = sources(src)
    expect(files.length).toBeGreaterThan(100)
    const callers = files.filter(file => !file.endsWith(join('clinical', 'returnPaths.ts')) && /returnPaths|clinicalReturnPath/.test(readFileSync(file, 'utf8')))
    expect(callers.map(file => relative(src, file))).toEqual([])
  })
})
