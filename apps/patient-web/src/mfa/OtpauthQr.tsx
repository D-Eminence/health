import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/** The light border a reader needs around a QR code, in modules (ISO/IEC 18004). */
const QUIET_ZONE = 4

/**
 * The dark modules of `text`'s QR code as one SVG path, a run of each row per
 * rectangle, in module units inside the quiet zone; null when the text fits no
 * QR code. Medium error correction, the version the text needs.
 */
function qrPath(text: string): { size: number; d: string } | null {
  const qr = qrcode(0, 'M')
  try {
    qr.addData(text)
    qr.make()
  } catch { return null }
  const count = qr.getModuleCount()
  let d = ''
  for (let row = 0; row < count; row += 1) {
    let column = 0
    while (column < count) {
      if (!qr.isDark(row, column)) { column += 1; continue }
      let run = 1
      while (column + run < count && qr.isDark(row, column + run)) run += 1
      d += `M${column + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`
      column += run
    }
  }
  return { size: count + 2 * QUIET_ZONE, d }
}

/**
 * `text` as a QR code, drawn here with no request (no QR service sees what it holds). Inline SVG with presentation
 * attributes only, as the portal's Content Security Policy allows (style-src 'self'); dark on light whatever the page's
 * colours. `label` is its text alternative. Nothing is drawn for a text too long for a QR code: the page's own words
 * and links must still serve.
 */
export function QrCode({ text, label, className, size = 200 }: { text: string; label: string; className?: string; size?: number }) {
  const drawn = useMemo(() => qrPath(text), [text])
  if (!drawn) return null
  return <svg className={className} role="img" aria-label={label}
    viewBox={`0 0 ${drawn.size} ${drawn.size}`} width={size} height={size} shapeRendering="crispEdges">
    <rect width={drawn.size} height={drawn.size} fill="#fff" />
    <path d={drawn.d} fill="#000" />
  </svg>
}

/**
 * A new authenticator's setup key as a QR code, for the authenticator app's
 * camera. It is drawn here from the `otpauth://` URI Identity returned, with
 * no request: the URI holds the secret, which no QR service may see. Nothing
 * is drawn for a URI too long for a QR code: the setup key and the link to the
 * app still serve.
 */
export function OtpauthQr({ uri, className }: { uri: string; className?: string }) {
  return <QrCode text={uri} label="QR code of the setup key, for your authenticator app" className={className} />
}
