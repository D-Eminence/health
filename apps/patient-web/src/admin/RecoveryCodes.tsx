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
export function RecoveryCodes({ codes, onDone, doneLabel = 'Continue', headingAs = 'h2' }: {
  codes: readonly string[]; onDone: () => void; doneLabel?: string
  /** 'h1' where the codes are the page itself (sign-in's last step, which has no other title). */
  headingAs?: 'h1' | 'h2'
}) {
  return <SharedRecoveryCodes codes={codes} onDone={onDone} doneLabel={doneLabel} limits="They cannot confirm high-risk actions."
    fileName="hid-admin-recovery-codes.txt" headingId="admin-recovery-title" headingAs={headingAs} classNames={CLASS_NAMES} Button={AdminButton} />
}
