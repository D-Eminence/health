import { deflateSync } from 'node:zlib'

/**
 * Photos built byte by byte for the metadata tests (photoMetadata.ts): every value is fictional. Each builder returns the
 * whole file and, built from the same parts independently of the code under test, exactly what stripping it must leave.
 */

type Bytes = number[]

export const ascii = (text: string): Bytes => [...text].map(character => character.charCodeAt(0))
const u16le = (value: number): Bytes => [value & 0xff, (value >> 8) & 0xff]
const u32le = (value: number): Bytes => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
const u32be = (value: number): Bytes => [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
const bytes = (...parts: Array<Bytes | Uint8Array>) => new Uint8Array(parts.flatMap(part => [...part]))

/** Whether `needle` occurs in `haystack`. */
export function contains(haystack: Uint8Array, needle: Uint8Array | Bytes | string): boolean {
  const find = typeof needle === 'string' ? ascii(needle) : [...needle]
  outer: for (let at = 0; at + find.length <= haystack.length; at += 1) {
    for (let index = 0; index < find.length; index += 1) if (haystack[at + index] !== find[index]) continue outer
    return true
  }
  return false
}

// ---------------------------------------------------------------------------------------------------------------------
// EXIF (a little-endian TIFF): IFD0 with Make, Model and the GPS IFD's place; the GPS IFD with GPSLatitude and
// GPSLongitude; IFD1 with a JPEG thumbnail, which itself ends in FF D9.
// ---------------------------------------------------------------------------------------------------------------------

/** Degrees, minutes and seconds, each a RATIONAL (numerator, denominator). */
type Coordinate = readonly [readonly [number, number], readonly [number, number], readonly [number, number]]
export interface Place { latitude: Coordinate; longitude: Coordinate }

/** Fictional places: a street corner's worth of precision, the kind a phone records. */
export const PLACE_TAKEN: Place = { latitude: [[6, 1], [27, 1], [1234, 100]], longitude: [[3, 1], [23, 1], [4567, 100]] }
export const PLACE_OF_THE_APPENDED: Place = { latitude: [[9, 1], [4, 1], [2468, 100]], longitude: [[7, 1], [29, 1], [1357, 100]] }

export const rationals = (coordinate: Coordinate): Bytes => coordinate.flatMap(([numerator, denominator]) => [...u32le(numerator), ...u32le(denominator)])
const entry = (tag: number, type: number, count: number, value: Bytes) => [...u16le(tag), ...u16le(type), ...u32le(count), ...value, ...Array(4 - value.length).fill(0)]

export const EXIF_MAKE = 'FictionalPhone'
export const EXIF_MODEL = 'FP-1 Example'
export const EXIF_THUMBNAIL: Bytes = [0xff, 0xd8, ...ascii('THUMBNAIL-OF-THE-ORIGINAL'), 0xff, 0xd9]
/** The IFD entries that say where the GPS data is, and what it is: their tag, type and count. */
export const GPS_POINTER_ENTRY: Bytes = [...u16le(0x8825), ...u16le(4), ...u32le(1)]
export const GPS_LATITUDE_ENTRY: Bytes = [...u16le(0x0002), ...u16le(5), ...u32le(3)]
export const GPS_LONGITUDE_ENTRY: Bytes = [...u16le(0x0004), ...u16le(5), ...u32le(3)]

export function exifTiff(place: Place): Bytes {
  const make = [...ascii(EXIF_MAKE), 0], model = [...ascii(EXIF_MODEL), 0]
  const ifd0 = 8, ifd0Size = 2 + 3 * 12 + 4
  const makeAt = ifd0 + ifd0Size, modelAt = makeAt + make.length
  const gps = modelAt + model.length, gpsSize = 2 + 5 * 12 + 4
  const latitudeAt = gps + gpsSize, longitudeAt = latitudeAt + 24
  const ifd1 = longitudeAt + 24, ifd1Size = 2 + 2 * 12 + 4
  const thumbnailAt = ifd1 + ifd1Size
  return [
    0x49, 0x49, 0x2a, 0x00, ...u32le(ifd0),
    ...u16le(3), ...entry(0x010f, 2, make.length, u32le(makeAt)), ...entry(0x0110, 2, model.length, u32le(modelAt)),
    ...entry(0x8825, 4, 1, u32le(gps)), ...u32le(ifd1),
    ...make, ...model,
    ...u16le(5), ...entry(0x0000, 1, 4, [2, 2, 0, 0]), ...entry(0x0001, 2, 2, ascii('N\0')), ...entry(0x0002, 5, 3, u32le(latitudeAt)),
    ...entry(0x0003, 2, 2, ascii('E\0')), ...entry(0x0004, 5, 3, u32le(longitudeAt)), ...u32le(0),
    ...rationals(place.latitude), ...rationals(place.longitude),
    ...u16le(2), ...entry(0x0201, 4, 1, u32le(thumbnailAt)), ...entry(0x0202, 4, 1, u32le(EXIF_THUMBNAIL.length)), ...u32le(0),
    ...EXIF_THUMBNAIL,
  ]
}

// ---------------------------------------------------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------------------------------------------------

export const segment = (marker: number, data: Bytes): Bytes => [0xff, marker, ((data.length + 2) >> 8) & 0xff, (data.length + 2) & 0xff, ...data]

export const XMP_PACKET = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
  + '<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="6,27.2057N" exif:GPSLongitude="3,23.7612E"/>'
  + '</rdf:RDF></x:xmpmeta>'
export const COMMENT = 'Taken at a fictional clinic in Ikeja'
export const IPTC_CITY = 'Fictional City'

export const SOI: Bytes = [0xff, 0xd8]
export const EOI: Bytes = [0xff, 0xd9]
export const JFIF = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
export const EXIF = (place: Place) => segment(0xe1, [...ascii('Exif'), 0, 0, ...exifTiff(place)])
export const XMP = segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), 0, ...ascii(XMP_PACKET)])
export const ICC = segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, ...ascii('fictional colour profile')])
export const MPF = segment(0xe2, [...ascii('MPF'), 0, 0x49, 0x49, 0x2a, 0x00, ...u32le(8), 0, 0])
const iptc = [0x1c, 0x02, 0x5a, 0x00, IPTC_CITY.length, ...ascii(IPTC_CITY)]
export const APP13 = segment(0xed, [...ascii('Photoshop 3.0'), 0, ...ascii('8BIM'), 0x04, 0x04, 0, 0, ...u32be(iptc.length), ...iptc])
export const ADOBE = segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 1])
export const COM = segment(0xfe, ascii(COMMENT))
export const DQT = segment(0xdb, [0, ...Array.from({ length: 64 }, (_, index) => index + 1)])
export const SOF0 = segment(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0])
export const SOF2 = segment(0xc2, [8, 0, 8, 0, 8, 1, 1, 0x11, 0])
export const DHT = segment(0xc4, [0x00, 1, ...Array(15).fill(0), 0x00])
export const DHT_AC = segment(0xc4, [0x10, 1, ...Array(15).fill(0), 0x00])
export const DRI = segment(0xdd, [0, 1])
export const SOS = segment(0xda, [1, 1, 0x00, 0, 63, 0])
/** Entropy-coded data with a stuffed FF (FF 00) and restarts (FF D0, FF D1) in it, as a scan has. */
export const ENTROPY: Bytes = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a, 0xff, 0x00, 0xbc, 0xff, 0xd1, 0xde]

