/**
 * A photo's metadata, taken out in the browser before it is uploaded ("Add a record", BACKEND-NEEDS.md §1). Under the
 * NDPA's data minimisation, where a photo was taken and the phone that took it have no clinical use here, so none of it
 * leaves the device. The picture itself is never re-encoded: what is kept is copied byte for byte, so the image the
 * patient took is the image a clinician sees.
 *
 * A JPEG keeps what decoding needs and nothing else: the start of image, APP0 JFIF (without a thumbnail), APP2
 * ICC_PROFILE (its colours), APP14 Adobe (its colour transform, its 12 bytes and no more), the tables and frame (DQT,
 * SOFn, DHT, DAC, DRI, DNL, DHP, EXP, each exactly as long as its own fields, or the file is refused: a length that says
 * more could hide an EXIF block behind them), each scan with its entropy-coded data exactly as it was (FF00 stuffing and
 * RST0-7 included; a progressive JPEG has several scans, with tables between them), and the end of image. Dropped:
 * APP1 (EXIF, with the GPS position, the camera's make and model and the EXIF thumbnail; XMP), APP13 (IPTC and
 * Photoshop), COM, every other APPn (APP2 MPF, the index of the further pictures a phone stores) and everything after
 * the primary image's end: phones append further JPEGs there (depth and gain maps, each with its own EXIF and GPS), and
 * some a video.
 *
 * The one thing kept of the EXIF is which way up the picture goes (its Orientation, tag 0x0112), or a photo a phone took
 * upright would show on its side. When the first APP1 EXIF before the first scan says an Orientation other than 1 (2-8),
 * a new APP1 is written in its place holding only that: "Exif\0\0", a TIFF header in the original's byte order and an
 * IFD0 with that one entry, and no next IFD (exifOrientation, orientationTiff). Nothing else of the EXIF is copied: no
 * other tag, no thumbnail (IFD1), no pointer to the EXIF, GPS or interoperability IFDs, no MakerNote. It goes where APP1
 * belongs, straight after the start of image, or after APP0 JFIF when JFIF is kept there. Orientation 1, no Orientation,
 * or an EXIF that can't be read with certainty (a bad TIFF header, an offset or entry outside the segment, a second
 * Orientation, one that isn't a single SHORT of 1-8) leaves no APP1 at all, as before; nothing is refused for it. No
 * pointer is followed, so a loop in the EXIF can't trap the walk.
 *
 * A PNG keeps its signature, its critical chunks and the ancillary chunks its display needs (transparency, colour, pixel
 * size, animation), each byte for byte (so each CRC stays valid). Dropped: eXIf (and the earlier spellings exIf and
 * zxIf), tEXt, zTXt, iTXt (which also carries XMP), tIME, and every other ancillary chunk (C2PA's caBX, which can carry
 * the place; private chunks such as Apple's iDOT); nothing after IEND is kept. As for a JPEG, when the first eXIf before
 * the image data says an Orientation other than 1, a new eXIf with only that takes its place (with its own CRC), before
 * IDAT as PNG requires.
 *
 * The same file always comes out as the same bytes, the orientation's included, so a retried upload sends the same body
 * with the same SHA-256.
 *
 * Fail closed: a file that cannot be walked cleanly (a bad marker or chunk, a segment or chunk running past the end, no
 * end of image or IEND, a second JPEG frame, a PNG chunk whose CRC is wrong, a critical chunk PNG doesn't have, or bytes
 * that are not the type the file says it is) throws PhotoMetadataError, and the page refuses it rather than send it as
 * it is. Pure apart from withoutPhotoMetadata, which reads the file it is given: nothing here keeps a file or sends
 * anything.
 *
 * The drawer has already checked each file's first 8 bytes against its type (fileSignature.ts) before this is reached;
 * a PDF is checked again here, as it is not walked.
 */
import { fileStartsAsItsType } from './fileSignature'

export type StrippedPhotoType = 'image/jpeg' | 'image/png'

