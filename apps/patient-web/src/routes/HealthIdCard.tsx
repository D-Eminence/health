import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BadgeCheck, Camera, CircleAlert, HeartPulse, Nfc, Share2, Trash2, UserRound } from 'lucide-react'
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
 * The patient's Health ID as the card they would carry: a bank-card shape (ISO ID-1, 85.6 × 54 mm) in a care blue-to-teal,
 * with a guilloche security pattern, a heartbeat line, a medical "chip" and a foil seal. On it, what a front desk or an
 * emergency team asks first: the photo, the name, the ID (large, copyable) and, when the patient has added them, blood
 * group and genotype. It opens every page about the patient (Home, Profile), first on a phone.
 *
 * The photo is the photo control (as on hid-1.0): tapping it picks a JPEG or PNG, drawn afresh as a square JPEG on this
 * page (photoImage.ts, so nothing the file held is sent), shown in a drawer to save. The actions sit under the card, not
 * on it, so the card reads as a card. `links` leaves out the link to the page it is on.
 */
export function HealthIdCard({ profile, verified, bloodGroup, genotype, shareTo, links = ['share', 'profile'], onChanged, className }: {
  profile: PatientProfile
  verified: boolean | null
  bloodGroup?: string | null
  genotype?: string | null
  shareTo: string
  links?: ReadonlyArray<'share' | 'profile'>
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
      setOpen(false); setPrepared(null)
      toast.success({ title: 'Photo saved', message: 'It’s on your Health ID card now.' })
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
      toast.success('Photo removed')
    } catch (cause) {
      toast.error({ title: 'Couldn’t remove your photo', message: isHidApiError(cause) ? cause.message : 'Please try again.' })
    } finally { setBusy(null) }
  }

  const face = photo.url
    ? <img src={photo.url} alt="" width={PHOTO_SIDE} height={PHOTO_SIDE} className="size-full object-cover" />
    : <span className="text-[22px] font-semibold tracking-wide text-white/90" aria-hidden="true">{initialsOf(profile)}</span>
  const facts = [bloodGroup && ['Blood', bloodGroup], genotype && ['Genotype', genotype]].filter((f): f is [string, string] => Array.isArray(f))

  return <div className={cx('flex flex-col gap-3', className)}>
    <section aria-label="Your Health ID card"
      className="group/card relative isolate aspect-[1.586/1] w-full overflow-hidden rounded-[18px] text-white shadow-[0_18px_40px_-18px_rgba(11,58,117,.65),0_2px_6px_rgba(16,24,40,.12)] ring-1 ring-white/10 select-none [background:linear-gradient(135deg,#0a2f63_0%,#0e57c8_48%,#0f8f9a_100%)] motion-safe:transition-transform motion-safe:duration-500 motion-safe:hover:[transform:perspective(900px)_rotateX(3deg)_rotateY(-4deg)]">
      <CardArt />
      {/* A sheen that passes over the card on hover, as light over laminate. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(105deg,transparent_35%,rgba(255,255,255,.18)_50%,transparent_65%)] motion-safe:transition-transform motion-safe:duration-700 motion-safe:group-hover/card:translate-x-full" />

      <div className="relative flex h-full flex-col p-[5%]">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25 backdrop-blur-sm"><HeartPulse className="size-4" aria-hidden /></span>
            <div className="leading-none"><p className="m-0 text-[14px] font-bold tracking-tight">Health ID</p>
              <p className="m-0 mt-0.5 text-[9px] font-semibold tracking-[.18em] text-white/65 uppercase">Patient card</p></div>
          </div>
          <Nfc className="size-5 rotate-90 text-white/55" aria-hidden />
        </div>

        <div className="mt-auto flex items-end gap-[4.5%]">
          {/* The photo is the control: a label around the hidden picker. */}
          {editable ? <label className="group/photo relative aspect-[4/5] w-[23%] shrink-0 cursor-pointer overflow-hidden rounded-xl bg-white/15 ring-2 ring-white/40 focus-within:ring-white">
            <span className="absolute inset-0 flex items-center justify-center">{face}</span>
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-[#0a2f63]/70 py-1 text-[9px] font-semibold backdrop-blur-sm transition-opacity sm:opacity-0 sm:group-hover/photo:opacity-100 sm:group-focus-within/photo:opacity-100">
              <Camera className="size-3" aria-hidden />{photo.url ? 'Change' : 'Add photo'}</span>
            <input ref={picker} type="file" accept="image/jpeg,image/png" className="sr-only" disabled={busy !== null}
              aria-label={photo.url ? 'Change the photo on your card' : 'Add a photo to your card'} onChange={event => void choose(event)} />
          </label> : <span className="relative flex aspect-[4/5] w-[23%] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/15 ring-2 ring-white/40">{face}</span>}

          <div className="min-w-0 flex-1 pb-0.5">
            <p className="m-0 truncate text-[15px] leading-tight font-semibold">{profile.fullName}</p>
            {verified !== null && <span className={cx('mt-1 inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold', verified ? 'bg-emerald-400/20 text-emerald-200' : 'bg-amber-400/20 text-amber-200')}>
              {verified ? <BadgeCheck className="size-3" aria-hidden /> : <CircleAlert className="size-3" aria-hidden />}{verified ? 'NIN verified' : 'NIN not verified'}</span>}
            <p className="m-0 mt-2 text-[9px] font-semibold tracking-[.18em] text-white/60 uppercase">Health ID</p>
            <div className="[&_.patient-hid]:gap-0.5 [&_.patient-hid-code]:font-mono [&_.patient-hid-code]:text-[clamp(17px,5.6vw,22px)] [&_.patient-hid-code]:font-semibold [&_.patient-hid-code]:tracking-[.08em] [&_.patient-hid-code]:[text-shadow:0_1px_0_rgba(0,0,0,.35),0_-1px_0_rgba(255,255,255,.15)] [&_.patient-hid-note]:text-[10px] [&_.patient-hid-note]:text-white/70"><HealthIdCode code={profile.hid} /></div>
          </div>
        </div>

        {facts.length > 0 && <dl className="m-0 mt-[3.5%] flex gap-1.5">
          {facts.map(([label, value]) => <div key={label} className="flex items-baseline gap-1.5 rounded-md bg-white/12 px-2 py-1 ring-1 ring-white/15 backdrop-blur-sm">
            <dt className="text-[9px] font-semibold tracking-[.12em] text-white/65 uppercase">{label}</dt><dd className="m-0 text-[12px] font-bold">{value}</dd></div>)}
        </dl>}
      </div>
    </section>

    {links.length > 0 && <div className="flex gap-2">
      {links.includes('share') && <Button to={shareTo} variant="primary" icon={Share2} className="flex-1">Share records</Button>}
      {links.includes('profile') && <Button to="/profile" icon={UserRound} className="flex-1">View profile</Button>}
    </div>}

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

/** The card's print: guilloche rosettes, a faint cross, a heartbeat line, a medical chip and a foil seal. Decoration only. */
function CardArt() {
  return <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 400 252" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="hid-glow" cx="85%" cy="5%" r="70%"><stop offset="0" stopColor="#5fd4ff" stopOpacity=".45" /><stop offset="1" stopColor="#5fd4ff" stopOpacity="0" /></radialGradient>
      <linearGradient id="hid-chip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f6e7b0" /><stop offset=".5" stopColor="#d4b46a" /><stop offset="1" stopColor="#f3dea0" /></linearGradient>
      <linearGradient id="hid-foil" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9be7ff" /><stop offset=".35" stopColor="#c9a7ff" /><stop offset=".65" stopColor="#ffd6a5" /><stop offset="1" stopColor="#a5ffd6" /></linearGradient>
    </defs>
    <rect width="400" height="252" fill="url(#hid-glow)" />
    {/* Guilloche: offset rings, as on a banknote. */}
    <g fill="none" stroke="#fff" strokeOpacity=".07" strokeWidth=".8">
      {Array.from({ length: 18 }, (_, i) => <ellipse key={i} cx={330} cy={60} rx={40 + i * 9} ry={28 + i * 7} transform={`rotate(${i * 7} 330 60)`} />)}
    </g>
    {/* A large faint medical cross. */}
    <path d="M300 120h28v-28h28v28h28v28h-28v28h-28v-28h-28z" fill="#fff" fillOpacity=".05" />
    {/* The heartbeat. */}
    <path d="M0 196 H120 l10 -14 l10 26 l14 -52 l14 74 l12 -34 H262 l8 -10 l8 10 H400" fill="none" stroke="#7fe3ff" strokeOpacity=".35" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    {/* The chip: a health cross etched into gold contacts. */}
    <g transform="translate(334 58)">
      <rect width="46" height="36" rx="7" fill="url(#hid-chip)" opacity=".92" />
      <path d="M0 12h14M0 24h14M32 12h14M32 24h14M14 0v36M32 0v36" stroke="#a3843f" strokeOpacity=".55" strokeWidth="1" />
      <path d="M20 10h6v5h5v6h-5v5h-6v-5h-5v-6h5z" fill="#b8963f" opacity=".8" />
    </g>
    {/* The foil seal. */}
    <circle cx="368" cy="222" r="14" fill="url(#hid-foil)" opacity=".55" />
    <circle cx="368" cy="222" r="9" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth=".8" />
  </svg>
}
