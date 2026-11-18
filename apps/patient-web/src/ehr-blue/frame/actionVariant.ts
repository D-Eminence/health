import type { EhrButtonVariant } from '@hid/ui/ehr'

/** Words that end, undo or throw away: their button is the danger one, never the lead. */
const DESTRUCTIVE = /^(cancel|delete|void|reject|refund|decline|deny|discard|remove|revoke|retract|mark .*in error|close)\b/i

/**
 * The look of a record page's action button (UX review, 17 Nov 2026): the first action that moves the record forward
 * is the one primary button (Fitts and Hick: one obvious next step); an action that ends or undoes something is the
 * danger style, so it is never mistaken for the next step; the rest are secondary. Every button keeps its own words.
 */
export function actionVariant(label: string, index: number, labels: readonly string[]): EhrButtonVariant {
  if (DESTRUCTIVE.test(label.trim())) return 'danger'
  const lead = labels.findIndex(other => !DESTRUCTIVE.test(other.trim()))
  return index === lead ? 'primary' : 'secondary'
}
