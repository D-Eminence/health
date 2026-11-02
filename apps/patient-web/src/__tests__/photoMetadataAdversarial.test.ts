import { describe, expect, it } from 'vitest'
import { PhotoMetadataError, stripPhotoMetadata, type PhotoMetadataProblem, type StrippedPhotoType } from '../photoMetadata'
import {
  APPENDED, DHT, DQT, ENTROPY, EOI, NEVER_LEFT, PLACE_OF_THE_APPENDED, PLACE_TAKEN, PNG_SIGNATURE, SOF0, SOF2, SOI, SOS,
  ascii, chunk, contains, exifTiff, metadataPng, pngChunks, rationals, segment, toBytes,
} from './photoFixtures'

/**
 * The stripper as a privacy control, tried further (NDPA data minimisation; BACKEND-NEEDS.md §1): GPS inside the EXIF
 * thumbnail, what phones store after the end of image, a second picture behind the first frame, a PNG chunk no decoder
 * knows, a second IHDR, a PNG length that lies to carry an eXIf inside a chunk that is kept, and metadata after the image
 * data or after IEND. Each comes out clean, or is refused; never passed on as it is. Every value is fictional.
 */

const tiff = exifTiff(PLACE_TAKEN)
const places = [rationals(PLACE_TAKEN.latitude), rationals(PLACE_TAKEN.longitude), rationals(PLACE_OF_THE_APPENDED.latitude)]
const placeLeft = (bytes: Uint8Array) => places.some(place => contains(bytes, place)) || NEVER_LEFT.some(needle => contains(bytes, needle))
const be32 = (value: number) => [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]

const problemOf = (bytes: Uint8Array, type: StrippedPhotoType): PhotoMetadataProblem | 'kept' => {
  try {
    stripPhotoMetadata(bytes, type)
    return 'kept'
  } catch (error) {
    expect(error).toBeInstanceOf(PhotoMetadataError)
    return (error as PhotoMetadataError).problem
  }
}

describe('a JPEG', () => {
  it('loses an EXIF thumbnail that is itself a JPEG with its own EXIF and GPS, and what phones store after the end', () => {
    // APP1: the EXIF, then its thumbnail, a whole JPEG with an APP1 of its own (another place) and an end of image.
    const app1 = segment(0xe1, [...ascii('Exif'), 0, 0, ...tiff, ...APPENDED])
    // After the end: a further JPEG (a depth map), a Samsung-style trailer and a motion photo's video.
    const after = [...APPENDED, ...ascii('SEFHlocation 6.4535N 3.3962E SEFT'), 0, 0, 0, 0x18, ...ascii('ftypmp42'), ...tiff]
    const file = toBytes(SOI, app1, DQT, SOF0, DHT, SOS, ENTROPY, EOI, after)
    expect(placeLeft(file)).toBe(true)
    const out = stripPhotoMetadata(file, 'image/jpeg')
    expect([...out]).toEqual([...toBytes(SOI, DQT, SOF0, DHT, SOS, ENTROPY, EOI)])
    expect(placeLeft(out)).toBe(false)
    expect(contains(out, 'SEFH')).toBe(false)
  })

  it('refuses a second frame before the end: a second picture can’t hide behind the first', () => {
    // The hidden picture's data carries the place, as a second picture could.
    const hidden = [...SOS, ...rationals(PLACE_TAKEN.latitude)]
    expect(problemOf(toBytes(SOI, DQT, SOF0, DHT, SOS, ENTROPY, SOF0, hidden, EOI), 'image/jpeg')).toBe('bad-marker')
    expect(problemOf(toBytes(SOI, DQT, SOF0, DHT, SOS, ENTROPY, SOF2, hidden, EOI), 'image/jpeg')).toBe('bad-marker')
    expect(problemOf(toBytes(SOI, DQT, SOF0, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg')).toBe('bad-marker')
  })
})

describe('a PNG', () => {
  const { kept } = metadataPng()
  const exifChunk = chunk('eXIf', tiff)

  it('drops an eXIf after the image data and whole chunks after IEND, keeping the rest byte for byte with valid CRCs', () => {
    const file = toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat, exifChunk, chunk('tEXt', [...ascii('GPS'), 0, ...ascii('6.4535N')]),
      kept.iend, exifChunk, chunk('IDAT', [...ascii('after IEND')]))
    const out = stripPhotoMetadata(file, 'image/png')
    expect([...out]).toEqual([...toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat, kept.iend)])
    expect(placeLeft(out)).toBe(false)
    expect(pngChunks(out).every(([, valid]) => valid)).toBe(true)
  })

  it('refuses a critical chunk PNG doesn’t have (one named EXIF, say) and a second IHDR', () => {
    const cases: Array<[string, Uint8Array]> = [
      ['a critical chunk named EXIF', toBytes(PNG_SIGNATURE, kept.ihdr, chunk('EXIF', tiff), kept.plte, kept.idat, kept.iend)],
      ['an unknown critical chunk after the image data', toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat, chunk('GPSx', tiff), kept.iend)],
      ['a second IHDR', toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, kept.idat, kept.ihdr, kept.iend)],
    ]
    for (const [what, bytes] of cases) expect(problemOf(bytes, 'image/png'), what).toBe('bad-chunk')
  })

  it('refuses a chunk whose length lies to carry the eXIf after it inside a chunk that is kept', () => {
    // pHYs (kept) says it runs on to the end of the eXIf after it, less that chunk's CRC, which then reads as its own.
    const phys = [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]
    const swallowing = [...be32(phys.length + exifChunk.length - 4), ...ascii('pHYs'), ...phys, ...exifChunk]
    const file = toBytes(PNG_SIGNATURE, kept.ihdr, swallowing, kept.plte, kept.idat, kept.iend)
    expect(problemOf(file, 'image/png')).toBe('bad-chunk')
  })

  it('refuses any chunk whose CRC is wrong, kept or dropped', () => {
    const flipped = (bytes: number[]) => [...bytes.slice(0, -1), bytes.at(-1)! ^ 0x01]
    for (const [what, bytes] of [
      ['IDAT', toBytes(PNG_SIGNATURE, kept.ihdr, kept.plte, flipped([...kept.idat]), kept.iend)],
      ['eXIf', toBytes(PNG_SIGNATURE, kept.ihdr, flipped(exifChunk), kept.plte, kept.idat, kept.iend)],
      ['IHDR', toBytes(PNG_SIGNATURE, flipped([...kept.ihdr]), kept.plte, kept.idat, kept.iend)],
    ] as const) expect(problemOf(bytes, 'image/png'), what).toBe('bad-chunk')
  })
})