/** Why a photo could not be walked. */
export type PhotoMetadataProblem = 'not-jpeg' | 'not-png' | 'type-mismatch' | 'bad-marker' | 'bad-segment' | 'bad-chunk' | 'truncated' | 'no-image'

/** A photo whose metadata could not be taken out with certainty: it is refused, never sent as it is. */
export class PhotoMetadataError extends Error {
  readonly problem: PhotoMetadataProblem
  constructor(problem: PhotoMetadataProblem, detail: string) {
    super(`The photo could not be prepared: ${detail}`)
    this.name = 'PhotoMetadataError'
    this.problem = problem
  }
}

const isPhotoType = (value: string): value is StrippedPhotoType => value === 'image/jpeg' || value === 'image/png'

/**
 * `bytes` without their metadata, as a new array (the input is not changed). Throws PhotoMetadataError when the bytes
 * cannot be walked cleanly as `mediaType`.
 */
export function stripPhotoMetadata(bytes: Uint8Array, mediaType: StrippedPhotoType): Uint8Array<ArrayBuffer> {
  if (mediaType === 'image/jpeg') return stripJpeg(bytes)
  if (mediaType === 'image/png') return stripPng(bytes)
  throw new PhotoMetadataError('type-mismatch', `${String(mediaType)} is not a photo type`)
}

/**
 * The file as it is uploaded: a JPEG or PNG as a new File of the same name and type holding only its stripped bytes,
 * read once here, so what is hashed and sent is exactly what was walked; a PDF as it is, once its first bytes are
 * "%PDF-" (fileSignature.ts). Anything else that says it is a PDF (a photo or a phone's video under a PDF's name, which
 * would go up with its metadata, or any other file) is refused as `type-mismatch`, never sent.
 */
export async function withoutPhotoMetadata(file: File): Promise<File> {
  if (!isPhotoType(file.type)) {
    if (!await fileStartsAsItsType(file)) throw new PhotoMetadataError('type-mismatch', `a file that says it is ${file.type || 'nothing'} but doesn't start as one`)
    return file
  }
  const stripped = stripPhotoMetadata(new Uint8Array(await file.arrayBuffer()), file.type)
  return new File([stripped], file.name, { type: file.type, lastModified: file.lastModified })
}

/** The parts kept, joined into one new array. */
function join(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) { out.set(part, at); at += part.length }
  return out
}

/** Whether `bytes` from `at` (and before `end`) start with `text`, a byte per character. */
function startsWith(bytes: Uint8Array, at: number, end: number, text: string): boolean {
  if (at + text.length > end) return false
  for (let index = 0; index < text.length; index += 1) if (bytes[at + index] !== text.charCodeAt(index)) return false
  return true
}

// ---------------------------------------------------------------------------------------------------------------------
// The orientation, the one thing kept of the EXIF
// ---------------------------------------------------------------------------------------------------------------------

/** EXIF's Orientation tag, and the TIFF type it is written as (SHORT). */
const ORIENTATION_TAG = 0x0112
const SHORT = 3

/** Which way up a picture goes, as its EXIF says it (2-8), and the byte order that EXIF was written in. */
interface Orientation { readonly littleEndian: boolean; readonly value: number }

/**
 * The Orientation the TIFF in `bytes` from `from` (up to `to`) gives in IFD0, when it is 2-8 and read with certainty;
 * otherwise null: Orientation 1 (as taken) or none, and any EXIF that can't be read cleanly (a TIFF header that isn't
 * "II" or "MM" and 42, an IFD0 or entry outside the TIFF, a second Orientation, one that isn't a single SHORT, or a value
 * outside 1-8). Only IFD0 is read and no pointer in it is followed, so nothing in the EXIF can loop.
 */
