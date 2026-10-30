import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  EhrButton, EhrDrawer, EhrEmptyState, EhrField, EhrIcon, EhrInput, EhrPopover, EhrSampleBanner, EhrSkeleton,
} from '@hid/ui/ehr'
import { useStaff } from '../../staff/App'
import { roleLabels } from '../../staff/staffAccess'
import { usesNovuBackend } from '../../backendContract'
import { useAccessRequests } from './attention'
import { DEMO_ROLES, useRoleView } from './roleView'
import { modulePath } from './sample/paths'
import { sampleModule, sampleRecords } from './sample/store'
import { pageHrefOf } from './pageHref'
import type { EhrBluePage } from './types'

/**
 * The top bar's controls (design: screens/panels). Search finds work areas; the bell says what waits; the demo chip
 * says what is live; the account menu signs out and switches facility, with today's session logic.
 */

export function WorkspaceSearch({ pages }: { readonly pages: readonly EhrBluePage[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  // Ctrl+K or Command+K opens it from anywhere in the workspace.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const words = query.trim().toLowerCase()
  const found = pages.filter(page => !words || page.label.toLowerCase().includes(words) || page.group.toLowerCase().includes(words))
  const close = () => { setOpen(false); setQuery('') }
  return <>
    <EhrButton variant="secondary" aria-keyshortcuts="Control+K Meta+K" onClick={() => setOpen(true)}>Search Health ID</EhrButton>
    <EhrDrawer open={open} title="Search Health ID" onClose={close}>
      <EhrField label="Search work areas" hint="Patient and staff search is not connected yet: it finds the work areas you may open.">
        <EhrInput type="search" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} />
      </EhrField>
      {found.length > 0 ? (
        <nav aria-label="Search results" className="hid-ehr-blue-results">
          {found.map(page => (
            <a key={page.path} className="hid-ehr-blue-result" href={pageHrefOf(page)} onClick={event => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              close()
              navigate(pageHrefOf(page))
            }}>
              {page.label}
              <span className="hid-ehr-blue-muted">{page.group || 'Home'}{page.status === 'sample' ? ' · sample' : ''}</span>
            </a>
          ))}
        </nav>
      ) : <EhrEmptyState title="No matching work areas" message="Try a different word." />}
    </EhrDrawer>
  </>
}

export function NotificationsButton() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const read = useAccessRequests()
  const pending = read.state === 'ready' ? read.pending : 0
  return <>
    <EhrButton variant="secondary" icon={<EhrIcon name="bell" />} onClick={() => setOpen(true)}
      aria-label={pending > 0 ? `Notifications, ${pending} pending` : 'Notifications'}>
      Notifications{pending > 0 ? <span className="hid-ehr-blue-count" aria-hidden="true">{pending}</span> : null}
    </EhrButton>
    <EhrDrawer open={open} title="Notifications" onClose={() => setOpen(false)}>
      {read.state === 'none' ? <EhrEmptyState title="Nothing waiting" message="Access requests show here for roles that answer them." />
        : read.state === 'loading' ? <EhrSkeleton label="Loading access requests" bars={2} />
          : read.state === 'failed' ? <p role="alert" className="hid-ehr-error">{read.message}</p>
            : (
              <div className="hid-ehr-blue-notice-item">
                <p><strong>{read.pending} pending access request{read.pending === 1 ? '' : 's'}</strong></p>
                <p className="hid-ehr-blue-muted">Patients and their requests are opened from External record access.</p>
                <EhrButton variant="secondary" onClick={() => { setOpen(false); navigate('/provider/requests') }}>Review requests</EhrButton>
              </div>
            )}
      <h3 className="hid-ehr-blue-subtitle hid-ehr-blue-drawer-section">Recent activity</h3>
      <EhrSampleBanner />
      <ul className="hid-ehr-blue-list">
        {SAMPLE_ACTIVITY.map(moduleId => {
          const module = sampleModule(moduleId)
          const record = sampleRecords(moduleId)[0]
          if (!module || !record) return null
          return <li key={moduleId} className="hid-ehr-blue-list-item hid-ehr-blue-notification">
            <span>{module.title} record created</span>
            <EhrButton variant="secondary" size="sm" aria-label={`Open ${module.title} record`}
              onClick={() => { setOpen(false); navigate(`${modulePath(moduleId)}/${record.id}`) }}>Open record</EhrButton>
          </li>
        })}
      </ul>
    </EhrDrawer>
  </>
}

/** The workspaces the design's notification list draws from (screens/panels/notifications-drawer.png). */
const SAMPLE_ACTIVITY = ['appointments', 'quality', 'nursing', 'icu', 'referrals'] as const

