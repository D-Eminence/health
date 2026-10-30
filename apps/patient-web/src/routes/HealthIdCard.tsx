import type { ReactNode } from 'react'
import { BadgeCheck, CircleAlert, IdCard, Share2, UserRound } from 'lucide-react'
import { Button, cx } from '../kasuwa/ui'
import { HealthIdCode } from './HealthIdCode'

/**
 * The patient's Health ID as the card they would carry: paytrail's dark "contrast" slab, the ID large and copyable
 * (recognition over recall: it is what a hospital asks for), and what to do with it. It opens every patient page that
 * is about the patient themselves (Home, Profile), first on a phone, so the one thing a front desk asks for is never
 * below the fold. `links` leaves out the link to the page it is on.
 */
export function HealthIdCard({ name, hid, verified, photo, shareTo, links = ['share', 'profile'], className, children }: {
  name: string
  hid: string
  verified: boolean | null
  photo: ReactNode
  shareTo: string
  links?: ReadonlyArray<'share' | 'profile'>
  className?: string
  children?: ReactNode
}) {
  return <section aria-label="Your Health ID card" className={cx('relative overflow-hidden rounded-2xl bg-contrast p-5 text-white shadow-[var(--shadow-pop)]', className)}>
    <div aria-hidden="true" className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-brand/40 blur-3xl" />
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:14px_14px]" />
    <div className="relative flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">{photo}<div className="min-w-0">
        <p className="m-0 truncate text-[15px] font-semibold">{name}</p>
        {verified !== null && <span className={cx('mt-1 inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold', verified ? 'bg-success/20 text-[#6ee0a6]' : 'bg-warn/20 text-[#fdb022]')}>
          {verified ? <BadgeCheck className="size-3.5" aria-hidden /> : <CircleAlert className="size-3.5" aria-hidden />}{verified ? 'NIN verified' : 'NIN not verified'}</span>}
      </div></div>
      <IdCard className="size-6 shrink-0 text-white/50" aria-hidden />
    </div>
    <p className="relative m-0 mt-6 text-overline text-white/60">Health ID</p>
    <div className="relative mt-1 [&_.patient-hid]:gap-1 [&_.patient-hid-code]:text-[26px] [&_.patient-hid-code]:font-semibold [&_.patient-hid-code]:tracking-[0.04em] [&_.patient-hid-note]:text-white/70"><HealthIdCode code={hid} /></div>
    {children}
    {links.length > 0 && <div className="relative mt-5 flex flex-wrap gap-2">
      {links.includes('share') && <Button to={shareTo} variant="primary" size="sm" icon={Share2}>Share records</Button>}
      {links.includes('profile') && <Button to="/profile" size="sm" icon={UserRound} className="!bg-white/10 !text-white !ring-white/20 hover:!bg-white/15">View profile</Button>}
    </div>}
  </section>
}
