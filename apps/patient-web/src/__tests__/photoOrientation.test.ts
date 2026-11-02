import { crc32 as zlibCrc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { PhotoMetadataError, stripPhotoMetadata, withoutPhotoMetadata, type PhotoMetadataProblem, type StrippedPhotoType } from '../photoMetadata'
import {
  ADOBE, APP13, APPENDED, COM, DHT, DQT, DRI, ENTROPY, EOI, EXIF_MAKE, EXIF_MODEL, EXIF_THUMBNAIL, ICC, JFIF, MPF, NEVER_LEFT,
  PLACE_TAKEN, PLAIN_JPEG, PNG_SIGNATURE, SOF0, SOI, SOS, XMP, ascii, chunk, contains, gpsTaggedJpeg, metadataPng, pngChunks,
  segment, toBytes, type Place,
} from './photoFixtures'

/**
 * Which way up a photo is, the one thing of its EXIF kept (the owner's decision, 2 Nov; BACKEND-NEEDS.md §1): when the
 * first EXIF says Orientation 2 to 8, the stripped photo carries a new EXIF built from that value alone, and nothing
 * else of the original's; otherwise no EXIF at all. Every value is fictional.
 */

type Bytes = number[]
type Order = 'II' | 'MM'

const u16 = (order: Order, value: number): Bytes => order === 'II' ? [value & 0xff, (value >> 8) & 0xff] : [(value >> 8) & 0xff, value & 0xff]
const u32 = (order: Order, value: number): Bytes => order === 'II'
  ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
  : [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]

/** What a phone's EXIF also says, beyond the place and the camera: when, and its maker's own notes. */
const DATE_TAKEN = '2026:10:20 09:30:12'
const MAKER_NOTE = 'FictionalMakerNote serial FP1-000042'
const PADDING = 'PADDING-AFTER-THE-LAST-IFD'

/** The Orientation entry a phone writes, or one that lies about its type or count. */
interface OrientationEntry { value: number; type?: number; count?: number }

/**
 * A phone's EXIF TIFF in either byte order: IFD0 with Make, Model, Orientation (when given), the EXIF sub-IFD (the date
 * taken, a MakerNote) and the GPS IFD (the place); IFD1 with a JPEG thumbnail; then padding.
 */
function phoneTiff(order: Order, orientation: OrientationEntry | null, place: Place = PLACE_TAKEN): Bytes {
  const s = (value: number) => u16(order, value), l = (value: number) => u32(order, value)
  const entry = (tag: number, type: number, count: number, value: Bytes) => [...s(tag), ...s(type), ...l(count), ...value, ...Array(4 - value.length).fill(0)]
  const rationals = (coordinate: Place['latitude']) => coordinate.flatMap(([numerator, denominator]) => [...l(numerator), ...l(denominator)])
  const make = [...ascii(EXIF_MAKE), 0], model = [...ascii(EXIF_MODEL), 0], date = [...ascii(DATE_TAKEN), 0], note = ascii(MAKER_NOTE)
  const ifd0Count = orientation ? 5 : 4
  const makeAt = 8 + 2 + 12 * ifd0Count + 4, modelAt = makeAt + make.length
  const exifIfd = modelAt + model.length, dateAt = exifIfd + 2 + 2 * 12 + 4, noteAt = dateAt + date.length
  const gps = noteAt + note.length, latitudeAt = gps + 2 + 5 * 12 + 4, longitudeAt = latitudeAt + 24
  const ifd1 = longitudeAt + 24, thumbnailAt = ifd1 + 2 + 2 * 12 + 4
  return [
    ...ascii(order), ...s(42), ...l(8),
    ...s(ifd0Count), ...entry(0x010f, 2, make.length, l(makeAt)), ...entry(0x0110, 2, model.length, l(modelAt)),
    ...(orientation ? entry(0x0112, orientation.type ?? 3, orientation.count ?? 1, s(orientation.value)) : []),
    ...entry(0x8769, 4, 1, l(exifIfd)), ...entry(0x8825, 4, 1, l(gps)), ...l(ifd1),
    ...make, ...model,
    ...s(2), ...entry(0x9003, 2, date.length, l(dateAt)), ...entry(0x927c, 7, note.length, l(noteAt)), ...l(0),
    ...date, ...note,
    ...s(5), ...entry(0x0000, 1, 4, [2, 2, 0, 0]), ...entry(0x0001, 2, 2, ascii('N\0')), ...entry(0x0002, 5, 3, l(latitudeAt)),
    ...entry(0x0003, 2, 2, ascii('E\0')), ...entry(0x0004, 5, 3, l(longitudeAt)), ...l(0),
    ...rationals(place.latitude), ...rationals(place.longitude),
    ...s(2), ...entry(0x0201, 4, 1, l(thumbnailAt)), ...entry(0x0202, 4, 1, l(EXIF_THUMBNAIL.length)), ...l(0),
    ...EXIF_THUMBNAIL,
    ...ascii(PADDING),
  ]
}

/** An APP1 EXIF carrying `tiff`; one carrying a phone's TIFF that says Orientation `value`. */
const exifApp1 = (tiff: Bytes) => segment(0xe1, [...ascii('Exif'), 0, 0, ...tiff])
const orientedExif = (order: Order, value: number) => exifApp1(phoneTiff(order, { value }))

/** The one APP1 a turned JPEG keeps, written out byte by byte: "Exif\0\0", a little-endian TIFF, IFD0 of one entry. */
const minimalApp1 = (value: number): Bytes => [
  0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, value, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]
/** The same TIFF, the data of the one eXIf a turned PNG keeps. */
const minimalTiff = (value: number) => minimalApp1(value).slice(10)
/** A TIFF of `order` whose IFD0 is the one Orientation `value` and nothing after it, not even the next IFD's offset. */
const bareOrientation = (order: Order, value: number): Bytes => [...ascii(order), ...u16(order, 42), ...u32(order, 8), ...u16(order, 1),
  ...u16(order, 0x0112), ...u16(order, 3), ...u32(order, 1), ...u16(order, value), 0, 0]

/** The JPEG's segments up to and including its first scan's header, as [marker, the whole segment]. */
function headerSegments(file: Uint8Array): Array<[number, Bytes]> {
  const found: Array<[number, Bytes]> = []
  let at = 2
  while (at + 4 <= file.length && file[at] === 0xff) {
    const marker = file[at + 1]!, end = at + 2 + ((file[at + 2]! << 8) | file[at + 3]!)
    found.push([marker, [...file.subarray(at, end)]])
    if (marker === 0xda) break
    at = end
  }
  return found
}
const app1sOf = (file: Uint8Array) => headerSegments(file).filter(([marker]) => marker === 0xe1).map(([, bytes]) => bytes)

/** How many times `needle` occurs in `haystack`. */
function occurrences(haystack: Uint8Array, needle: Bytes): number {
  let found = 0
  outer: for (let at = 0; at + needle.length <= haystack.length; at += 1) {
    for (let index = 0; index < needle.length; index += 1) if (haystack[at + index] !== needle[index]) continue outer
    found += 1
  }
  return found
}

/** What must never be left of a phone's EXIF but its orientation, in either byte order: none of the place, the camera, the time or the thumbnail. */
const neverLeft = (order: Order): ReadonlyArray<Bytes | string> => [
  ...NEVER_LEFT.filter(needle => needle !== 'Exif'),
  DATE_TAKEN, MAKER_NOTE, PADDING, 'THUMBNAIL-OF-THE-ORIGINAL',
  PLACE_TAKEN.latitude.flatMap(([numerator, denominator]) => [...u32(order, numerator), ...u32(order, denominator)]),
  PLACE_TAKEN.longitude.flatMap(([numerator, denominator]) => [...u32(order, numerator), ...u32(order, denominator)]),
  [...u16(order, 0x8825), ...u16(order, 4), ...u32(order, 1)], [...u16(order, 0x8769), ...u16(order, 4), ...u32(order, 1)],
  [...u16(order, 0x0201), ...u16(order, 4), ...u32(order, 1)], [...u16(order, 0x927c), ...u16(order, 7)],
]
const leftOf = (stripped: Uint8Array, order: Order) => neverLeft(order).filter(needle => contains(stripped, needle))

/** A phone's photo, as gpsTaggedJpeg is, with `app1` as its EXIF; and what decoding needs of it, kept as before. */
const phoneJpeg = (app1: Bytes) => toBytes(SOI, JFIF, app1, XMP, ICC, MPF, APP13, ADOBE, DQT, COM, SOF0, DHT, DRI, SOS, ENTROPY, EOI, APPENDED)
const IMAGE: Bytes = [...ICC, ...ADOBE, ...DQT, ...SOF0, ...DHT, ...DRI, ...SOS, ...ENTROPY, ...EOI]

const problemOf = (bytes: Uint8Array, type: StrippedPhotoType): PhotoMetadataProblem | 'kept' => {
  try {
    stripPhotoMetadata(bytes, type)
    return 'kept'
  } catch (error) {
    expect(error).toBeInstanceOf(PhotoMetadataError)
    return (error as PhotoMetadataError).problem
  }
}

describe('a JPEG that says which way up it is', () => {
  it.each(['II', 'MM'] as const)('keeps Orientation 6 from a GPS-tagged photo (%s) as its only APP1, built anew, and nothing else of the EXIF', order => {
    const file = phoneJpeg(orientedExif(order, 6))
    // The fixture carries all of it to begin with.
    expect(leftOf(file, order).length).toBeGreaterThan(15)
    const out = stripPhotoMetadata(file, 'image/jpeg')
    // Byte for byte: the start, JFIF, the one new APP1, then the picture exactly as it was.
    expect([...out]).toEqual([...SOI, ...JFIF, ...minimalApp1(6), ...IMAGE])
    expect(app1sOf(out)).toEqual([minimalApp1(6)])
    expect(occurrences(out, ascii('Exif'))).toBe(1)
    expect(leftOf(out, order)).toEqual([])
    // Take the one APP1 out again and what is left is what stripping gave before the decision: the picture unchanged.
    expect([...out.subarray(0, 2 + JFIF.length), ...out.subarray(2 + JFIF.length + 36)]).toEqual([...gpsTaggedJpeg().stripped])
  })

  it('writes the same APP1 whichever byte order the camera used: little-endian, so the byte order tells nothing', () => {
    expect([...stripPhotoMetadata(phoneJpeg(orientedExif('MM', 6)), 'image/jpeg')])
      .toEqual([...stripPhotoMetadata(phoneJpeg(orientedExif('II', 6)), 'image/jpeg')])
  })

  it('keeps each of the turned orientations, 2 to 8, as it is', () => {
    for (const order of ['II', 'MM'] as const) {
      for (let value = 2; value <= 8; value += 1) {
        expect(app1sOf(stripPhotoMetadata(phoneJpeg(orientedExif(order, value)), 'image/jpeg')), `${order} ${value}`).toEqual([minimalApp1(value)])
      }
    }
  })

  it('goes by the first Orientation entry in IFD0', () => {
    const twice = [...ascii('MM'), ...u16('MM', 42), ...u32('MM', 8), ...u16('MM', 2),
      ...u16('MM', 0x0112), ...u16('MM', 3), ...u32('MM', 1), ...u16('MM', 6), 0, 0,
      ...u16('MM', 0x0112), ...u16('MM', 3), ...u32('MM', 1), ...u16('MM', 3), 0, 0, ...u32('MM', 0)]
    expect(app1sOf(stripPhotoMetadata(toBytes(SOI, exifApp1(twice), DQT, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg'))).toEqual([minimalApp1(6)])
  })

  it('keeps no padding of the original value: only the SHORT itself is read', () => {
    // A camera's SHORT, its two unused bytes not zero.
    const tiff = phoneTiff('II', { value: 6 })
    // IFD0's third entry, the Orientation, and its four value bytes 8 into it.
    const at = 8 + 2 + 2 * 12 + 8
    tiff[at + 2] = 0xab; tiff[at + 3] = 0xcd
    expect(tiff.slice(at - 8, at + 4)).toEqual([0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0xab, 0xcd])
    const out = stripPhotoMetadata(toBytes(SOI, exifApp1(tiff), DQT, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg')
    expect(app1sOf(out)).toEqual([minimalApp1(6)])
    expect(contains(out, [0xab, 0xcd])).toBe(false)
  })

  it('reads an IFD0 whose one entry ends where the EXIF ends, with no next IFD offset after it', () => {
    for (const order of ['II', 'MM'] as const) {
      const out = stripPhotoMetadata(toBytes(SOI, exifApp1(bareOrientation(order, 3)), DQT, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg')
      expect(app1sOf(out), order).toEqual([minimalApp1(3)])
    }
  })
})

describe('a JPEG whose EXIF gives no turn, or can’t be read, has no EXIF at all', () => {
  /** The TIFF of `order` with `patch` written at `at`: a field that lies. */
  const patched = (order: Order, at: number, patch: Bytes, orientation: OrientationEntry | null = { value: 6 }) => {
    const tiff = phoneTiff(order, orientation)
    tiff.splice(at, patch.length, ...patch)
    return tiff
  }
  /** Where IFD0's third entry, the Orientation, starts. */
  const ORIENTATION_ENTRY = 8 + 2 + 2 * 12
  const tiffOnly = (order: Order, ifd0: Bytes) => [...ascii(order), ...u16(order, 42), ...u32(order, 8), ...ifd0]
  /**
   * A TIFF whose IFD0 offset points back into its own header, laid out so that reading from there would find Orientation
   * 6: in II an offset of 4 reads its own low bytes as a count of 4 entries, the second at 18; in MM an offset of 6 reads
   * its low bytes as a count of 6, the first at 8.
   */
  const headerIfd = (order: Order): Bytes => {
    const tiff = [...ascii(order), ...u16(order, 42), ...u32(order, order === 'II' ? 4 : 6), ...Array(80).fill(0)]
    tiff.splice(order === 'II' ? 18 : 8, 12, ...u16(order, 0x0112), ...u16(order, 3), ...u32(order, 1), ...u16(order, 6), 0, 0)
    return tiff
  }

  const cases = (order: Order): Array<[string, Bytes]> => [
    ['Orientation 1, the picture as stored', phoneTiff(order, { value: 1 })],
    ['no Orientation', phoneTiff(order, null)],
    ['Orientation 0', phoneTiff(order, { value: 0 })],
    ['Orientation 9', phoneTiff(order, { value: 9 })],
    ['Orientation 0xFFFF', phoneTiff(order, { value: 0xffff })],
    ['an Orientation that is a LONG', phoneTiff(order, { value: 6, type: 4 })],
    ['an Orientation that is a BYTE', phoneTiff(order, { value: 6, type: 1 })],
    ['an Orientation whose count lies (2)', phoneTiff(order, { value: 6, count: 2 })],
    ['an Orientation whose count lies (0)', phoneTiff(order, { value: 6, count: 0 })],
    ['an Orientation whose count lies (65537)', phoneTiff(order, { value: 6, count: 0x10001 })],
    ['an IFD0 whose count of entries lies, running past the end', patched(order, 8, u16(order, 200))],
    ['an IFD0 whose count of entries runs one byte past the end', (() => {
      const tiff = phoneTiff(order, { value: 6 })
      return [...tiff.slice(0, 8), ...u16(order, Math.floor((tiff.length - 10) / 12) + 1), ...tiff.slice(10)]
    })()],
    ['an IFD0 offset past the end', patched(order, 4, u32(order, 0x0001_0000))],
    ['an IFD0 offset of 0xFFFFFFFF', patched(order, 4, u32(order, 0xffff_ffff))],
    ['an IFD0 offset inside the header', patched(order, 4, u32(order, 4))],
    ['an IFD0 offset inside the header, where an Orientation would read from there', headerIfd(order)],
    ['an IFD0 offset of 0', patched(order, 4, u32(order, 0))],
    ['an IFD0 whose count is the last byte', (() => {
      const tiff = phoneTiff(order, { value: 6 })
      return [...tiff.slice(0, 4), ...u32(order, tiff.length - 1), ...tiff.slice(8)]
    })()],
    ['the other byte order’s 42', patched(order, 2, order === 'II' ? [0, 42] : [42, 0])],
    ['no byte order', patched(order, 0, ascii('IM'))],
    ['a TIFF cut short in its header', ascii(order).concat([0x2a, 0x00, 0x08])],
    ['an Orientation in IFD1 alone', tiffOnly(order, [...u16(order, 0), ...u32(order, 14), ...u16(order, 1),
      ...u16(order, 0x0112), ...u16(order, 3), ...u32(order, 1), ...u16(order, 6), 0, 0, ...u32(order, 0)])],
    ['an Orientation in the EXIF sub-IFD alone', tiffOnly(order, [...u16(order, 1), ...u16(order, 0x8769), ...u16(order, 4), ...u32(order, 1), ...u32(order, 26), ...u32(order, 0),
      ...u16(order, 1), ...u16(order, 0x0112), ...u16(order, 3), ...u32(order, 1), ...u16(order, 6), 0, 0, ...u32(order, 0)])],
    ['an Orientation entry whose type field lies', patched(order, ORIENTATION_ENTRY + 2, u16(order, 0x0300))],
    ['a first Orientation entry that is a LONG, a second that is a SHORT 6', tiffOnly(order, [...u16(order, 2),
      ...u16(order, 0x0112), ...u16(order, 4), ...u32(order, 1), ...u32(order, 6),
      ...u16(order, 0x0112), ...u16(order, 3), ...u32(order, 1), ...u16(order, 6), 0, 0, ...u32(order, 0)])],
  ]

  it.each(['II', 'MM'] as const)('gives none, and still the photo, for a value out of range or a field that lies (%s)', order => {
    for (const [what, tiff] of cases(order)) {
      const out = stripPhotoMetadata(toBytes(SOI, JFIF, exifApp1(tiff), DQT, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg')
      expect([...out], what).toEqual([...PLAIN_JPEG])
    }
  })

  it('gives none for an APP1 of no more than "Exif\\0\\0", or not even that', () => {
    for (const data of [[...ascii('Exif'), 0, 0], [...ascii('Exif'), 0], ascii('Exif')]) {
      expect([...stripPhotoMetadata(toBytes(SOI, JFIF, segment(0xe1, data), DQT, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg')]).toEqual([...PLAIN_JPEG])
    }
  })

  it('reads an EXIF only after exactly "Exif\\0\\0": any other identifier gives none, whatever TIFF follows it', () => {
    for (const identifier of [[...ascii('Exif'), 0, 1], [...ascii('Exif'), 0, 0xff], ascii('ExifII'), [...ascii('EXIF'), 0, 0], [...ascii('exif'), 0, 0]]) {
      const app1 = segment(0xe1, [...identifier, ...phoneTiff('II', { value: 6 })])
      expect([...stripPhotoMetadata(toBytes(SOI, JFIF, app1, DQT, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg')], String.fromCharCode(...identifier)).toEqual([...PLAIN_JPEG])
    }
  })

  it('still refuses a photo that can’t be walked, whatever its EXIF says', () => {
    const body = [...DQT, ...SOF0, ...DHT, ...SOS, ...ENTROPY]
    expect(problemOf(toBytes(SOI, orientedExif('II', 6), body), 'image/jpeg')).toBe('truncated')
    expect(problemOf(toBytes(SOI, orientedExif('II', 6), [0x00], body, EOI), 'image/jpeg')).toBe('bad-marker')
    expect(problemOf(toBytes(SOI, orientedExif('MM', 6)).subarray(0, 60), 'image/jpeg')).toBe('truncated')
  })
})

describe('which EXIF a JPEG is turned by', () => {
  const tail = [...DQT, ...SOF0, ...DHT, ...SOS, ...ENTROPY, ...EOI]
  const XMP_TURNED = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Orientation="8"/></x:xmpmeta>'
  /** An XMP APP1 that says Orientation 8 in words, and carries what looks like an Orientation entry too. */
  const turnedXmp = segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii(XMP_TURNED), 0x12, 0x01, 3, 0, 1, 0, 0, 0, 8, 0, 0, 0])
  const outOf = (...parts: Bytes[]) => stripPhotoMetadata(toBytes(SOI, ...parts, tail), 'image/jpeg')

  it('goes by the first APP1 EXIF alone: an XMP APP1 with an orientation of its own is ignored, before or after it', () => {
    expect([...outOf(JFIF, turnedXmp)]).toEqual([...PLAIN_JPEG])
    expect(app1sOf(outOf(JFIF, orientedExif('II', 6), turnedXmp))).toEqual([minimalApp1(6)])
    expect(app1sOf(outOf(JFIF, turnedXmp, orientedExif('MM', 6)))).toEqual([minimalApp1(6)])
    expect(contains(outOf(JFIF, turnedXmp, orientedExif('MM', 6)), 'tiff:Orientation')).toBe(false)
  })

  it('goes by the first EXIF, never a second: one with no turn is not overruled by one after it', () => {
    expect(app1sOf(outOf(JFIF, orientedExif('II', 6), orientedExif('II', 3)))).toEqual([minimalApp1(6)])
    expect([...outOf(JFIF, exifApp1(phoneTiff('II', null)), orientedExif('II', 6))]).toEqual([...PLAIN_JPEG])
    expect([...outOf(JFIF, exifApp1(phoneTiff('II', { value: 6, count: 2 })), orientedExif('II', 6))]).toEqual([...PLAIN_JPEG])
  })

  it('takes no orientation from an EXIF after the first scan, nor from one outside APP1', () => {
    const afterScan = toBytes(SOI, JFIF, DQT, SOF0, DHT, SOS, ENTROPY, orientedExif('II', 6), EOI)
    expect([...stripPhotoMetadata(afterScan, 'image/jpeg')]).toEqual([...PLAIN_JPEG])
    const exifData = orientedExif('II', 6).slice(4)
    for (const marker of [0xe0, 0xe2, 0xe3, 0xef]) expect([...outOf(JFIF, segment(marker, exifData))], marker.toString(16)).toEqual([...PLAIN_JPEG])
    expect([...outOf(JFIF, segment(0xfe, exifData))]).toEqual([...PLAIN_JPEG])
    // Nor from the EXIF of the further picture a phone appends after the end.
    const appended = toBytes(SOI, JFIF, tail, SOI, orientedExif('II', 6), tail)
    expect([...stripPhotoMetadata(appended, 'image/jpeg')]).toEqual([...PLAIN_JPEG])
  })

  it('takes it from an EXIF among the tables, before the first scan', () => {
    const out = stripPhotoMetadata(toBytes(SOI, JFIF, DQT, SOF0, orientedExif('II', 5), DHT, SOS, ENTROPY, EOI), 'image/jpeg')
    expect([...out]).toEqual([...SOI, ...JFIF, ...minimalApp1(5), ...DQT, ...SOF0, ...DHT, ...SOS, ...ENTROPY, ...EOI])
  })
})

describe('where a turned JPEG’s APP1 goes', () => {
  const picture = [...DQT, ...SOF0, ...DHT, ...SOS, ...ENTROPY, ...EOI]

  it('right after APP0 JFIF when the photo opens with one, wherever its EXIF was', () => {
    for (const file of [toBytes(SOI, JFIF, orientedExif('II', 6), picture), toBytes(SOI, orientedExif('II', 6), JFIF, picture)]) {
      expect([...stripPhotoMetadata(file, 'image/jpeg')]).toEqual([...SOI, ...JFIF, ...minimalApp1(6), ...picture])
    }
    // JFIF with a thumbnail is kept without it, and the APP1 follows the header as kept.
    const withThumbnail = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0xaa, 0xbb, 0xcc])
    expect([...stripPhotoMetadata(toBytes(SOI, withThumbnail, orientedExif('MM', 3), picture), 'image/jpeg')])
      .toEqual([...SOI, ...JFIF, ...minimalApp1(3), ...picture])
  })

  it('right after the start of image when there is no JFIF, or JFIF is not where JFIF goes', () => {
    expect([...stripPhotoMetadata(toBytes(SOI, orientedExif('II', 6), ICC, picture), 'image/jpeg')])
      .toEqual([...SOI, ...minimalApp1(6), ...ICC, ...picture])
    // An APP0 that isn't JFIF is dropped, and is no place for it.
    const jfxx = segment(0xe0, [...ascii('JFXX'), 0, 0x10, 1, 2, 3])
    expect([...stripPhotoMetadata(toBytes(SOI, jfxx, orientedExif('II', 6), picture), 'image/jpeg')])
      .toEqual([...SOI, ...minimalApp1(6), ...picture])
    // JFIF after the colour profile: the APP1 still comes first, where EXIF goes.
    expect([...stripPhotoMetadata(toBytes(SOI, ICC, JFIF, orientedExif('II', 6), picture), 'image/jpeg')])
      .toEqual([...SOI, ...minimalApp1(6), ...ICC, ...JFIF, ...picture])
  })
})

/** A PNG with metadata, as metadataPng is, with `exif` as its eXIf before the image data. */
function phonePngOf(exif: Bytes) {
  const { kept } = metadataPng()
  return toBytes(PNG_SIGNATURE, kept.ihdr, chunk('tIME', [0x07, 0xea, 10, 20, 9, 30, 0]), kept.plte, chunk('eXIf', exif),
    chunk('tEXt', [...ascii('Comment'), 0, ...ascii('Taken at a fictional clinic in Ikeja')]), kept.idat, kept.iend, ascii('after IEND: 6.4535N 3.3962E'))
}

describe('a PNG that says which way up it is', () => {
  const { kept } = metadataPng()
  const phonePng = phonePngOf

  it.each(['II', 'MM'] as const)('keeps Orientation 8 (%s) as exactly one new eXIf before the image data, its CRC its own', order => {
    const file = phonePng(phoneTiff(order, { value: 8 }))
    const out = stripPhotoMetadata(file, 'image/png')
    const exif = toBytes(minimalTiff(8))
    // Written out: length 26, "eXIf", the TIFF, and the CRC of the type and the TIFF (zlib's, not the code's own).
    const expected = toBytes([0, 0, 0, 26], ascii('eXIf'), exif, (() => {
      const crc = zlibCrc32(toBytes(ascii('eXIf'), exif))
      return [(crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]
    })())
    expect([...expected]).toEqual(chunk('eXIf', minimalTiff(8)))
    expect([...out]).toEqual([...toBytes(PNG_SIGNATURE, kept.ihdr, expected, kept.plte, kept.idat, kept.iend)])
    expect(pngChunks(out)).toEqual([['IHDR', true], ['eXIf', true], ['PLTE', true], ['IDAT', true], ['IEND', true]])
    expect(occurrences(out, ascii('eXIf'))).toBe(1)
    expect(leftOf(out, order)).toEqual([])
  })

  it('gives no eXIf for Orientation 1, none, 9, a lying count or offset, or one after the image data', () => {
    const plain = [...toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat, kept.iend)]
    const lyingOffset = phoneTiff('MM', { value: 8 })
    lyingOffset.splice(4, 4, ...u32('MM', 0x7fff_0000))
    for (const [what, tiff] of [
      ['1', phoneTiff('II', { value: 1 })], ['none', phoneTiff('MM', null)], ['9', phoneTiff('II', { value: 9 })],
      ['count 2', phoneTiff('MM', { value: 8, count: 2 })], ['offset', lyingOffset], ['empty', []],
      ['with the JPEG identifier in front', [...ascii('Exif'), 0, 0, ...phoneTiff('II', { value: 8 })]],
    ] as const) expect([...stripPhotoMetadata(phonePng([...tiff]), 'image/png')], what).toEqual(plain)
    const afterData = toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat, chunk('eXIf', phoneTiff('II', { value: 8 })), kept.iend)
    expect([...stripPhotoMetadata(afterData, 'image/png')]).toEqual(plain)
  })

  it('reads an eXIf whose one entry ends where its data ends, and not one whose entry runs on into the CRC', () => {
    const turned = [...toBytes(PNG_SIGNATURE, kept.ihdr, chunk('eXIf', minimalTiff(8)), kept.plte, kept.idat, kept.iend)]
    const plain = [...toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat, kept.iend)]
    for (const order of ['II', 'MM'] as const) {
      expect([...stripPhotoMetadata(phonePng(bareOrientation(order, 8)), 'image/png')], order).toEqual(turned)
      // Two bytes short: the entry's value is in the data, but its last two bytes would be the CRC's.
      expect([...stripPhotoMetadata(phonePng(bareOrientation(order, 8).slice(0, -2)), 'image/png')], order).toEqual(plain)
    }
  })

  it('goes by the first eXIf only, and never by the earlier spellings exIf and zxIf', () => {
    const two = toBytes(PNG_SIGNATURE, kept.ihdr, chunk('eXIf', phoneTiff('II', { value: 6 })), chunk('eXIf', phoneTiff('II', { value: 8 })), kept.plte, kept.idat, kept.iend)
    expect([...stripPhotoMetadata(two, 'image/png')]).toEqual([...toBytes(PNG_SIGNATURE, kept.ihdr, chunk('eXIf', minimalTiff(6)), kept.plte, kept.idat, kept.iend)])
    const noTurn = toBytes(PNG_SIGNATURE, kept.ihdr, chunk('eXIf', phoneTiff('II', null)), chunk('eXIf', phoneTiff('II', { value: 8 })), kept.plte, kept.idat, kept.iend)
    expect([...stripPhotoMetadata(noTurn, 'image/png')]).toEqual([...toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat, kept.iend)])
    const spelt = toBytes(PNG_SIGNATURE, kept.ihdr, chunk('exIf', phoneTiff('II', { value: 6 })), chunk('zxIf', phoneTiff('II', { value: 6 })), kept.plte, kept.idat, kept.iend)
    expect([...stripPhotoMetadata(spelt, 'image/png')]).toEqual([...toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat, kept.iend)])
  })

  it('still refuses an eXIf whose CRC is wrong', () => {
    const exif = chunk('eXIf', phoneTiff('II', { value: 6 }))
    const flipped = [...exif.slice(0, -1), exif.at(-1)! ^ 0x01]
    expect(problemOf(toBytes(PNG_SIGNATURE, kept.ihdr, flipped, kept.plte, kept.idat, kept.iend), 'image/png')).toBe('bad-chunk')
  })
})

describe('the same file always strips to the same bytes', () => {
  it('stripping twice is stripping once, and the same file gives the same bytes each time', () => {
    const files: Array<[Uint8Array, StrippedPhotoType]> = [
      [phoneJpeg(orientedExif('II', 6)), 'image/jpeg'],
      [phoneJpeg(orientedExif('MM', 8)), 'image/jpeg'],
      [toBytes(SOI, orientedExif('MM', 3), DQT, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg'],
      [phonePngOf(phoneTiff('MM', { value: 8 })), 'image/png'],
    ]
    for (const [file, type] of files) {
      const once = stripPhotoMetadata(file, type)
      expect([...stripPhotoMetadata(file, type)]).toEqual([...once])
      expect([...stripPhotoMetadata(once, type)]).toEqual([...once])
    }
  })

  it('sends the turned photo as a new File of its name and type holding exactly those bytes', async () => {
    const file = phoneJpeg(orientedExif('MM', 6))
    const ready = await withoutPhotoMetadata(new File([file], 'IMG_20261020_093012.jpg', { type: 'image/jpeg', lastModified: 5 }))
    expect([ready.name, ready.type]).toEqual(['IMG_20261020_093012.jpg', 'image/jpeg'])
    expect([...new Uint8Array(await ready.arrayBuffer())]).toEqual([...SOI, ...JFIF, ...minimalApp1(6), ...IMAGE])
  })
})
