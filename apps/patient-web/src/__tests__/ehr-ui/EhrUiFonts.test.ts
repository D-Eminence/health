import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ehrDirectory } from './ehrCss'

/**
 * Playfair Display's licence reserves its name for unmodified fonts. ehr.css serves fonts/playfair-display.woff, a WOFF
 * 1.0 wrapper of the upstream variable font kept beside it (fonts/PlayfairDisplay[wght].ttf, from google/fonts
 * ofl/playfairdisplay): this checks every table inflates to exactly the upstream bytes, and that the wrapper adds no
 * metadata or private data (OFL FAQ 2.2). The launch build check accepts .woff and .woff2 assets, not .ttf.
 */

const fonts = join(ehrDirectory, 'fonts')
const upstream = readFileSync(join(fonts, 'PlayfairDisplay[wght].ttf'))
const woff = readFileSync(join(fonts, 'playfair-display.woff'))

function sfntTables(font: Buffer): Map<string, Buffer> {
  const count = font.readUInt16BE(4)
  return new Map(Array.from({ length: count }, (_, index) => {
    const record = 12 + index * 16
    const offset = font.readUInt32BE(record + 8)
    return [font.toString('latin1', record, record + 4), font.subarray(offset, offset + font.readUInt32BE(record + 12))]
  }))
}

function woffTables(font: Buffer): Map<string, Buffer> {
  const count = font.readUInt16BE(12)
  return new Map(Array.from({ length: count }, (_, index) => {
    const record = 44 + index * 20
    const offset = font.readUInt32BE(record + 4)
    const stored = font.subarray(offset, offset + font.readUInt32BE(record + 8))
    const length = font.readUInt32BE(record + 12)
    return [font.toString('latin1', record, record + 4), stored.length < length ? inflateSync(stored) : stored]
  }))
}

describe('Playfair Display', () => {
  it('is the upstream variable font, unmodified', () => {
    expect(createHash('sha256').update(upstream).digest('hex')).toBe('c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6')
    expect(upstream.readUInt32BE(0)).toBe(0x00010000)
  })

  it('is served as a WOFF holding exactly the upstream tables, with no metadata or private data', () => {
    expect(woff.toString('latin1', 0, 4)).toBe('wOFF')
    expect(woff.readUInt32BE(4)).toBe(upstream.readUInt32BE(0))
    expect(woff.readUInt32BE(8)).toBe(woff.length)
    // metaOffset, metaLength, metaOrigLength, privOffset, privLength
    expect([24, 28, 32, 36, 40].map(offset => woff.readUInt32BE(offset))).toEqual([0, 0, 0, 0, 0])
    const original = sfntTables(upstream)
    const wrapped = woffTables(woff)
    expect([...wrapped.keys()].sort()).toEqual([...original.keys()].sort())
    for (const [tag, bytes] of original) expect(wrapped.get(tag)!.equals(bytes), tag).toBe(true)
  })
})
