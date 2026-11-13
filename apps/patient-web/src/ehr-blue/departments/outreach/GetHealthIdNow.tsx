import { IdCard } from 'lucide-react'
import { Card, CardHeader } from '../../../kasuwa/ui'
import { QrCode } from '../../../mfa/OtpauthQr'
import { patientSignUpHref } from '../../../productSites'

/** For anyone under 18, in place of the steps: the Terms allow under-18s with a parent's or guardian's agreement. */
export const GUARDIAN_MUST_AGREE = 'A parent or guardian must agree. They can make it with them on their phone, now or later.'

/** While the registration waits on this device: the team creates the Health ID from its case view once it is sent. */
export const OPEN_WHEN_SENT = 'Once this registration is sent, open it to create their Health ID.'

/**
 * "Get a Health ID now" (outreach event of 14 November 2026): after a registration is saved, and on its case view, the
 * patient sign-up on the main site as a QR code for the person's own phone, the same link to open on this phone, and the
 * steps. Where Outreach can make the Health ID itself (CreateHealthId.tsx), this is only the fallback. The address is the sign-up's
 * alone (productSites.ts patientSignUpHref): the same for everyone, with nothing about the person in it, so neither the
 * QR code nor the link can carry their name, phone number or temporary ID anywhere.
 */
export function GetHealthIdNow({ id, fallback = false, queued = false, ageYears }: {
  /** Unique on the page, for the heading and the hint ids. */
  readonly id: string
  /**
   * The person's age, when known. Under 18, a parent or guardian must agree (the Terms), so the steps addressed to the
   * person give way to a line saying so; the QR code stays, for the parent or guardian's phone.
   */
  readonly ageYears?: number
  /**
   * Where the team can create the Health ID itself (CreateHealthId.tsx): the sign-up is only the fallback, a small
   * "Or, instead, they can sign up on their own phone" that opens to the same QR code, link and steps, and says to use one
   * way only.
   */
  readonly fallback?: boolean
  /**
   * Shown while the registration waits on this device (an outreach group's, where the team can create the Health ID once
   * it is sent): that is said instead of "Your team can't create it for them". Not judged from the registration list,
   * which a page opened with no signal has not read.
   */
  readonly queued?: boolean
}) {
  const href = patientSignUpHref()
  const headingId = `${id}-heading`
  const minor = typeof ageYears === 'number' && ageYears < 18
  const content = (
      <div className="flex flex-col gap-4 p-5 @md:flex-row @md:items-start">
        <QrCode text={href} label="QR code that opens the Health ID sign-up page" size={220}
          className="block aspect-square h-auto w-full max-w-[220px] shrink-0 self-center rounded-lg ring-1 ring-line @md:self-start" />
        <div className="flex min-w-0 flex-col gap-3">
          {minor ? <p className="m-0 text-body text-ink">{GUARDIAN_MUST_AGREE}</p> : (
            <ol className="m-0 flex flex-col gap-2 pl-5 text-body text-ink">
              <li>Scan with their phone camera.</li>
              <li>They enter their name, email address and phone number, choose a password, and type in the code sent to their email.</li>
              <li>Their Health ID appears on screen. Write it on their slip.</li>
            </ol>
          )}
          {fallback ? null : queued
            // Not for under-18s: a Health ID can't be created for them at outreach.
            ? minor ? null : <p className="m-0 text-body text-ink-2">{OPEN_WHEN_SENT}</p>
            : <p className="m-0 text-body text-ink-2"><strong>They own their Health ID.</strong> Your team can’t create it for them.</p>}
          {/* Both ways would make two Health IDs for one person. Not for under-18s, who are not offered Create Health ID. */}
          {fallback && !minor ? <p className="m-0 text-body text-ink-2">Use one way only: if they sign up on their phone, don’t press Create Health ID.</p> : null}
          <p className="m-0 text-body text-ink-2">Let them use their own phone. Don’t open sign-up on yours: they would type their password on your device.</p>
        </div>
      </div>
  )
  if (fallback) {
    return (
      <details id={id} className="rounded-xl bg-surface ring-1 ring-line">
        <summary className="cursor-pointer px-5 py-3 text-body font-medium text-brand-ink">Or, instead, they can sign up on their own phone</summary>
        {content}
      </details>
    )
  }
  return (
    <Card aria-labelledby={headingId}>
      <CardHeader as="h2" titleId={headingId} icon={IdCard} iconTone="brand" title="Get a Health ID now"
        description="If they have a phone with internet and an email address, they can get their own Health ID before they leave." />
      {content}
    </Card>
  )
}
