import { createHash } from 'node:crypto'
import { brotliDecompressSync } from 'node:zlib'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ehrDirectory } from './ehrCss'

/**
 * Both fonts are the unmodified upstream google/fonts variable fonts, converted losslessly to WOFF2 (fonts/README.md):
 * Playfair Display's licence reserves its name for unmodified fonts, and every font must keep its copyright and licence
 * records. This decodes each WOFF2 (Brotli, from Node) and checks every table against the upstream table's sha256.
 * glyf and loca are stored in WOFF2's glyph transform, which fontTools rebuilt byte for byte when the files were made.
 */

const fonts = join(ehrDirectory, 'fonts')
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** The upstream tables' sha256 (head with its checksum adjustment zeroed). */
const UPSTREAM: Record<string, { readonly file: string; readonly served: string; readonly tables: Record<string, string> }> = {
  'Playfair Display': {
    file: 'playfair-display.woff2',
    served: '4297e9ec39f1b8157623d048fb99eab03c90e482669599e8fc662ee178994c49',
    tables: {
      DSIG: 'cbbc48750debb8535093b3deaf88ac7f4cff87425576a58de2bac754acdb4616',
      GDEF: 'ef3483ca6751739ecb029c29d1f3eb0e568f602b359e04fd820a23ef7638d40f',
      GPOS: 'd2c6b59daaf127438cd88179b5103b517d0497d398309bf363666e9c2bfdd9c9',
      GSUB: '4b95f19e2a0f99af9fb7cd8f4e6939f60548c6703b78743f8e6358b9daa9958d',
      HVAR: '56da00dcb63394ee6dbd324229cd6324e3260bbf3f8bd7afd42ded17b6145fb3',
      'OS/2': '08fa29628a722d3d3eff7739650539b5106606553c16a0f12b6fc61ad235e429',
      STAT: '2c90f83b6d64e6a6d04b2739dd954c45fe4a4ad7f501126367081303fce46853',
      cmap: '2c1e94b0b07224b4db03b40a22ea543a9de35ef5c81146813c2078b37adbea54',
      fvar: '5fa01b4eacb5461caa23d6c8c293fb9b614c7964f9cb747e0a6750f4d4e5c96d',
      gasp: '4ca731f86ad506ac0e320283dc9461926346de3c4d91d539ea7f6620d3826940',
      glyf: '7573b3730476d120856f7d7dd3b7a4b32c291d93739e9e221cf95018a1c088d2',
      gvar: '5b9b97ec8f324a1e5ba25d8105cb39e2bfb382ad994a52078f73750015ecf825',
      head: '61975133851fe11cf9949b63bc09501fbb3d8c6282e3c028b098b1c5f57c2038',
      hhea: 'ba9ba880e01f69c34fd98841384c4f2d3f3acf04b836070ea5e5f4c7d5131b7d',
      hmtx: '645df12c7734bdf4c9a02f58c0fa7d409f55c0727050abb5dd438a850f4c6c9b',
      loca: '822d95fcfcf89cca97f95f435a267527c56e9ac0962e7fd5d9cef1f9700903f7',
      maxp: 'e4b70676dfec16b7a3ac3cc4e4fae951f718fd162586360c13d79b381a25e550',
      name: '1c33c05238792eec412ec170fe41cb90a33fb62aae5e291101c2716c4d3b74a3',
      post: '79811d89949ec2f739acaf8cc1d4ad9bf7b3e4d67b9442f26032f93f7137c1c2',
      prep: '907c4106ff9989c1805827d5581bdf107a253b098cb71eb374f5e47c35604452',
    },
  },
  Geist: {
    file: 'geist.woff2',
    served: '2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1',
    tables: {
      GDEF: 'e62fdfa3316502d0476ae353a2924ce9f929dfa8afefb193a3e8eb74d72e42ea',
      GPOS: 'efac249ca0dcf58c951fd68e8a8a3a0c24b94928926c6107efd7edf59162d809',
      GSUB: 'fc4285ef8c81824adbd1bb9a51577df1d2d19eb4dc5ddaa6c7a68601e443414a',
      HVAR: '79a88f83150f31c58fc1a97f8b2e771c8984c94cba13476bcafca2333af6a0ae',
      MVAR: 'ce914d5f9abcf0a92592b0565f109533ef5da5cbda71c083b1b7d3d42fe2e9a3',
      'OS/2': '9616adb263a712d15fde3b1c91b82b0f396e229c8192ce013078280c739ecff5',
      STAT: '7b7efa6f377af61ff7ec77c12a5bbca4b566c4a5290fa3b5189d380729d0b049',
      cmap: 'c9bf6d466d4efd80602f8cda55cab2a35b65234ec0cd52fc4636e9300489369d',
      fvar: 'ee2e774e0efee2b3166990918566a90b1745d073563b6e6be6eca885fd17e6ff',
      gasp: '4ca731f86ad506ac0e320283dc9461926346de3c4d91d539ea7f6620d3826940',
      glyf: '87453980c40102d16fc81b491087f121d12da70105ecf896a368e21f8db51974',
      gvar: '4ca5bf95196d34afaae1207b5515ccb85d38bea6677b83029d2f180b1d1f4991',
      head: '52071629537a6157de20523528770625538aa28d2e4a10a358fa5454aa3a0690',
      hhea: 'bf4ce36350d190349a8c4178fb674e4e771a59186bc9462fbf5023bed08cebcc',
      hmtx: '62be0edd44938f7cd3bb21d7208dade9e26644ec6c61a7ca5f37f06ad295098f',
      loca: 'c3d474e051a491a7e844a290411547499b1fa12d3f272faf16c8da8e44911f96',
      maxp: '5f007f7357fb52a0969391a2d76fda9032e7778e45ff077c78a0558ca22b2e1a',
      meta: '4315f4f9e3356076bf05edef6c7b6c53c3810af6738cc2190691ffcea5b60e87',
      name: '751186988d0c8180d5861ee0db197a3afe26e55a0fdafe2a4f5acf5cc4bd97eb',
      post: '1c8404c5104b541f6918b2f9a0ae5458f388df64bdd1b5548a5845a1c23bb26c',
      prep: '907c4106ff9989c1805827d5581bdf107a253b098cb71eb374f5e47c35604452',
    },
  },
}

