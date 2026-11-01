/**
 * An agreement as Health ID shows it: a short version on screen beside the tick boxes, and the full text in a sheet
 * (AgreementSheet.tsx). Each is versioned: what a person agrees to is this `id` at this `version`, and a new version
 * asks them to agree again (ReAgree.tsx). A section shows its list first, then any paragraphs, which follow on from it.
 */
export interface AgreementSection {
  readonly heading: string
  readonly paragraphs?: readonly string[]
  readonly bullets?: readonly string[]
}

export interface AgreementDocument {
  /** What the backend stores (BACKEND-NEEDS.md, "Consent and agreements"). */
  readonly id: 'patient-terms' | 'health-data' | 'facility-agreement'
  readonly version: string
  /** The date this version takes effect, YYYY-MM-DD. */
  readonly date: string
  readonly title: string
  /** The line above the short version's list. */
  readonly lead: string
  /** The short version, one plain sentence a line. */
  readonly short: readonly string[]
  readonly sections: readonly AgreementSection[]
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-11-01" as "1 November 2026"; anything else as it came. */
export function agreementDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const month = MONTHS[Number(match[2]) - 1]
  return month ? `${Number(match[3])} ${month} ${match[1]}` : value
}

/** "Version 1.0 · 1 November 2026". */
export const versionLine = (document: Pick<AgreementDocument, 'version' | 'date'>) =>
  `Version ${document.version} · ${agreementDate(document.date)}`
