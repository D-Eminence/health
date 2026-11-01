import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import qrcode from 'qrcode-generator'
import { OtpauthQr } from './OtpauthQr'

/**
 * The QR code of a new authenticator's setup key (hid-system #71: Identity
 * returns the `otpauthUri` once, at enrolment start). It is drawn in the page
 * from the URI, with no request: a remote QR service would receive the secret.
 */
const URI = 'otpauth://totp/Health%20ID:ada%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
  + '&issuer=Health+ID&algorithm=SHA1&digits=6&period=30'

/** The dark cells the drawn path covers, as "row,column" of the code, the quiet zone taken off. */
function drawnCells(d: string, margin: number) {
  const cells = new Set<string>()
  for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let step = 0; step < Number(run); step += 1) cells.add(`${Number(y) - margin},${Number(x) - margin + step}`)
  }
  return cells
}

afterEach(() => { vi.unstubAllGlobals() })

describe('the setup key as a QR code', () => {
  it('draws every dark module of the URI\'s code, and only those, inside a four-module quiet zone', () => {
    render(<OtpauthQr uri={URI} />)

    const image = screen.getByRole('img', { name: 'Square code to scan with your code app' })
    const reference = qrcode(0, 'M')
    reference.addData(URI)
    reference.make()
    const count = reference.getModuleCount()
    expect(image.getAttribute('viewBox')).toBe(`0 0 ${count + 8} ${count + 8}`)

    const expected = new Set<string>()
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) if (reference.isDark(row, column)) expected.add(`${row},${column}`)
    }
    const path = image.querySelector('path')
    expect(path?.getAttribute('d')).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/)
    expect(drawnCells(path?.getAttribute('d') ?? '', 4)).toEqual(expected)
  })

  it('is dark on light whatever the page\'s colours, so a camera can read it', () => {
    render(<OtpauthQr uri={URI} />)
    const image = screen.getByRole('img')

    const background = image.querySelector('rect')
    expect(background?.getAttribute('fill')).toBe('#fff')
    expect(background?.getAttribute('width')).toBe(image.getAttribute('viewBox')?.split(' ')[2])
    expect(image.querySelector('path')?.getAttribute('fill')).toBe('#000')
  })

  it('asks nothing of the network and carries no style or reference the page\'s policy would refuse', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { container } = render(<OtpauthQr uri={URI} />)

    expect(fetch).not.toHaveBeenCalled()
    expect(container.querySelector('[style], [href], [src], image, use, foreignObject, script')).toBeNull()
    expect(container.innerHTML).not.toContain('http')
  })

  it('draws nothing for a URI too long for any QR code: the setup key and link still serve', () => {
    const { container } = render(<OtpauthQr uri={`${URI}&pad=${'A'.repeat(4000)}`} />)
    expect(container.innerHTML).toBe('')
  })
})
