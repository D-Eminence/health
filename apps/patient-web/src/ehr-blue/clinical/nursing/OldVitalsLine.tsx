import type { KeyValue } from '../parts/KeyValueList'

/** The line under an observation saved under the old "Vitals" category (oldVitalsLine), in the design's muted sub-line. */
export function OldVitalsLine({ line }: { readonly line: string }) {
  return <span className="hid-ehr-clinical-cell-sub">{line}</span>
}

/** The observation's "Note", with the old "Vitals" line under its text when there is one (the other items as they are). */
export function withOldVitalsLine(items: readonly KeyValue[], line: string | null): KeyValue[] {
  if (!line) return [...items]
  return items.map(item => item.label === 'Note' ? { ...item, value: <>{item.value}<OldVitalsLine line={line} /></> } : item)
}
