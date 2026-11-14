import { describe, expect, it } from 'vitest'
import { REDACTED, redact, redactText, redactUrl } from '../redact'

describe('redactText', () => {
  it('masks Health ID codes, phones, emails and dates in free text', () => {
    expect(redactText('patient HID-4821-QW logged in')).toBe(`patient ${REDACTED} logged in`)
    expect(redactText('called +234 803 555 0111 today')).toContain(REDACTED)
    expect(redactText('sent to ada@example.com')).toBe(`sent to ${REDACTED}`)
    expect(redactText('dob 1988-04-02 recorded')).toBe(`dob ${REDACTED} recorded`)
  })

  it('leaves non-identifying text intact', () => {
    expect(redactText('record saved in 320 ms')).toBe('record saved in 320 ms')
  })
})

describe('redact', () => {
  it('masks sensitive fields but keeps the object shape', () => {
    expect(
      redact({
        hid_code: 'HID-4821-QW',
        full_name: 'Ada Okafor',
        allergies: 'penicillin',
        status: 'active',
        durationMs: 42,
      }),
    ).toEqual({
      hid_code: REDACTED,
      full_name: REDACTED,
      allergies: REDACTED,
      status: 'active',
      durationMs: 42,
    })
  })

  it('matches field names regardless of casing or separators', () => {
    expect(redact({ hidCode: 'x', 'HID-CODE': 'y', phone_e164: 'z' })).toEqual({
      hidCode: REDACTED,
      'HID-CODE': REDACTED,
      phone_e164: REDACTED,
    })
  })

  it('redacts through nested objects and arrays', () => {
    expect(redact({ page: { records: [{ diagnosis: 'x', id: 7 }] } })).toEqual({
      page: { records: [{ diagnosis: REDACTED, id: 7 }] },
    })
  })

  it('strips session material', () => {
    expect(redact({ accessToken: 'abc', authorization: 'Bearer abc' })).toEqual({
      accessToken: REDACTED,
      authorization: REDACTED,
    })
  })

  it('reduces an Error to name and redacted message', () => {
    expect(redact(new Error('failed for HID-99-AA'))).toEqual({
      name: 'Error',
      message: `failed for ${REDACTED}`,
    })
  })

  it('coarsens dates to year-month', () => {
    expect(redact(new Date('1988-04-02T10:00:00Z'))).toBe('1988-04')
  })

  it('stops recursing on deeply nested structures', () => {
    let deep: Record<string, unknown> = { value: 'leaf' }
    for (let i = 0; i < 12; i += 1) deep = { nested: deep }
    expect(JSON.stringify(redact(deep))).toContain(REDACTED)
  })
})

describe('redactUrl', () => {
  it('masks identifiers in the path', () => {
    expect(redactUrl('/hospital/patient-records/HID-4821-QW')).toBe(
      `/hospital/patient-records/${REDACTED}`,
    )
    expect(redactUrl('/records/2f1c9a44-9d3e-4b5a-9f21-9a1f2b3c4d5e')).toBe(`/records/${REDACTED}`)
  })

  it('masks sensitive query parameters and keeps the rest', () => {
    expect(redactUrl('https://app.example/search?q=Ada&page=2')).toBe(
      `https://app.example/search?q=${REDACTED}&page=2`,
    )
  })

  it('keeps ordinary paths readable', () => {
    expect(redactUrl('/patient/records')).toBe('/patient/records')
  })
})
