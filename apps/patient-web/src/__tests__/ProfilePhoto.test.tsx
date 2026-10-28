import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { PatientProfile } from '../api'
import { PHOTO_SIDE, PHOTO_SIDES, base64Of, photoBody, reencodePhoto, withoutJpegMetadata } from '../photoImage'
import { EDGE_BODY_MAX_BYTES, jsonBodyBytes } from '../profileParity'
import { PortalShell, ProfilePage } from '../routes/Portal'
import { json, openSection, press, problem, profile, renderPortal, type Handler, type Sent } from './portalHarness'

vi.mock('../chatFeatures', () => ({ patientChatEnabled: () => false, patientChatHost: () => false }))

/**
 * The profile photo (hid-1.0 parity B3, the lead's decisions): the page decodes the chosen JPEG or PNG, crops it to its
 * centre square, draws it afresh on a small square canvas and sends only the JPEG the canvas encodes, in a body of at
 * most 8,000 bytes, which production's edge lets through. These tests stand in for the browser's decoder and canvas,
 * and check that what is uploaded is exactly that fresh JPEG and never the chosen file's own bytes, with its EXIF and
 * GPS block.
 */

/** A camera JPEG with an EXIF block holding a GPS position: SOI, APP1 "Exif", a GPS tag, then picture bytes. */
const GPS_MARKER = [0x47, 0x50, 0x53, 0x49, 0x6e, 0x66, 0x6f] // "GPSInfo"
const CAMERA_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...GPS_MARKER,
  0x06, 0x24, 0x18, 0x0e, 0x00, 0x03, 0x37, 0x2c, 0xff, 0xdb, 0x11, 0x22, 0x33, 0x44, 0xff, 0xd9])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])

const decoded = (base64: string) => Uint8Array.from(atob(base64), character => character.charCodeAt(0))
/** A JPEG segment: FF, the marker, the length (its own two bytes included), the payload. */
const segment = (marker: number, payload: readonly number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload]
const JFIF = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
/** The rest of a canvas JPEG, laid out as an encoder writes it (the tables shortened): DQT, a `side` x `side` SOF0, DHT, SOS. */
const pictureHead = (side: number) => [...segment(0xdb, [0x00, 0x55, 0x66, 0x77]),
  ...segment(0xc0, [0x08, side >> 8, side & 0xff, side >> 8, side & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
  ...segment(0xc4, [0x00, 0x01, 0x05, 0x01]), ...segment(0xda, [0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00])]
/** SOI, the header segments given, the picture's tables and frame, the scan, EOI. */
function jpeg(header: readonly number[], scan: Uint8Array = new Uint8Array([0x12, 0x34, 0x56, 0x78]), side: number = PHOTO_SIDE): Uint8Array<ArrayBuffer> {
  const head = [0xff, 0xd8, ...header, ...pictureHead(side)]
  const whole = new Uint8Array(head.length + scan.length + 2)
  whole.set(head)
  whole.set(scan, head.length)
  whole.set([0xff, 0xd9], head.length + scan.length)
  return whole
}
/** What the stand-in canvas encodes, as Chromium and Firefox do: a fresh JFIF JPEG with no metadata, 256 x 256. */
const CANVAS_JPEG = jpeg(JFIF)
/**
 * The start of every canvas JPEG WebKit (Safari, and every browser on iOS) encodes through ImageIO: SOI, JFIF at 72 dpi,
 * an APP1 Exif block (ColorSpace, PixelXDimension and PixelYDimension, here 512) and an APP13 Photoshop 3.0 block (8BIM
 * 0x0404 and 0x0425). Identity refuses a JPEG with either. The frame that follows here is 256 x 256.
 */
const WEBKIT_HEAD = decoded('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAACAKADAAQAAAABAAACAAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+')
const WEBKIT_JPEG = jpeg([...WEBKIT_HEAD.slice(2)])
const WEBKIT_JFIF = [...WEBKIT_HEAD.slice(2, 20)]

/**
 * Identity's own reading of a JPEG (hid-system services/identity-api/src/patient-profile/profile-photo.ts jpegSize), as
 * it is: FF D8 FF first and FF D9 last, the segments walked to the scan, one frame size, and no APP1 or APP13.
 */
function identityJpegSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const at = (index: number) => bytes[index] ?? -1
  const word = (index: number) => (at(index) << 8) | at(index + 1)
  if (bytes.length < 4 || at(0) !== 0xff || at(1) !== 0xd8 || at(2) !== 0xff || at(bytes.length - 2) !== 0xff || at(bytes.length - 1) !== 0xd9) return undefined
  const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  const standalone = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7])
  let size: { width: number; height: number } | undefined
  let offset = 2
  while (offset < bytes.length) {
    if (at(offset) !== 0xff) return undefined
    while (offset < bytes.length && at(offset) === 0xff) offset += 1
    const marker = at(offset)
    offset += 1
    if (marker === -1) return undefined
    if (standalone.has(marker)) continue
    if (marker === 0xda || marker === 0xd9) return size
    if (offset + 2 > bytes.length) return undefined
    const length = word(offset)
    if (length < 2 || offset + length > bytes.length) return undefined
    if (marker === 0xe1 || marker === 0xed) return undefined
    if (frames.has(marker)) {
      if (length < 7 || size) return undefined
      size = { height: word(offset + 3), width: word(offset + 5) }
    }
    offset += length
  }
  return undefined
}
const contains = (haystack: Uint8Array, needle: readonly number[]) =>
  haystack.some((_, start) => needle.every((byte, offset) => haystack[start + offset] === byte))

