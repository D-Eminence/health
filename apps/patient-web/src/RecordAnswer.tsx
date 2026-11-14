import { Fragment, type ReactNode } from 'react'

/*
 * The one renderer for record assistant answers, used by the patient chat (app.) and the staff chat (ehr.).
 * Limited formatting only: headings, paragraphs, **bold**, bullet and numbered lists (one level of sub-list) and
 * simple tables. It builds React
 * elements, so React escapes all content; there is no HTML parser, no automatic URLs and no model-generated
 * link targets.
 */

/** Dash-like punctuation the answer must not show. The minus sign (U+2212) is handled on its own. */
const DASHES = '\u2012\u2013\u2014\u2015'
const D = `[${DASHES}]`
const re = (source: string, flags = 'g') => new RegExp(source, flags)

/**
 * Removes en dashes, em dashes and similar from assistant text in the browser, so every answer reads cleanly,
 * including answers saved earlier. The server does not apply this rule yet.
 * - A line made only of dashes, stars or underscores (a divider) is dropped.
 * - A dashed calendar date ("2026\u201309\u201321") keeps its parts, joined by "-".
 * - A dash between numbers becomes " to " ("3\u20135" reads "3 to 5"); a minus sign becomes "-".
 * - A dash that starts a line becomes a bullet; a dash that is the whole value after "Label:" reads "Not recorded".
 * - A spaced dash, a dash spaced on one side, or an em dash between words becomes ", ".
 * - Any other dash (an en dash inside a word such as "Smith\u2013Jones") becomes "-".
 */
export function cleanAssistantText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(re(`^[ \\t]*(?:[-*_${DASHES}][ \\t]*){3,}$`, 'gm'), '')
    .replace(re(`\\b(\\d{4})${D}(\\d{2})${D}(\\d{2})\\b`), '$1-$2-$3')
    .replace(/\u2212/g, '-')
    .replace(re(`(\\d)[ \\t]*${D}[ \\t]*(?=\\d)`), '$1 to ')
    .replace(re(`^([ \\t]*)${D}[ \\t]+`, 'gm'), '$1- ')
    .replace(re(`^([ \\t]*(?:[-*\u2022][ \\t]+)?[^\\n:]{1,40}:)[ \\t]*${D}[ \\t]*$`, 'gm'), '$1 Not recorded')
    .replace(re(`[ \\t]+${D}[ \\t]*$`, 'gm'), '')
    .replace(re(`[ \\t]+${D}[ \\t]*(?=\\S)|(?<=\\S)${D}[ \\t]+`), ', ')
    .replace(re(`(?<=\\S)[\u2014\u2015](?=\\S)`), ', ')
    .replace(re(D), '-')
}

/** `*text*` (single stars) is shown as plain text; the stars are dropped. */
const unstar = (text: string) => text.replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, '$1$2')