function exifOrientation(bytes: Uint8Array, from: number, to: number): Orientation | null {
  const size = to - from
  if (size < 8) return null
  const littleEndian = bytes[from] === 0x49 && bytes[from + 1] === 0x49
  if (!littleEndian && !(bytes[from] === 0x4d && bytes[from + 1] === 0x4d)) return null
  const u16 = (at: number) => littleEndian ? bytes[from + at]! | (bytes[from + at + 1]! << 8) : (bytes[from + at]! << 8) | bytes[from + at + 1]!
  const u32 = (at: number) => littleEndian ? (u16(at) + u16(at + 2) * 0x10000) : (u16(at) * 0x10000 + u16(at + 2))
  if (u16(2) !== 42) return null
  const ifd0 = u32(4)
  if (ifd0 < 8 || ifd0 + 2 > size) return null
  const count = u16(ifd0)
  // The entries (12 bytes each) and the next IFD's offset after them, all inside the TIFF.
  if (ifd0 + 2 + 12 * count + 4 > size) return null
  let value: number | null = null
  for (let index = 0; index < count; index += 1) {
    const entry = ifd0 + 2 + 12 * index
    if (u16(entry) !== ORIENTATION_TAG) continue
    if (value !== null || u16(entry + 2) !== SHORT || u32(entry + 4) !== 1) return null
    value = u16(entry + 8)
    if (value < 1 || value > 8) return null
  }
  return value === null || value === 1 ? null : { littleEndian, value }
}

/**
 * A TIFF holding only `orientation`, in its byte order: the header (IFD0 at byte 8), an IFD0 of one entry (Orientation,
 * one SHORT, its value in the entry's first two bytes) and no next IFD. 26 bytes, always the same for the same input.
 */
function orientationTiff({ littleEndian, value }: Orientation): Uint8Array {
  const u16 = (n: number) => littleEndian ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]
  const u32 = (n: number) => littleEndian ? [...u16(n & 0xffff), ...u16(n >>> 16)] : [...u16(n >>> 16), ...u16(n & 0xffff)]
  return Uint8Array.from([
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8),
    ...u16(1), ...u16(ORIENTATION_TAG), ...u16(SHORT), ...u32(1), ...u16(value), 0, 0,
    ...u32(0),
  ])
}

// ---------------------------------------------------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------------------------------------------------

const SOI = 0xd8, EOI = 0xd9, SOS = 0xda, APP0 = 0xe0, APP1 = 0xe1, APP2 = 0xe2, APP14 = 0xee, APP15 = 0xef, COM = 0xfe
const DHT = 0xc4, DAC = 0xcc, DQT = 0xdb, DNL = 0xdc, DRI = 0xdd, EXP = 0xdf
const isRestart = (marker: number) => marker >= 0xd0 && marker <= 0xd7
/** The frame headers: SOF0-3, 5-7, 9-11 and 13-15 (C4 is DHT, C8 reserved, CC DAC). */
const isFrame = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
/**
 * Markers this walk does not take between segments: 00 (only stuffing, inside a scan), TEM and the reserved 02-BF, JPG
 * (C8) and JPG0-13 (F0-FD, JPEG-LS among them), a restart outside a scan, and a second start of image.
 */
const isRefused = (marker: number) => marker < 0xc0 || marker === 0xc8 || isRestart(marker) || marker === SOI || (marker >= 0xf0 && marker <= 0xfd)

/** APP0 JFIF's fixed part after its length: "JFIF\0", version, units, densities (12 bytes), then the thumbnail's size. */
const JFIF_FIXED = 12
/** APP14 Adobe's whole part after its length: "Adobe", version, two flags, the colour transform (12 bytes). */
const ADOBE_FIXED = 12
/** What APP1 EXIF starts with, before its TIFF. */
const EXIF_HEADER = 'Exif\0\0'
const EXIF_HEADER_BYTES = Uint8Array.from(EXIF_HEADER, character => character.charCodeAt(0))

/** A segment of `marker` holding `data`, built anew: for a header kept without what followed it. */
function rebuilt(marker: number, data: Uint8Array): Uint8Array {
  const segment = new Uint8Array(4 + data.length)
  segment.set([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff])
  segment.set(data, 4)
  return segment
}

