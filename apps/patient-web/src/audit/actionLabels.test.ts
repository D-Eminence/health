import { describe, expect, it } from 'vitest'
import tables from './actionLabels.spec-tables.md?raw'
import { AUDIT_ACTION_LABELS, LEGACY_ACTION_LABELS, LEGACY_ACTIVITY } from './actionLabels'

/**
 * Every audit action the backend writes has its words in docs/AUDIT_ACTION_LABELS.md (D-Eminence/health#75): 333 rows
 * in its main table (two of them rules, not codes: the hid-1.0 catch-all and the request log) and 3 hid-1.0 actions.
 * actionLabels.spec-tables.md holds those two tables' code and label columns as the spec writes them; actionLabels.ts
 * must hold exactly the same labels, none reworded, none missing, none invented.
 */
function rows(section: string): Array<[string, string]> {
  const start = tables.indexOf(`## ${section}`)
  const end = tables.indexOf('\n## ', start + 1)
  return tables.slice(start, end === -1 ? undefined : end).split('\n')
    .map(line => /^\| `([^`]+)` \| (.+) \|$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => [match[1] ?? '', match[2] ?? ''])
}

const labels = rows('Labels')
const legacy = rows('Legacy (hid-1.0) actions')
// The two rows that name a rule rather than a code.
const RULES = ['<hid-1.0 legacy action>', 'api.<route action or method.path>']

describe('the audit action labels', () => {
  it('reads the spec’s tables in full', () => {
    expect(labels).toHaveLength(333)
    expect(legacy).toHaveLength(3)
    expect(labels.filter(([code]) => RULES.includes(code)).map(([code]) => code)).toEqual(RULES)
  })

  it('holds every code of the spec’s main table with its label as written, and nothing else', () => {
    const codes = labels.filter(([code]) => !RULES.includes(code))
    expect(codes).toHaveLength(331)
    expect(Object.entries(AUDIT_ACTION_LABELS)).toEqual(codes)
  })

  it('holds the three hid-1.0 actions, and the hid-1.0 catch-all as the spec words it', () => {
    expect(Object.entries(LEGACY_ACTION_LABELS)).toEqual(legacy)
    expect(LEGACY_ACTIVITY).toBe(labels.find(([code]) => code === '<hid-1.0 legacy action>')?.[1])
  })

  it('keeps the request log out of the labels: it is never shown', () => {
    expect(labels.find(([code]) => code.startsWith('api.'))?.[1]).toBe('Hidden (request log)')
    expect(Object.keys(AUDIT_ACTION_LABELS).some(code => code.startsWith('api.'))).toBe(false)
  })
})