type Recorded = Mock<(...args: unknown[]) => void>
interface Canvas { context: { fillRect: Recorded; drawImage: Recorded }; toBlob: Recorded; sizes: Array<[number, number]> }
let canvas: Canvas
let bitmap: { width: number; height: number; close: Recorded }
let created: string[]
let revoked: string[]

beforeEach(() => {
  bitmap = { width: 1200, height: 800, close: vi.fn<(...args: unknown[]) => void>() }
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  const context = { fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
    fillRect: vi.fn<(...args: unknown[]) => void>(), drawImage: vi.fn<(...args: unknown[]) => void>() }
  canvas = { context, sizes: [], toBlob: vi.fn<(...args: unknown[]) => void>() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    canvas.sizes.push([this.width, this.height])
    return context as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback, type?: string, quality?: unknown) => {
    canvas.toBlob(type, quality)
    callback(new Blob([CANVAS_JPEG], { type: 'image/jpeg' }))
  })
  created = []; revoked = []
  let next = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const url = `blob:https://portal.test/${++next}`; created.push(url); return url })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => { revoked.push(url) })
})
afterEach(() => { vi.unstubAllGlobals() })

const withPhoto: PatientProfile = { ...profile, email: 'ada@example.com', phone: '+2348031234567', phoneVerified: false, hasPhoto: false }

/** Identity with the photo routes: the profile says whether there is one, and the photo is read and changed. */
function gateway(start: boolean, answers: { put?: () => Response; del?: () => Response } = {}): Handler & { hasPhoto: () => boolean } {
  let has = start
  const handler = ((path: string, method: string) => {
    if (path === '/identity/me' && method === 'GET') return json({ ...withPhoto, hasPhoto: has })
    if (path === '/identity/me/photo' && method === 'GET') return has
      ? new Response(CANVAS_JPEG, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' } })
      : problem(404, 'PHOTO_NOT_FOUND', 'There is no photo.')
    if (path === '/identity/me/photo' && method === 'PUT') { const answer = answers.put?.() ?? json({ hasPhoto: true }); if (answer.ok) has = true; return answer }
    if (path === '/identity/me/photo' && method === 'DELETE') { const answer = answers.del?.() ?? json({ hasPhoto: false }); if (answer.ok) has = false; return answer }
    return problem(404, 'NOT_FOUND', `${method} ${path}`)
  }) as unknown as Handler & { hasPhoto: () => boolean }
  handler.hasPhoto = () => has
  return handler
}
const photoCard = async () => within(await openSection('Photo'))
async function choose(file: File) {
  const input = (await photoCard()).getByLabelText(/Choose a (new )?photo/) as HTMLInputElement
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
}
const puts = (sent: Sent[]) => sent.filter(request => request.path === '/identity/me/photo' && request.method === 'PUT')

/** The JPEG the page uploaded, from the body of its PUT. */
const uploaded = (sent: Sent[]) => decoded((puts(sent)[0]?.body as { data: string }).data)
/**
 * A stand-in canvas that encodes, at each side and quality, a JPEG with `header`: `length(side, quality)` bytes once
 * the metadata is dropped, which leaves `kept` of the header.
 */
function encodes(length: (side: number, quality: number) => number, header: readonly number[] = JFIF, kept: readonly number[] = header) {
  const tried: Array<[number, unknown]> = []
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback, _type?: string, quality?: unknown) {
    tried.push([this.width, quality])
    const scan = length(this.width, quality as number) - jpeg(kept, new Uint8Array(0), this.width).length
    callback(new Blob([jpeg(header, new Uint8Array(Math.max(1, scan)), this.width)], { type: 'image/jpeg' }))
  } as unknown as typeof HTMLCanvasElement.prototype.toBlob)
  return tried
}
/**
 * The bytes libjpeg encodes a typical portrait in (the centre square of an 810 x 1080 head-and-shoulders photo, drawn
 * at each side and encoded at each quality the page tries), once the encoder's metadata is dropped.
 */
