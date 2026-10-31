import { useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BadgeCheck, Camera, CircleAlert, Share2, Trash2, UserRound } from 'lucide-react'
import logoSrc from '../../../public-web/public/brand/logo.png'
import markSrc from '../../../public-web/public/brand/logo-icon.png'
import { isHidApiError } from '@hid/http'
import type { PatientProfile } from '../api'
import { Drawer } from '../kasuwa/interactive'
import { useToast } from '../kasuwa/toast'
import { Button, IconChip, cx } from '../kasuwa/ui'
import { PHOTO_SIDE, PhotoProblem, base64Of, reencodePhoto } from '../photoImage'
import { useAnnounceProfileChange } from '../profileChange'
import { useSession } from '../session'
import { HealthIdCode } from './HealthIdCode'
import { initialsOf, useObjectUrl, usePatientPhoto } from './ProfilePhoto'

/**
 * The patient's Health ID as the card they would carry: a bank-card shape (ISO ID-1, 85.6 × 54 mm) in the brand blue, the
 * Health ID logo reversed out in white, on a gradient from Health ID blue to black, with the detail of a premium card: fine
 * engraving, a micro-text frame, a chip, and the holder's portrait in an engraved medallion. It leans toward the pointer
 * with a moving light, and sways and catches a sheen when idle. On it, what a front desk or an
 * emergency team asks first: the photo, the name, the ID (large, copyable) and, when the patient has added them, blood
 * group and genotype. It opens every page about the patient (Home, Profile), first on a phone.
 *
 * The photo is the photo control (as on hid-1.0): tapping it picks a JPEG or PNG, drawn afresh as a square JPEG on this
 * page (photoImage.ts, so nothing the file held is sent), shown in a drawer to save. A "Change photo" pill on the
 * medallion says so. The actions sit under the card, not on it, so the card reads as a card. `links` leaves out the link
 * to the page it is on; Profile passes none.
 */