/** A further JPEG a phone appends after the primary image's end (a depth or gain map), with its own EXIF and GPS. */
export const APPENDED: Bytes = [...SOI, ...EXIF(PLACE_OF_THE_APPENDED), ...DQT, ...SOF0, ...DHT, ...SOS, 0x21, 0x43, 0x65, ...EOI]

/**
 * A photo as a phone might save it: JFIF, EXIF with GPS, the camera and a thumbnail, XMP with GPS, a colour profile, the
 * MPF index, IPTC, Adobe's colour transform, a comment among the tables, one scan with restarts, the end of image, and a
 * further JPEG appended after it with its own EXIF and GPS.
 */
export function gpsTaggedJpeg() {
  const file = bytes(SOI, JFIF, EXIF(PLACE_TAKEN), XMP, ICC, MPF, APP13, ADOBE, DQT, COM, SOF0, DHT, DRI, SOS, ENTROPY, EOI, APPENDED)
  const stripped = bytes(SOI, JFIF, ICC, ADOBE, DQT, SOF0, DHT, DRI, SOS, ENTROPY, EOI)
  return { file, stripped }
}

/** A progressive JPEG: two scans, with a table between them, and a comment and EXIF to be taken out. */
export function progressiveJpeg() {
  const first = segment(0xda, [1, 1, 0x00, 0, 0, 0x01]), second = segment(0xda, [1, 1, 0x00, 1, 63, 0x01])
  const firstData: Bytes = [0x0a, 0xff, 0x00, 0x0b, 0x0c], secondData: Bytes = [0x1a, 0x1b, 0xff, 0x00, 0x1c]
  const file = bytes(SOI, EXIF(PLACE_TAKEN), DQT, SOF2, DHT, first, firstData, COM, DHT_AC, second, secondData, EOI)
  const stripped = bytes(SOI, DQT, SOF2, DHT, first, firstData, DHT_AC, second, secondData, EOI)
  return { file, stripped }
}

