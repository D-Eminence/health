import type { jsPDF } from 'jspdf'
import { LEAST_MARGIN_MM, PT_PER_PX, PX_PER_MM, pageOf, pageSizePx, pageStarts, yOnPage, type PaperSize, type Span } from './paperPages'
import { printCssText } from './printCss'
import { pdfText } from '../ehr-blue/departments/outreach/outreachExportFiles'

/*
 * A paper as a PDF, made on this device, for a browser that prints its own web address round a page whatever the page
 * asks (printEngine.ts: Safari, and every browser on an iPhone or iPad). A PDF has no web address, and a browser prints
 * a PDF's own pages with nothing of its own added.
 *
 * The paper is laid out as the browser would print it, from the page's own stylesheets with their print rules applied
 * (printCss.ts), in a frame of its own off the screen, a page wide. Then each line of text is written into the PDF as
 * text (it can be selected and searched, and prints sharp at any size), each rule and border drawn as a line, and each
 * picture (the Health ID logo) placed from its own pixels: the page is never photographed. The frame's text is set in
 * the font the PDF carries (Noto Sans, as the Outreach export uses), so every line is as long on paper as it was laid
 * out. The pages are cut between lines (paperPages.ts), with the same margin at the top and foot of every page.
 *
 * Nothing leaves the device: the PDF is made here and handed back as a Blob. Only this file's chunk loads jsPDF and the
 * font, when someone prints.
 */

export interface PaperPdfOptions {
  readonly size: PaperSize
  /** The PDF's title: the facility and what the paper is (paperTitle), never a patient's name or Health ID. */
  readonly title: string
}

const FONT = 'NotoSans'
/** The family the frame sets every line in: the PDF's own font, so text measures the same in both. */
const FRAME_FONT = 'HID Paper PDF'
/** Heavier than this is set in the bold face. */
const BOLD_FROM = 550
/** A painted part (a ruled line to sign on, a boxed note) no taller than this is kept whole on one page. */
const SMALL_PART_MM = 20
/** The longest wait for the paper's pictures to load in the frame. */
const IMAGE_WAIT_MS = 4000

type Colour = readonly [number, number, number]

interface TextRun {
  readonly kind: 'text'
  readonly text: string
  readonly left: number
  readonly width: number
  readonly top: number
  readonly bottom: number
  readonly baseline: number
  readonly size: number
  readonly bold: boolean
  readonly colour: Colour
  readonly letterSpacing: number
  readonly underline: boolean
}

interface Picture {
  readonly kind: 'picture'
  readonly data: string
  readonly left: number
  readonly top: number
  readonly bottom: number
  readonly width: number
}

interface Edge {
  readonly width: number
  readonly colour: Colour
  readonly style: string
}

interface Box {
  readonly kind: 'box'
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly fill: Colour | null
  readonly radius: number
  readonly edges: { readonly top: Edge | null; readonly right: Edge | null; readonly bottom: Edge | null; readonly left: Edge | null }
}

type Mark = TextRun | Picture | Box

/** What the paper holds, read from its layout: the marks to draw, and what must not be cut between pages. */
interface Reading {
  readonly marks: Mark[]
  readonly whole: Span[]
  readonly marginTop: number
  readonly marginBottom: number
  readonly width: number
  readonly height: number
}

/** The font's file, from the build's own lazy chunk (a data: URL), as bytes. */
function bytesOf(dataUrl: string): Uint8Array<ArrayBuffer> {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)

const SUPERSCRIPTS: Readonly<Record<string, string>> = { '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' }

/**
 * Words as the PDF's font can draw them (pdfText: every Yoruba, Igbo and Hausa letter, ₦; anything else as "?"). A
 * power the font has no raised figure for is written plainly: "×10⁹/L" as "×10^9/L".
 */
export function paperText(value: string): string {
  return pdfText(value.replace(/[⁰⁴-⁹⁺⁻]+/g, power => `^${[...power].map(character => SUPERSCRIPTS[character] ?? character).join('')}`))
}

/** CSS colours as the PDF takes them, read back from a canvas so any colour the browser knows (oklch too) works. */
function colourReader(doc: Document) {
  const canvas = doc.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const known = new Map<string, Colour | null>()
  return (value: string): Colour | null => {
    if (known.has(value)) return known.get(value)!
    let colour: Colour | null = null
    if (context && value && value !== 'transparent') {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = '#000'
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
      // Mostly see-through counts as not there; anything else is drawn solid (paper is black on white).
      colour = (alpha ?? 0) < 26 ? null : [red ?? 0, green ?? 0, blue ?? 0]
    }
    known.set(value, colour)
    return colour
  }
}

