import { describe, expect, it } from 'vitest'
import { PhotoMetadataError, stripPhotoMetadata, withoutPhotoMetadata, type PhotoMetadataProblem, type StrippedPhotoType } from '../photoMetadata'
import {
  ADOBE, DHT, DQT, DRI, ENTROPY, EOI, ICC, JFIF, NEVER_LEFT, PLACE_TAKEN, PLAIN_JPEG, PNG_SIGNATURE, SOF0, SOI, SOS,
  ascii, chunk, contains, gpsTaggedJpeg, metadataPng, pngChunks, progressiveJpeg, rationals, segment, toBytes,
} from './photoFixtures'

/**
 * A photo's metadata taken out before upload (NDPA data minimisation; BACKEND-NEEDS.md §1), never re-encoded: what is
 * kept is the original's bytes, segment by segment and chunk by chunk, and a file that can't be walked cleanly throws.
 */

const refusal = (bytes: Uint8Array, type: StrippedPhotoType): PhotoMetadataProblem | null => {
  try {
    stripPhotoMetadata(bytes, type)
    return null
  } catch (error) {
    expect(error).toBeInstanceOf(PhotoMetadataError)
    return (error as PhotoMetadataError).problem
  }
}

const leftOf = (stripped: Uint8Array) => NEVER_LEFT.filter(needle => contains(stripped, needle))

