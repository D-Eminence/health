/**
 * The standard way a Health ID application reports a failed request.
 *
 * Only plain English is shown (owner's rule, 1 Nov 2026): plainErrorText's words for the failure, or the caller's own
 * `fallback`. Never the server's text, a code, a status number, a correlation id or a JavaScript message, so a failure
 * cannot put internal or clinical detail on screen, or into a screenshot pasted into a support ticket. The
 * correlation id stays in the logs (HidApiError.toLogContext), where support finds it.
 */

import type { ReactNode } from 'react'
import { HidApiError, plainErrorText } from '@hid/http'

export interface ErrorStateProps {
  readonly error: unknown
  /** The caller's own plain sentence for what failed. */
  readonly fallback?: string
  /** Shown when the failure is retryable. */
  readonly onRetry?: () => void
  readonly children?: ReactNode
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again. If it keeps happening, contact Health ID support.'

/** A plain sentence for the failure. Never the error's own message, code or details. */
export function toDisplayMessage(error: unknown, fallback: string = GENERIC_MESSAGE): string {
  return plainErrorText(error, fallback)
}

export function ErrorState({ error, fallback, onRetry, children }: ErrorStateProps) {
  const apiError = error instanceof HidApiError ? error : null
  const canRetry = apiError?.retryable === true && onRetry !== undefined

  return (
    <div
      role="alert"
      aria-live="polite"
      className="rounded-(--radius-card) border-[0.5px] border-line-strong bg-surface-sunk p-4"
    >
      <p className="text-[15px] leading-[1.45] text-ink">{toDisplayMessage(error, fallback)}</p>

      {children}

      {canRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex h-[38px] items-center rounded-(--radius-button) border border-brand bg-brand px-3.5 text-[14px] font-semibold text-white transition-colors duration-150 hover:border-brand-hover hover:bg-brand-hover active:border-brand-active active:bg-brand-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}