function px(value: string): number {
  const number = parseFloat(value)
  return Number.isFinite(number) ? number : 0
}

/** Waits for a picture in the frame, a little while at most. */
function loaded(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve()
  return new Promise(resolve => {
    const finish = () => resolve()
    image.addEventListener('load', finish, { once: true })
    image.addEventListener('error', finish, { once: true })
    setTimeout(finish, IMAGE_WAIT_MS)
  })
}

/** A picture's own pixels as a PNG, at its natural size (up to 2000 pixels across). */
function pngOf(doc: Document, image: CanvasImageSource, width: number, height: number): string | null {
  if (!(width > 0 && height > 0)) return null
  const scale = Math.min(1, 2000 / Math.max(width, height))
  const canvas = doc.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/** An inline SVG (an icon) as a PNG four times its size, its currentColor kept. */
async function svgPng(doc: Document, svg: SVGSVGElement, colour: string, width: number, height: number): Promise<string | null> {
  if (!(width > 0 && height > 0)) return null
  const copy = svg.cloneNode(true) as SVGSVGElement
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  copy.setAttribute('width', String(width * 4))
  copy.setAttribute('height', String(height * 4))
  copy.style.color = colour
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`
  const image = new Image()
  image.src = source
  await loaded(image)
  return image.naturalWidth > 0 ? pngOf(doc, image, width * 4, height * 4) : null
}

/** The marker an outside list item shows ("3.", "•"), or null for none. */
function markerOf(item: Element, style: CSSStyleDeclaration): string | null {
  const type = style.listStyleType
  if (!type || type === 'none') return null
  if (type === 'decimal' || type === 'decimal-leading-zero') {
    const list = item.parentElement
    const start = list?.tagName === 'OL' ? Number(list.getAttribute('start') ?? '1') || 1 : 1
    let index = 0
    for (let sibling = item.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.tagName === 'LI') index += 1
    const number = start + index
    return `${type === 'decimal-leading-zero' && number < 10 ? '0' : ''}${number}.`
  }
  return '•'
}

/** The frame's font: where a line's baseline sits in its box, from the face itself, as a share of the font size. */
function baselineOf(doc: Document) {
  const probe = doc.createElement('div')
  probe.setAttribute('style', `position:absolute;left:0;top:0;font:400 100px/normal '${FRAME_FONT}';white-space:nowrap`)
  const word = doc.createTextNode('Hx')
  const mark = doc.createElement('span')
  mark.setAttribute('style', 'display:inline-block;width:0;height:0;vertical-align:baseline')
  probe.append(word, mark)
  doc.body.appendChild(probe)
  const range = doc.createRange()
  range.selectNodeContents(word)
  const box = range.getBoundingClientRect()
  const baseline = mark.getBoundingClientRect().top
  probe.remove()
  const ascent = box.height > 0 ? (baseline - box.top) / 100 : 1.069
  const content = box.height > 0 ? box.height / 100 : 1.362
  // A text box is the face's ascent and descent tall; where a browser makes it the line's height instead, the face sits
  // in its middle.
  return (top: number, height: number, size: number) => top + (height - content * size) / 2 + ascent * size
}

/** Reads every line of text, picture, rule and border of the paper from its layout in the frame. */
async function readPaper(doc: Document, root: HTMLElement, size: PaperSize, pageHeight: number): Promise<Reading> {
  const view = doc.defaultView!
  const colour = colourReader(doc)
  const baseline = baselineOf(doc)
  const marks: Mark[] = []
  const whole: Span[] = []
  const rootBox = root.getBoundingClientRect()
  const rootStyle = view.getComputedStyle(root)
  const least = LEAST_MARGIN_MM * PX_PER_MM
  const marginTop = Math.max(least, rootBox.top + px(rootStyle.paddingTop))
  const marginBottom = Math.max(least, px(rootStyle.paddingBottom))
  const room = pageHeight - marginTop - marginBottom
  const pictures: Array<Promise<void>> = []
  const range = doc.createRange()

  const keepWhole = (span: Span) => { if (span.bottom - span.top > 0 && span.bottom - span.top <= room) whole.push(span) }

  const readText = (node: Text, style: CSSStyleDeclaration) => {
    const data = node.data
    if (!data.trim() && !/pre/.test(style.whiteSpace)) return
    const size = px(style.fontSize)
    const bold = (Number(style.fontWeight) || 400) >= BOLD_FROM
    const ink = colour(style.color) ?? [0, 0, 0]
    const letterSpacing = style.letterSpacing === 'normal' ? 0 : px(style.letterSpacing)
    const underline = /underline/.test(style.textDecorationLine || style.textDecoration)
    const upper = style.textTransform === 'uppercase'
    const lower = style.textTransform === 'lowercase'
    const collapse = !/^(pre|pre-wrap|break-spaces)$/.test(style.whiteSpace)
    let run: { text: string; left: number; right: number; top: number; height: number; end: number } | null = null
    const flush = () => {
      if (!run) return
      const text = run.text.replace(/\s+$/, '')
      const shown = paperText(upper ? text.toUpperCase() : lower ? text.toLowerCase() : text)
      if (shown.trim()) {
        marks.push({ kind: 'text', text: shown, left: run.left, width: run.right - run.left, top: run.top, bottom: run.top + run.height,
          baseline: baseline(run.top, run.height, size), size, bold, colour: ink, letterSpacing, underline })
        keepWhole({ top: run.top, bottom: run.top + run.height })
      }
      run = null
    }
    for (let index = 0; index < data.length;) {
      const code = data.codePointAt(index)!
      const length = code > 0xffff ? 2 : 1
      let character = data.slice(index, index + length)
      // A tone mark (ẹ̀, ọ́) sits on the letter before it: it joins that letter's run wherever the layout puts its box.
      if (/\p{M}/u.test(character)) {
        index += length
        if (run) run.text += character
        continue
      }
      range.setStart(node, index)
      range.setEnd(node, index + length)
      index += length
      const boxes = range.getClientRects()
      const box = boxes[boxes.length - 1]
      const blank = /\s/.test(character)
      if (!box || box.width <= 0) {
        // A space the layout folded away, or the end of a line in pre-wrap text.
        if (!blank) continue
        if (character === '\n' || character === '\r') flush()
        continue
      }
      if (blank && collapse) character = ' '
      const sameLine: boolean = run !== null && Math.abs(box.top - run.top) < box.height / 2 && box.left >= run.end - 1
      if (!sameLine) {
        flush()
        if (blank) continue
        run = { text: character, left: box.left, right: box.right, top: box.top, height: box.height, end: box.right }
      } else if (run) {
        run.text += character
        run.end = box.right
        if (!blank) run.right = box.right
      }
    }
    flush()
  }

  const readElement = async (element: Element): Promise<void> => {
    const style = view.getComputedStyle(element)
    if (style.display === 'none') return
    const shown = style.visibility === 'visible'
    const box = element.getBoundingClientRect()
    if (shown && (element.tagName === 'IMG' || element.tagName === 'CANVAS')) {
      const left = box.left + px(style.borderLeftWidth) + px(style.paddingLeft)
      const top = box.top + px(style.borderTopWidth) + px(style.paddingTop)
      const width = box.width - px(style.borderLeftWidth) - px(style.paddingLeft) - px(style.paddingRight) - px(style.borderRightWidth)
      const height = box.height - px(style.borderTopWidth) - px(style.paddingTop) - px(style.paddingBottom) - px(style.borderBottomWidth)
      if (width > 0 && height > 0) {
        const index = marks.length
        marks.push({ kind: 'picture', data: '', left, top, bottom: top + height, width })
        keepWhole({ top, bottom: top + height })
        pictures.push((async () => {
          let data: string | null = null
          if (element instanceof view.HTMLImageElement) {
            await loaded(element)
            data = pngOf(doc, element, element.naturalWidth, element.naturalHeight)
          } else if (element instanceof view.HTMLCanvasElement) {
            data = pngOf(doc, element, element.width, element.height)
          }
          marks[index] = { kind: 'picture', data: data ?? '', left, top, bottom: top + height, width }
        })())
      }
      return
    }
    if (element instanceof view.SVGSVGElement) {
      if (shown && box.width > 0 && box.height > 0) {
        const index = marks.length
        marks.push({ kind: 'picture', data: '', left: box.left, top: box.top, bottom: box.bottom, width: box.width })
        keepWhole({ top: box.top, bottom: box.bottom })
        pictures.push(svgPng(doc, element, style.color, box.width, box.height).then(data => {
          marks[index] = { kind: 'picture', data: data ?? '', left: box.left, top: box.top, bottom: box.bottom, width: box.width }
        }))
      }
      return
    }
    if (box.height > 0 && box.width > 0) {
      const edge = (side: 'Top' | 'Right' | 'Bottom' | 'Left'): Edge | null => {
        const width = px(style.getPropertyValue(`border-${side.toLowerCase()}-width`))
        const lineStyle = style.getPropertyValue(`border-${side.toLowerCase()}-style`)
        const ink = colour(style.getPropertyValue(`border-${side.toLowerCase()}-color`))
        return width > 0 && ink && lineStyle !== 'none' && lineStyle !== 'hidden' ? { width, colour: ink, style: lineStyle } : null
      }
      const edges = shown ? { top: edge('Top'), right: edge('Right'), bottom: edge('Bottom'), left: edge('Left') } : { top: null, right: null, bottom: null, left: null }
      // A background prints only where the paper asks for it (print-color-adjust: exact), as browsers print by default.
      const exact = style.getPropertyValue('print-color-adjust') === 'exact' || style.getPropertyValue('-webkit-print-color-adjust') === 'exact'
      const fill = shown && exact ? colour(style.backgroundColor) : null
      const painted = Boolean(fill || edges.top || edges.right || edges.bottom || edges.left)
      if (painted) {
        const rects = style.display === 'inline' ? Array.from(element.getClientRects()) : [box]
        for (const rect of rects) {
          marks.push({ kind: 'box', left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, fill, radius: px(style.borderTopLeftRadius), edges })
        }
      }
      const avoid = /avoid/.test(style.breakInside) || /avoid/.test(style.getPropertyValue('page-break-inside'))
      if (avoid || element.tagName === 'TR' || (painted && box.height <= SMALL_PART_MM * PX_PER_MM)) keepWhole({ top: box.top, bottom: box.bottom })
      if (shown && style.display === 'list-item' && style.listStylePosition !== 'inside') {
        const marker = markerOf(element, style)
        if (marker) {
          const at = marks.length
          await readChildren(element, style)
          const first = marks.slice(at).find((mark): mark is TextRun => mark.kind === 'text')
          if (first) {
            marks.push({ ...first, text: marker, left: box.left - first.size * 0.3, width: 0, letterSpacing: 0, underline: false, bold: false,
              colour: colour(style.color) ?? [0, 0, 0] })
          }
          return
        }
      }
    }
    await readChildren(element, style)
  }

  const readChildren = async (element: Element, style: CSSStyleDeclaration) => {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 3) { if (style.visibility === 'visible') readText(child as Text, style) } else if (child.nodeType === 1) await readElement(child as Element)
    }
  }

  await readElement(root)
  await Promise.all(pictures)
  const width = size === 'slip' ? Math.max(rootBox.right, 1) : pageSizePx(size).width
  const height = size === 'slip' ? Math.max(rootBox.bottom, 1) : pageHeight
  return { marks, whole, marginTop, marginBottom, width, height }
}

/** jsPDF draws a marker right-aligned to its left edge; everything else from its own left. */
function drawText(pdf: jsPDF, run: TextRun, y: number) {
  pdf.setFont(FONT, run.bold ? 'bold' : 'normal')
  pdf.setFontSize(run.size * PT_PER_PX)
  pdf.setTextColor(run.colour[0], run.colour[1], run.colour[2])
  const characterSpace = run.letterSpacing * PT_PER_PX
  const characters = [...run.text].length
  if (run.width === 0) {
    pdf.text(run.text, run.left * PT_PER_PX, y * PT_PER_PX, { baseline: 'alphabetic', align: 'right' })
    return
  }
  const natural = pdf.getTextWidth(run.text) + characterSpace * characters
  const wanted = run.width * PT_PER_PX
  // As long as the line was laid out: the same font measures the same, so this only evens out rounding.
  const scale = natural > 0 ? Math.min(1.25, Math.max(0.8, wanted / natural)) : 1
  pdf.text(run.text, run.left * PT_PER_PX, y * PT_PER_PX, {
    baseline: 'alphabetic',
    ...(characterSpace ? { charSpace: characterSpace } : {}),
    ...(Math.abs(scale - 1) > 0.002 ? { horizontalScale: scale } : {}),
  })
  if (run.underline) {
    pdf.setDrawColor(run.colour[0], run.colour[1], run.colour[2])
    pdf.setLineWidth(Math.max(0.5, run.size * 0.06) * PT_PER_PX)
    const under = (y + run.size * 0.12) * PT_PER_PX
    pdf.line(run.left * PT_PER_PX, under, (run.left + run.width) * PT_PER_PX, under)
  }
}

function setEdge(pdf: jsPDF, edge: Edge) {
  pdf.setDrawColor(edge.colour[0], edge.colour[1], edge.colour[2])
  pdf.setLineWidth(edge.width * PT_PER_PX)
  const width = edge.width * PT_PER_PX
  pdf.setLineDashPattern(edge.style === 'dashed' ? [3 * width, 2 * width] : edge.style === 'dotted' ? [width, width] : [], 0)
}

/** A box's part on one page: from `from` to `to` on the long column, drawn at `shift`. */
function drawBox(pdf: jsPDF, box: Box, from: number, to: number, place: (y: number) => number) {
  const top = Math.max(box.top, from)
  const bottom = Math.min(box.bottom, to)
  if (bottom <= top) return
  const x = box.left * PT_PER_PX
  const width = (box.right - box.left) * PT_PER_PX
  const y0 = place(top) * PT_PER_PX
  const y1 = place(bottom) * PT_PER_PX
  const { edges } = box
  const whole = box.top >= from && box.bottom <= to
  const same = edges.top && [edges.right, edges.bottom, edges.left].every(edge => edge && edge.width === edges.top!.width && edge.style === edges.top!.style
    && edge.colour.join() === edges.top!.colour.join())
  if (box.fill) {
    pdf.setFillColor(box.fill[0], box.fill[1], box.fill[2])
    if (box.radius > 0 && whole) pdf.roundedRect(x, y0, width, y1 - y0, box.radius * PT_PER_PX, box.radius * PT_PER_PX, 'F')
    else pdf.rect(x, y0, width, y1 - y0, 'F')
  }
  if (same && whole && edges.top) {
    setEdge(pdf, edges.top)
    const inset = edges.top.width * PT_PER_PX / 2
    if (box.radius > 0) {
      const radius = Math.max(0, box.radius * PT_PER_PX - inset)
      pdf.roundedRect(x + inset, y0 + inset, width - 2 * inset, y1 - y0 - 2 * inset, radius, radius, 'S')
    } else {
      pdf.rect(x + inset, y0 + inset, width - 2 * inset, y1 - y0 - 2 * inset, 'S')
    }
    return
  }
  if (edges.top && box.top >= from) {
    setEdge(pdf, edges.top)
    const y = y0 + edges.top.width * PT_PER_PX / 2
    pdf.line(x, y, x + width, y)
  }
  if (edges.bottom && box.bottom <= to) {
    setEdge(pdf, edges.bottom)
    const y = y1 - edges.bottom.width * PT_PER_PX / 2
    pdf.line(x, y, x + width, y)
  }
  if (edges.left) {
    setEdge(pdf, edges.left)
    const at = x + edges.left.width * PT_PER_PX / 2
    pdf.line(at, y0, at, y1)
  }
  if (edges.right) {
    setEdge(pdf, edges.right)
    const at = x + width - edges.right.width * PT_PER_PX / 2
    pdf.line(at, y0, at, y1)
  }
}

/** Writes what was read into a PDF, page by page. */
function writePdf(JsPdf: typeof jsPDF, fonts: readonly [string, string], reading: Reading, title: string, slip: boolean): jsPDF {
  const { marks, whole, marginTop, marginBottom, width, height } = reading
  const starts = slip ? [0] : pageStarts(whole, height, marginTop, marginBottom)
  const pageWidth = width * PT_PER_PX
  const pageHeight = height * PT_PER_PX
  const pdf = new JsPdf({ unit: 'pt', format: [pageWidth, pageHeight], orientation: pageWidth > pageHeight ? 'landscape' : 'portrait', compress: true })
  pdf.addFileToVFS('NotoSans-Regular.ttf', fonts[0])
  pdf.addFont('NotoSans-Regular.ttf', FONT, 'normal')
  pdf.addFileToVFS('NotoSans-Bold.ttf', fonts[1])
  pdf.addFont('NotoSans-Bold.ttf', FONT, 'bold')
  pdf.setProperties({ title, creator: 'Health ID' })
  pdf.setDisplayMode('fullpage', 'continuous')
  for (let page = 1; page < starts.length; page += 1) pdf.addPage([pageWidth, pageHeight], pageWidth > pageHeight ? 'landscape' : 'portrait')
  const place = (page: number) => (y: number) => yOnPage(starts, page, y, marginTop)
  // What each page shows of the long column: up to where the next page starts, and no further than its foot margin.
  const ends = starts.map((start, page) => slip ? Infinity
    : Math.min(starts[page + 1] ?? Infinity, start + height - marginBottom - (page === 0 ? 0 : marginTop)))
  for (const mark of marks) {
    if (mark.kind === 'box') {
      for (let page = 0; page < starts.length; page += 1) {
        if (mark.bottom <= starts[page]! || mark.top >= ends[page]!) continue
        pdf.setPage(page + 1)
        drawBox(pdf, mark, starts[page]!, ends[page]!, place(page))
      }
      continue
    }
    const page = pageOf(starts, mark.top)
    pdf.setPage(page + 1)
    if (mark.kind === 'text') {
      drawText(pdf, mark, place(page)(mark.baseline))
    } else if (mark.data) {
      const height = mark.bottom - mark.top
      pdf.addImage(mark.data, 'PNG', mark.left * PT_PER_PX, place(page)(mark.top) * PT_PER_PX, mark.width * PT_PER_PX, height * PT_PER_PX, undefined, 'FAST')
    }
  }
  pdf.setLineDashPattern([], 0)
  return pdf
}

/** The frame the paper is laid out in: off the screen, a page wide, an empty page of its own. */
function paperFrame(width: number, height: number): Promise<HTMLIFrameElement> {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.setAttribute('style', `position:fixed;left:-${Math.ceil(width) + 1000}px;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden;pointer-events:none`)
  return new Promise(resolve => {
    frame.addEventListener('load', () => resolve(frame), { once: true })
    frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'
    document.body.appendChild(frame)
  })
}

/**
 * The paper `root` (as it is on the page now; it is copied, not moved) as a PDF. The page sizes and the title are the
 * caller's; the PDF holds the paper's own words and nothing else.
 */
export async function paperPdf(root: Element, { size, title }: PaperPdfOptions): Promise<Blob> {
  const page = pageSizePx(size)
  const css = printCssText(Array.from(document.styleSheets))
  const copy = root.cloneNode(true) as HTMLElement
  const [{ jsPDF: JsPdf }, regular, bold] = await Promise.all([import('jspdf'),
    import('../ehr-blue/departments/outreach/fonts/NotoSans-Regular.ttf?inline'), import('../ehr-blue/departments/outreach/fonts/NotoSans-Bold.ttf?inline')])
  const frame = await paperFrame(page.width, page.height)
  try {
    const doc = frame.contentDocument
    const view = frame.contentWindow
    if (!doc || !view) throw new Error('No frame to lay the paper out in.')
    doc.documentElement.lang = document.documentElement.lang || 'en'
    doc.documentElement.dir = document.documentElement.dir || 'ltr'
    const sheet = doc.createElement('style')
    // The page's own rules as they print, then the PDF's font on every line (above any rule's font, as printing would
    // use the page's): the frame and the PDF then measure each line alike.
    sheet.textContent = `${css}\n:root,:root *:not(#hid-paper-pdf){font-family:'${FRAME_FONT}' !important;font-synthesis:none !important;`
      + 'font-kerning:none !important;font-feature-settings:normal !important;font-variant-ligatures:none !important}'
      + ':root{background:#fff}'
    doc.head.appendChild(sheet)
    // The frame's own FontFace: a face belongs to the document whose fonts it joins.
    const Face = (view as unknown as typeof globalThis).FontFace
    const faces = [new Face(FRAME_FONT, bytesOf(regular.default), { weight: `1 ${BOLD_FROM - 1}` }),
      new Face(FRAME_FONT, bytesOf(bold.default), { weight: `${BOLD_FROM} 1000` })]
    for (const face of faces) doc.fonts.add(await face.load())
    const paper = doc.importNode(copy, true) as HTMLElement
    doc.body.appendChild(paper)
    await doc.fonts.ready
    const reading = await readPaper(doc, paper, size, page.height)
    const pdf = writePdf(JsPdf, [base64Of(regular.default), base64Of(bold.default)], reading, title, size === 'slip')
    return pdf.output('blob')
  } finally {
    frame.remove()
  }
}