describe('a JPEG', () => {
  it('loses EXIF (GPS, camera, thumbnail), XMP, IPTC, the MPF index, comments and the image appended after it', () => {
    const { file, stripped } = gpsTaggedJpeg()
    // The fixture carries all of it to begin with.
    expect(leftOf(file).length).toBeGreaterThan(15)
    const out = stripPhotoMetadata(file, 'image/jpeg')
    expect(leftOf(out)).toEqual([])
    // Exactly what decoding needs, in its place, byte for byte: nothing re-encoded, nothing added.
    expect([...out]).toEqual([...stripped])
    // It ends at the primary image's end: the appended JPEG, with its own EXIF and GPS, is gone.
    expect([...out.subarray(-2)]).toEqual(EOI)
    expect(out.filter((byte, at) => byte === 0xff && out[at + 1] === 0xd8)).toHaveLength(1)
    // The input is left as it was.
    expect(contains(file, 'Exif')).toBe(true)
  })

  it('keeps the tables, frame, scan and entropy-coded data identical, stuffed bytes and restarts included', () => {
    const out = stripPhotoMetadata(gpsTaggedJpeg().file, 'image/jpeg')
    const tables = toBytes(DQT, SOF0, DHT, DRI, SOS, ENTROPY, EOI)
    expect(contains(out, tables)).toBe(true)
    expect(contains(out, [0xff, 0x00, 0x56, 0xff, 0xd0])).toBe(true)
  })

  it('keeps the colour profile (ICC) and Adobe’s colour transform, and JFIF', () => {
    const out = stripPhotoMetadata(gpsTaggedJpeg().file, 'image/jpeg')
    for (const kept of [ICC, ADOBE, JFIF]) expect(contains(out, kept)).toBe(true)
  })

  it('keeps both scans of a progressive JPEG and the table between them', () => {
    const { file, stripped } = progressiveJpeg()
    expect([...stripPhotoMetadata(file, 'image/jpeg')]).toEqual([...stripped])
  })

  it('leaves a JPEG with nothing to take out exactly as it was', () => {
    expect([...stripPhotoMetadata(PLAIN_JPEG, 'image/jpeg')]).toEqual([...PLAIN_JPEG])
    // And stripping twice is stripping once: the same bytes, so the same SHA-256 for a retried upload.
    const once = stripPhotoMetadata(gpsTaggedJpeg().file, 'image/jpeg')
    expect([...stripPhotoMetadata(once, 'image/jpeg')]).toEqual([...once])
  })

  it('keeps JFIF without its thumbnail, a second picture', () => {
    const withThumbnail = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0xaa, 0xbb, 0xcc])
    const out = stripPhotoMetadata(toBytes(SOI, withThumbnail, DQT, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg')
    expect([...out]).toEqual([...PLAIN_JPEG])
    expect(contains(out, [0xaa, 0xbb, 0xcc])).toBe(false)
  })

  it('drops APP0 that is not JFIF, and every other APPn: APP3 to APP12 and APP15', () => {
    const others = [0xe0, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xef].map(marker => segment(marker, ascii('FictionalVendor 6.4535N')))
    const out = stripPhotoMetadata(toBytes(SOI, ...others, DQT, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg')
    expect([...out]).toEqual([...toBytes(SOI, DQT, SOF0, DHT, SOS, ENTROPY, EOI)])
  })

  it('does not take FF D9 inside a segment (the EXIF thumbnail’s) for the end of the image', () => {
    // The fixture's thumbnail ends in FF D9 inside APP1: a walk by length steps over it.
    const { file } = gpsTaggedJpeg()
    expect(stripPhotoMetadata(file, 'image/jpeg').length).toBe(gpsTaggedJpeg().stripped.length)
  })

  it('leaves out fill bytes between segments, and keeps a scan’s bytes as they are', () => {
    const scanWithFill = [...ENTROPY, 0xff]
    const out = stripPhotoMetadata(toBytes(SOI, [0xff, 0xff], DQT, SOF0, DHT, SOS, scanWithFill, EOI), 'image/jpeg')
    expect([...out]).toEqual([...toBytes(SOI, DQT, SOF0, DHT, SOS, scanWithFill, EOI)])
  })

  it('refuses what it cannot walk cleanly', () => {
    const body = [...DQT, ...SOF0, ...DHT, ...SOS, ...ENTROPY]
    const cases: Array<[string, Uint8Array, PhotoMetadataProblem]> = [
      ['empty', toBytes([]), 'not-jpeg'],
      ['a PNG that says it is a JPEG', metadataPng().file, 'not-jpeg'],
      ['a segment running past the end', toBytes(SOI, [0xff, 0xe1, 0x00, 0x40], ascii('Exif')), 'truncated'],
      ['no end of image', toBytes(SOI, body), 'truncated'],
      ['cut inside a segment’s length', toBytes(SOI, [0xff, 0xdb, 0x00]), 'truncated'],
      ['bytes that are not a marker between segments', toBytes(SOI, JFIF, [0x00, 0x12], body, EOI), 'bad-marker'],
      ['a scan before the frame', toBytes(SOI, DQT, SOS, ENTROPY, EOI), 'bad-marker'],
      ['the end of image before any scan', toBytes(SOI, DQT, SOF0, EOI), 'no-image'],
      ['a restart outside a scan', toBytes(SOI, [0xff, 0xd0], body, EOI), 'bad-marker'],
      ['a segment of length 1', toBytes(SOI, [0xff, 0xdb, 0x00, 0x01], body, EOI), 'bad-marker'],
      ['a JPEG-LS frame', toBytes(SOI, segment(0xf7, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]), SOS, ENTROPY, EOI), 'bad-marker'],
      ['a second start of image', toBytes(SOI, SOI, body, EOI), 'bad-marker'],
      ['a reserved marker', toBytes(SOI, [0xff, 0x02, 0x00, 0x02], body, EOI), 'bad-marker'],
    ]
    for (const [what, bytes, problem] of cases) expect(refusal(bytes, 'image/jpeg'), what).toBe(problem)
    // A metadata segment cut short is refused too, never passed on as it is.
    const { file } = gpsTaggedJpeg()
    expect(refusal(file.subarray(0, 40), 'image/jpeg')).toBe('truncated')
  })
})

describe('a PNG', () => {
  it('loses eXIf, tEXt, zTXt, iTXt, tIME, C2PA’s caBX, iDOT, a private chunk and what follows IEND; keeps IHDR, PLTE, IDAT and IEND byte for byte', () => {
    const { file, stripped } = metadataPng()
    expect(leftOf(file).length).toBeGreaterThan(5)
    const out = stripPhotoMetadata(file, 'image/png')
    expect([...out]).toEqual([...stripped])
    expect(leftOf(out)).toEqual([])
    expect([...out.subarray(0, 8)]).toEqual(PNG_SIGNATURE)
    // Each chunk kept is the original, so its CRC is still right.
    expect(pngChunks(out)).toEqual([['IHDR', true], ['PLTE', true], ['IDAT', true], ['IEND', true]])
  })

  it('keeps the chunks its display needs, the colour ones among them', () => {
    const { kept } = metadataPng()
    const colour = [chunk('sRGB', [0]), chunk('gAMA', [0, 0, 0xb1, 0x8f]), chunk('iCCP', [...ascii('fictional'), 0, 0, 0x78, 0x9c]), chunk('pHYs', [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])]
    const file = toBytes(PNG_SIGNATURE, kept.ihdr, ...colour, kept.plte, chunk('tRNS', [0]), kept.idat, kept.iend)
    expect([...stripPhotoMetadata(file, 'image/png')]).toEqual([...file])
    // Each of the others display uses (colour, HDR, background, histogram, animation) is kept too, as it was.
    const display = ['cHRM', 'sBIT', 'cICP', 'mDCV', 'cLLI', 'bKGD', 'hIST', 'acTL', 'fcTL', 'fdAT'].map(type => chunk(type, [1, 2, 3, 4]))
    const shown = toBytes(PNG_SIGNATURE, kept.ihdr, ...display, kept.plte, kept.idat, kept.iend)
    expect([...stripPhotoMetadata(shown, 'image/png')]).toEqual([...shown])
  })

  it('drops every other ancillary chunk, whatever it is: none of it is the picture', () => {
    const { kept } = metadataPng()
    const others = ['sPLT', 'oFFs', 'pCAL', 'sCAL', 'sTER', 'dSIG', 'gIFg', 'vpAg', 'caBX', 'iDOT', 'prVt', 'zzZz']
      .map(type => chunk(type, ascii('FictionalVendor 6.4535N')))
    const file = toBytes(PNG_SIGNATURE, kept.ihdr, ...others, kept.plte, kept.idat, ...others, kept.iend)
    const out = stripPhotoMetadata(file, 'image/png')
    expect([...out]).toEqual([...toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat, kept.iend)])
    expect(contains(out, '6.4535N')).toBe(false)
  })

  it('takes out the earlier spellings of eXIf too', () => {
    const { kept } = metadataPng()
    const file = toBytes(PNG_SIGNATURE, kept.ihdr, chunk('exIf', [...ascii('II*'), 0]), chunk('zxIf', [1, 2, 3]), kept.plte, kept.idat, kept.iend)
    expect([...stripPhotoMetadata(file, 'image/png')]).toEqual([...toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat, kept.iend)])
  })

  it('refuses what it cannot walk cleanly', () => {
    const { file, kept } = metadataPng()
    const head = toBytes(PNG_SIGNATURE, kept.ihdr)
    const cases: Array<[string, Uint8Array, PhotoMetadataProblem]> = [
      ['empty', toBytes([]), 'not-png'],
      ['a JPEG that says it is a PNG', gpsTaggedJpeg().file, 'not-png'],
      ['no IEND', toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat), 'truncated'],
      ['a chunk running past the end', file.subarray(0, file.length - 40), 'truncated'],
      ['a chunk type that is not four letters', toBytes(head, [0, 0, 0, 0], [0x49, 0x44, 0x41, 0x31], [0, 0, 0, 0], kept.iend), 'bad-chunk'],
      ['a first chunk that is not IHDR', toBytes(PNG_SIGNATURE, kept.plte, kept.ihdr, kept.idat, kept.iend), 'bad-chunk'],
      ['a chunk longer than a PNG allows', toBytes(head, [0xff, 0xff, 0xff, 0xff], ascii('IDAT'), [0, 0, 0, 0]), 'bad-chunk'],
      ['IEND before any image data', toBytes(head, kept.iend), 'no-image'],
      ['IEND with data', toBytes(head, kept.idat, chunk('IEND', [1])), 'no-image'],
    ]
    for (const [what, bytes, problem] of cases) expect(refusal(bytes, 'image/png'), what).toBe(problem)
  })
})

