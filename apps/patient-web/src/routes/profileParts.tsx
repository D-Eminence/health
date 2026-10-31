import type { ComponentProps, ReactNode, Ref } from 'react'
import { RotateCcw } from 'lucide-react'
import { Alert, Button, Input, Select, Textarea, buttonClass, cx } from '../kasuwa/ui'

/*
 * The shared controls, typed to take a ref: React 19 passes `ref` to a function component as a prop, and each of these
 * spreads its other props onto its element, so the ref reaches the <input>, <select>, <textarea> or <button>. Focus
 * management (useStepFocus, useActionFocus) needs it.
 */
export const InputR = Input as (props: ComponentProps<typeof Input> & { ref?: Ref<HTMLInputElement> }) => ReactNode
export const SelectR = Select as (props: ComponentProps<typeof Select> & { ref?: Ref<HTMLSelectElement> }) => ReactNode
export const TextareaR = Textarea as (props: ComponentProps<typeof Textarea> & { ref?: Ref<HTMLTextAreaElement> }) => ReactNode
export const ButtonR = Button as (props: ComponentProps<typeof Button> & { ref?: Ref<HTMLButtonElement> }) => ReactNode

/*
 * The few lines every profile card says the same way, built from the shared parts (kasuwa/ui.tsx): a hint, a problem, a
 * saved notice, and a read that failed with its Try again. Kept here so each card says them in one shape.
 */

/** A short line of help under a heading or a form. */
export function Hint({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return <p id={id} className={cx('m-0 text-[13px] text-ink-3', className)}>{children}</p>
}

/** What went wrong, said where it happened. An alert only where focus could not move to it (`alert`). */
export function Problem({ id, alert = true, children }: { id?: string; alert?: boolean; children: ReactNode }) {
  return <Alert id={id} intent="error" size="sm" live={alert}>{children}</Alert>
}

/** What a save changed, in a live region mounted throughout, so each new one is read out. */
export function Saved({ children }: { children?: ReactNode }) {
  return <div role="status" className="empty:hidden">{children ? <Alert intent="success" size="sm" live={false}>{children}</Alert> : null}</div>
}

/** A read that failed, with Try again; `buttonRef` is useRetryFocus's, so focus comes back to it or to what loaded. */
export function LoadProblem({ what, error, onRetry, buttonRef, name }: {
  what: string; error: string; onRetry: () => void; buttonRef?: Ref<HTMLButtonElement>; name?: ReactNode
}) {
  return <Alert intent="error" size="sm" title={`Couldn’t load ${what}`}
    action={<button ref={buttonRef} type="button" onClick={onRetry} className={buttonClass({ size: 'sm' })}>
      <RotateCcw className="size-3.5" aria-hidden />Try again{name ? <> {name}</> : null}</button>}>{error}</Alert>
}

/** Buttons in a row that wraps on a phone. */
export function Actions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex flex-wrap items-center gap-2', className)}>{children}</div>
}
