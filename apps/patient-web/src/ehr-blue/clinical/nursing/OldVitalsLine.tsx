import type { KeyValue } from '../parts/KeyValueList'
import { OLD_VITALS_NOTE } from './observations'

/** The line under an observation saved under the old "Vitals" category (isOldVitalsNote), in the design's muted sub-line. */
export function OldVitalsLine() {
  return <span className="hid-ehr-clinical-cell-sub">{OLD_VITALS_NOTE}</span>
}

/** The observation's "Note", with the old "Vitals" line under its text when `old` (the other items as they are). */
export function withOldVitalsLine(items: readonly KeyValue[], old: boolean): KeyValue[] {
  if (!old) return [...items]
  return items.map(item => item.label === 'Note' ? { ...item, value: <>{item.value}<OldVitalsLine /></> } : item)
}