/** The plainest JPEG: nothing to take out, so stripping leaves every byte. */
export const PLAIN_JPEG = bytes(SOI, JFIF, DQT, SOF0, DHT, SOS, ENTROPY, EOI)

// ---------------------------------------------------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
export function crc32(data: ArrayLike<number>): number {
  let c = 0xffffffff
  for (let index = 0; index < data.length; index += 1) c = CRC_TABLE[(c ^ data[index]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export const PNG_SIGNATURE: Bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
export const chunk = (type: string, data: Bytes): Bytes => [...u32be(data.length), ...ascii(type), ...data, ...u32be(crc32([...ascii(type), ...data]))]

/** Content Credentials (C2PA) as a PNG carries them, in a caBX chunk: here with the place, as a phone's may be. */
export const C2PA_MANIFEST = 'jumb c2pa.assertions stds.exif exif:GPSLatitude="6,27.2057N"'
/** A vendor's own chunk (private: lower-case second letter), its contents anything at all. */
export const PRIVATE_CHUNK_TEXT = 'FictionalVendor taken near 6.4535N'

/**
 * A 1 x 1 palette PNG with EXIF (GPS), text, compressed text, international text (XMP), a time, Content Credentials
 * (caBX), Apple's iDOT and a vendor's private chunk, and bytes after IEND.
 */
export function metadataPng() {
  const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 3, 0, 0, 0])
  const plte = chunk('PLTE', [0x12, 0x34, 0x56])
  const idat = chunk('IDAT', [...deflateSync(Uint8Array.from([0, 0]))])
  const iend = chunk('IEND', [])
  const file = bytes(PNG_SIGNATURE, ihdr, chunk('tIME', [0x07, 0xea, 10, 20, 9, 30, 0]), plte, chunk('eXIf', exifTiff(PLACE_TAKEN)),
    chunk('tEXt', [...ascii('Comment'), 0, ...ascii(COMMENT)]), chunk('iTXt', [...ascii('XML:com.adobe.xmp'), 0, 0, 0, 0, 0, ...ascii(XMP_PACKET)]),
    chunk('caBX', ascii(C2PA_MANIFEST)), chunk('prVt', ascii(PRIVATE_CHUNK_TEXT)), chunk('iDOT', [0, 0, 0, 2, ...Array(24).fill(0)]),
    idat, chunk('zTXt', [...ascii('Location'), 0, 0, ...deflateSync(Uint8Array.from(ascii(COMMENT)))]), iend, ascii('after IEND: 6.4535N 3.3962E'))
  const stripped = bytes(PNG_SIGNATURE, ihdr, plte, idat, iend)
  return { file, stripped, kept: { ihdr, plte, idat, iend } }
}

/** The PNG's chunks as [type, whether its CRC is right], read from `file`. */
export function pngChunks(file: Uint8Array): Array<[string, boolean]> {
  const read: Array<[string, boolean]> = []
  let at = 8
  while (at + 12 <= file.length) {
    const length = ((file[at]! << 24) >>> 0) + (file[at + 1]! << 16) + (file[at + 2]! << 8) + file[at + 3]!
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8))
    const stored = ((file[at + 8 + length]! << 24) >>> 0) + (file[at + 9 + length]! << 16) + (file[at + 10 + length]! << 8) + file[at + 11 + length]!
    read.push([type, crc32(file.subarray(at + 4, at + 8 + length)) === stored])
    at += 12 + length
  }
  return read
}

/** What must never be left of the place, the camera or the comments, in any of these fixtures. */
export const NEVER_LEFT: ReadonlyArray<Bytes | string> = [
  'Exif', 'http://ns.adobe.com/xap', 'GPSLatitude', 'GPSLongitude', EXIF_MAKE, EXIF_MODEL, 'THUMBNAIL-OF-THE-ORIGINAL', 'Photoshop', '8BIM',
  IPTC_CITY, COMMENT, 'MPF', 'XML:com.adobe.xmp', 'after IEND', 'c2pa', 'caBX', 'iDOT', PRIVATE_CHUNK_TEXT,
  rationals(PLACE_TAKEN.latitude), rationals(PLACE_TAKEN.longitude), rationals(PLACE_OF_THE_APPENDED.latitude), rationals(PLACE_OF_THE_APPENDED.longitude),
  GPS_POINTER_ENTRY, GPS_LATITUDE_ENTRY, GPS_LONGITUDE_ENTRY,
]

export const toBytes = bytes