/**
 * The segment as kept, or null when it is dropped. APP0 is kept only as JFIF, and then without its thumbnail; APP2 only
 * as ICC_PROFILE; APP14 only as Adobe, and then only its 12 bytes (a decoder reads no more); every other APPn and COM are
 * dropped; everything else decoding needs is kept.
 */
function keptSegment(bytes: Uint8Array, marker: number, at: number, end: number): Uint8Array | null {
  const data = at + 4
  if (marker === APP0) {
    if (end - data < JFIF_FIXED + 2 || !startsWith(bytes, data, end, 'JFIF\0')) return null
    if (end - data === JFIF_FIXED + 2 && bytes[data + JFIF_FIXED] === 0 && bytes[data + JFIF_FIXED + 1] === 0) return bytes.subarray(at, end)
    // A JFIF thumbnail is a second picture: the header is kept, saying there is none.
    const header = new Uint8Array(JFIF_FIXED + 2)
    header.set(bytes.subarray(data, data + JFIF_FIXED))
    return rebuilt(APP0, header)
  }
  if (marker === APP2) return startsWith(bytes, data, end, 'ICC_PROFILE\0') ? bytes.subarray(at, end) : null
  if (marker === APP14) {
    if (end - data < ADOBE_FIXED || !startsWith(bytes, data, end, 'Adobe')) return null
    // Anything a longer segment carries after its 12 bytes is no part of the picture, and is left behind.
    return end - data === ADOBE_FIXED ? bytes.subarray(at, end) : rebuilt(APP14, bytes.subarray(data, data + ADOBE_FIXED))
  }
  if (marker >= APP0 && marker <= APP15) return null
  if (marker === COM) return null
  return bytes.subarray(at, end)
}

/**
 * Whether a segment kept for decoding (the tables, the frame, a scan's header) is exactly as long as its own fields, as
 * a decoder reads it (libjpeg refuses one that isn't): a length that says more could carry anything past them, such as
 * an EXIF block with the GPS position, so such a segment is refused rather than kept as it is.
 */
function exactSegment(bytes: Uint8Array, marker: number, data: number, end: number): boolean {
  const size = end - data
  switch (marker) {
    case DQT: case DHT: {
      // Tables, one after another: precision or class (0 or 1) and slot (0-3), then 64 or 128 values for DQT, or 16
      // counts and that many values (at most 256) for DHT.
      let at = data
      while (at < end) {
        const kind = bytes[at]! >> 4, slot = bytes[at]! & 0x0f
        if (kind > 1 || slot > 3) return false
        if (marker === DQT) { at += 1 + (kind === 1 ? 128 : 64); continue }
        if (at + 17 > end) return false
        let values = 0
        for (let index = 1; index <= 16; index += 1) values += bytes[at + index]!
        if (values > 256) return false
        at += 17 + values
      }
      return size > 0 && at === end
    }
    // Pairs of a table and its conditioning value.
    case DAC: return size > 0 && size % 2 === 0
    // The restart interval; the number of lines.
    case DRI: case DNL: return size === 2
    // Which way a hierarchical frame expands.
    case EXP: return size === 1
    // The components in the scan (1-4), two bytes each, then the spectral selection and approximation.
    case SOS: return size >= 1 && bytes[data]! >= 1 && bytes[data]! <= 4 && size === 4 + 2 * bytes[data]!
    // SOFn and DHP: precision, lines, samples per line, the components (at least one), three bytes each.
    default: return size >= 6 && bytes[data + 5]! >= 1 && size === 6 + 3 * bytes[data + 5]!
  }
}

