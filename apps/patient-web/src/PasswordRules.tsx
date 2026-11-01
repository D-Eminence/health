import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import './passwordRules.css'

/**
 * The rules a new password must meet, ticked as they are met while the person types.
 *
 * Only the rules the server checks are listed: 12 to 256 characters (the fields'
 * maxLength already stops a longer one), and, where the form has a second field,
 * that the two match. The server stays the judge; this only shows progress.
 *
 * Give the field aria-describedby={id}, so the list is read with it. Each rule
 * says "done" or "not yet" in text as well as by its icon and colour. A rule that
 * becomes met is announced politely once the person pauses, never on every key.
 */
export const PASSWORD_MIN_LENGTH = 12

export interface PasswordRulesProps {
  /** The list's id, which the password field names in its aria-describedby. */
  readonly id: string
  readonly password: string
  /** The second ("confirm") field's value, where the form has one: adds "Passwords match". */
  readonly confirm?: string
  /** Show the short tip under the rules. */
  readonly tip?: boolean
  readonly className?: string
}

interface Rule { readonly key: string; readonly label: string; readonly met: boolean }

export function passwordRules(password: string, confirm?: string): readonly Rule[] {
  const rules: Rule[] = [{ key: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: password.length >= PASSWORD_MIN_LENGTH }]
  if (confirm !== undefined) rules.push({ key: 'match', label: 'Passwords match', met: confirm.length > 0 && confirm === password })
  return rules
}

/** How long typing must pause before a newly met rule is announced. */
const ANNOUNCE_DELAY_MS = 700

export function PasswordRules({ id, password, confirm, tip = true, className }: PasswordRulesProps) {
  const rules = passwordRules(password, confirm)
  const [announcement, setAnnouncement] = useState('')
  const previous = useRef<Record<string, boolean> | null>(null)
  const pending = useRef<string[]>([])

  // Debounced: each key press restarts the wait, so a rule met mid-word is read once the person pauses.
  useEffect(() => {
    const now = passwordRules(password, confirm)
    const before = previous.current
    previous.current = Object.fromEntries(now.map(rule => [rule.key, rule.met]))
    if (before) {
      for (const rule of now) {
        if (rule.met && before[rule.key] === false && !pending.current.includes(rule.label)) pending.current.push(rule.label)
        if (!rule.met) pending.current = pending.current.filter(label => label !== rule.label)
      }
    }
    if (pending.current.length === 0) return
    const timer = window.setTimeout(() => {
      setAnnouncement(pending.current.map(label => `${label}: done.`).join(' '))
      pending.current = []
    }, ANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [password, confirm])

  return (
    <div className={['password-rules', className].filter(Boolean).join(' ')}>
      <div id={id}>
        <ul className="password-rules-list">
          {rules.map(rule => (
            <li key={rule.key} className="password-rule" data-met={rule.met || undefined}>
              <span className="password-rule-mark" aria-hidden="true">
                {rule.met ? <Check size={14} strokeWidth={3} /> : <span className="password-rule-dot" />}
              </span>
              <span>{rule.label}<span className="password-rules-sr">{rule.met ? ' (done)' : ' (not yet)'}</span></span>
              {/* Keeps the words apart where the list is read as one description. */}
              {' '}
            </li>
          ))}
        </ul>
        {tip && <p className="password-rules-tip">Tip: a few words together is easy to remember.</p>}
      </div>
      <p className="password-rules-sr" aria-live="polite" data-testid={`${id}-status`}>{announcement}</p>
    </div>
  )
}