export function HealthIdCard({ profile, verified, bloodGroup, genotype, allergies, shareTo, links = ['share', 'profile'], sharePrimary = true, onChanged, className }: {
  profile: PatientProfile
  verified: boolean | null
  bloodGroup?: string | null
  genotype?: string | null
  allergies?: string | null
  shareTo: string
  links?: ReadonlyArray<'share' | 'profile'>
  /** Share is the screen's one primary action, unless something else on it is (a request waiting on Home). */
  sharePrimary?: boolean
  /** Reads the profile again after the photo changes. */
  onChanged?: () => Promise<unknown>
  className?: string
}) {
  const editable = typeof profile.hasPhoto === 'boolean'
  const photo = usePatientPhoto(profile.hasPhoto === true)
  const picker = useRef<HTMLInputElement>(null)
  const [prepared, setPrepared] = useState<Blob | null>(null)
  const preview = useObjectUrl(prepared)
  const [busy, setBusy] = useState<'preparing' | 'saving' | 'removing' | null>(null)
  const [open, setOpen] = useState(false)
  const { api } = useSession()
  const toast = useToast()
  const announce = useAnnounceProfileChange()
  // "Add a profile photo" (the checklist, the profile's completion) links to ?photo=add: the card's photo takes focus,
  // ringed, one tap from the picker. The address is cleared after.
  const [params, setParams] = useSearchParams()
  const asked = editable && params.get('photo') === 'add'
  useLayoutEffect(() => {
    if (!asked) return
    picker.current?.focus({ preventScroll: true })
    picker.current?.closest('section')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setParams(current => { const next = new URLSearchParams(current); next.delete('photo'); return next }, { replace: true })
  }, [asked, setParams])

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy('preparing'); setOpen(true)
    try { setPrepared(await reencodePhoto(file)) }
    catch (cause) {
      setOpen(false)
      toast.error({ title: 'That picture can’t be used', message: cause instanceof PhotoProblem ? cause.message : 'Choose a JPEG or PNG photo.' })
    } finally { setBusy(null) }
  }
  const close = () => { if (busy === 'saving' || busy === 'removing') return; setOpen(false); setPrepared(null) }
  const save = async () => {
    if (!prepared || busy) return
    setBusy('saving')
    try {
      await api.savePhoto(await base64Of(prepared))
      await onChanged?.(); void photo.reload(); announce()
      // The card shows the new photo: that is the result, so no toast repeats it.
      setOpen(false); setPrepared(null)
    } catch (cause) {
      toast.error({ title: 'Couldn’t save your photo', message: isHidApiError(cause) && cause.code === 'PHOTO_INVALID' ? 'Choose a JPEG or PNG photo.' : isHidApiError(cause) ? cause.message : 'Please try again.' })
    } finally { setBusy(null) }
  }
  const remove = async () => {
    if (busy) return
    setBusy('removing')
    try {
      await api.removePhoto(); photo.forget()
      await onChanged?.(); announce()
      setOpen(false); setPrepared(null)
    } catch (cause) {
      toast.error({ title: 'Couldn’t remove your photo', message: isHidApiError(cause) ? cause.message : 'Please try again.' })
    } finally { setBusy(null) }
  }

  const face = photo.url
    ? <img src={photo.url} alt="" width={PHOTO_SIDE} height={PHOTO_SIDE} className="size-full object-cover" />
    : <span className="text-[5.4cqw] font-light tracking-[.12em] text-white/85" aria-hidden="true">{initialsOf(profile)}</span>
  // Allergies are free text; each one is listed, and the card prints the first with how many more (never cut off silently).
  const allergyList = allergyItems(allergies)
  const facts = cardFacts(bloodGroup, genotype)
  const [allergiesOpen, setAllergiesOpen] = useState(false)

  return <div className={cx('flex flex-col gap-3', className)}>
    <CardFace name={profile.fullName} hid={<HealthIdCode code={profile.hid} />} verified={verified} facts={facts} allergies={allergyList}
      onAllergies={() => setAllergiesOpen(true)} medallion={editable ? <label className="group/photo absolute inset-0 cursor-pointer rounded-full">
        <span className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full bg-[#071a3d] ring-[.5cqw] ring-white/25 group-focus-within/photo:ring-white">{face}</span>
        {/* Seen as a control: a pill that says what it does; the whole medallion (well over 44px) is its target. */}
        <span aria-hidden="true" className="absolute -bottom-[2.6cqw] left-1/2 inline-flex -translate-x-1/2 items-center gap-[1cqw] rounded-full bg-white px-[2.4cqw] py-[1.1cqw] text-[3cqw] leading-none font-semibold whitespace-nowrap text-[#0d3f99] shadow-[0_2px_6px_rgba(2,5,11,.35)] group-hover/photo:bg-[#eef3fb]">
          <Camera className="size-[3.2cqw]" />{photo.url ? 'Change photo' : 'Add photo'}</span>
        <input ref={picker} type="file" accept="image/jpeg,image/png" className="sr-only" disabled={busy !== null}
          aria-label={photo.url ? 'Change the photo on your card' : 'Add a photo to your card'} onChange={event => void choose(event)} />
      </label> : undefined} face={face} />

    {links.length > 0 && <div className="flex gap-2">
      {links.includes('share') && <Button to={shareTo} variant={sharePrimary ? 'primary' : 'secondary'} icon={Share2} className="flex-1">Share records</Button>}
      {links.includes('profile') && <Button to="/profile" icon={UserRound} className="flex-1">View profile</Button>}
    </div>}

    <Drawer open={allergiesOpen} onClose={() => setAllergiesOpen(false)} title={allergyList.length === 1 ? 'Allergy' : `${allergyList.length} allergies`}
      icon={<IconChip icon={CircleAlert} tone="warn" />} description="On your card, and shown to clinicians you share your records with."
      footer={<><Button onClick={() => setAllergiesOpen(false)}>Close</Button><Button to="/profile#health-information" variant="primary" onClick={() => setAllergiesOpen(false)}>Edit allergies</Button></>}>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {allergyList.map(item => <li key={item} className="flex items-center gap-3 rounded-xl bg-warn-soft/50 px-4 py-3 text-sm font-medium [overflow-wrap:anywhere] text-ink ring-1 ring-line">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warn" />{item}</li>)}
      </ul>
    </Drawer>

    <Drawer open={open} onClose={close} title="Your card photo" icon={<IconChip icon={Camera} tone="brand" />}
      description="Clinicians see it when you share your records, so they know it’s you."
      footer={<>
        {photo.url && <Button variant="danger" icon={Trash2} className="mr-auto" loading={busy === 'removing'} disabled={busy !== null} onClick={() => void remove()}>Remove</Button>}
        <Button disabled={busy === 'saving' || busy === 'removing'} onClick={() => picker.current?.click()}>Choose another</Button>
        <Button variant="primary" loading={busy === 'saving'} disabled={!prepared || busy !== null} onClick={() => void save()}>Save photo</Button></>}>
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="relative size-44 overflow-hidden rounded-2xl bg-tray ring-1 ring-line">
          {preview ? <img src={preview} alt="Your new photo, cropped to a square" width={PHOTO_SIDE} height={PHOTO_SIDE} className="size-full object-cover" />
            : <span role="status" className="absolute inset-0 flex items-center justify-center text-[13px] text-ink-3">{busy === 'preparing' ? 'Preparing your photo…' : 'No photo chosen'}</span>}
        </div>
        <p className="m-0 max-w-xs text-center text-[13px] text-ink-3">A clear photo of your face, like a passport photo. It’s cropped to a square, and nothing else from the file is sent.</p>
      </div>
    </Drawer>
  </div>
}

/**
 * The card itself, as it looks wherever it appears: on Home and Profile, in the email a provider receives, and on the page
 * that email opens. Everything on it is sized to its own width (cqw), so it is the same card, in the same proportion
 * (ISO ID-1, 85.6 × 54 mm), at any size. The wrapper sways a little when idle; the card leans toward a mouse and a light
 * follows it (through CSS variables, never React state). `medallion` replaces the portrait with a control (the photo
 * picker); `onAllergies` makes the allergies a button.
 */
export function CardFace({ name, hid, verified, facts, allergies, onAllergies, medallion, face, label = 'Patient card', still = false }: {
  name: string
  hid: ReactNode
  verified: boolean | null
  facts: ReadonlyArray<readonly [string, string]>
  allergies: readonly string[]
  onAllergies?: () => void
  medallion?: ReactNode
  face: ReactNode
  label?: string
  /** No sway, lean or sheen: for a still preview, such as inside an email. */
  still?: boolean
}) {
  const card = useRef<HTMLElement>(null)
  // The card leans toward a mouse or pen, up to a few degrees, and the glare follows; it settles back as the pointer
  // leaves. Not on touch (that would fight scrolling), and not where the person asked for less motion.
  const tilt = (event: React.PointerEvent<HTMLElement>) => {
    const el = card.current
    if (!el || still || event.pointerType === 'touch' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const box = el.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height
    el.style.setProperty('--hid-rx', `${((0.5 - y) * 9).toFixed(2)}deg`)
    el.style.setProperty('--hid-ry', `${((x - 0.5) * 12).toFixed(2)}deg`)
    el.style.setProperty('--hid-mx', `${(x * 100).toFixed(1)}%`)
    el.style.setProperty('--hid-my', `${(y * 100).toFixed(1)}%`)
    el.dataset.lit = 'true'
  }
  const untilt = () => {
    const el = card.current
    if (!el) return
    for (const name of ['--hid-rx', '--hid-ry', '--hid-mx', '--hid-my']) el.style.removeProperty(name)
    delete el.dataset.lit
  }
  const firstAllergy = allergies[0] ?? null
  const allergyText = firstAllergy && <>
    <span className="truncate text-[3.2cqw] leading-none font-medium tracking-[.02em]">{firstAllergy}</span>
    {allergies.length > 1 && <span className="shrink-0 rounded-full bg-white/20 px-[1.2cqw] py-[.5cqw] text-[3cqw] leading-none font-semibold">+{allergies.length - 1}</span>}
    <span className="sr-only">, all allergies: {allergies.join(', ')}.{onAllergies ? ' Open the list.' : ''}</span></>
  return <div className={cx('@container [perspective:1100px]', !still && 'motion-safe:animate-[hid-card-idle_7s_ease-in-out_infinite] motion-safe:hover:[animation-play-state:paused]')}>
    <section ref={card} aria-label={`${name}’s Health ID card`} onPointerMove={tilt} onPointerLeave={untilt}
      className="hid-card relative isolate aspect-[1.586/1] w-full overflow-hidden rounded-[4.6cqw] text-white select-none [background:linear-gradient(135deg,#1570ef_0%,#0d3f99_36%,#071a3d_68%,#02050b_100%)] shadow-[0_28px_50px_-26px_rgba(2,5,11,.85),0_2px_6px_rgba(16,24,40,.14)]">
      <CardPrint />
      {/* Light: a glare that follows the pointer, and a sheen that passes over every few seconds. */}
      {!still && <span aria-hidden="true" className="hid-card-glare pointer-events-none absolute inset-0 mix-blend-soft-light" />}
      {!still && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-[linear-gradient(100deg,transparent_0%,rgba(255,255,255,.14)_50%,transparent_100%)] motion-safe:animate-[hid-card-sheen_7s_ease-in-out_infinite]" />}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-white/15 ring-inset" />

      {/* The top: the logo and what the card is. */}
      <img src={logoSrc} alt="Health ID" width={890} height={264} className="absolute top-[7.2cqw] left-[7.5cqw] h-[5.6cqw] w-auto brightness-0 invert" />
      <span className="absolute top-[8.2cqw] right-[7.5cqw] text-[3cqw] leading-none font-medium tracking-[.12em] text-white/80 uppercase">{label}</span>

      {/* The chip and the contactless mark, where a card has them. */}
      <span aria-hidden="true" className="absolute top-[19.5cqw] left-[7.5cqw] h-[8.6cqw] w-[11.2cqw] overflow-hidden rounded-[1.6cqw] [background:linear-gradient(135deg,#eef2f6_0%,#b9c2cc_40%,#e6ebf0_62%,#a7b0bb_100%)] shadow-[inset_0_0_0_1px_rgba(40,50,60,.35),0_1px_2px_rgba(0,0,0,.4)]">
        <span className="absolute inset-x-0 top-1/3 h-px bg-black/25" /><span className="absolute inset-x-0 top-2/3 h-px bg-black/25" />
        <span className="absolute inset-y-0 left-[30%] w-px bg-black/25" /><span className="absolute inset-y-0 left-[70%] w-px bg-black/25" />
        <span className="absolute top-1/3 bottom-1/3 left-[30%] right-[30%] rounded-[.6cqw] border border-black/25" />
      </span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute top-[21.1cqw] left-[20.5cqw] h-[5.4cqw] w-auto text-white/75" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M8.5 8.5a5 5 0 0 1 0 7" /><path d="M12 6a8.5 8.5 0 0 1 0 12" /><path d="M15.5 3.5a12 12 0 0 1 0 17" />
      </svg>

      {/* The medallion: the holder's portrait in engraved rings, where a premium card has its emblem. */}
      <div className="absolute top-[16cqw] right-[8cqw] size-[25cqw]">
        {medallion ?? <span className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full bg-[#071a3d] ring-[.5cqw] ring-white/25">{face}</span>}
      </div>

      {/* What an emergency team needs first, printed under the chip. */}
      {(facts.length > 0 || firstAllergy) && <dl className="absolute top-[30.5cqw] left-[7.5cqw] m-0 flex w-[59cqw] gap-[3.5cqw]">
        {facts.map(([factLabel, value]) => <div key={factLabel} className="min-w-0 shrink-0">
          <dt className="text-[3cqw] leading-none font-medium tracking-[.06em] text-white/80 uppercase">{factLabel}</dt>
          <dd className="m-0 mt-[1.4cqw] truncate text-[3.6cqw] leading-none font-semibold tracking-[.02em] text-white">{value}</dd></div>)}
        {firstAllergy && <div className="min-w-0 flex-1">
          <dt className="text-[3cqw] leading-none font-medium tracking-[.06em] text-white/80 uppercase">{allergies.length > 1 ? 'Allergies' : 'Allergy'}</dt>
          <dd className="m-0 mt-[.8cqw]">{onAllergies
            // A pill with a chevron, so it reads as something to tap; its target reaches 44px above and below.
            ? <button type="button" onClick={onAllergies} title={allergies.join(', ')} className="relative flex max-w-full cursor-pointer items-center gap-[1cqw] rounded-full border-0 bg-white/15 py-[.8cqw] pr-[.8cqw] pl-[1.8cqw] text-left font-[inherit] text-white ring-1 ring-white/40 after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white">{allergyText}</button>
            : <span title={allergies.join(', ')} className="flex max-w-full items-center gap-[1.2cqw] text-white/95">{allergyText}</span>}</dd></div>}
      </dl>}

      {/* The holder: name, NIN and the ID. */}
      <div className="absolute right-[7.5cqw] bottom-[6.5cqw] left-[7.5cqw] flex items-end justify-between gap-[4cqw]">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-[1.2cqw] truncate text-[3.2cqw] leading-none font-medium tracking-[.12em] text-white/90 uppercase">{name}
            {verified !== null && (verified ? <BadgeCheck className="size-[2.9cqw] shrink-0 text-[#8ee6c1]" aria-label="NIN verified" />
              : <CircleAlert className="size-[2.9cqw] shrink-0 text-amber-200" aria-label="NIN not verified" />)}</p>
          <div className="mt-[1.8cqw] text-[4.9cqw] leading-none font-medium tracking-[.16em] whitespace-nowrap text-[#eef3fb] [filter:drop-shadow(0_1px_0_rgba(0,0,0,.45))] [&_.patient-hid]:gap-0 [&_.patient-hid-code]:p-0 [&_.patient-hid-code]:text-[4.9cqw] [&_.patient-hid-code]:leading-none [&_.patient-hid-code]:font-medium [&_.patient-hid-code]:tracking-[.16em] [&_.patient-hid-code]:whitespace-nowrap [&_.patient-hid-code]:text-[#eef3fb] [&_.patient-hid-note]:text-[3cqw] [&_.patient-hid-note]:tracking-normal [&_.patient-hid-note]:text-white/80">{hid}</div>
        </div>
      </div>
    </section>
  </div>
}

/** Blood group and genotype as the card prints them, each only where it is known. */
export function cardFacts(bloodGroup?: string | null, genotype?: string | null): Array<readonly [string, string]> {
  const facts: Array<readonly [string, string]> = []
  if (bloodGroup) facts.push(['Blood', bloodGroup])
  if (genotype) facts.push(['Genotype', genotype])
  return facts
}

/**
 * Allergies as the patient wrote them, one per item: split on commas, semicolons, new lines and a final "and", with
 * repeats dropped. "Penicillin, sulfa drugs and peanuts" is three.
 */
export function allergyItems(text: string | null | undefined): string[] {
  if (!text) return []
  const seen = new Set<string>()
  return text.split(/[,;\n]+|\s+and\s+/i).map(item => item.trim().replace(/\.$/, '')).filter(item => {
    const key = item.toLowerCase()
    if (!item || /^(none|nil|n\/a|no known allergies?)$/i.test(item) || seen.has(key)) return false
    seen.add(key); return true
  }).map(item => item.charAt(0).toUpperCase() + item.slice(1))
}

/**
 * The card's engraving, all in white at low strength so it reads as print, not decoration: fine wave guilloche, a frame
 * of micro-text ("HEALTH ID" repeated, as security printing has), and the rosette rings round the medallion with the
 * brand's fingerprint mark behind. Decoration only; sized in the card's own units.
 */
function CardPrint() {
  const waves = Array.from({ length: 34 }, (_, i) => {
    const y = 6 + i * 7.4, a = 3 + (i % 5) * 0.6, phase = i * 9
    let d = `M -10 ${y}`
    for (let x = -10; x <= 410; x += 10) d += ` L ${x} ${(y + a * Math.sin((x + phase) / 26)).toFixed(2)}`
    return d
  })
  const micro = Array.from({ length: 40 }, () => 'HEALTH ID ').join('· ')
  return <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 400 252">
    <defs>
      <radialGradient id="hid-glow" cx="0%" cy="0%" r="80%"><stop offset="0" stopColor="#4ea2ff" stopOpacity=".35" /><stop offset="1" stopColor="#4ea2ff" stopOpacity="0" /></radialGradient>
      <path id="hid-frame" d="M 26 12 H 374 A 14 14 0 0 1 388 26 V 226 A 14 14 0 0 1 374 240 H 26 A 14 14 0 0 1 12 226 V 26 A 14 14 0 0 1 26 12 Z" />
      <mask id="hid-medallion-hole"><rect width="400" height="252" fill="#fff" /><circle cx="318" cy="114" r="50" fill="#000" /></mask>
    </defs>
    <rect width="400" height="252" fill="url(#hid-glow)" />
    <g fill="none" stroke="#fff" strokeOpacity=".055" strokeWidth=".6" mask="url(#hid-medallion-hole)">{waves.map(d => <path key={d} d={d} />)}</g>
    {/* Micro-text frame, with a hairline inside it. */}
    <text fill="#fff" fillOpacity=".2" fontSize="3.6" letterSpacing=".9" fontWeight="600"><textPath href="#hid-frame">{micro}</textPath></text>
    <rect x="16.5" y="16.5" width="367" height="219" rx="11" fill="none" stroke="#fff" strokeOpacity=".08" strokeWidth=".6" />
    {/* Rosette rings round the medallion. */}
    <g fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth=".55">
      {Array.from({ length: 36 }, (_, i) => <ellipse key={i} cx="318" cy="114" rx="66" ry="53" transform={`rotate(${i * 10} 318 114)`} />)}
    </g>
    <circle cx="318" cy="114" r="54" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth=".8" />
    <circle cx="318" cy="114" r="57" fill="none" stroke="#fff" strokeOpacity=".1" strokeWidth=".6" strokeDasharray="1.2 2" />
    <image href={markSrc} x="0" y="120" height="150" width="150" opacity=".05" style={{ filter: 'brightness(0) invert(1)' }} />
  </svg>
}