const PORTRAIT: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  256: { 0.86: 16841, 0.75: 12005, 0.62: 9541, 0.5: 8070 }, 224: { 0.86: 13377, 0.75: 9551, 0.62: 7554, 0.5: 6465 },
  192: { 0.86: 10192, 0.75: 7347, 0.62: 5873, 0.5: 5017 }, 160: { 0.86: 7496, 0.75: 5469, 0.62: 4428, 0.5: 3814 },
  128: { 0.86: 5257, 0.75: 3926, 0.62: 3168, 0.5: 2789 },
}

describe('the photo the page sends', () => {
  it('is a fresh canvas JPEG of the centre square: none of the chosen file, its EXIF or GPS, is uploaded', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(false), {}, { parityB3: true })
    await choose(new File([CAMERA_JPEG], 'IMG_0001.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByRole('img', { name: 'Your new photo, cropped to a square' })).toBeTruthy()
    // Decoded, drawn at 256 x 256 on white from the centre square (1200 x 800: 200 in, 800 across), encoded as a JPEG.
    expect(canvas.sizes).toEqual([[256, 256]])
    expect(canvas.context.fillRect).toHaveBeenCalledWith(0, 0, 256, 256)
    expect(canvas.context.drawImage).toHaveBeenCalledWith(bitmap, 200, 0, 800, 800, 0, 0, 256, 256)
    expect(canvas.toBlob).toHaveBeenCalledWith('image/jpeg', 0.86)
    expect(bitmap.close).toHaveBeenCalled()
    expect(puts(sent)).toEqual([])

    await press(screen.getByRole('button', { name: 'Save photo' }))
    await screen.findByText('Your photo was saved.')
    const [upload] = puts(sent)
    const body = upload?.body as { mediaType: string; data: string }
    expect(body.mediaType).toBe('image/jpeg')
    const bytes = decoded(body.data)
    expect(bytes).toEqual(CANVAS_JPEG)
    expect(contains(bytes, [0x45, 0x78, 0x69, 0x66])).toBe(false) // "Exif"
    expect(contains(bytes, GPS_MARKER)).toBe(false)
    expect(contains(bytes, [...CAMERA_JPEG.slice(20, 28)])).toBe(false)
    expect(puts(sent)).toHaveLength(1)
  })

  it('takes a PNG the same way, as a JPEG on white', async () => {
    bitmap = { width: 600, height: 900, close: vi.fn<(...args: unknown[]) => void>() }
    const photo = await reencodePhoto(new File([PNG], 'scan.png', { type: 'image/png' }))
    expect(photo.type).toBe('image/jpeg')
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(CANVAS_JPEG)
    expect(canvas.context.drawImage).toHaveBeenCalledWith(bitmap, 0, 150, 600, 600, 0, 0, 256, 256)
  })

  it('sends a typical photo at the largest side whose body fits in 8,000 bytes, which production\'s edge lets through', async () => {
    // As Safari encodes it, with its Exif and Photoshop blocks on every candidate: each is measured without them.
    const tried = encodes((side, quality) => PORTRAIT[side]?.[quality] ?? 40_000, [...WEBKIT_HEAD.slice(2)], WEBKIT_JFIF)
    const { sent } = renderPortal(<ProfilePage />, gateway(false), {}, { parityB3: true })
    await choose(new File([CAMERA_JPEG], 'IMG_0003.jpg', { type: 'image/jpeg' }))
    await press(await screen.findByRole('button', { name: 'Save photo' }))
    await screen.findByText('Your photo was saved.')
    // 256 and 224 px are too large at every quality; 192 px fits at 0.62.
    expect(tried).toEqual([[256, 0.86], [256, 0.75], [256, 0.62], [256, 0.5], [224, 0.86], [224, 0.75], [224, 0.62], [224, 0.5],
      [192, 0.86], [192, 0.75], [192, 0.62]])
    expect(canvas.sizes).toEqual([[256, 256], [224, 224], [192, 192]])
    expect(canvas.context.drawImage).toHaveBeenLastCalledWith(bitmap, 200, 0, 800, 800, 0, 0, 192, 192)
    const bytes = uploaded(sent)
    expect(bytes).toHaveLength(5873)
    expect(identityJpegSize(bytes)).toEqual({ width: 192, height: 192 })
    expect(contains(bytes, [0xff, 0xe1])).toBe(false)
    expect(contains(bytes, [0xff, 0xed])).toBe(false)
    // The body as the client sends it: JSON, its one text base64.
    const body = JSON.stringify(puts(sent)[0]?.body)
    expect(body.length).toBeLessThanOrEqual(EDGE_BODY_MAX_BYTES)
    expect(body.length).toBe(7868)
  })

  it('takes a body of exactly 8,000 bytes, and tries a lower quality, then a smaller side, for one larger', async () => {
    // 5,973 bytes of JPEG are 7,964 of base64, in a body of 8,000; 5,974 bytes make one of 8,004.
    const tried = encodes((side, quality) => side === 224 && quality === 0.75 ? 5973 : 5974)
    const photo = await reencodePhoto(new File([CAMERA_JPEG], 'a.jpg', { type: 'image/jpeg' }))
    expect(tried).toEqual([[256, 0.86], [256, 0.75], [256, 0.62], [256, 0.5], [224, 0.86], [224, 0.75]])
    expect(jsonBodyBytes(photoBody(await base64Of(photo)))).toBe(8000)
    expect(EDGE_BODY_MAX_BYTES).toBe(8000)
    expect(PHOTO_SIDES).toEqual([256, 224, 192, 160, 128])
  })

  it('says a picture that fits at no side can\'t be sent, and sends nothing', async () => {
    const tried = encodes(() => 5974)
    const { sent } = renderPortal(<ProfilePage />, gateway(false), {}, { parityB3: true })
    await choose(new File([CAMERA_JPEG], 'crowd.jpg', { type: 'image/jpeg' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This picture has too much detail to send as a profile photo. Choose another '
      + 'one, such as a photo of your face against a plain background.')
    // Every side, each at every quality.
    expect(tried).toEqual(PHOTO_SIDES.flatMap(side => [0.86, 0.75, 0.62, 0.5].map(quality => [side, quality])))
    expect(screen.queryByRole('button', { name: 'Save photo' })).toBeNull()
    expect(puts(sent)).toEqual([])
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('refuses a browser that answers anything but a JPEG', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback: BlobCallback) => callback(new Blob([PNG], { type: 'image/png' })))
    await expect(reencodePhoto(new File([CAMERA_JPEG], 'a.jpg', { type: 'image/jpeg' }))).rejects.toThrow('can’t prepare the photo')
    // Nor a "JPEG" Identity could not read: bytes after its end, or no frame size before the scan.
    for (const broken of [new Uint8Array([...CANVAS_JPEG, 0x00]), new Uint8Array([0xff, 0xd8, ...JFIF, ...segment(0xda, [0x01]), 0x12, 0xff, 0xd9])]) {
      vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback: BlobCallback) => callback(new Blob([broken], { type: 'image/jpeg' })))
      await expect(reencodePhoto(new File([CAMERA_JPEG], 'a.jpg', { type: 'image/jpeg' }))).rejects.toThrow('can’t prepare the photo')
    }
  })

  it('drops the Exif and Photoshop blocks WebKit writes into every canvas JPEG, so Identity takes the photo from Safari and iOS', async () => {
    expect(identityJpegSize(WEBKIT_JPEG)).toBeUndefined() // as WebKit encodes it, Identity refuses it
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback: BlobCallback) => callback(new Blob([WEBKIT_JPEG], { type: 'image/jpeg' })))
    const { sent } = renderPortal(<ProfilePage />, gateway(false), {}, { parityB3: true })
    await choose(new File([CAMERA_JPEG], 'IMG_0002.jpg', { type: 'image/jpeg' }))
    await press(await screen.findByRole('button', { name: 'Save photo' }))
    await screen.findByText('Your photo was saved.')
    const bytes = uploaded(sent)
    expect(contains(bytes, [0xff, 0xe1])).toBe(false)
    expect(contains(bytes, [0xff, 0xed])).toBe(false)
    expect(contains(bytes, [0x45, 0x78, 0x69, 0x66])).toBe(false) // "Exif"
    expect(contains(bytes, [...new TextEncoder().encode('Photoshop')])).toBe(false)
    // The JFIF, the tables, the frame and the scan are WebKit's own, untouched.
    expect(bytes).toEqual(jpeg(WEBKIT_JFIF))
    expect(identityJpegSize(bytes)).toEqual({ width: 256, height: 256 })
    expect(JSON.stringify(puts(sent)[0]?.body).length).toBeLessThanOrEqual(EDGE_BODY_MAX_BYTES)
  })
})

