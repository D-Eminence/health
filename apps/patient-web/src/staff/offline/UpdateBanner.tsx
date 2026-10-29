import { Button } from '@hid/ui'
import { UPDATE } from './copy'
import { useShellUpdate } from './shellUpdateAdapter'

/**
 * Says a new version of Health ID is ready, and never reloads by itself (§2.12 "Update"). Update now waits while a
 * form has unsaved changes (`formsDirty`) or a change is being sent in any tab.
 */
export function UpdateBanner({ formsDirty = false }: { formsDirty?: boolean }) {
  const shell = useShellUpdate()
  if (shell.updatedElsewhere) return <div className="staff-notice offline-update" role="status">
    <span>{UPDATE.otherTab}</span> <Button size="sm" tone="secondary" onClick={shell.reload}>{UPDATE.reload}</Button></div>
  if (!shell.ready) return null
  const waiting = formsDirty ? UPDATE.waitForms : shell.sending ? UPDATE.waitSending : ''
  return <div className="staff-notice offline-update" role="status">
    <span>{UPDATE.ready}</span>
    <Button size="sm" onClick={shell.update} disabled={waiting !== ''} aria-describedby={waiting ? 'offline-update-wait' : undefined}>{UPDATE.button}</Button>
    {waiting && <span id="offline-update-wait" className="staff-muted">{waiting}</span>}
  </div>
}
