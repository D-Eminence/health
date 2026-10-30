import { Link } from 'react-router-dom'
import { ChevronRight, CircleCheck, CircleDashed, ListChecks } from 'lucide-react'
import type { ProfileCompletion } from './profileCompletion'
import { ItemName } from '../ItemName'

/**
 * "Profile completion" (hid-1.0 parity B3): the percentage, a bar, and what is still missing, each a link to where it
 * is filled in. On the profile it is always shown, first, and never closed (as hid-1.0 had it; the owner's decision of
 * 2026-10-28). `compact` is the overview's: the figure and the bar, with a link to the list on the profile.
 */
export function ProfileCompletionCard({ completion, compact = false }: { completion: ProfileCompletion; compact?: boolean }) {
  const { percent, missing } = completion
  const bar = <div className="patient-completion-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
  if (compact) {
    return <div className="patient-completion patient-completion-compact">
      <p><strong>{percent}%</strong> of your profile is complete</p>
      {bar}
      {missing.length > 0 && <Link to="/profile#profile-completion">See what’s missing <ItemName>from your profile</ItemName></Link>}
    </div>
  }
  return <section className="overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-card)] ring-1 ring-line" id="profile-completion" aria-labelledby="profile-completion-title">
    <div className="flex items-center gap-3 px-5 pt-4 pb-3">
      <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full ${percent === 100 ? 'bg-success-soft text-success-ink' : 'bg-brand-soft text-brand-ink'}`}>
        {percent === 100 ? <CircleCheck className="size-[18px]" aria-hidden /> : <ListChecks className="size-[18px]" aria-hidden />}</span>
      <div className="min-w-0 flex-1">
        <h2 id="profile-completion-title" tabIndex={-1} className="m-0 text-title-3 text-ink">{percent === 100 ? 'Profile complete' : 'Finish your profile'}</h2>
        <p className="m-0 text-[13px] text-ink-3"><span className="tabular font-medium text-ink">{percent}%</span>{missing.length > 0 ? ` · ${missing.length} to add` : ' · nothing left to add'}</p>
      </div>
    </div>
    <div className="mx-5 mb-4 h-1.5 overflow-hidden rounded-full bg-tray" aria-hidden="true"><div className={`h-full rounded-full ${percent === 100 ? 'bg-success' : 'bg-brand'}`} style={{ width: `${percent}%` }} /></div>
    {missing.length > 0 && <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">{missing.map(item => <li key={item.key}>
      <Link to={item.href} className="flex min-h-11 items-center gap-3 px-5 py-2.5 text-[13px] font-medium text-ink no-underline hover:bg-subtle">
        <CircleDashed className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="flex-1">{item.label}</span><ChevronRight className="size-4 text-ink-3" aria-hidden /></Link></li>)}</ul>}
  </section>
}