describe('the metadata dropped from the canvas JPEG', () => {
  const comment = segment(0xfe, [...new TextEncoder().encode('Made with a camera')])
  const icc = segment(0xe2, [...new TextEncoder().encode('ICC_PROFILE'), 0x00, 0x01, 0x01])
  const xmp = segment(0xe1, [...new TextEncoder().encode('http://ns.adobe.com/xap/1.0/'), 0x00, 0x3c, 0x78])
  const iptc = segment(0xed, [...new TextEncoder().encode('Photoshop 3.0'), 0x00])
  const app15 = segment(0xef, [0x01, 0x02])
  const adobe = segment(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x01])
  const other14 = segment(0xee, [0x4e, 0x6f, 0x74, 0x65])

  it('drops every APP1 to APP15 segment and comment before the scan, and keeps JFIF and the Adobe colour transform', () => {
    const cleaned = withoutJpegMetadata(jpeg([...JFIF, ...xmp, ...icc, ...iptc, ...comment, ...adobe, ...other14, ...app15]))
    expect(cleaned).toEqual(jpeg([...JFIF, ...adobe]))
    expect(identityJpegSize(cleaned!)).toEqual({ width: 256, height: 256 })
    // Already clean, it is the same bytes.
    expect(withoutJpegMetadata(CANVAS_JPEG)).toEqual(CANVAS_JPEG)
  })

  it('keeps the scan as encoded, even where its bytes look like a marker', () => {
    const scan = new Uint8Array([0xff, 0x00, 0xff, 0xe1, 0x00, 0x04, 0xff, 0xd0, 0x01])
    expect(withoutJpegMetadata(jpeg([...JFIF, ...comment], scan))).toEqual(jpeg(JFIF, scan))
  })

  it.each<[string, Uint8Array]>([
    ['no EOI', CANVAS_JPEG.slice(0, -2)],
    ['a byte after EOI', new Uint8Array([...CANVAS_JPEG, 0x00])],
    ['no SOI', CANVAS_JPEG.slice(2)],
    ['a segment longer than the file', new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff, 0x00, 0xff, 0xd9])],
    ['no frame size before the scan', new Uint8Array([0xff, 0xd8, ...JFIF, ...segment(0xda, [0x01]), 0x12, 0xff, 0xd9])],
    ['two frame sizes', jpeg(segment(0xc0, [0x08, 0x02, 0x00, 0x02, 0x00, 0x01, 0x01, 0x11, 0x00]))],
    ['a frame larger than 1024 pixels', new Uint8Array([0xff, 0xd8, ...JFIF, ...segment(0xc0, [0x08, 0x08, 0x00, 0x02, 0x00, 0x01, 0x01, 0x11, 0x00]),
      ...segment(0xda, [0x01]), 0x12, 0xff, 0xd9])],
  ])('is refused for %s', (_label, bytes) => {
    expect(withoutJpegMetadata(bytes)).toBeNull()
  })
})

