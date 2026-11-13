import { ExternalLink, IdCard } from 'lucide-react'
import { Button, Card, CardHeader } from '../../../kasuwa/ui'
import { QrCode } from '../../../mfa/OtpauthQr'
import { patientSignUpHref } from '../../../productSites'

/**
 * "Get a Health ID now" (outreach event of 14 November 2026): after a registration is saved, and on its case view, the
 * patient sign-up on the main site as a QR code for the person's own phone, the same link to open on this phone, and the
 * steps. Where Outreach can make the Health ID itself (CreateHealthId.tsx), this is only the fallback. The address is the sign-up's
 * alone (productSites.ts patientSignUpHref): the same for everyone, with nothing about the person in it, so neither the
 * QR code nor the link can carry their name, phone number or temporary ID anywhere.
 */
export function GetHealthIdNow({ id, fallback = false }: {
  /** Unique on the page, for the heading and the hint ids. */
  readonly id: string
  /**
   * Where the team can create the Health ID itself (CreateHealthId.tsx): the sign-up is only the fallback, a small
   * "Or they can sign up on their own phone" that opens to the same QR code, link and steps.
   */
  readonly fallback?: boolean
}) {
  const href = patientSignUpHref()
  const headingId = `${id}-heading`
  const newTabId = `${id}-new-tab`
  const content = (
      <div className="flex flex-col gap-4 p-5 @md:flex-row @md:items-start">
        <QrCode text={href} label="QR code that opens the Health ID sign-up page" size={220}
          className="block aspect-square h-auto w-full max-w-[220px] shrink-0 self-center rounded-lg ring-1 ring-line @md:self-start" />
        <div className="flex min-w-0 flex-col gap-3">
          <ol className="m-0 flex flex-col gap-2 pl-5 text-body text-ink">
            <li>Scan with their phone camera.</li>
            <li>They enter their name, email address and phone number, choose a password, and type in the code sent to their email.</li>
            <li>Their Health ID appears on screen. Write it on their slip.</li>
          </ol>
          {fallback ? null : <p className="m-0 text-body text-ink-2"><strong>They own their Health ID.</strong> Your team can’t create it for them.</p>}
          <div className="flex flex-col items-start gap-1">
            <Button href={href} variant="primary" size="lg" icon={ExternalLink} aria-describedby={newTabId}>Open sign-up on this phone</Button>
            <span id={newTabId} className="text-caption text-ink-3">Opens in a new tab.</span>
          </div>
        </div>
      </div>
  )
  if (fallback) {
    return (
      <details id={id} className="rounded-xl bg-surface ring-1 ring-line">
        <summary className="cursor-pointer px-5 py-3 text-body font-medium text-brand-ink">Or they can sign up on their own phone</summary>
        {content}
      </details>
    )
  }
  return (
    <Card aria-labelledby={headingId}>
      <CardHeader as="h2" titleId={headingId} icon={IdCard} iconTone="brand" title="Get a Health ID now"
        description="If they have a phone with internet, they can get their own Health ID before they leave." />
      {content}
    </Card>
  )
}
