import { describe, expect, it, vi } from 'vitest'
import { FILE_SIGNATURES, SIGNATURE_BYTES, fileStartsAsItsType, startsAsType } from '../fileSignature'
import { PLAIN_JPEG, ascii, metadataPng, toBytes } from './photoFixtures'

/**
 * What a photo or file the patient adds must start with (BACKEND-NEEDS.md §1): its type's leading bytes, read from its
 * first 8 bytes before it is listed. Every value is fictional.
 */
describe('the leading bytes of each type an entry takes', () => {
  it('are JPEG FF D8 FF, PNG 89 50 4E 47 0D 0A 1A 0A and PDF "%PDF-", read from the first 8 bytes', () => {
    expect(FILE_SIGNATURES).toEqual({
      'image/jpeg': [0xff, 0xd8, 0xff],
      'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
    })
    expect(FILE_SIGNATURES['application/pdf']).toEqual(ascii('%PDF-'))
    expect(SIGNATURE_BYTES).toBe(8)
  })

  it('takes bytes that start as the type they say, whatever follows', () => {
    expect(startsAsType(PLAIN_JPEG, 'image/jpeg')).toBe(true)
    expect(startsAsType(metadataPng().file, 'image/png')).toBe(true)
    expect(startsAsType(toBytes(ascii('%PDF-1.7 fictional')), 'application/pdf')).toBe(true)
    expect(startsAsType(toBytes([0xff, 0xd8, 0xff]), 'image/jpeg')).toBe(true)
  })

  it('refuses bytes of another type, too few bytes, and any type but these three', () => {
    const program = toBytes([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
    for (const type of ['image/jpeg', 'image/png', 'application/pdf']) expect(startsAsType(program, type), type).toBe(false)
    expect(startsAsType(PLAIN_JPEG, 'image/png')).toBe(false)
    expect(startsAsType(metadataPng().file, 'application/pdf')).toBe(false)
    expect(startsAsType(new Uint8Array(16), 'application/pdf')).toBe(false)
    expect(startsAsType(toBytes(ascii('%PDF')), 'application/pdf')).toBe(false)
    expect(startsAsType(toBytes([0xff, 0xd8]), 'image/jpeg')).toBe(false)
    expect(startsAsType(metadataPng().file.subarray(0, 7), 'image/png')).toBe(false)
    expect(startsAsType(new Uint8Array(), 'image/jpeg')).toBe(false)
    for (const type of ['image/heic', 'image/gif', '', 'toString', '__proto__', 'constructor']) expect(startsAsType(PLAIN_JPEG, type), type).toBe(false)
  })
})

describe('fileStartsAsItsType', () => {
  it('reads only the file’s first 8 bytes, and goes by the type the file says', async () => {
    const file = new File([PLAIN_JPEG], 'result-slip.jpg', { type: 'image/jpeg' })
    const slice = vi.spyOn(file, 'slice')
    const whole = vi.spyOn(file, 'arrayBuffer')
    expect(await fileStartsAsItsType(file)).toBe(true)
    expect(slice).toHaveBeenCalledWith(0, 8)
    expect(whole).not.toHaveBeenCalled()
    expect(await fileStartsAsItsType(new File([PLAIN_JPEG], 'result-slip.png', { type: 'image/png' }))).toBe(false)
    expect(await fileStartsAsItsType(new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], 'scan.png', { type: 'image/png' }))).toBe(false)
    expect(await fileStartsAsItsType(new File([toBytes(ascii('%PDF-1.4'))], 'discharge.pdf', { type: 'application/pdf' }))).toBe(true)
  })
})
