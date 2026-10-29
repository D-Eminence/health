import { Button } from '@hid/ui'
import { UPDATE } from './copy'
import { useShellUpdate } from './shellUpdateAdapter'

/**
 * Says a new version of Health ID is ready, and never reloads by itself (§2.12 "Update"). Update now is enabled only
 * while the shell says it can update (`canUpdate`, A9): no form has unsaved changes and nothing is being sent in any
 * tab. The update reloads this tab, so a form in progress would be lost.
 */
export function UpdateBanner() {
  const shell = useShellUpdate()
  if (shell.updatedElsewhere) return <div className="staff-notice offline-update" role="status">
    <span>{UPDATE.otherTab}</span> <Button size="sm" tone="secondary" onClick={shell.reload}>{UPDATE.reload}</Button></div>
  if (!shell.ready) return null
  const waiting = shell.sending ? UPDATE.waitSending : !shell.canUpdate ? UPDATE.waitForms : ''
  return <div className="staff-notice offline-update" role="status">
    <span>{UPDATE.ready}</span>
    <Button size="sm" onClick={shell.update} disabled={!shell.canUpdate} aria-describedby={waiting ? 'offline-update-wait' : undefined}>{UPDATE.button}</Button>
    {waiting && <span id="offline-update-wait" className="staff-muted">{waiting}</span>}
  </div>
}