describe('choosing a photo', () => {
  it.each([
    ['a GIF', new File([new Uint8Array([0x47, 0x49, 0x46, 0x38])], 'a.gif', { type: 'image/gif' }), 'Choose a JPEG or PNG picture.'],
    ['a file named .jpg that is not a picture', new File(['<svg onload=alert(1)>'], 'a.jpg', { type: 'image/jpeg' }), 'Choose a JPEG or PNG picture.'],
    ['a file over 10 MB', new File([CAMERA_JPEG, new Uint8Array(10 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' }),
      'This picture is too large to use. Choose one under 10 MB.'],
  ])('refuses %s, decodes nothing and sends nothing', async (_label, file, message) => {
    const { sent } = renderPortal(<ProfilePage />, gateway(false), {}, { parityB3: true })
    await choose(file)
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(createImageBitmap).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Save photo' })).toBeNull()
    expect(puts(sent)).toEqual([])
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Choose a photo')))
  })

  it('moves focus to Save photo once the photo is prepared', async () => {
    renderPortal(<ProfilePage />, gateway(false), {}, { parityB3: true })
    const input = (await photoCard()).getByLabelText('Choose a photo') as HTMLInputElement
    // Chosen from the keyboard: the chooser holds focus, and is disabled and then gone as the photo is prepared.
    input.focus()
    await act(async () => { fireEvent.change(input, { target: { files: [new File([CAMERA_JPEG], 'a.jpg', { type: 'image/jpeg' })] } }) })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save photo' })))
    expect(await screen.findByRole('img', { name: 'Your new photo, cropped to a square' })).toBeTruthy()
  })

  it('says so when the picture cannot be decoded', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new DOMException('bad', 'InvalidStateError') }))
    renderPortal(<ProfilePage />, gateway(false), {}, { parityB3: true })
    await choose(new File([CAMERA_JPEG], 'broken.jpg', { type: 'image/jpeg' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This picture could not be opened. Choose another JPEG or PNG picture.')
  })

  it('says what Identity refused, and keeps the photo to save again', async () => {
    renderPortal(<ProfilePage />, gateway(false, { put: () => problem(400, 'PHOTO_INVALID', 'The photo is not valid.') }), {}, { parityB3: true })
    await choose(new File([CAMERA_JPEG], 'a.jpg', { type: 'image/jpeg' }))
    await press(await screen.findByRole('button', { name: 'Save photo' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This picture can’t be used. Choose a JPEG or PNG photo.')
    expect(screen.getByRole('button', { name: 'Save photo' })).toBeTruthy()
  })

  it('drops the prepared photo on Cancel, and revokes its preview', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(false), {}, { parityB3: true })
    await choose(new File([CAMERA_JPEG], 'a.jpg', { type: 'image/jpeg' }))
    const preview = (await screen.findByRole('img', { name: 'Your new photo, cropped to a square' })).getAttribute('src')!
    await press(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('img', { name: 'Your new photo, cropped to a square' })).toBeNull()
    expect(revoked).toContain(preview)
    expect(puts(sent)).toEqual([])
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Choose a photo')))
  })
})

describe('the photo shown', () => {
  it('is read as bytes and shown from a blob: URL, which goes when the page does; nothing is stored', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { sent, view } = renderPortal(<ProfilePage />, gateway(true), {}, { parityB3: true })
    const shown = await (await photoCard()).findByRole('img', { name: 'Your photo' })
    expect(shown.getAttribute('src')).toMatch(/^blob:/)
    expect(sent.filter(request => request.path === '/identity/me/photo')).toEqual([{ path: '/identity/me/photo', method: 'GET', body: null }])
    const url = shown.getAttribute('src')!
    view.unmount()
    expect(revoked).toContain(url)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('is removed with Remove photo, and the initials show again', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(true), {}, { parityB3: true })
    const url = (await (await photoCard()).findByRole('img', { name: 'Your photo' })).getAttribute('src')!
    await press(screen.getByRole('button', { name: 'Remove photo' }))
    await screen.findByText('Your photo was removed.')
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Your photo' })).toBeNull())
    expect(sent.filter(request => request.method === 'DELETE')).toEqual([{ path: '/identity/me/photo', method: 'DELETE', body: null }])
    expect(revoked).toContain(url)
    expect((await photoCard()).getByText('AE')).toBeTruthy()
  })

  it('is not offered by an Identity that does not say whether there is one', async () => {
    renderPortal(<ProfilePage />, (path, method) => path === '/identity/me' && method === 'GET' ? json(profile) : problem(404, 'NOT_FOUND', path))
    await screen.findByText('Ada Example')
    expect(screen.queryByRole('heading', { name: 'Photo' })).toBeNull()
  })
})

describe('the header', () => {
  const shell = (handler: Handler) => renderPortal(<Routes><Route path="/" element={<PortalShell />}><Route index element={<p>Overview page</p>} />
    </Route></Routes>, handler, {}, { parityB3: true })

  it('shows the patient\'s photo as a link to their profile', async () => {
    shell(gateway(true))
    const link = await screen.findByRole('link', { name: 'Your profile' })
    expect(link.getAttribute('href')).toBe('/profile')
    await waitFor(() => expect(link.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/))
    expect(link.querySelector('img')?.getAttribute('alt')).toBe('')
  })

  it('shows the initials while there is no photo, without asking for one', async () => {
    const { sent } = shell(gateway(false))
    const link = await screen.findByRole('link', { name: 'Your profile' })
    await waitFor(() => expect(link.textContent).toBe('AE'))
    expect(sent.some(request => request.path === '/identity/me/photo')).toBe(false)
  })
})