/** The WOFF2 known-table list: a directory entry names its table by index into it, or 63 and the tag itself. */
const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat',
  'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat',
  'Sill']

interface Woff2Table {
  readonly data: Buffer
  readonly transformed: boolean
}

function base128(font: Buffer, at: number): [number, number] {
  let value = 0
  for (let index = 0; index < 5; index += 1) {
    const byte = font[at + index]!
    value = value * 128 + (byte & 0x7f)
    if ((byte & 0x80) === 0) return [value, at + index + 1]
  }
  throw new Error('UIntBase128 longer than 5 bytes')
}

/** The tables of a single-font WOFF2, as stored (glyf and loca still transformed). */
function woff2Tables(font: Buffer): Map<string, Woff2Table> {
  const count = font.readUInt16BE(12)
  let at = 48
  const entries: { tag: string; length: number; transformed: boolean }[] = []
  for (let index = 0; index < count; index += 1) {
    const flags = font[at]!
    at += 1
    const known = flags & 0x3f
    const tag = known === 63 ? font.toString('latin1', at, at + 4) : KNOWN_TAGS[known]!
    if (known === 63) at += 4
    const version = flags >> 6
    const [original, next] = base128(font, at)
    at = next
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0
    let length = original
    if (transformed) [length, at] = base128(font, at)
    entries.push({ tag, length, transformed })
  }
  const stream = brotliDecompressSync(font.subarray(at, at + font.readUInt32BE(20)))
  expect(stream.length).toBe(entries.reduce((sum, entry) => sum + entry.length, 0))
  let offset = 0
  return new Map(entries.map(entry => {
    const data = stream.subarray(offset, offset + entry.length)
    offset += entry.length
    return [entry.tag, { data, transformed: entry.transformed }]
  }))
}

/** The name table's Windows (platform 3) records, by name ID. */
function names(table: Buffer): Map<number, string> {
  const count = table.readUInt16BE(2)
  const storage = table.readUInt16BE(4)
  const found = new Map<number, string>()
  for (let index = 0; index < count; index += 1) {
    const record = 6 + index * 12
    const nameId = table.readUInt16BE(record + 6)
    if (table.readUInt16BE(record) !== 3 || found.has(nameId)) continue
    const start = storage + table.readUInt16BE(record + 10)
    found.set(nameId, Buffer.from(table.subarray(start, start + table.readUInt16BE(record + 8))).swap16().toString('utf16le'))
  }
  return found
}

