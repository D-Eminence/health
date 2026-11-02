import { describe, expect, it } from 'vitest'
import { PhotoMetadataError, stripPhotoMetadata, withoutPhotoMetadata, type PhotoMetadataProblem } from '../photoMetadata'
import {
  ADOBE, DHT, DQT, DRI, ENTROPY, EOI, EXIF, JFIF, NEVER_LEFT, PLACE_TAKEN, PLAIN_JPEG, SOF0, SOI, SOS,
  ascii, contains, exifTiff, gpsTaggedJpeg, metadataPng, rationals, segment, toBytes,
} from './photoFixtures'

/**
 * The stripper as a privacy control, tried the ways a file could still carry the place or the camera through it: EXIF
 * in segments other than APP1, a length that lies to hide an EXIF block inside a segment that is kept, and a photo
 * under a PDF's name. Each must come out clean, or be refused; never sent as it is. Every value is fictional.
 */

const EXIF_BLOCK = [...ascii('Exif'), 0, 0, ...exifTiff(PLACE_TAKEN)]
const length = (data: number) => [((data + 2) >> 8) & 0xff, (data + 2) & 0xff]
/** A segment of `marker` holding `data`, its length counting `hidden` too: what a lying length hides behind its fields. */
const lying = (marker: number, data: number[], hidden: number[]) => [0xff, marker, ...length(data.length + hidden.length), ...data, ...hidden]

const refusal = (bytes: Uint8Array): PhotoMetadataProblem | 'kept' => {
  try {
    stripPhotoMetadata(bytes, 'image/jpeg')
    return 'kept'
  } catch (error) {
    expect(error).toBeInstanceOf(PhotoMetadataError)
    return (error as PhotoMetadataError).problem
  }
}
const leftOf = (stripped: Uint8Array) => NEVER_LEFT.filter(needle => contains(stripped, needle))

describe('a JPEG whose EXIF is somewhere other than APP1', () => {
  it('comes out clean: APP0 JFXX, APP0 JFIF with more after it, APP2 that isn’t a colour profile, APP3, APP15, a second APP1, the XMP extension, APP1 after the scan', () => {
    const elsewhere = [
      segment(0xe0, [...ascii('JFXX'), 0, 0x10, ...EXIF_BLOCK]),
      segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, ...EXIF_BLOCK]),
      segment(0xe2, EXIF_BLOCK),
      segment(0xe2, [...ascii('MPF'), 0, ...EXIF_BLOCK]),
      segment(0xe3, EXIF_BLOCK),
      segment(0xef, EXIF_BLOCK),
      segment(0xe1, [...ascii('http://ns.adobe.com/xmp/extension/'), 0, ...ascii('exif:GPSLatitude="6,27.2057N"')]),
    ]
    const file = toBytes(SOI, ...elsewhere, EXIF(PLACE_TAKEN), EXIF(PLACE_TAKEN), DQT, SOF0, DHT, SOS, ENTROPY, segment(0xe1, EXIF_BLOCK), EOI)
    const out = stripPhotoMetadata(file, 'image/jpeg')
    // Only JFIF's own header is left of all of it, with no thumbnail: the same bytes as the plain JPEG.
    expect([...out]).toEqual([...PLAIN_JPEG])
    expect(leftOf(out)).toEqual([])
  })
})

