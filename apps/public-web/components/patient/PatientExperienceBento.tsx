import Image from 'next/image'
import { Reveal } from '@/components/motion/Reveal'
import { HealthIcon } from '@/components/shared/HealthIcon'

/** Two patient-led ways to keep a health history complete. */
export function PatientExperienceBento() {
  return (
    <section aria-labelledby="patient-record-title" className="bg-surface py-12 sm:py-14 lg:py-20">
      <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-5 lg:px-6">
        <div className="mx-auto max-w-[760px] text-center">
          <p className="font-mono text-[12px] font-semibold tracking-[0.12em] text-brand uppercase">Your health history</p>
          <h2 id="patient-record-title" className="mt-4 font-display text-[clamp(2rem,3.5vw,2.5rem)] leading-[1.08] tracking-[-0.025em] text-ink">One place for the care you&apos;ve received.</h2>
          <p className="mt-4 text-[15px]/[1.45] text-muted">When care happens outside a connected Health ID provider, your history can still keep growing with you.</p>
        </div>

        <div className="patient-bento-grid mt-10 grid gap-4 lg:grid-cols-2">
          <Reveal className="h-full"><article className="bento-card flex min-h-full flex-col overflow-hidden rounded-(--radius-card) border-[0.5px] border-line bg-surface p-5 sm:p-6">
            <p className="font-mono text-[11px] font-semibold tracking-[0.1em] text-brand uppercase">Your records</p>
            <h3 className="mt-4 max-w-[20ch] font-display text-[clamp(1.625rem,2.6vw,2rem)] leading-[1.1] tracking-[-0.02em] text-ink">Received care somewhere else? Add it yourself.</h3>
            <p className="mt-3 max-w-[54ch] text-[14px]/[1.45] text-muted">Your Health ID is not limited to hospitals already using Health ID. Add relevant information from that visit and keep it in one place.</p>
            <div className="bento-visual mt-6 flex min-h-[330px] flex-1 items-center overflow-hidden rounded-(--radius-card) border-[0.5px] border-line p-5">
              <div className="w-full text-left">
                <span className="grid h-8 w-8 place-items-center rounded-(--radius-button) border border-line-strong text-ink"><HealthIcon name="arrow" size={16} className="rotate-180" /></span>
                <p className="mt-8 text-[15px] font-semibold text-ink">Medical record</p>
                <div className="mt-3 rounded-(--radius-card) bg-surface-tint p-4"><div className="flex gap-3"><HealthIcon name="file" size={18} /><span><b className="block text-[13px] text-ink">Typhoid lab result</b><small className="block text-[12px] text-muted">Uploaded · 100% · 200kb</small></span></div><span className="mt-3 block h-1 rounded-(--radius-pill) bg-brand" /></div>
                <ul className="mt-4 grid gap-3 text-[12px] text-muted"><li className="flex items-center justify-between"><span className="flex items-center gap-2"><HealthIcon name="laboratory" size={16} /> Lab Results</span><i className="h-5 w-5 border-2 border-brand bg-brand" /></li><li className="flex items-center justify-between"><span className="flex items-center gap-2"><HealthIcon name="medicine" size={16} /> Drug Prescription</span><i className="h-5 w-5 border border-muted" /></li><li className="flex items-center justify-between"><span className="flex items-center gap-2"><HealthIcon name="file" size={16} /> Medical Report</span><i className="h-5 w-5 border border-muted" /></li><li className="flex items-center justify-between"><span className="flex items-center gap-2"><HealthIcon name="attachment" size={16} /> Others</span><i className="h-px w-[134px] bg-muted" /></li></ul>
                <button type="button" className="mt-6 h-[38px] w-full rounded-(--radius-button) bg-brand text-[14px] font-semibold text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Continue</button>
              </div>
            </div>
          </article></Reveal>

          <Reveal className="h-full"><article className="bento-card flex min-h-full flex-col overflow-hidden rounded-(--radius-card) border-[0.5px] border-line bg-surface p-5 sm:p-6">
            <p className="font-mono text-[11px] font-semibold tracking-[0.1em] text-brand uppercase">Share with healthcare providers</p>
            <h3 className="mt-4 max-w-[20ch] font-display text-[clamp(1.625rem,2.6vw,2rem)] leading-[1.1] tracking-[-0.02em] text-ink">Share the health record that matters for your care.</h3>
            <p className="mt-3 max-w-[54ch] text-[14px]/[1.45] text-muted">Choose a record to share with a healthcare provider, while keeping control of what they can view.</p>
            <div className="bento-visual mt-6 flex min-h-[330px] flex-1 items-end justify-center overflow-hidden rounded-(--radius-card) border-[0.5px] border-line px-5 pt-5">
              <Image src="/brand/share-health-record.png" alt="Health ID screen for sharing a record with a healthcare provider" width={1135} height={1167} className="h-[330px] w-auto object-cover object-top" />
            </div>
          </article></Reveal>
        </div>
      </div>
    </section>
  )
}