/** `**bold**` only; a short "Label:" (three words or fewer) that starts a line or list item is shown in bold too. */
function inline(text: string, label = false): ReactNode[] {
  const lead = label ? /^([A-Z][A-Za-z0-9'()/& ]{0,30}[A-Za-z0-9)]):[ \t]+(?=\S)/.exec(text) : null
  const nodes: ReactNode[] = []
  let rest = text
  if (lead && lead[1] && lead[1].split(' ').length <= 3) {
    nodes.push(<strong key="label">{lead[1]}:</strong>, ' ')
    rest = text.slice(lead[0].length)
  }
  rest.split(/(\*\*[^*\n]+\*\*)/g).forEach((part, i) => {
    if (!part) return
    nodes.push(part.length > 4 && part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{unstar(part.slice(2, -2))}</strong> : <Fragment key={i}>{unstar(part)}</Fragment>)
  })
  return nodes
}

type ListItem = { text: string; sub?: { ordered: boolean; items: string[] } }
type Block =
  | { kind: 'heading'; level: 3 | 4; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'table'; header: string[]; rows: string[][] }

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const BOLD_LINE = /^\s*\*\*([^*\n]+?)\*\*:?\s*$/
const BULLET = /^(\s*)[-*\u2022]\s+(.*)$/
const NUMBERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/
const TABLE_ROW = /^\s*\|(.*)\|\s*$/
const TABLE_RULE = /^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/

/** Heading text without surrounding bold stars or a trailing colon. */
const headingText = (text: string) => text.replace(/^\*\*(.*)\*\*$/, '$1').replace(/\s*:\s*$/, '')
const cells = (row: string) => row.split('|').map(cell => cell.trim())

function parse(text: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  const close = () => { if (current) blocks.push(current); current = null }
  const lines = cleanAssistantText(text).split('\n')
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] ?? ''
    if (!line.trim()) { close(); continue }
    const row = TABLE_ROW.exec(line)
    if (row?.[1] !== undefined && TABLE_RULE.test(lines[n + 1] ?? '')) {
      // A markdown table: its header, the rule under it, then each row that follows.
      close()
      const table: Block = { kind: 'table', header: cells(row[1]), rows: [] }
      n += 1
      while (n + 1 < lines.length) {
        const next = TABLE_ROW.exec(lines[n + 1] ?? '')
        if (next?.[1] === undefined) break
        table.rows.push(cells(next[1]))
        n += 1
      }
      blocks.push(table)
      continue
    }
    if (TABLE_RULE.test(line) && line.includes('|')) continue
    const heading = HEADING.exec(line)
    const boldLine = BOLD_LINE.exec(line)
    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (heading?.[2]) {
      close()
      // "#" and "##" are section headings; "###" and deeper are sub-headings.
      blocks.push({ kind: 'heading', level: (heading[1]?.length ?? 1) <= 2 ? 3 : 4, text: headingText(heading[2]) })
    } else if (boldLine?.[1] && (!current || current.kind !== 'paragraph')) {
      close()
      blocks.push({ kind: 'heading', level: 4, text: headingText(boldLine[1]) })
    } else if (bullet || numbered) {
      const ordered = !bullet
      const indent = (bullet ? bullet[1] : numbered?.[1]) ?? ''
      const item = (bullet ? bullet[2] : numbered?.[3]) ?? ''
      const last = current?.kind === 'list' ? current.items[current.items.length - 1] : undefined
      if (last && indent.length >= 2) {
        // An indented item belongs to the item above it, as a sub-list.
        last.sub ??= { ordered, items: [] }
        last.sub.items.push(item)
        continue
      }
      if (!current || current.kind !== 'list' || current.ordered !== ordered) {
        close()
        current = { kind: 'list', ordered, start: ordered ? Number(numbered?.[2] ?? 1) : 1, items: [] }
      }
      current.items.push({ text: item })
    } else if (current?.kind === 'list' && /^\s{2,}\S/.test(line)) {
      // An indented line continues the list item above it.
      const last = current.items[current.items.length - 1]
      if (last) last.text += `\n${line.trim()}`
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
    if (block.kind === 'table') return <div key={i} className="record-chat-table-wrap"><table className="record-chat-table">
      <thead><tr>{block.header.map((cell, j) => <th key={j} scope="col">{inline(cell)}</th>)}</tr></thead>
      <tbody>{block.rows.map((row, r) => <tr key={r}>{block.header.map((_, j) => <td key={j}>{inline(row[j] ?? '')}</td>)}</tr>)}</tbody>
    </table></div>
    if (block.kind === 'list') {
      const items = block.items.map((item, j) => {
        const sub = item.sub && item.sub.items.map((text, k) => <li key={k}>{inline(text, true)}</li>)
        return <li key={j}>{inline(item.text, true)}{sub && (item.sub?.ordered ? <ol>{sub}</ol> : <ul>{sub}</ul>)}</li>
      })
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
