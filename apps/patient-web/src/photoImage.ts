/**
 * The profile photo as the portal sends it (hid-1.0 parity B3, the lead's decision): whatever JPEG or PNG the patient
 * chooses is decoded here, cropped to its centre square and drawn afresh on a 512 x 512 canvas, and only the JPEG the
 * canvas encodes is sent. Nothing of the chosen file's own bytes goes, so its metadata (EXIF, the GPS position where it
 * was taken, the camera, any comment) is never uploaded; what the browser's own encoder adds besides the picture
 * (WebKit's Exif and Photoshop blocks) is dropped from the canvas JPEG too. Identity checks the type by its magic bytes
 * again, the size (at most 300 KB), the dimensions (at most 1024 x 1024) and that no such block is left. Nothing is
 * kept: the bytes live in memory only.
 */

/** The side of the square the portal sends. */
export const PHOTO_SIDE = 512
/** The most Identity stores, decoded. */
export const PHOTO_MAX_BYTES = 300 * 1024
/** The largest file the page decodes: a phone's camera picture fits; anything larger is refused before it is read. */
export const PHOTO_SOURCE_MAX_BYTES = 10 * 1024 * 1024
/** The JPEG qualities tried in turn until the photo fits in PHOTO_MAX_BYTES (a 512 x 512 photo nearly always fits at the first). */
const QUALITIES = [0.86, 0.75, 0.62, 0.5] as const

export type PhotoType = 'image/jpeg' | 'image/png'

/** Why a chosen picture can't be used, in words the page shows as they are. */
export class PhotoProblem extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoProblem'
  }
}

export const PHOTO_TYPE_PROBLEM = 'Choose a JPEG or PNG picture.'
export const PHOTO_SOURCE_TOO_LARGE = 'This picture is too large to use. Choose one under 10 MB.'
export const PHOTO_UNREADABLE = 'This picture could not be opened. Choose another JPEG or PNG picture.'
export const PHOTO_UNSUPPORTED = 'This browser can’t prepare the photo. Try another browser.'
export const PHOTO_TOO_DETAILED = 'This picture could not be made small enough. Choose another one.'

/** The type a file's first bytes say it is: FF D8 FF for a JPEG, the eight-byte signature for a PNG, or null. */
export async function sniffPhotoType(file: Blob): Promise<PhotoType | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (head.length === 8 && png.every((byte, index) => head[index] === byte)) return 'image/png'
  return null
}

interface Decoded { source: CanvasImageSource; width: number; height: number; release: () => void }

/** The picture, decoded as the browser shows it (turned the way its camera said it was held). */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch (cause) {
    URL.revokeObjectURL(url)
    throw cause
  }
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      // A browser that cannot encode a JPEG answers a PNG, or nothing: neither is sent.
      if (blob && blob.type === 'image/jpeg') resolve(blob)
      else reject(new PhotoProblem(PHOTO_UNSUPPORTED))
    }, 'image/jpeg', quality)
  })
}

/** The largest side Identity takes, in pixels. */
const PHOTO_MAX_SIDE = 1024
/** JPEG markers without a length: TEM and RST0-RST7. */
const JPEG_STANDALONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7])
/** Start-of-frame markers, which carry the frame size (not DHT C4, JPG C8 or DAC CC), as Identity reads them. */
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const ADOBE = [0x41, 0x64, 0x6f, 0x62, 0x65] // "Adobe"

/**
 * The canvas JPEG with only the picture: the segments a browser's encoder adds besides it are dropped. WebKit (Safari,
 * and every browser on iOS) writes an APP1 Exif block (its colour space and pixel size) and an APP13 Photoshop block
 * into every canvas JPEG, and Identity refuses any JPEG holding APP1 or APP13, as it would a camera's EXIF and GPS.
 * Every APP1 to APP15 segment and every comment (COM) before the scan goes, except an APP14 "Adobe" segment, which says
 * how the colours are encoded and nothing else; the JFIF APP0, the tables, the frame, the scan and the end are kept as
 * encoded. Null when the bytes are not a JPEG laid out as Identity reads one: SOI, its segments, one frame header of 1
 * to 1024 pixels a side before the scan, and EOI last.
 */
