import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { LabAbnormalFlag } from '../../../staff/api'
import { PrintHeader } from '../../frame/PrintHeader'
import { startPrint, type PaperPrint, type PrintJob } from '../../../print/printPaper'
import { FLAG_WORDS } from './labText'
import './lab.css'

/*
 * Printing a sample label or a result slip (lab.css). The paper is put on the page only while it prints, so nothing
 * else's print rules (a receipt's) meet it; it prints in the commit that shows it (as a PDF in Safari, printPaper.ts),
 * and the paper goes once it has printed. The result slip carries the shared print header (the Health ID logo and the facility); a sample
 * label, a sticker about 60 mm wide for a sample tube, keeps to who, what and the request number.
 */

type PaperKind = 'label' | 'slip'

/** A label prints as a strip as long as its labels; a result slip on A4. Titles name the facility, never the patient. */
const PAPERS: Readonly<Record<PaperKind, PaperPrint>> = {
  label: { size: 'slip', kind: 'Sample label' },
  slip: { size: 'A4', kind: 'Lab result' },
}

export function usePrint() {
  const [paper, setPaper] = useState<{ kind: PaperKind; node: ReactNode; round: number; job: PrintJob } | null>(null)
  const area = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!paper) return
    return paper.job.run(area.current, () => setPaper(current => current?.round === paper.round ? null : current))
  }, [paper])
  const print = useCallback((kind: PaperKind, node: ReactNode) => {
    const job = startPrint(PAPERS[kind])
    setPaper(current => ({ kind, node, round: (current?.round ?? 0) + 1, job }))
  }, [])
  const shown = paper ? <div ref={area} data-lab-print={paper.kind} aria-hidden="true" className="hidden print:block">{paper.node}</div> : null
  return { print, area: shown }
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
      <PrintHeader facility={facility} />
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