describe('a length that lies', () => {
  it('refuses a table, frame or scan header whose length says more than its fields: an EXIF block can’t ride inside one that is kept', () => {
    const app1 = segment(0xe1, EXIF_BLOCK)
    const tail = [...DHT, ...SOS, ...ENTROPY, ...EOI]
    const cases: Array<[string, Uint8Array]> = [
      ['DQT swallowing the APP1 after it', toBytes(SOI, lying(0xdb, DQT.slice(4), app1), SOF0, tail)],
      ['DQT with the EXIF block after its table', toBytes(SOI, lying(0xdb, DQT.slice(4), EXIF_BLOCK), SOF0, tail)],
      ['SOF0 with more after its component', toBytes(SOI, DQT, lying(0xc0, SOF0.slice(4), EXIF_BLOCK), tail)],
      ['DHT with more after its table', toBytes(SOI, DQT, SOF0, lying(0xc4, DHT.slice(4), EXIF_BLOCK), SOS, ENTROPY, EOI)],
      ['SOS with more after its fields', toBytes(SOI, DQT, SOF0, DHT, lying(0xda, SOS.slice(4), EXIF_BLOCK), ENTROPY, EOI)],
      ['DRI with more after its interval', toBytes(SOI, DQT, SOF0, lying(0xdd, DRI.slice(4), EXIF_BLOCK), tail)],
      ['DNL with more after its lines', toBytes(SOI, DQT, SOF0, DHT, SOS, ENTROPY, lying(0xdc, [0, 8], EXIF_BLOCK), EOI)],
      ['EXP with more after it', toBytes(SOI, DQT, lying(0xdf, [0x11], EXIF_BLOCK), SOF0, tail)],
      ['DAC of an odd length', toBytes(SOI, DQT, SOF0, segment(0xcc, [0x00, 0x11, 0x00]), tail)],
      ['a DQT of no table', toBytes(SOI, segment(0xdb, []), SOF0, tail)],
      ['a DQT whose table runs past its length', toBytes(SOI, segment(0xdb, DQT.slice(4, -1)), SOF0, tail)],
      ['a DHT whose values run past its length', toBytes(SOI, DQT, SOF0, segment(0xc4, [0x00, 3, ...Array(15).fill(0), 0x00]), SOS, ENTROPY, EOI)],
      ['a DQT table of an unknown precision', toBytes(SOI, segment(0xdb, [0x20, ...DQT.slice(5)]), SOF0, tail)],
      ['a DHT table counting more than 256 values', toBytes(SOI, DQT, SOF0, segment(0xc4, [0x00, ...Array(16).fill(17), ...Array(272).fill(0)]), SOS, ENTROPY, EOI)],
      ['a DHT table cut short of its counts', toBytes(SOI, DQT, SOF0, segment(0xc4, [0x00, 1, 0, 0]), SOS, ENTROPY, EOI)],
      ['a frame of no component', toBytes(SOI, DQT, segment(0xc0, [8, 0, 8, 0, 8, 0]), tail)],
      ['a scan of no component', toBytes(SOI, DQT, SOF0, DHT, segment(0xda, [0, 0, 63, 0]), ENTROPY, EOI)],
    ]
    for (const [what, bytes] of cases) expect(refusal(bytes), what).toBe('bad-segment')
  })

  it('still takes every table, frame and scan header that is exactly its fields', () => {
    // A 16-bit table and an 8-bit one in one DQT; two Huffman tables in one DHT; three components in the frame and scan.
    const dqt = segment(0xdb, [0x10, ...Array(128).fill(1), 0x01, ...Array(64).fill(2)])
    const sof = segment(0xc1, [8, 0, 16, 0, 16, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
    const dht = segment(0xc4, [0x00, 2, ...Array(15).fill(0), 0x03, 0x04, 0x11, 0, 1, ...Array(14).fill(0), 0x05])
    const dac = segment(0xcc, [0x00, 0x11, 0x10, 0x05])
    const sos = segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])
    const file = toBytes(SOI, JFIF, dqt, sof, dht, dac, DRI, sos, ENTROPY, segment(0xdc, [0, 16]), EOI)
    expect([...stripPhotoMetadata(file, 'image/jpeg')]).toEqual([...file])
  })

  it('keeps Adobe’s 12 bytes and leaves behind whatever a longer APP14 carries; one too short to be Adobe’s is dropped', () => {
    const longer = segment(0xee, [...ADOBE.slice(4), ...EXIF_BLOCK])
    const out = stripPhotoMetadata(toBytes(SOI, longer, DQT, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg')
    expect([...out]).toEqual([...toBytes(SOI, ADOBE, DQT, SOF0, DHT, SOS, ENTROPY, EOI)])
    expect(leftOf(out)).toEqual([])
    const short = segment(0xee, ascii('Adobe'))
    expect([...stripPhotoMetadata(toBytes(SOI, short, DQT, SOF0, DHT, SOS, ENTROPY, EOI), 'image/jpeg')])
      .toEqual([...toBytes(SOI, DQT, SOF0, DHT, SOS, ENTROPY, EOI)])
  })

  it('refuses a JPEG that starts again inside a scan, rather than take it for the picture’s data', () => {
    const inner = [0xff, 0xd8, ...segment(0xe1, EXIF_BLOCK)]
    expect(refusal(toBytes(SOI, DQT, SOF0, DHT, SOS, [0x12, 0x34], inner, EOI))).toBe('bad-marker')
  })
})

describe('a photo under a PDF’s name', () => {
  /** The first bytes of each kind of picture or phone video, its EXIF (with the GPS position) after them. */
  const exif = exifTiff(PLACE_TAKEN)
  const box = (type: string, brand: string) => [0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii(brand), 0, 0, 0, 0, ...ascii(`mif1${type}`)]
  const pictures: Array<[string, number[]]> = [
    ['a TIFF, little-endian (and a DNG)', exif],
    ['a TIFF, big-endian', [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, ...exif]],
    ['a BigTIFF', [0x49, 0x49, 0x2b, 0x00, 8, 0, 0, 0, ...exif]],
    ['an iPhone’s HEIC', [...box('heic', 'heic'), ...ascii('Exif'), ...exif]],
    ['an AVIF', [...box('avif', 'avif'), ...exif]],
    ['a phone’s video (MP4 or MOV)', [0, 0, 0, 0x14, ...ascii('ftypqt  '), 0, 0, 0, 0, ...ascii('qt  '), ...exif]],
    ['a WebP', [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8X'), ...ascii('EXIF'), ...exif]],
    ['a GIF', [...ascii('GIF89a'), 1, 0, 1, 0, ...exif]],
    ['a JPEG XL codestream', [0xff, 0x0a, ...exif]],
    ['a JPEG XL container', [0, 0, 0, 0x0c, ...ascii('JXL '), 0x0d, 0x0a, 0x87, 0x0a, ...ascii('Exif'), ...exif]],
  ]

  it('refuses any picture or phone video that says it is a PDF: it would go up with its EXIF and GPS', async () => {
    for (const [what, bytes] of pictures) {
      const disguised = new File([toBytes(bytes)], 'scan.pdf', { type: 'application/pdf' })
      expect(contains(toBytes(bytes), rationals(PLACE_TAKEN.latitude)), what).toBe(true)
      await expect(withoutPhotoMetadata(disguised), what).rejects.toMatchObject({ name: 'PhotoMetadataError', problem: 'type-mismatch' })
    }
  })

  it('sends a PDF as it is, the very File, whatever it holds after its start', async () => {
    for (const bytes of [ascii('%PDF-1.7 fictional'), [0x0a, ...ascii('%PDF-1.4')], Array(16).fill(0)]) {
      const pdf = new File([toBytes(bytes)], 'discharge.pdf', { type: 'application/pdf' })
      expect(await withoutPhotoMetadata(pdf)).toBe(pdf)
    }
  })

  it('refuses a photo whose bytes are another picture’s, whatever photo type it says', async () => {
    for (const [type, bytes] of [['image/jpeg', metadataPng().file], ['image/png', gpsTaggedJpeg().file], ['image/jpeg', toBytes(exif)]] as const) {
      await expect(withoutPhotoMetadata(new File([bytes], 'photo', { type }))).rejects.toBeInstanceOf(PhotoMetadataError)
    }
  })
})
