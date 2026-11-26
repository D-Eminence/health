import type { EhrBadgeTone } from '@hid/ui/ehr'

/*
 * The live five-level triage scale (hid-system 0135's `triage_level`: 1 most urgent to 5), in the words and tones every
 * page uses: the waiting list, the emergency department board (ED-1 reuses the same field, there is no second scale) and
 * Triage & Vitals. One module, so the three never drift apart. The clinical lead signs off the scale before real
 * patients use the board.
 */

export const TRIAGE_LEVELS = [1, 2, 3, 4, 5] as const

const TRIAGE_WORDS: Readonly<Record<number, string>> = {
  1: 'Level 1: most urgent',
  2: 'Level 2: very urgent',
  3: 'Level 3: urgent',
  4: 'Level 4: less urgent',
  5: 'Level 5: not urgent',
}

export const NO_TRIAGE_LEVEL = 'No triage level yet'

export function triageText(level: number | null): string {
  return level !== null && Object.hasOwn(TRIAGE_WORDS, level) ? TRIAGE_WORDS[level]! : NO_TRIAGE_LEVEL
}

/** Level 1 and 2 in the critical tone, 3 in caution, as the waiting list shows them. No timer colours. */
export function triageTone(level: number | null): EhrBadgeTone {
  if (level === null) return 'neutral'
  return level <= 2 ? 'critical' : level === 3 ? 'caution' : 'neutral'
}

export const TRIAGE_HINT = 'Level 1 is the most urgent. Patients are listed by level.'