export function withoutJpegMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = bytes.byteLength
  if (length < 4 || view.getUint16(0) !== 0xffd8 || view.getUint8(2) !== 0xff || view.getUint16(length - 2) !== 0xffd9) return null
  const kept: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)]
  let framed = false
  let offset = 2
  while (offset < length) {
    if (view.getUint8(offset) !== 0xff) return null
    // Fill bytes before a marker are not kept.
    while (offset < length && view.getUint8(offset) === 0xff) offset += 1
    if (offset >= length) return null
    const marker = view.getUint8(offset)
    offset += 1
    if (JPEG_STANDALONE_MARKERS.has(marker)) { kept.push(Uint8Array.of(0xff, marker)); continue }
    // The scan, and all that follows it to EOI, is the picture itself: kept as it is, once the frame size is known.
    if (marker === 0xda) {
      if (!framed) return null
      kept.push(Uint8Array.of(0xff, marker), bytes.subarray(offset))
      return joined(kept)
    }
    if (marker === 0xd8 || marker === 0xd9 || offset + 2 > length) return null
    const size = view.getUint16(offset)
    if (size < 2 || offset + size > length) return null
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (framed || size < 7) return null
      const height = view.getUint16(offset + 3)
      const width = view.getUint16(offset + 5)
      if (width < 1 || height < 1 || width > PHOTO_MAX_SIDE || height > PHOTO_MAX_SIDE) return null
      framed = true
    }
    const adobe = marker === 0xee && size >= 2 + ADOBE.length && ADOBE.every((byte, index) => view.getUint8(offset + 2 + index) === byte)
    const metadata = marker === 0xfe || (marker >= 0xe1 && marker <= 0xef && !adobe)
    if (!metadata) kept.push(Uint8Array.of(0xff, marker), bytes.subarray(offset, offset + size))
    offset += size
  }
  return null
}

function joined(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const whole = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let at = 0
  for (const part of parts) { whole.set(part, at); at += part.byteLength }
  return whole
}

/** The encoded JPEG without its encoder's metadata, or the reason it can't be sent. */
async function pictureOnly(encoded: Blob): Promise<Blob> {
  const bytes = withoutJpegMetadata(new Uint8Array(await encoded.arrayBuffer()))
  if (!bytes) throw new PhotoProblem(PHOTO_UNSUPPORTED)
  return new Blob([bytes], { type: 'image/jpeg' })
}

/**
 * The photo to send: the centre square of `file`, drawn at 512 x 512 on a white ground (a PNG's transparent parts
 * become white) and encoded as a JPEG of at most 300 KB. Refuses anything that is not a JPEG or PNG by its type and by
 * its first bytes.
 */
export async function reencodePhoto(file: File): Promise<Blob> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') throw new PhotoProblem(PHOTO_TYPE_PROBLEM)
  if (file.size > PHOTO_SOURCE_MAX_BYTES) throw new PhotoProblem(PHOTO_SOURCE_TOO_LARGE)
  if (await sniffPhotoType(file) === null) throw new PhotoProblem(PHOTO_TYPE_PROBLEM)
  let image: Decoded
  try { image = await decode(file) } catch { throw new PhotoProblem(PHOTO_UNREADABLE) }
  try {
    if (!(image.width > 0) || !(image.height > 0)) throw new PhotoProblem(PHOTO_UNREADABLE)
    const side = Math.min(image.width, image.height)
    const canvas = document.createElement('canvas')
    canvas.width = PHOTO_SIDE
    canvas.height = PHOTO_SIDE
    const context = canvas.getContext('2d')
    if (!context) throw new PhotoProblem(PHOTO_UNSUPPORTED)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, PHOTO_SIDE, PHOTO_SIDE)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image.source, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, PHOTO_SIDE, PHOTO_SIDE)
    for (const quality of QUALITIES) {
      const photo = await pictureOnly(await encode(canvas, quality))
      if (photo.size <= PHOTO_MAX_BYTES) return photo
    }
    throw new PhotoProblem(PHOTO_TOO_DETAILED)
  } finally {
    image.release()
  }
}

/** The bytes as base64, for the JSON body. */
export async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}
