import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CircleCheck, Clock, Eye, Lock, Mail, TriangleAlert } from 'lucide-react'
import { Alert, Button, Card, Field, cx } from '../kasuwa/ui'
import { FormPage, PageState } from '../kasuwa/parts'
import { WORDS } from '../copy'
import { InputR } from './profileParts'
import { useSession } from '../session'
import { describedBy, useDocumentTitle, useStepFocus } from '../authSteps'
import { cardSharesEnabled } from '../cardSharesFlag'
import { PERSON_NAME, inviteEmailProblem } from '../shareRecords'
import {
  CARD_SHARE_CONSENT_VERSION, CARD_SHARE_DURATIONS, CARD_SHARE_SCOPES, cardShareDurationLabel, cardShareProblem, emailTypoSuggestion,
  type CardShareCreated, type CardShareScope,
} from '../cardShares'
import { useCardShareList } from './SharedCardLinks'

/**
 * Send my card by email (step 8, hid-system 0118): /access/share/card. Offered only while the build's switch is on and
 * the backend serves card links (its list answers 200); otherwise it opens Access and sharing, as today.
 *
 * Who (the address, a private label, card only or card and records, 24 hours or 7 days), then Check and send, which is
 * the patient's consent: it says what is shared, that records added while the link is open are included, that the
 * person can keep a copy of what they see, that anyone who can read that inbox can open it, and that an earlier link to
 * the same address ends. Its wording is versioned (CARD_SHARE_CONSENT_VERSION) and sent with the link. Email only: there
 * is never a link to copy (owner answer 3).
 */
type Step = 'who' | 'check' | 'done'

/** One key per send, kept while what it sends is the same, so sending again is answered as a replay. */
function useIdempotencyKey() {
  const held = useRef<{ body: string; key: string } | null>(null)
  return useCallback((body: unknown) => {
    const signature = JSON.stringify(body)
    if (held.current?.body !== signature) held.current = { body: signature, key: crypto.randomUUID() }
    return held.current.key
  }, [])
}

const until = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }).format(new Date(iso))

export function ShareCard() {
  useDocumentTitle('Send my card · Health ID')
  const links = useCardShareList()
  if (!cardSharesEnabled()) return <Navigate to="/access" replace />
  if (links.data === null && !links.loading && !links.error) return <Navigate to="/access" replace />
  return <FormPage title="Send my card" back={{ to: '/access', label: `Back to ${WORDS.accessPage}` }}>
    <PageState what="your shared links" loading={links.data === null && links.loading} error={links.data ? null : links.error} hasData={false} onRetry={() => void links.reload()} rows={2}>
      {links.data ? <SendFlow live={links.data.items.filter(item => item.status === 'active' || item.status === 'locked').map(item => item.recipientEmail?.toLowerCase() ?? '')}
        onSent={() => void links.reload()} /> : null}
    </PageState>
  </FormPage>
}

/**
 * The email the person gets (E5), as it will look: the link and a reference, and nothing about the patient (D1). The
 * reference is made when the link is sent; the patient sees it in their list.
 */
export function CardLinkEmailPreview({ to }: { to: string }) {
  return <figure className="m-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-line" aria-label={`Preview of the email ${to} receives`}>
    <div className="flex flex-col gap-0.5 border-b border-line bg-subtle px-4 py-3 text-[12px] text-ink-3">
      <p className="m-0"><span className="text-ink-2">From</span> Health ID</p>
      <p className="m-0 text-[13px] font-semibold text-ink">A Health ID card has been shared with you</p>
    </div>
    <div className="flex flex-col gap-3 bg-[#f5f7fa] px-4 py-5 text-[13px] text-ink-2 [&_p]:m-0">
      <p>Someone has shared their Health ID card with you. You can look at it, but you can’t change anything.</p>
      <span className="inline-flex h-10 items-center self-start rounded-[10px] bg-brand-fill px-5 text-sm font-semibold text-white">Open the card</span>
      <p>When you open it, we’ll email a 6-digit code to this address. Anyone who opens this link can ask for a code, but the code comes only to this inbox.</p>
      <p>Reference: a short code like K7P2-QX9M. The person who shared it can see it, so you can check with them that it’s really from them.</p>
      <p>The link works until the time you choose, or until they end it. Please don’t forward this email.</p>
      <p className="text-[12px] text-ink-3">If you weren’t expecting this, you can ignore it, or use Stop these emails. How we use your email address.</p>
    </div>
  </figure>
}

