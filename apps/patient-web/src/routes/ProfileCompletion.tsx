import { Link } from 'react-router-dom'
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
      {missing.length > 0 && <Link to="/profile#profile-completion">See what is missing <ItemName>from your profile</ItemName></Link>}
    </div>
  }
  return <div className="patient-card patient-completion" id="profile-completion">
    <h2 tabIndex={-1}>Profile completion</h2>
    <p className="patient-completion-figure"><strong>{percent}%</strong> complete</p>
    {bar}
    {missing.length === 0 ? <p className="patient-field-hint">Your profile is complete.</p> : <>
      <p className="patient-field-hint">Still to add:</p>
      <ul className="patient-completion-missing">{missing.map(item => <li key={item.key}><Link to={item.href}>{item.label}</Link></li>)}</ul>
    </>}
  </div>
}
