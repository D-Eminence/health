import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
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
 * Health ID logo reversed out in white and its fingerprint mark as the only print, on a gradient from Health ID blue to black. On it, what a front desk or an
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
    : <span className="text-[5cqw] font-semibold tracking-wide text-white/90" aria-hidden="true">{initialsOf(profile)}</span>
  const facts = [bloodGroup && ['Blood', bloodGroup], genotype && ['Genotype', genotype]].filter((f): f is [string, string] => Array.isArray(f))

  return <div className={cx('flex flex-col gap-3', className)}>
    {/* Everything on the card is sized to the card's own width (cqw), so it is the same card, in the same proportion
        (ISO ID-1, 85.6 × 54 mm), on any screen. */}
    <div className="@container">
    <section aria-label="Your Health ID card"
      className="relative isolate aspect-[1.586/1] w-full overflow-hidden rounded-[4.5cqw] text-white select-none [background:linear-gradient(135deg,#1570ef_0%,#0d3f99_38%,#071a3d_70%,#03060d_100%)] shadow-[0_24px_48px_-24px_rgba(3,6,13,.8),0_2px_6px_rgba(16,24,40,.14)] motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:-translate-y-0.5">
      <CardPrint />
      {/* A hairline inner edge, as on a laminated card. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-white/15 ring-inset" />

      <div className="relative grid h-full grid-rows-[auto_1fr_auto] p-[6cqw]">
        <div className="flex items-start justify-between">
          <img src={logoSrc} alt="Health ID" width={890} height={264} className="h-[7.2cqw] w-auto brightness-0 invert" />
          <span className="pt-[.8cqw] text-[2.5cqw] font-semibold tracking-[.22em] text-white/60 uppercase">Patient</span>
        </div>

        <div className="flex items-center gap-[4cqw]">
          {/* The photo is the control: a label around the hidden picker. */}
          {editable ? <label className="group/photo relative aspect-[4/5] w-[17cqw] shrink-0 cursor-pointer overflow-hidden rounded-[2.6cqw] bg-white/10 ring-1 ring-white/30 focus-within:ring-2 focus-within:ring-white">
            <span className="absolute inset-0 flex items-center justify-center">{face}</span>
            <span aria-hidden="true" className="absolute right-[1cqw] bottom-[1cqw] inline-flex size-[5.4cqw] items-center justify-center rounded-full bg-white text-[#0b3f94] shadow"><Camera className="size-[3.2cqw]" /></span>
            <input ref={picker} type="file" accept="image/jpeg,image/png" className="sr-only" disabled={busy !== null}
              aria-label={photo.url ? 'Change the photo on your card' : 'Add a photo to your card'} onChange={event => void choose(event)} />
          </label> : <span className="relative flex aspect-[4/5] w-[17cqw] shrink-0 items-center justify-center overflow-hidden rounded-[2.6cqw] bg-white/10 ring-1 ring-white/30">{face}</span>}
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[4.6cqw] leading-tight font-semibold tracking-[-.01em]">{profile.fullName}</p>
            {verified !== null && <p className={cx('m-0 mt-[1.2cqw] inline-flex items-center gap-[1cqw] text-[3cqw] font-medium', verified ? 'text-[#9ff0cf]' : 'text-amber-200')}>
              {verified ? <BadgeCheck className="size-[3.6cqw]" aria-hidden /> : <CircleAlert className="size-[3.6cqw]" aria-hidden />}{verified ? 'NIN verified' : 'NIN not verified'}</p>}
          </div>
        </div>

        <div className="flex items-end justify-between gap-[4cqw]">
          <div className="min-w-0">
            <p className="m-0 text-[2.5cqw] font-semibold tracking-[.22em] text-white/60 uppercase">Health ID</p>
            <div className="mt-[.6cqw] [&_.patient-hid]:gap-0 [&_.patient-hid-code]:p-0 [&_.patient-hid-code]:text-[6.4cqw] [&_.patient-hid-code]:leading-none [&_.patient-hid-code]:font-semibold [&_.patient-hid-code]:tracking-[.08em] [&_.patient-hid-code]:whitespace-nowrap [&_.patient-hid-code]:[text-shadow:0_1px_0_rgba(0,0,0,.35),0_-1px_0_rgba(255,255,255,.12)] [&_.patient-hid-note]:text-[2.6cqw] [&_.patient-hid-note]:text-white/70"><HealthIdCode code={profile.hid} /></div>
          </div>
          {facts.length > 0 && <dl className="m-0 flex shrink-0 gap-[4cqw] text-right">
            {facts.map(([label, value]) => <div key={label}>
              <dt className="text-[2.5cqw] font-semibold tracking-[.22em] text-white/60 uppercase">{label}</dt>
              <dd className="m-0 mt-[.6cqw] text-[4.4cqw] leading-none font-semibold">{value}</dd></div>)}
          </dl>}
        </div>
      </div>
    </section>
    </div>

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

/** The card's only print: the brand's fingerprint mark, faint, bleeding off the corner. */
function CardPrint() {
  return <img src={markSrc} alt="" aria-hidden="true" className="pointer-events-none absolute -right-[9%] -bottom-[30%] h-[110%] w-auto opacity-[.08] brightness-0 invert" />
}