function SendFlow({ live, onSent }: { live: string[]; onSent: () => void }) {
  const { api } = useSession()
  const [step, setStep] = useState<Step>('who')
  const [email, setEmail] = useState('')
  const [label, setLabel] = useState('')
  const [scope, setScope] = useState<CardShareScope>('card_and_records')
  const [duration, setDuration] = useState<'24h' | '7d'>('24h')
  const [emailProblem, setEmailProblem] = useState<string | null>(null)
  const [labelProblem, setLabelProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<(CardShareCreated & { email: string }) | null>(null)
  const stepFocus = useStepFocus()
  const errorFocus = useStepFocus()
  const fieldFocus = useStepFocus()
  const key = useIdempotencyKey()
  const go = (next: Step) => { setStep(next); setError(null); stepFocus.focus() }
  // The first step's heading takes focus as the flow opens, as each later step's does.
  const { focus: focusStep } = stepFocus
  useEffect(() => { focusStep() }, [focusStep])
  const address = email.trim(), who = label.trim()
  const replaces = live.includes(address.toLowerCase())

  const toCheck = (event: FormEvent) => {
    event.preventDefault()
    const badEmail = inviteEmailProblem(address) ? 'Enter an email address like name@example.com.' : null
    const badLabel = who && (who.length > 80 || !PERSON_NAME.test(who)) ? 'Use letters, spaces, apostrophes, dots or hyphens for who this is.' : null
    setEmailProblem(badEmail); setLabelProblem(badLabel)
    if (badEmail || badLabel) { fieldFocus.focus(); return }
    go('check')
  }

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const body = { email: address, ...(who ? { label: who } : {}), scope, duration, consentVersion: CARD_SHARE_CONSENT_VERSION }
    setBusy(true); setError(null)
    try {
      const answer = await api.createCardShare(body, key(body))
      setSent({ ...answer, email: address })
      onSent()
      go('done')
    } catch (cause) {
      setError(cardShareProblem(cause, 'Your card could not be sent. Please try again.'))
      errorFocus.focus()
    } finally { setBusy(false) }
  }

  const startAgain = () => { setSent(null); setEmail(''); setLabel(''); setScope('card_and_records'); setDuration('24h'); go('who') }

  const heading = (text: string, hint?: ReactNode) => <div className="flex flex-col gap-1">
    <h2 ref={stepFocus.target} tabIndex={-1} className="m-0 text-title-2 text-ink outline-none">{text}</h2>
    {hint && <p className="m-0 text-[13px] text-ink-3">{hint}</p>}
  </div>
  const alert = error && <div ref={errorFocus.target} tabIndex={-1} className="outline-none"><Alert intent="error" size="sm">{error}</Alert></div>
  const frame = (name: string, body: ReactNode, footer: ReactNode) => <Card key={name} as="div" className="overflow-visible!">
    <div className="flex flex-col gap-5 p-5">{body}</div>
    <div data-form-actions="" className="flex flex-col gap-2 rounded-b-xl border-t border-line bg-surface px-5 py-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto max-sm:sticky max-sm:bottom-[calc(64px+env(safe-area-inset-bottom))] max-sm:z-[var(--z-sticky)] max-sm:[:root:has(.hid-chat-launcher)_&]:pr-[60px]">{footer}</div>
  </Card>

  if (step === 'who') return frame('who', <form id="card-who" noValidate onSubmit={toCheck} className="flex flex-col gap-5">
    {heading('Send your card by email', 'For a doctor, a relative, a friend: anyone with an email address. They don’t need a Health ID.')}
    <Field label="Their email address" htmlFor="card-email" hintId="card-email-hint"
      hint="We’ll email them a link. To open it, they need a code we send to this address. Check it carefully."
      errorId="card-email-problem" error={emailProblem ?? undefined}>
      <InputR id="card-email" ref={emailProblem || !labelProblem ? fieldFocus.target : undefined} type="email" value={email} maxLength={254} autoComplete="off"
        aria-invalid={emailProblem ? true : undefined} aria-describedby={describedBy('card-email-hint', emailProblem && 'card-email-problem')}
        onChange={event => setEmail(event.target.value)} />
    </Field>
    <Field label="Who is this?" optional htmlFor="card-label" hintId="card-label-hint" hint="Only you see this. It isn’t put in any email."
      errorId="card-label-problem" error={labelProblem ?? undefined}>
      <InputR id="card-label" ref={labelProblem && !emailProblem ? fieldFocus.target : undefined} value={label} maxLength={80} autoComplete="off"
        aria-invalid={labelProblem ? true : undefined} aria-describedby={describedBy('card-label-hint', labelProblem && 'card-label-problem')}
        onChange={event => setLabel(event.target.value)} />
    </Field>
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-[13px] font-medium text-ink-2">What they’ll see</legend>
      {CARD_SHARE_SCOPES.map(option => { const on = scope === option.value
        return <label key={option.value} className={cx(TILE, on ? TILE_ON : TILE_OFF)}>
          <input type="radio" name="card-scope" value={option.value} checked={on} onChange={() => setScope(option.value)} className="mt-1 shrink-0" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">{option.label}</span>
            <span className="block text-[13px] text-ink-3">{option.description}</span></span>
        </label> })}
    </fieldset>
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 p-0 text-[13px] font-medium text-ink-2">How long</legend>
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-tray p-1.5">
        {CARD_SHARE_DURATIONS.map(option => { const on = duration === option.value
          return <label key={option.value} className={cx('flex min-h-11 cursor-pointer items-center justify-center rounded-xl px-2 py-2 text-center text-[13px] font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand',
            on ? 'bg-surface text-brand-ink shadow-[var(--shadow-xs)] ring-[1.5px] ring-brand' : 'text-ink-2 hover:bg-surface/70')}>
            <input type="radio" name="card-duration" value={option.value} checked={on} onChange={() => setDuration(option.value)} className="sr-only" />
            {option.label}
          </label> })}
      </div>
    </fieldset>
    <p className="m-0 flex gap-2 text-[13px] text-ink-3"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />Read only. They can’t change anything.</p>
  </form>, <><Button to="/access" variant="ghost">Cancel</Button>
    <Button type="submit" form="card-who" variant="primary" iconRight={ArrowRight}>Continue</Button></>)

  if (step === 'check') {
    const typo = emailTypoSuggestion(address)
    return frame('check', <form id="card-check" onSubmit={event => void send(event)} className="flex flex-col gap-5">
      {heading('Check and send')}
      <div className="flex flex-col gap-1 rounded-xl p-4 ring-1 ring-line">
        <span className="text-[12px] text-ink-3">Sending to</span>
        <p className="m-0 text-title-2 [overflow-wrap:anywhere] text-ink">{address}</p>
        {who && <span className="text-[13px] text-ink-3">{who} (only you see this)</span>}
        {typo && <p className="m-0 mt-1 flex gap-2 text-[13px] text-warn-ink"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />Did you mean {typo}? Check the address before you send.</p>}
      </div>
      <dl className="m-0 divide-y divide-line rounded-xl ring-1 ring-line">
        <div className="flex items-start gap-3 px-4 py-3"><Eye className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><div className="min-w-0 flex-1"><dt className="text-[12px] text-ink-3">What they’ll see</dt>
          <dd className="m-0 text-sm text-ink">{scope === 'card'
            ? 'They’ll see your Health ID card: your name, Health ID, photo, blood group, genotype and allergies. Not your records.'
            : 'They’ll see your Health ID card, your visits, signed notes, older records, the health information you entered and the records you added.'}</dd>
          {scope === 'card_and_records' && <dd className="m-0 mt-1 text-[13px] text-warn-ink">They’ll also see anything added to your record until the link ends.</dd>}</div></div>
        <div className="flex items-start gap-3 px-4 py-3"><Clock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><div className="min-w-0 flex-1"><dt className="text-[12px] text-ink-3">How long</dt>
          <dd className="m-0 text-sm font-medium text-ink">{cardShareDurationLabel(duration)}</dd></div></div>
      </dl>
      {replaces && <p className="m-0 text-[13px] font-medium text-ink">This ends the link you sent to this address before.</p>}
      <p className="m-0 text-[13px] text-ink-2">They can’t change anything, but they can save, print or screenshot what they see. Ending the link stops new views; it can’t take back what they’ve already seen. Anyone who can read that inbox can open your card.</p>
      <p className="m-0 flex gap-2 text-[13px] text-ink-3"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />Each time it’s opened, you’ll be told.</p>
      <details className="group rounded-xl ring-1 ring-line">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[13px] font-semibold text-brand-ink [&::-webkit-details-marker]:hidden">
          <Mail className="size-4" aria-hidden />See the email they get</summary>
        <div className="border-t border-line p-3"><CardLinkEmailPreview to={address} /></div>
      </details>
      <a href="/card/preview" className="text-[13px] font-semibold text-brand-ink">See what they’ll see</a>
      {alert}
    </form>, <><Button disabled={busy} onClick={() => go('who')} icon={ArrowLeft}>Back</Button>
      <Button type="submit" form="card-check" variant="primary" icon={Mail} loading={busy} disabled={busy}>{busy ? 'Sending…' : 'Send my card'}</Button></>)
  }

  if (step === 'done' && sent) return frame('done', <div className="flex flex-col items-center gap-3 py-4 text-center">
    <span className="inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success-ink"><CircleCheck className="size-7" aria-hidden /></span>
    {heading('Your card link is on its way')}
    <p className="m-0 max-w-md text-sm text-ink-2">Your card link is on its way to {sent.email}. It works until {until(sent.share.expiresAt)}, or until you end it. You’ll be told each time it’s opened.</p>
    {sent.replacedId && <p className="m-0 text-[13px] text-ink-3">The link you sent to this address before has ended.</p>}
    {(sent.delivery === 'not_sent' || sent.delivery === 'failed') && <p className="m-0 text-[13px] text-warn-ink">We aren’t sure the email arrived. You can end this link and send a new one tomorrow.</p>}
    <p className="m-0 text-[13px] text-ink-3">We’ve also emailed you to say a card link was sent, so you’ll know if anyone else sends one.</p>
    <p className="m-0 text-[13px] text-ink-3">Reference {sent.share.reference}. They see it in the email too.</p>
  </div>, <><Button onClick={startAgain}>Send to someone else</Button>
    <Button to="/access?tab=granted" variant="primary">See your shared links</Button></>)

  return frame('lost', null, <Button onClick={startAgain}>Start again</Button>)
}

const TILE = 'flex cursor-pointer items-start gap-3 rounded-xl p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand'
const TILE_ON = 'bg-brand-soft ring-[1.5px] ring-brand'
const TILE_OFF = 'bg-surface ring-1 ring-line hover:bg-subtle'