function weightAxis(fvar: Buffer): [number, number] {
  const axes = fvar.readUInt16BE(4)
  const size = fvar.readUInt16BE(10)
  for (let index = 0; index < fvar.readUInt16BE(8); index += 1) {
    const axis = axes + index * size
    if (fvar.toString('latin1', axis, axis + 4) === 'wght') return [fvar.readInt32BE(axis + 4) / 65536, fvar.readInt32BE(axis + 12) / 65536]
  }
  throw new Error('no wght axis')
}

const css = readFileSync(join(ehrDirectory, 'ehr.css'), 'utf8')

function fontFace(family: string): string {
  const block = css.split('@font-face').slice(1).map(rule => rule.slice(0, rule.indexOf('}')))
    .find(rule => rule.includes(`font-family: ${family.includes(' ') ? `'${family}'` : family};`))
  if (!block) throw new Error(`no @font-face for ${family}`)
  return block
}

describe.each(Object.entries(UPSTREAM))('%s', (family, { file, served, tables: upstream }) => {
  const font = readFileSync(join(fonts, file))
  const tables = woff2Tables(font)

  it('is the file recorded in fonts/README.md, a single TrueType WOFF2 with no metadata or private data', () => {
    expect(sha256(font)).toBe(served)
    expect(readFileSync(join(fonts, 'README.md'), 'utf8')).toContain(served)
    expect(font.toString('latin1', 0, 4)).toBe('wOF2')
    expect(font.readUInt32BE(4)).toBe(0x00010000)
    expect(font.readUInt32BE(8)).toBe(font.length)
    // metaOffset, metaLength, metaOrigLength, privOffset, privLength
    expect([28, 32, 36, 40, 44].map(offset => font.readUInt32BE(offset))).toEqual([0, 0, 0, 0, 0])
  })

  it('holds every upstream table unchanged, but for what WOFF2 itself requires', () => {
    // WOFF2 drops a DSIG (the conversion invalidates any signature); Playfair's is an empty 8-byte stub.
    expect([...tables.keys()].sort()).toEqual(Object.keys(upstream).filter(tag => tag !== 'DSIG').sort())
    for (const [tag, { data, transformed }] of tables) {
      if (tag === 'glyf' || tag === 'loca') {
        expect(transformed, tag).toBe(true)
        continue
      }
      expect(transformed, tag).toBe(false)
      if (tag === 'head') {
        // head: flag bit 11 says "converted losslessly", and its checksum adjustment changes with the file.
        expect(data.readUInt16BE(16) & 0x0800).toBe(0x0800)
        const original = Buffer.from(data)
        original.writeUInt32BE(0, 8)
        original.writeUInt16BE(data.readUInt16BE(16) & ~0x0800, 16)
        expect(sha256(original), tag).toBe(upstream.head)
      } else {
        expect(sha256(data), tag).toBe(upstream[tag])
      }
    }
  })

  it('keeps its name, copyright and licence records', () => {
    const records = names(tables.get('name')!.data)
    expect(records.get(1)).toBe(family)
    expect(records.get(0)).toMatch(/^Copyright 20\d\d The .+ Project Authors/)
    expect(records.get(13)).toMatch(/^This Font Software is licensed under the SIL Open Font License, Version 1\.1/)
    expect(records.get(14)).toMatch(/^https?:\/\/(scripts\.sil\.org\/OFL|openfontlicense\.org)/)
  })

  it('is served from ehr.css as WOFF2 over its whole weight axis', () => {
    const [min, max] = weightAxis(tables.get('fvar')!.data)
    const rule = fontFace(family)
    expect(rule).toContain(`src: url('./fonts/${file}') format('woff2');`)
    expect(rule).toContain(`font-weight: ${min} ${max};`)
    expect([min, max]).toEqual(family === 'Geist' ? [100, 900] : [400, 900])
  })
})

describe('the fonts folder', () => {
  it('ships only the two WOFF2 files, their licences and their provenance', () => {
    expect(KNOWN_TAGS).toHaveLength(63)
    expect(readdirSync(fonts).sort()).toEqual(['OFL-Geist.txt', 'OFL-PlayfairDisplay.txt', 'README.md', 'geist.woff2', 'playfair-display.woff2'])
    const readme = readFileSync(join(fonts, 'README.md'), 'utf8')
    for (const upstream of ['c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6', '73894e0448cae90a92b6c2f8732b7bb9acb7b94c418bff559dad4a18e1de9659']) {
      expect(readme).toContain(upstream)
    }
    expect(readme).toMatch(/google\/fonts\s+at `[0-9a-f]{40}`/)
  })
})
