import type { ButtonHTMLAttributes } from 'react'
import { RecoveryCodes as SharedRecoveryCodes } from '../mfa/RecoveryCodes'

const CLASS_NAMES = { root: 'admin-recovery', list: 'admin-recovery-codes', actions: 'admin-action-row',
  success: 'admin-success', error: 'admin-error', checkbox: 'admin-checkbox' }

function AdminButton({ primary, ...rest }: { primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={primary ? 'admin-primary' : 'admin-secondary'} {...rest} />
}

/**
 * Shows recovery codes the backend returned, once. They live only in the
 * caller's state and are discarded when the administrator continues.
 */
export function RecoveryCodes({ codes, onDone, doneLabel = 'Continue' }: {
  codes: readonly string[]; onDone: () => void; doneLabel?: string
}) {
  return <SharedRecoveryCodes codes={codes} onDone={onDone} doneLabel={doneLabel} limits="They cannot confirm high-risk actions."
    fileName="hid-admin-recovery-codes.txt" headingId="admin-recovery-title" classNames={CLASS_NAMES} Button={AdminButton} />
}
