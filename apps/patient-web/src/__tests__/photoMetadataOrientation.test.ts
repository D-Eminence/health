import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { stripPhotoMetadata, withoutPhotoMetadata } from '../photoMetadata'
import {
  DHT, DQT, ENTROPY, EOI, ICC, JFIF, NEVER_LEFT, PLACE_OF_THE_APPENDED, PLACE_TAKEN, PNG_SIGNATURE, SOF0, SOI, SOS, XMP, APPENDED,
  ascii, chunk, contains, exifTiff, pngChunks, segment, toBytes,
} from './photoFixtures'

/**
 * The one thing a photo keeps of its EXIF: which way up it goes (Orientation, tag 0x0112; BACKEND-NEEDS.md §1), or a
 * portrait photo from a phone shows on its side. The EXIF here is shaped as a phone writes it (the camera's make, model
 * and software, a resolution, the EXIF sub-IFD with the time taken and a MakerNote, the GPS IFD with the place, IFD1
 * with a JPEG thumbnail), in either byte order; what comes out is a new APP1 (or PNG eXIf) holding only the
 * Orientation, built here by hand byte for byte, independently of the code under test. Every value is fictional.
 */

type Bytes = number[]
type Order = 'II' | 'MM'

const MAKE = 'FictionalPhone', MODEL = 'FP-1 Example', SOFTWARE = 'FictionalOS 7.2', TAKEN_AT = '2026:10:30 09:41:07'
const MAKER_NOTE = 'FictionalVendor MakerNote: serial FP1-000123, lens 4.2mm, near 6.4535N'
const THUMBNAIL: Bytes = [0xff, 0xd8, ...ascii('THUMBNAIL-OF-THE-PORTRAIT'), 0xff, 0xd9]

