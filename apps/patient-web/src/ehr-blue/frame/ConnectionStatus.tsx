import { useState } from 'react'
import { EhrButton, EhrDrawer, EhrPopover, EhrSampleBanner } from '@hid/ui/ehr'

/**
 * The design's connection and sync status (screens/panels/connection-popover.png and sync-drawer.png): a chip in the
 * bar at the bottom of the workspace, a popover with the summary and a drawer with the details. Health ID has no
 * offline sync for staff today, so all three are samples with fictional figures.
 */
export function ConnectionStatus() {
  const [details, setDetails] = useState(false)
  return (
    <div className="hid-ehr-blue-statusbar">
      <EhrPopover
        trigger={<><span className="hid-ehr-blue-status-dot" aria-hidden="true" />Needs attention · 4 pending</>}
        label="Connection and sync status"
        placement="above"
        triggerClassName="hid-ehr-blue-status-chip"
      >
        {close => <>
          <EhrSampleBanner />
          <p className="hid-ehr-blue-menu-name">Online</p>
          <p>4 saved changes waiting to sync.</p>
          <p>Last sync: 29 Oct 2026, 12:49 (fictional).</p>
          <p>Cached clinical records remain available offline.</p>
          <p>Administrative changes require a connection.</p>
          <EhrButton variant="quiet" onClick={() => { close(false); setDetails(true) }}>View sync details</EhrButton>
        </>}
      </EhrPopover>
      <EhrDrawer open={details} title="Connection and sync details" onClose={() => setDetails(false)}>
        <EhrSampleBanner />
        <h3 className="hid-ehr-blue-subtitle">Connection & saved work</h3>
        <p>Online · last sync 29 Oct 2026, 12:49 (fictional).</p>
        <p>Up to 100 assigned or recent patients per workspace. Offline access lasts up to 8 hours; inactivity locks after 5 minutes.</p>
        <p>Cached clinical work can be saved offline. Administrative changes require a connection.</p>
        <EhrButton variant="secondary" size="sm">Sync now</EhrButton>
        {[1, 1, 2, 2].map((count, index) => (
          <div key={index} className="hid-ehr-blue-sync-item">
            <h3 className="hid-ehr-blue-subtitle">Review required</h3>
            <p>{count} record change{count === 1 ? '' : 's'} · 29 Oct 2026, 12:41 (fictional)</p>
            <p>Conflicting versions retained for review. Both versions are retained; an authorised clinician can review this work
              from this branch’s connection details when online. This item will not overwrite the connected version automatically.</p>
          </div>
        ))}
        <p>Signing out clears cached records and retains encrypted pending changes for authenticated sync.</p>
      </EhrDrawer>
    </div>
  )
}