describe('withoutPhotoMetadata, the file as it is uploaded', () => {
  it('gives a photo as a new File of the same name and type holding only its stripped bytes; the picked file is unchanged', async () => {
    const { file: original, stripped } = gpsTaggedJpeg()
    const picked = new File([original], 'IMG_0001.jpg', { type: 'image/jpeg', lastModified: 7 })
    const ready = await withoutPhotoMetadata(picked)
    expect(ready).not.toBe(picked)
    expect(ready).toBeInstanceOf(File)
    expect([ready.name, ready.type, ready.size]).toEqual(['IMG_0001.jpg', 'image/jpeg', stripped.length])
    expect([...new Uint8Array(await ready.arrayBuffer())]).toEqual([...stripped])
    expect(contains(new Uint8Array(await picked.arrayBuffer()), rationals(PLACE_TAKEN.latitude))).toBe(true)
  })

  it('gives a PNG the same way', async () => {
    const { file, stripped } = metadataPng()
    const ready = await withoutPhotoMetadata(new File([file], 'scan.png', { type: 'image/png' }))
    expect([...new Uint8Array(await ready.arrayBuffer())]).toEqual([...stripped])
  })

  it('gives a PDF as it is, the very File', async () => {
    const pdf = new File([toBytes(ascii('%PDF-1.7 fictional, Exif and all'))], 'discharge.pdf', { type: 'application/pdf' })
    expect(await withoutPhotoMetadata(pdf)).toBe(pdf)
  })

  it('refuses a photo that says it is a PDF, rather than send it with its metadata', async () => {
    for (const bytes of [gpsTaggedJpeg().file, metadataPng().file]) {
      const disguised = new File([bytes], 'photo.pdf', { type: 'application/pdf' })
      await expect(withoutPhotoMetadata(disguised)).rejects.toMatchObject({ name: 'PhotoMetadataError', problem: 'type-mismatch' })
    }
  })

  it('refuses a photo whose bytes are not the type it says', async () => {
    await expect(withoutPhotoMetadata(new File([gpsTaggedJpeg().file], 'renamed.png', { type: 'image/png' })))
      .rejects.toBeInstanceOf(PhotoMetadataError)
    await expect(withoutPhotoMetadata(new File([toBytes(ascii('not a photo'))], 'fake.jpg', { type: 'image/jpeg' })))
      .rejects.toMatchObject({ problem: 'not-jpeg' })
  })
})