const u16 = (order: Order, n: number): Bytes => order === 'II' ? [n & 0xff, (n >> 8) & 0xff] : [(n >> 8) & 0xff, n & 0xff]
const u32 = (order: Order, n: number): Bytes => order === 'II'
  ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
  : [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

/** An IFD entry: inline bytes (four at most, padded), data placed after the IFD, or the offset of a named IFD or blob. */
type Value = { inline: Bytes } | { data: Bytes } | { to: string }
interface Entry { tag: number; type: number; count: number; value: Value }
interface Ifd { name: string; entries: Entry[]; next?: string }

/**
 * A TIFF as EXIF carries it: the header, then each IFD followed by the data its entries point at, then the blobs. A
 * `to` value or `next` naming an IFD or blob is written as that one's offset, so an IFD can even point back at itself.
 */
function tiff(order: Order, ifds: Ifd[], blobs: Record<string, Bytes> = {}, ifd0At = 8): Bytes {
  const at: Record<string, number> = {}
  let offset = ifd0At
  for (const ifd of ifds) {
    at[ifd.name] = offset
    offset += 2 + 12 * ifd.entries.length + 4
    for (const entry of ifd.entries) if ('data' in entry.value) offset += entry.value.data.length + (entry.value.data.length % 2)
  }
  for (const [name, blob] of Object.entries(blobs)) { at[name] = offset; offset += blob.length }
  const out: Bytes = [...ascii(order), ...u16(order, 42), ...u32(order, ifd0At), ...Array(ifd0At - 8).fill(0)]
  for (const ifd of ifds) {
    let dataAt = at[ifd.name]! + 2 + 12 * ifd.entries.length + 4
    const data: Bytes = []
    out.push(...u16(order, ifd.entries.length))
    for (const { tag, type, count, value } of ifd.entries) {
      out.push(...u16(order, tag), ...u16(order, type), ...u32(order, count))
      if ('inline' in value) out.push(...value.inline, ...Array(4 - value.inline.length).fill(0))
      else if ('to' in value) out.push(...u32(order, at[value.to]!))
      else {
        out.push(...u32(order, dataAt))
        const padded = [...value.data, ...Array(value.data.length % 2).fill(0)]
        data.push(...padded)
        dataAt += padded.length
      }
    }
    out.push(...u32(order, ifd.next ? at[ifd.next]! : 0), ...data)
  }
  for (const blob of Object.values(blobs)) out.push(...blob)
  return out
}

const text = (value: string): Bytes => [...ascii(value), 0]
const rational = (order: Order, numerator: number, denominator: number) => [...u32(order, numerator), ...u32(order, denominator)]
const place = (order: Order, coordinate: typeof PLACE_TAKEN.latitude) => coordinate.flatMap(([n, d]) => rational(order, n, d))
/** The Orientation entry, as a SHORT: `type` and `count` can be made wrong. */
const orientationEntry = (order: Order, value: number, type = 3, count = 1): Entry => ({
  tag: 0x0112, type, count, value: type === 3 ? { inline: u16(order, value) } : { inline: u32(order, value) },
})

/** IFD0 as a phone writes it, Orientation among the camera's details, with the EXIF, GPS and thumbnail IFDs after it. */
function phoneIfds(order: Order, orientation: Entry[] = [orientationEntry(order, 6)]): Ifd[] {
  return [
    { name: 'ifd0', next: 'ifd1', entries: [
      { tag: 0x010f, type: 2, count: MAKE.length + 1, value: { data: text(MAKE) } },
      { tag: 0x0110, type: 2, count: MODEL.length + 1, value: { data: text(MODEL) } },
      ...orientation,
      { tag: 0x011a, type: 5, count: 1, value: { data: rational(order, 72, 1) } },
      { tag: 0x0131, type: 2, count: SOFTWARE.length + 1, value: { data: text(SOFTWARE) } },
      { tag: 0x8769, type: 4, count: 1, value: { to: 'exif' } },
      { tag: 0x8825, type: 4, count: 1, value: { to: 'gps' } },
    ] },
    { name: 'exif', entries: [
      { tag: 0x9003, type: 2, count: TAKEN_AT.length + 1, value: { data: text(TAKEN_AT) } },
      { tag: 0x927c, type: 7, count: MAKER_NOTE.length, value: { data: ascii(MAKER_NOTE) } },
    ] },
    { name: 'gps', entries: [
      { tag: 0x0000, type: 1, count: 4, value: { inline: [2, 2, 0, 0] } },
      { tag: 0x0001, type: 2, count: 2, value: { inline: ascii('N\0') } },
      { tag: 0x0002, type: 5, count: 3, value: { data: place(order, PLACE_TAKEN.latitude) } },
      { tag: 0x0003, type: 2, count: 2, value: { inline: ascii('E\0') } },
      { tag: 0x0004, type: 5, count: 3, value: { data: place(order, PLACE_TAKEN.longitude) } },
    ] },
    { name: 'ifd1', entries: [
      { tag: 0x0201, type: 4, count: 1, value: { to: 'thumbnail' } },
      { tag: 0x0202, type: 4, count: 1, value: { inline: u32(order, THUMBNAIL.length) } },
    ] },
  ]
}
const phoneTiff = (order: Order, orientation?: Entry[]) => tiff(order, phoneIfds(order, orientation), { thumbnail: THUMBNAIL })
const app1 = (tiffBytes: Bytes) => segment(0xe1, [...ascii('Exif'), 0, 0, ...tiffBytes])

/** The only APP1 that may come out, written out by hand: "Exif\0\0", the TIFF header, one entry, no next IFD. */
const MINIMAL_TIFF: Record<Order, (value: number) => Bytes> = {
  II: value => [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, value, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  MM: value => [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, value, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
}
const MINIMAL_APP1 = (order: Order, value: number): Bytes => [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...MINIMAL_TIFF[order](value)]

/** Everything of the camera, the time, the place and the thumbnail that must be gone, in both byte orders. */
const GONE: ReadonlyArray<Bytes | string> = [
  ...NEVER_LEFT.filter(needle => needle !== 'Exif'), MAKE, MODEL, SOFTWARE, TAKEN_AT, MAKER_NOTE, 'MakerNote', 'THUMBNAIL-OF-THE-PORTRAIT',
  ...(['II', 'MM'] as const).flatMap(order => [
    place(order, PLACE_TAKEN.latitude), place(order, PLACE_TAKEN.longitude), place(order, PLACE_OF_THE_APPENDED.latitude),
    rational(order, 72, 1),
    // The pointers to the EXIF and GPS IFDs and the thumbnail: their tag and type.
    [...u16(order, 0x8769), ...u16(order, 4)], [...u16(order, 0x8825), ...u16(order, 4)], [...u16(order, 0x0201), ...u16(order, 4)],
  ]),
]
const leftOf = (out: Uint8Array) => GONE.filter(needle => contains(out, needle))
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const times = (bytes: Uint8Array, needle: Bytes) => {
  let count = 0
  for (let at = 0; at + needle.length <= bytes.length; at += 1) if (needle.every((byte, index) => bytes[at + index] === byte)) count += 1
  return count
}

const PICTURE = [...DQT, ...SOF0, ...DHT, ...SOS, ...ENTROPY, ...EOI]
const NO_APP1 = toBytes(SOI, ICC, PICTURE)

describe('a JPEG from a phone, held sideways (Orientation 6)', () => {
  it.each(['II', 'MM'] as const)('keeps only the orientation, in a new APP1 in the original’s byte order (%s)', order => {
    const file = toBytes(SOI, app1(phoneTiff(order)), XMP, ICC, PICTURE, APPENDED)
    // The fixture carries all of it to begin with.
    expect(leftOf(file).length).toBeGreaterThan(12)
    const out = stripPhotoMetadata(file, 'image/jpeg')
    expect([...out]).toEqual([...toBytes(SOI, MINIMAL_APP1(order, 6), ICC, PICTURE)])
    expect(leftOf(out)).toEqual([])
    // One APP1, one TIFF header, one IFD entry: no IFD1, no sub-IFD.
    expect(times(out, [0xff, 0xe1])).toBe(1)
    expect(times(out, ascii('Exif'))).toBe(1)
  })

  it('puts the APP1 after APP0 JFIF, wherever the EXIF was', () => {
    const after = stripPhotoMetadata(toBytes(SOI, JFIF, app1(phoneTiff('II')), ICC, PICTURE), 'image/jpeg')
    expect([...after]).toEqual([...toBytes(SOI, JFIF, MINIMAL_APP1('II', 6), ICC, PICTURE)])
    const before = stripPhotoMetadata(toBytes(SOI, app1(phoneTiff('II')), JFIF, ICC, PICTURE), 'image/jpeg')
    expect([...before]).toEqual([...after])
    // Without JFIF, straight after the start of image.
    const plain = stripPhotoMetadata(toBytes(SOI, ICC, app1(phoneTiff('MM')), PICTURE), 'image/jpeg')
    expect([...plain]).toEqual([...toBytes(SOI, MINIMAL_APP1('MM', 6), ICC, PICTURE)])
  })

  it.each([2, 3, 4, 5, 6, 7, 8])('keeps Orientation %i', value => {
    const out = stripPhotoMetadata(toBytes(SOI, app1(phoneTiff('II', [orientationEntry('II', value)])), PICTURE), 'image/jpeg')
    expect([...out]).toEqual([...toBytes(SOI, MINIMAL_APP1('II', value), PICTURE)])
  })

  it('is the same bytes every time, so Try again sends the same body with the same SHA-256', async () => {
    const file = toBytes(SOI, JFIF, app1(phoneTiff('II')), XMP, ICC, PICTURE, APPENDED)
    const first = stripPhotoMetadata(file, 'image/jpeg'), second = stripPhotoMetadata(Uint8Array.from(file), 'image/jpeg')
    expect([...second]).toEqual([...first])
    expect(sha256(second)).toBe(sha256(first))
    // Stripping what came out changes nothing: its APP1 is already only the orientation.
    expect(sha256(stripPhotoMetadata(first, 'image/jpeg'))).toBe(sha256(first))
    const picked = new File([file], 'portrait.jpg', { type: 'image/jpeg' })
    const [one, two] = await Promise.all([withoutPhotoMetadata(picked), withoutPhotoMetadata(picked)])
    const [a, b] = await Promise.all([one.arrayBuffer(), two.arrayBuffer()])
    expect(sha256(new Uint8Array(a))).toBe(sha256(first))
    expect(sha256(new Uint8Array(b))).toBe(sha256(first))
  })

  it('leaves the picture’s own bytes as they were: only the APP1 is new', () => {
    const file = toBytes(SOI, JFIF, app1(phoneTiff('II')), ICC, PICTURE)
    const out = stripPhotoMetadata(file, 'image/jpeg')
    expect(contains(out, toBytes(ICC, PICTURE))).toBe(true)
    expect(out.length).toBe(SOI.length + JFIF.length + MINIMAL_APP1('II', 6).length + ICC.length + PICTURE.length)
  })
})

describe('a JPEG with no turn to keep', () => {
  it('has no APP1 at all for Orientation 1 or none, as before', () => {
    for (const orientation of [[orientationEntry('II', 1)], []]) {
      const out = stripPhotoMetadata(toBytes(SOI, app1(phoneTiff('II', orientation)), ICC, PICTURE), 'image/jpeg')
      expect([...out]).toEqual([...NO_APP1])
    }
    // The fixtures the other tests use carry no Orientation: still no APP1.
    expect(contains(stripPhotoMetadata(toBytes(SOI, app1(exifTiff(PLACE_TAKEN)), ICC, PICTURE), 'image/jpeg'), [0xff, 0xe1])).toBe(false)
  })

  it('drops an EXIF it can’t read with certainty rather than refuse the photo', () => {
    const good = phoneTiff('II')
    const withHeader = (bytes: Bytes) => app1(bytes)
    const ifd0Count = (bytes: Bytes, count: number) => [...bytes.slice(0, 8), ...u16('II', count), ...bytes.slice(10)]
    const cases: Array<[string, Bytes]> = [
      ['no TIFF at all', segment(0xe1, [...ascii('Exif'), 0, 0])],
      ['a TIFF shorter than its header', withHeader([0x49, 0x49, 0x2a, 0x00, 0x08])],
      ['a byte order that is neither II nor MM', withHeader([0x49, 0x4d, ...good.slice(2)])],
      ['the wrong TIFF number', withHeader([0x49, 0x49, 0x2b, 0x00, ...good.slice(4)])],
      ['IFD0 inside the header', withHeader([...good.slice(0, 4), ...u32('II', 4), ...good.slice(8)])],
      ['IFD0 past the end', withHeader([...good.slice(0, 4), ...u32('II', 0xfffffff0), ...good.slice(8)])],
      ['IFD0 just past the end', withHeader([...good.slice(0, 4), ...u32('II', good.length - 1), ...good.slice(8)])],
      ['more entries than the TIFF holds', withHeader(ifd0Count(good, 0xffff))],
      ['a TIFF cut off inside IFD0', withHeader(good.slice(0, 8 + 2 + 12 * 3 + 6))],
      ['Orientation as a LONG', withHeader(phoneTiff('II', [orientationEntry('II', 6, 4)]))],
      ['Orientation with two values', withHeader(phoneTiff('II', [orientationEntry('II', 6, 3, 2)]))],
      ['Orientation 0', withHeader(phoneTiff('II', [orientationEntry('II', 0)]))],
      ['Orientation 9', withHeader(phoneTiff('II', [orientationEntry('II', 9)]))],
      ['two Orientations that disagree', withHeader(phoneTiff('II', [orientationEntry('II', 6), orientationEntry('II', 8)]))],
      ['two Orientations that agree', withHeader(phoneTiff('II', [orientationEntry('II', 6), orientationEntry('II', 6)]))],
      ['"Exif" without its two zero bytes', segment(0xe1, [...ascii('Exif'), 0, 1, ...good])],
    ]
    for (const [name, segmentBytes] of cases) {
      const out = stripPhotoMetadata(toBytes(SOI, segmentBytes, ICC, PICTURE), 'image/jpeg')
      expect([...out], name).toEqual([...NO_APP1])
    }
  })

  it('reads IFD0 only: loops in the IFD chain or the sub-IFDs can’t trap it, and only the orientation comes out', () => {
    const loops = tiff('MM', [
      { name: 'ifd0', next: 'ifd0', entries: [
        { tag: 0x010f, type: 2, count: MAKE.length + 1, value: { data: text(MAKE) } },
        orientationEntry('MM', 8),
        { tag: 0x8769, type: 4, count: 1, value: { to: 'ifd0' } },
        { tag: 0x8825, type: 4, count: 1, value: { to: 'gps' } },
      ] },
      { name: 'gps', next: 'gps', entries: [{ tag: 0x8825, type: 4, count: 1, value: { to: 'gps' } }] },
    ])
    const out = stripPhotoMetadata(toBytes(SOI, app1(loops), PICTURE), 'image/jpeg')
    expect([...out]).toEqual([...toBytes(SOI, MINIMAL_APP1('MM', 8), PICTURE)])
    expect(contains(out, MAKE)).toBe(false)
  })

  it('reads only the first APP1 EXIF before the scan, as a browser does', () => {
    // A second APP1 EXIF before the scan, and one after it, are not read: the first says 1, so no APP1 comes out.
    const sideways = app1(phoneTiff('II', [orientationEntry('II', 6)]))
    const upright = app1(phoneTiff('II', [orientationEntry('II', 1)]))
    expect([...stripPhotoMetadata(toBytes(SOI, upright, sideways, PICTURE), 'image/jpeg')]).toEqual([...toBytes(SOI, PICTURE)])
    expect([...stripPhotoMetadata(toBytes(SOI, DQT, SOF0, DHT, SOS, ENTROPY, sideways, EOI), 'image/jpeg')]).toEqual([...toBytes(SOI, PICTURE)])
    // XMP before the EXIF is not EXIF: the EXIF after it is still the first.
    expect([...stripPhotoMetadata(toBytes(SOI, XMP, sideways, upright, PICTURE), 'image/jpeg')]).toEqual([...toBytes(SOI, MINIMAL_APP1('II', 6), PICTURE)])
    // An "Exif" block in any other APPn is never read.
    const elsewhere = [0xe0, 0xe2, 0xe3, 0xef].map(marker => segment(marker, [...ascii('Exif'), 0, 0, ...phoneTiff('II')]))
    expect([...stripPhotoMetadata(toBytes(SOI, ...elsewhere, PICTURE), 'image/jpeg')]).toEqual([...toBytes(SOI, PICTURE)])
  })
})

describe('a PNG', () => {
  const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 3, 0, 0, 0])
  const plte = chunk('PLTE', [0x12, 0x34, 0x56])
  const idat = chunk('IDAT', [...deflateSync(Uint8Array.from([0, 0]))])
  const iend = chunk('IEND', [])
  const comment = chunk('tEXt', [...ascii('Comment'), 0, ...ascii('near 6.4535N')])

  it.each(['II', 'MM'] as const)('keeps only an eXIf’s orientation, in a new eXIf with its own CRC before IDAT (%s)', order => {
    const file = toBytes(PNG_SIGNATURE, ihdr, plte, chunk('eXIf', phoneTiff(order)), comment, idat, iend)
    expect(leftOf(file).length).toBeGreaterThan(8)
    const out = stripPhotoMetadata(file, 'image/png')
    expect([...out]).toEqual([...toBytes(PNG_SIGNATURE, ihdr, plte, chunk('eXIf', MINIMAL_TIFF[order](6)), idat, iend)])
    expect(pngChunks(out)).toEqual([['IHDR', true], ['PLTE', true], ['eXIf', true], ['IDAT', true], ['IEND', true]])
    expect(leftOf(out)).toEqual([])
    // The same bytes every time.
    expect(sha256(stripPhotoMetadata(Uint8Array.from(file), 'image/png'))).toBe(sha256(out))
    expect(sha256(stripPhotoMetadata(out, 'image/png'))).toBe(sha256(out))
  })

  it('drops eXIf as before when it says 1, says nothing, can’t be read, or comes after the image data', () => {
    const plain = toBytes(PNG_SIGNATURE, ihdr, plte, idat, iend)
    const cases: Array<[string, Uint8Array]> = [
      ['Orientation 1', toBytes(PNG_SIGNATURE, ihdr, plte, chunk('eXIf', phoneTiff('II', [orientationEntry('II', 1)])), idat, iend)],
      ['no Orientation', toBytes(PNG_SIGNATURE, ihdr, plte, chunk('eXIf', exifTiff(PLACE_TAKEN)), idat, iend)],
      ['a bad TIFF header', toBytes(PNG_SIGNATURE, ihdr, plte, chunk('eXIf', [0x49, 0x49, 0x2b, 0x00, ...phoneTiff('II').slice(4)]), idat, iend)],
      ['an "Exif" prefix PNG does not have', toBytes(PNG_SIGNATURE, ihdr, plte, chunk('eXIf', [...ascii('Exif'), 0, 0, ...phoneTiff('II')]), idat, iend)],
      ['IFD0 past the end', toBytes(PNG_SIGNATURE, ihdr, plte, chunk('eXIf', [...phoneTiff('II').slice(0, 4), ...u32('II', 4096), ...phoneTiff('II').slice(8)]), idat, iend)],
      ['after IDAT', toBytes(PNG_SIGNATURE, ihdr, plte, idat, chunk('eXIf', phoneTiff('II')), iend)],
      ['an earlier spelling', toBytes(PNG_SIGNATURE, ihdr, plte, chunk('exIf', phoneTiff('II')), chunk('zxIf', phoneTiff('II')), idat, iend)],
    ]
    for (const [name, file] of cases) expect([...stripPhotoMetadata(file, 'image/png')], name).toEqual([...plain])
  })

  it('reads only the first eXIf', () => {
    const file = toBytes(PNG_SIGNATURE, ihdr, chunk('eXIf', phoneTiff('II', [orientationEntry('II', 3)])), plte,
      chunk('eXIf', phoneTiff('MM', [orientationEntry('MM', 6)])), idat, iend)
    expect([...stripPhotoMetadata(file, 'image/png')]).toEqual([...toBytes(PNG_SIGNATURE, ihdr, chunk('eXIf', MINIMAL_TIFF.II(3)), plte, idat, iend)])
  })
})
