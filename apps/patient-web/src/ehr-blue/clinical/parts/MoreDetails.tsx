import type { ReactNode } from 'react'

/**
 * A closed "More details" line under a plain name, holding what a clinician may still want but the screen does not lead
 * with: a diagnosis's ICD-10 code, a test's LOINC code, a medicine's route code (owner decision 33.4). It opens with a
 * click or the keyboard (a native disclosure). `about` names the record for a screen reader, as several sit on one page.
 */
export function MoreDetails({ about, children }: { readonly about?: string; readonly children: ReactNode }) {
  return (
    <details className="hid-ehr-more-details text-[13px] text-ink-3">
      <summary className="w-fit cursor-pointer rounded font-medium text-ink-2">
        More details{about ? <span className="sr-only">: {about}</span> : null}
      </summary>
      <div className="mt-1 flex flex-col gap-0.5">{children}</div>
    </details>
  )
}

/** A code with its coding system, as a clinician reads it: "ICD-10 J45". Empty when there is no code. */
export function codeText(system: string | null | undefined, code: string | null | undefined): string {
  const value = code?.trim() ?? ''
  return value ? [system?.trim(), value].filter(Boolean).join(' ') : ''
}