function stripJpeg(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) throw new PhotoMetadataError('not-jpeg', 'no start of image')
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]
  let at = 2
  let frame = false
  let scanned = false
  // The first APP1 EXIF before the first scan says the orientation (a browser reads none after it); any other is left
  // unread.
  let exifRead = false
  let orientation: Orientation | null = null
  // Where APP1 belongs: after the start of image, or after APP0 JFIF when that is the first segment kept.
  let app1At = 1
  for (;;) {
    if (at >= bytes.length) throw new PhotoMetadataError('truncated', 'no end of image')
    if (bytes[at] !== 0xff) throw new PhotoMetadataError('bad-marker', `no marker at byte ${at}`)
    // Fill bytes (0xFF) may come before a marker; they are not kept.
    while (at + 1 < bytes.length && bytes[at + 1] === 0xff) at += 1
    if (at + 1 >= bytes.length) throw new PhotoMetadataError('truncated', 'no end of image')
    const marker = bytes[at + 1]!
    if (marker === EOI) {
      if (!scanned) throw new PhotoMetadataError('no-image', 'the end of image before any scan')
      kept.push(bytes.subarray(at, at + 2))
      if (orientation) kept.splice(app1At, 0, rebuilt(APP1, join([EXIF_HEADER_BYTES, orientationTiff(orientation)])))
      // Whatever follows the primary image's end (further pictures, a video) is left behind.
      return join(kept)
    }
    if (isRefused(marker)) throw new PhotoMetadataError('bad-marker', `marker ${marker.toString(16)} at byte ${at}`)
    if (at + 4 > bytes.length) throw new PhotoMetadataError('truncated', 'a segment without its length')
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!
    if (length < 2) throw new PhotoMetadataError('bad-marker', `a segment of length ${length} at byte ${at}`)
    const end = at + 2 + length
    if (end > bytes.length) throw new PhotoMetadataError('truncated', `a segment running past the end at byte ${at}`)
    // One frame: a second frame header before the end (a second picture, or a hierarchical JPEG, which browsers don't
    // show) is refused, so no picture hides behind the first.
    if (isFrame(marker) && frame) throw new PhotoMetadataError('bad-marker', `a second frame at byte ${at}`)
    if (isFrame(marker)) frame = true
    if (marker === SOS && !frame) throw new PhotoMetadataError('bad-marker', 'a scan before the frame')
    const isMetadata = (marker >= APP0 && marker <= APP15) || marker === COM
    if (!isMetadata && !exactSegment(bytes, marker, at + 4, end)) {
      throw new PhotoMetadataError('bad-segment', `a segment ${marker.toString(16)} whose length isn't its fields' at byte ${at}`)
    }
    if (marker === APP1 && !scanned && !exifRead && startsWith(bytes, at + 4, end, EXIF_HEADER)) {
      exifRead = true
      orientation = exifOrientation(bytes, at + 4 + EXIF_HEADER.length, end)
    }
    const segment = keptSegment(bytes, marker, at, end)
    if (segment) {
      if (marker === APP0 && kept.length === 1) app1At = 2
      kept.push(segment)
    }
    at = end
    if (marker !== SOS) continue
    // The scan's entropy-coded data, byte for byte, up to the next marker: FF00 is a stuffed FF and FFD0-FFD7 a
    // restart, both part of the data; FF FF is a fill byte before a marker.
    scanned = true
    const start = at
    for (;;) {
      const ff = bytes.indexOf(0xff, at)
      if (ff < 0 || ff + 1 >= bytes.length) throw new PhotoMetadataError('truncated', 'a scan without an end')
      const next = bytes[ff + 1]!
      if (next === 0x00 || isRestart(next)) { at = ff + 2; continue }
      if (next === 0xff) { at = ff + 1; continue }
      at = ff
      break
    }
    kept.push(bytes.subarray(start, at))
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
/**
 * The ancillary chunks the picture's display needs, kept: transparency, colour (cHRM, gAMA, iCCP, sBIT, sRGB, cICP and
 * the HDR mDCV and cLLI, with their earlier spellings), background, histogram, pixel size and animation (APNG). Every
 * other ancillary chunk is metadata to this walk and is dropped: eXIf (and its earlier spellings exIf and zxIf), tEXt,
 * zTXt, iTXt (XMP), tIME, C2PA's caBX (which can carry the place), and private chunks (Apple's iDOT, a vendor's own);
 * only an eXIf's orientation is written again, in a new eXIf of its own (stripPng). PNG's four critical chunks (IHDR,
 * PLTE, IDAT, IEND: an upper-case first letter) are kept; any other critical chunk, or a second IHDR, is refused
 * (stripPng).
 */
const PNG_KEPT_ANCILLARY = new Set(['tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCV', 'mDCv', 'cLLI', 'cLLi', 'bKGD', 'hIST', 'pHYs', 'acTL', 'fcTL', 'fdAT'])
const PNG_MAX_CHUNK = 0x7fffffff
const isLetter = (byte: number) => (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)
/** A critical chunk: its first letter upper case (bit 5 clear). */
const isCriticalChunk = (type: string) => type.charCodeAt(0) <= 0x5a
/** The only critical chunks PNG has; any other is refused. */
const PNG_CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND'])
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
/** The CRC-32 a PNG chunk carries, of `bytes` from `from` up to `to` (its type and data). */
function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff
  for (let index = from; index < to; index += 1) c = CRC_TABLE[(c ^ bytes[index]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A PNG chunk of `type` holding `data`, built anew with its CRC. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length))
  return out
}

