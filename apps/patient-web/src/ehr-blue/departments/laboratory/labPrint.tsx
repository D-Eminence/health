import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react'
import type { LabAbnormalFlag } from '../../../staff/api'
import { FLAG_WORDS } from './labText'
import './lab.css'

/*
 * Printing a sample label or a result slip (lab.css). The paper is put on the page only while it prints, so nothing
 * else's print rules (a receipt's) meet it; window.print runs in the commit that shows it, and the paper goes once the
 * print dialog closes.
 */

type PaperKind = 'label' | 'slip'

export function usePrint() {
  const [paper, setPaper] = useState<{ kind: PaperKind; node: ReactNode; round: number } | null>(null)
  useLayoutEffect(() => {
    if (!paper) return
    const done = () => setPaper(current => current?.round === paper.round ? null : current)
    window.addEventListener('afterprint', done, { once: true })
    try { window.print() } catch { done() }
    return () => window.removeEventListener('afterprint', done)
  }, [paper])
  const print = useCallback((kind: PaperKind, node: ReactNode) => setPaper(current => ({ kind, node, round: (current?.round ?? 0) + 1 })), [])
  const area = paper ? <div data-lab-print={paper.kind} aria-hidden="true" className="hidden print:block">{paper.node}</div> : null
  return { print, area }
}

/** What a sample label says: who, their age and sex, the test, the request number and the date. */
export interface SampleLabel {
  readonly key: string
  readonly name: string
  readonly ageSex: string | null
  readonly test: string
  readonly requestNumber: string
  readonly date: string
}

export function Labels({ labels }: { readonly labels: readonly SampleLabel[] }) {
  return <div className="flex flex-col gap-2 p-1 text-black">
    {labels.map(label => <div key={label.key} data-lab-label="" className="flex flex-col gap-0.5 border border-black px-2 py-1.5">
      <p className="m-0 text-[14px] leading-tight font-semibold">{label.name}</p>
      {label.ageSex ? <p className="m-0 text-[12px] leading-tight">{label.ageSex}</p> : null}
      <p className="m-0 text-[13px] leading-tight font-medium">{label.test}</p>
      <p className="m-0 text-[12px] leading-tight tracking-[.04em]">{label.requestNumber} · {label.date}</p>
    </div>)}
  </div>
}

/** One released result on the slip. */
export interface SlipLine {
  readonly key: string
  readonly test: string
  readonly value: string
  readonly unit: string | null
  readonly range: string | null
  readonly flag: LabAbnormalFlag
}

export function ResultSlip({ facility, name, ageSex, hid, requestNumber, released, lines }: {
  readonly facility: string; readonly name: string; readonly ageSex: string | null; readonly hid: string
  readonly requestNumber: string; readonly released: string; readonly lines: readonly SlipLine[]
}) {
  return <div className="flex flex-col gap-3 p-4 text-black">
    <div>
      <p className="m-0 text-[16px] font-semibold">{facility}</p>
      <p className="m-0 text-[13px]">Laboratory result</p>
    </div>
    <div className="text-[13px]">
      <p className="m-0 text-[15px] font-semibold">{name}</p>
      <p className="m-0">{[ageSex, hid].filter(Boolean).join(' · ')}</p>
      <p className="m-0">Request {requestNumber} · Released {released}</p>
    </div>
    <table className="w-full border-collapse text-left text-[13px]">
      <thead><tr className="border-b border-black"><th className="py-1 pr-2">Test</th><th className="py-1 pr-2">Result</th><th className="py-1 pr-2">Range</th><th className="py-1">Flag</th></tr></thead>
      <tbody>{lines.map(line => <tr key={line.key} className="border-b border-[#999]">
        <td className="py-1 pr-2">{line.test}</td>
        <td className="py-1 pr-2 font-semibold">{line.value}{line.unit ? ` ${line.unit}` : ''}</td>
        <td className="py-1 pr-2">{line.range ?? ''}</td>
        <td className="py-1">{line.flag === 'normal' || line.flag === 'unknown' ? '' : FLAG_WORDS[line.flag]}</td>
      </tr>)}</tbody>
    </table>
  </div>
}