export function DemoChip({ facility }: { readonly facility: string }) {
  const navigate = useNavigate()
  return (
    <EhrPopover trigger="Demo" label="About this demo" triggerClassName="hid-ehr-blue-chip">
      {close => <>
        <p><strong>{facility} is a Health ID demo facility.</strong></p>
        <p className="hid-ehr-blue-muted">Live pages use Health ID. Pages marked as samples are not connected yet: their data is fictional and is gone when you reload.</p>
        <EhrButton variant="secondary" size="sm" onClick={() => { close(false); navigate('/provider/whats-left') }}>See what’s left</EhrButton>
      </>}
    </EhrPopover>
  )
}

function initials(name: string): string {
  const letters = name.split(/\s+/).filter(Boolean).map(word => word[0]!.toUpperCase())
  return (letters.length > 1 ? letters[0]! + letters.at(-1)! : letters[0] ?? 'H').slice(0, 2)
}

export function AccountMenu({ onSample }: { readonly onSample?: (panel: 'profile' | 'preferences' | 'help') => void }) {
  const { state, signOut } = useStaff()
  const navigate = useNavigate()
  const role = useRoleView()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  if (state.status !== 'ready') return null
  const { actor } = state.session
  const name = actor.displayName ?? actor.email ?? 'Staff member'
  const facility = actor.facility
  const roles = facility ? (usesNovuBackend() ? roleLabels(facility.roles) : facility.roles.join(', ')) || 'Staff' : 'Staff'

  async function leave() {
    if (signingOut) return
    setError('')
    setSigningOut(true)
    try { await signOut() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Sign-out could not be completed.') }
    finally { setSigningOut(false) }
  }

  return <>
    <EhrPopover trigger={<span className="hid-ehr-blue-avatar" aria-hidden="true">{initials(name)}<span className="hid-ehr-blue-presence" /></span>} triggerLabel="Account menu" label="Account">
      {close => (
        <div className="hid-ehr-blue-menu">
          <p className="hid-ehr-blue-menu-name">{name}</p>
          <p className="hid-ehr-blue-muted">{roles}{facility ? ` · ${facility.name}` : ''}</p>
          {onSample ? <>
            <EhrButton variant="secondary" onClick={() => { close(false); onSample('profile') }}>My profile</EhrButton>
            <EhrButton variant="secondary" onClick={() => { close(false); onSample('profile') }}>Status: Online</EhrButton>
            <EhrButton variant="secondary" onClick={() => { close(false); onSample('preferences') }}>Preferences</EhrButton>
            <EhrButton variant="secondary" onClick={() => { close(false); onSample('help') }}>Help</EhrButton>
          </> : null}
          {actor.facilities.length > 1 ? (
            <EhrButton variant="secondary" onClick={() => { close(false); navigate('/provider/institutions') }}>Switch facility</EhrButton>
          ) : null}
          <div className="hid-ehr-blue-roles" role="group" aria-labelledby="hid-ehr-blue-roles-title">
            <p id="hid-ehr-blue-roles-title" className="hid-ehr-blue-muted">View Home as a demo role (sample)</p>
            {role.viewing ? <EhrButton variant="quiet" size="sm" onClick={() => { close(); role.view(null); navigate('/provider') }}>My own dashboard</EhrButton> : null}
            {DEMO_ROLES.map(demo => (
              <EhrButton key={demo} variant="quiet" size="sm" aria-pressed={role.viewing === demo}
                onClick={() => { close(); role.view(demo); navigate('/provider') }}>{demo}</EhrButton>
            ))}
          </div>
          <EhrButton variant="secondary" icon={<EhrIcon name="signOut" />} busy={signingOut} onClick={leave}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </EhrButton>
        </div>
      )}
    </EhrPopover>
    {error ? <p role="alert" className="hid-ehr-error hid-ehr-blue-topbar-error">{error}</p> : null}
  </>
}

/** The sample panels the account menu opens (screens/admin/profile.png and the design's preferences and help). */
export function AccountSamplePanel({ panel, onClose }: { readonly panel: 'profile' | 'preferences' | 'help' | null; readonly onClose: () => void }) {
  const { state } = useStaff()
  const actor = state.status === 'ready' ? state.session.actor : null
  const title = panel === 'profile' ? 'My profile' : panel === 'preferences' ? 'Preferences' : 'Help'
  return (
    <EhrDrawer open={panel !== null} title={title} onClose={onClose}>
      <EhrSampleBanner />
      {panel === 'profile' ? <dl className="hid-ehr-blue-facts">
        <div className="hid-ehr-blue-fact"><dt>Name</dt><dd>{actor?.displayName ?? 'Not recorded'}</dd></div>
        <div className="hid-ehr-blue-fact"><dt>Status</dt><dd>Online (sample)</dd></div>
        <div className="hid-ehr-blue-fact"><dt>Photo</dt><dd>Not added (sample)</dd></div>
      </dl> : panel === 'preferences' ? <p>Sound, notification and display preferences arrive with the presence service.</p>
        : <p>Use Search Health ID (Ctrl+K or Command+K) to find work areas. Contact your facility administrator for access or account help.</p>}
    </EhrDrawer>
  )
}