function stripPng(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new PhotoMetadataError('not-png', 'no PNG signature')
  }
  const kept: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE.length)]
  let at: number = PNG_SIGNATURE.length
  let first = true
  let image = false
  // The first eXIf before the image data says the orientation; a new eXIf holding only that takes its place.
  let exifRead = false
  for (;;) {
    // Length (4), type (4), data, CRC (4).
    if (at + 12 > bytes.length) throw new PhotoMetadataError('truncated', 'no IEND')
    const length = ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!
    if (length > PNG_MAX_CHUNK) throw new PhotoMetadataError('bad-chunk', `a chunk of length ${length} at byte ${at}`)
    const typeBytes = bytes.subarray(at + 4, at + 8)
    if (!typeBytes.every(isLetter)) throw new PhotoMetadataError('bad-chunk', `a chunk type that is not four letters at byte ${at}`)
    const type = String.fromCharCode(...typeBytes)
    const end = at + 12 + length
    if (end > bytes.length) throw new PhotoMetadataError('truncated', `a ${type} chunk running past the end`)
    // Each chunk's CRC is checked: a length that lies (a pHYs that says it runs on over the eXIf after it, say) leaves
    // the CRC read from the wrong place, so the file is refused rather than kept with the eXIf inside the pHYs.
    const stored = ((bytes[end - 4]! << 24) >>> 0) + (bytes[end - 3]! << 16) + (bytes[end - 2]! << 8) + bytes[end - 1]!
    if (crc32(bytes, at + 4, end - 4) !== stored) throw new PhotoMetadataError('bad-chunk', `a ${type} chunk whose CRC is wrong at byte ${at}`)
    if (first && (type !== 'IHDR' || length !== 13)) throw new PhotoMetadataError('bad-chunk', 'no IHDR first')
    // A critical chunk no decoder knows (one named EXIF, say) can't be shown, so nothing says it isn't metadata; nor can
    // a second IHDR. Either is refused rather than kept.
    if (isCriticalChunk(type) && (!PNG_CRITICAL.has(type) || (type === 'IHDR' && !first))) {
      throw new PhotoMetadataError('bad-chunk', `a critical chunk ${type} out of place at byte ${at}`)
    }
    first = false
    if (type === 'IEND') {
      if (!image || length !== 0) throw new PhotoMetadataError('no-image', 'IEND without image data')
      kept.push(bytes.subarray(at, end))
      // Whatever follows IEND is left behind.
      return join(kept)
    }
    if (type === 'IDAT') image = true
    if (isCriticalChunk(type) || PNG_KEPT_ANCILLARY.has(type)) kept.push(bytes.subarray(at, end))
    else if (type === 'eXIf' && !image && !exifRead) {
      exifRead = true
      const orientation = exifOrientation(bytes, at + 8, end - 4)
      if (orientation) kept.push(pngChunk('eXIf', orientationTiff(orientation)))
    }
    at = end
  }
}
