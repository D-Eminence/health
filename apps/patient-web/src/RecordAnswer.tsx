import { Fragment, type ReactNode } from 'react'

/*
 * The one renderer for record assistant answers, used by the patient chat (app.) and the staff chat (ehr.).
 * Limited formatting only: headings, paragraphs, **bold**, bullet and numbered lists. It builds React
 * elements, so React escapes all content; there is no HTML parser, no automatic URLs and no model-generated
 * link targets.
 */

const DASHES = '‒–—―−'

/**
 * Removes en dashes, em dashes and similar from assistant text, the same way the server does, so answers
 * saved before the server rule still read cleanly: a dash between numbers becomes " to ", a spaced dash
 * becomes ", " and any other becomes "-". A dash that starts a line becomes a bullet.
 */
export function cleanAssistantText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(new RegExp(`(\\d)[ \\t]*[${DASHES}][ \\t]*(?=\\d)`, 'g'), '$1 to ')
    .replace(new RegExp(`^([ \\t]*)[${DASHES}][ \\t]+`, 'gm'), '$1- ')
    .replace(new RegExp(`[ \\t]+[${DASHES}][ \\t]*$`, 'gm'), '')
    .replace(new RegExp(`[ \\t]+[${DASHES}][ \\t]+`, 'g'), ', ')
    .replace(new RegExp(`[${DASHES}]`, 'g'), '-')
}

/** `**bold**` only; a short "Label:" that starts a line or list item is shown in bold too. */
function inline(text: string, label = false): ReactNode[] {
  const lead = label ? /^([A-Z][A-Za-z0-9'()/&, ]{0,38}[A-Za-z0-9)]):[ \t]+(?=\S)/.exec(text) : null
  const nodes: ReactNode[] = []
  let rest = text
  if (lead && lead[1] && lead[1].split(' ').length <= 5 && !lead[1].includes('**')) {
    nodes.push(<strong key="label">{lead[1]}:</strong>, ' ')
    rest = text.slice(lead[0].length)
  }
  rest.split(/(\*\*[^*\n]+\*\*)/g).forEach((part, i) => {
    if (!part) return
    nodes.push(part.length > 4 && part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>)
  })
  return nodes
}

type Block =
  | { kind: 'heading'; level: 3 | 4; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const BOLD_LINE = /^\s*\*\*([^*\n]+?)\*\*:?\s*$/
const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/

function parse(text: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  const close = () => { if (current) blocks.push(current); current = null }
  for (const line of cleanAssistantText(text).split('\n')) {
    if (!line.trim()) { close(); continue }
    const heading = HEADING.exec(line)
    const boldLine = BOLD_LINE.exec(line)
    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (heading?.[2]) {
      close()
      // "#" and "##" are section headings; "###" and deeper are sub-headings.
      blocks.push({ kind: 'heading', level: (heading[1]?.length ?? 1) <= 2 ? 3 : 4, text: heading[2].replace(/^\*\*(.*)\*\*$/, '$1') })
    } else if (boldLine?.[1] && (!current || current.kind !== 'paragraph')) {
      close()
      blocks.push({ kind: 'heading', level: 4, text: boldLine[1] })
    } else if (bullet || numbered) {
      const ordered = !bullet
      const item = (bullet ? bullet[1] : numbered?.[2]) ?? ''
      if (!current || current.kind !== 'list' || current.ordered !== ordered) {
        close()
        current = { kind: 'list', ordered, start: ordered ? Number(numbered?.[1] ?? 1) : 1, items: [] }
      }
      current.items.push(item)
    } else if (current?.kind === 'list' && /^\s{2,}\S/.test(line)) {
      // An indented line continues the list item above it.
      current.items[current.items.length - 1] += `\n${line.trim()}`
    } else {
      if (!current || current.kind !== 'paragraph') { close(); current = { kind: 'paragraph', lines: [] } }
      current.lines.push(line.trim())
    }
  }
  close()
  return blocks
}

/** The answer's blocks without a wrapper, for places that supply their own container. */
export function FormattedAnswer({ text }: { text: string }) {
  return <>{parse(text).map((block, i) => {
    if (block.kind === 'heading') return block.level === 3
      ? <h3 key={i}>{inline(block.text)}</h3> : <h4 key={i}>{inline(block.text)}</h4>
    if (block.kind === 'list') {
      const items = block.items.map((item, j) => <li key={j}>{inline(item, true)}</li>)
      return block.ordered
        ? <ol key={i} start={block.start === 1 ? undefined : block.start}>{items}</ol>
        : <ul key={i}>{items}</ul>
    }
    return <p key={i}>{block.lines.map((line, j) => <Fragment key={j}>{j > 0 && '\n'}{inline(line, true)}</Fragment>)}</p>
  })}</>
}

export function RecordAnswer({ text, className }: { text: string; className?: string }) {
  return <div className={className ? `record-chat-answer ${className}` : 'record-chat-answer'}><FormattedAnswer text={text} /></div>
}
