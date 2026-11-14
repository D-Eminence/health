import { Reveal } from '@/components/motion/Reveal'
import { HealthIcon } from '@/components/shared/HealthIcon'

/** Patient views based on supported record and access-history routes. */
export function PatientExperienceBento() {
  return (
    <section aria-labelledby="patient-record-title" className="bg-surface py-12 sm:py-14 lg:py-20">
      <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-5 lg:px-6">
        <div className="mx-auto max-w-[760px] text-center">
          <p className="font-mono text-[12px] font-semibold tracking-[0.12em] text-brand uppercase">Your health history</p>
          <h2 id="patient-record-title" className="mt-4 font-display text-[clamp(2rem,3.5vw,2.5rem)] leading-[1.08] tracking-[-0.025em] text-ink">One place for records from participating care.</h2>
          <p className="mt-4 text-[15px]/[1.45] text-muted">Review the supported records connected to your Health ID, then see how your information was accessed.</p>
        </div>

        <div className="patient-bento-grid mt-10 grid gap-4 lg:grid-cols-2">
          <Reveal className="h-full"><article className="bento-card flex min-h-full flex-col overflow-hidden rounded-(--radius-card) border-[0.5px] border-line bg-surface p-5 sm:p-6">
            <p className="font-mono text-[11px] font-semibold tracking-[0.1em] text-brand uppercase">Your records</p>
            <h3 className="mt-4 max-w-[20ch] font-display text-[clamp(1.625rem,2.6vw,2rem)] leading-[1.1] tracking-[-0.02em] text-ink">See care documented by a participating provider.</h3>
            <p className="mt-3 max-w-[54ch] text-[14px]/[1.45] text-muted">Completed encounters, signed notes and supported clinical details remain associated with the right patient identity.</p>
            <div className="bento-visual mt-6 flex min-h-[330px] flex-1 items-center overflow-hidden rounded-(--radius-card) border-[0.5px] border-line p-5">
              <div className="w-full text-left">
                <p className="text-[11px] font-medium text-muted">Illustrative record</p>
                <p className="mt-5 text-[15px] font-semibold text-ink">Care summary</p>
                <div className="mt-3 rounded-(--radius-card) bg-surface-tint p-4"><div className="flex gap-3"><HealthIcon name="file" size={18} /><span><b className="block text-[13px] text-ink">Clinical note</b><small className="block text-[12px] text-muted">Signed by a participating care team</small></span></div></div>
                <ul className="mt-4 grid gap-3 text-[12px] text-muted">
                  <li className="flex items-center gap-2"><HealthIcon name="file" size={16} /> Completed encounters</li>
                  <li className="flex items-center gap-2"><HealthIcon name="laboratory" size={16} /> Available laboratory results</li>
                  <li className="flex items-center gap-2"><HealthIcon name="medicine" size={16} /> Prescriptions on record</li>
                </ul>
              </div>
            </div>
          </article></Reveal>

          <Reveal className="h-full"><article className="bento-card flex min-h-full flex-col overflow-hidden rounded-(--radius-card) border-[0.5px] border-line bg-surface p-5 sm:p-6">
            <p className="font-mono text-[11px] font-semibold tracking-[0.1em] text-brand uppercase">Access history</p>
            <h3 className="mt-4 max-w-[20ch] font-display text-[clamp(1.625rem,2.6vw,2rem)] leading-[1.1] tracking-[-0.02em] text-ink">Review access to your information.</h3>
            <p className="mt-3 max-w-[54ch] text-[14px]/[1.45] text-muted">Your access history shows activity recorded when authorised users reach your information.</p>
            <div className="bento-visual mt-6 flex min-h-[330px] flex-1 items-center justify-center overflow-hidden rounded-(--radius-card) border-[0.5px] border-line p-5">
              <div className="w-full max-w-sm rounded-(--radius-card) border border-line bg-white p-5 shadow-sm">
                <p className="text-[11px] font-medium text-muted">Illustrative activity</p>
                <p className="mt-3 text-[15px] font-semibold text-ink">Record access</p>
                <div className="mt-4 flex items-start gap-3 rounded-lg bg-surface-tint p-3"><HealthIcon name="shield" size={19} className="text-brand" /><span><b className="block text-[13px] text-ink">Authorised care access</b><small className="block text-[12px] text-muted">Facility and purpose recorded</small></span></div>
                <p className="mt-4 text-[12px]/relaxed text-muted">A Health ID identifies you. Record access is checked separately.</p>
              </div>
            </div>
          </article></Reveal>
        </div>
      </div>
    </section>
  )
}
