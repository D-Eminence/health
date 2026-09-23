'use client'

import Link from 'next/link'
import Image from 'next/image'
import { ProductDashboard } from '@/components/shared/ProductDashboard'
import { HeroBackground } from '@/components/shared/HeroBackground'
import { findProductDetail } from '@/content/product-details'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { EASE_OUT } from '@/lib/ease'
import { SharedLayoutBg } from '@/components/motion/shared-layout-bg'
import { HealthIcon, type HealthIconName } from '@/components/shared/HealthIcon'
import { useEffect, useId, useRef, useState } from 'react'
import { cx } from '@hid/ui'
import { HeroDemoButton } from '@/components/shared/HeroDemoButton'
import { PRODUCTS } from '@/content/products'
import { APP_ENTRY, ROUTES, SOLUTION_AUDIENCES, SOLUTION_IMAGES } from '@/content/site'
import { Logo } from './Logo'
export interface NavLinkEntry {
  readonly type: 'link'
  readonly label: string
  readonly href: string
}

export interface NavMenuItem {
  readonly label: string
  readonly href: string
  /** One line under the label. Products carry it; short menus do not. */
  readonly description?: string
  /** Two-letter mark, shown for products. */
  readonly mark?: string
  /** Optional contextual preview used by desktop mega menus. */
  readonly preview?: { readonly src: string; readonly alt: string; readonly caption: string; readonly position?: string }
}

export interface NavMenuEntry {
  readonly type: 'menu'
  readonly label: string
  readonly items: readonly NavMenuItem[]
  /** The "see everything" link at the foot of the menu. */
  readonly all?: { readonly label: string; readonly href: string }
  readonly presentation?: 'menu' | 'mega'
}

export type NavEntry = NavLinkEntry | NavMenuEntry

function mobileGroupId(baseId: string, label: string): string {
  return `${baseId}-mobile-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

export interface SiteNavProps {
  /** Rendered in order, so a menu can sit between two plain links. */
  readonly entries: readonly NavEntry[]
  readonly signInHref: string
  readonly signInLabel: string
  readonly action: { readonly label: string; readonly href: string }
  readonly audience: 'patient' | 'provider'
}

/**
 * The floating pill navigation.
 *
 * Client-side because each menu and the small-screen drawer are disclosure
 * widgets. Everything it links to is a plain URL, so the nav still works before
 * hydration.
 *
 * Only one menu is open at a time, which is what a pointer expects and what
 * keeps Escape unambiguous.
 */
export function SiteNav({ entries, signInHref, signInLabel, action, audience }: SiteNavProps) {
  const reduce = useReducedMotion()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileOpenGroup, setMobileOpenGroup] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const megaOpen = entries.some(entry => entry.type === 'menu' && entry.presentation === 'mega' && entry.label === openMenu)
  const menuId = useId()
  const menuButtonId = useId()
  const navigationRef = useRef<HTMLDivElement>(null)
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const desktopMenuTriggerRef = useRef<HTMLButtonElement | null>(null)

  // The pill is frosted glass over the page. Once the reader scrolls, content
  // passes underneath it, so it thickens to stay legible — the same behaviour
  // the approved design gives its navigation.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close either disclosure on an outside press or Escape. Returning focus to
  // the trigger after Escape keeps keyboard navigation predictable.
  useEffect(() => {
    if (openMenu === null && !menuOpen) return

    const onPointerDown = (event: PointerEvent) => {
      if (!navigationRef.current?.contains(event.target as Node)) {
        setOpenMenu(null)
        setMenuOpen(false)
        setMobileOpenGroup(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      const trigger = menuOpen ? mobileMenuTriggerRef.current : desktopMenuTriggerRef.current
      setOpenMenu(null)
      setMenuOpen(false)
      setMobileOpenGroup(null)
      requestAnimationFrame(() => trigger?.focus())
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen, openMenu])

  useEffect(() => {
    if (!menuOpen) return
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = originalOverflow }
  }, [menuOpen])

  return (
    <div className="health-site-header sticky top-0 z-50 isolate px-3 pt-3 sm:px-5 sm:pt-5">
      <AnimatePresence initial={false}>
        {megaOpen ? <motion.div
          key="desktop-navigation-backdrop"
          aria-hidden="true"
          className="health-navigation-backdrop"
          style={{ backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
          data-products-open={openMenu === 'Products'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : .2, ease: EASE_OUT }}
        /> : null}
      </AnimatePresence>
      <div ref={navigationRef} className="relative mx-auto w-full max-w-[1180px]">
        <nav
        aria-label="Primary"
        style={megaOpen ? { backdropFilter: 'none' } : undefined}
        className={cx(
          'relative max-lg:z-50 mx-auto flex w-full max-w-[1180px] items-center gap-4 rounded-[26px] border px-4 py-2.5 backdrop-blur-[18px] backdrop-saturate-[160%] transition-[background-color,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:px-5',
          openMenu !== null || scrolled
            ? 'border-white/80 bg-white/92 shadow-[0_10px_34px_rgba(15,39,66,0.12),inset_0_1px_0_rgba(255,255,255,0.9)]'
            : 'border-white/60 bg-white/72 shadow-[0_4px_20px_rgba(15,39,66,0.07),inset_0_1px_0_rgba(255,255,255,0.8)]',
        )}
      >
        <div className="flex items-center gap-2">
          <Logo />
          <AudienceSwitch audience={audience} />
        </div>

        <div className="ml-auto hidden items-center gap-6 lg:flex">
          {entries.map(entry =>
            entry.type === 'menu' ? (
              entry.presentation === 'mega' ? <MegaNavMenu
                key={entry.label}
                entry={entry}
                open={openMenu === entry.label}
                onToggle={trigger => {
                  desktopMenuTriggerRef.current = trigger
                  setOpenMenu(current => (current === entry.label ? null : entry.label))
                }}
                onClose={() => setOpenMenu(null)}
              /> : <NavMenu
                key={entry.label}
                entry={entry}
                open={openMenu === entry.label}
                onToggle={trigger => {
                  desktopMenuTriggerRef.current = trigger
                  setOpenMenu(current => (current === entry.label ? null : entry.label))
                }}
                onClose={() => setOpenMenu(null)}
              />
            ) : (
              <Link
                key={entry.href}
                href={entry.href}
                className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
              >
                {entry.label}
              </Link>
            ),
          )}
        </div>

        <div className="ml-auto flex items-center gap-2.5 lg:ml-7">
          <a
            href={signInHref}
            className="hidden min-h-11 items-center text-sm font-semibold text-ink hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand lg:inline-flex"
          >
            {signInLabel}
          </a>
          <HeroDemoButton href={action.href} size="sm" className="max-lg:!hidden lg:inline-flex">
            {action.label}
          </HeroDemoButton>

          <button
            ref={mobileMenuTriggerRef}
            id={menuButtonId}
            type="button"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => {
              setOpenMenu(null)
              setMobileOpenGroup(null)
              setMenuOpen(open => !open)
            }}
            className="grid h-11 w-11 place-items-center rounded-full border border-line text-ink hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand lg:hidden"
          >
            <HealthIcon name={menuOpen ? 'close' : 'menu'} size={20} />
          </button>
        </div>
        </nav>

        <AnimatePresence initial={false}>
        {menuOpen ? (
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : -6, scale: reduce ? 1 : 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            style={{ transformOrigin: 'top center' }}
            inert={!menuOpen}
            id={menuId}
            role="region"
            aria-labelledby={menuButtonId}
            className="fixed inset-0 z-40 w-full max-w-none overflow-y-auto overscroll-contain rounded-none border-0 bg-white px-6 pb-8 pt-24 shadow-none lg:hidden"
          >
          <ul className="mx-auto flex w-full max-w-[720px] flex-col">
            {entries.map(entry =>
              entry.type === 'menu' ? (
              <li key={entry.label} className="border-b border-line" data-open={mobileOpenGroup === entry.label}>
                  <button type="button" aria-expanded={mobileOpenGroup === entry.label} aria-controls={mobileGroupId(menuId, entry.label)} onClick={() => setMobileOpenGroup(current => current === entry.label ? null : entry.label)} className="flex min-h-14 w-full items-center justify-between px-0 py-3 text-left text-[15px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand">
                    {entry.label}
                    <svg viewBox="0 0 12 12" aria-hidden="true" className={cx('h-3 w-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none', mobileOpenGroup === entry.label && 'rotate-180')}><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  </button>
                  <div id={mobileGroupId(menuId, entry.label)} aria-hidden={mobileOpenGroup !== entry.label} inert={mobileOpenGroup !== entry.label} className={cx('grid transition-[grid-template-rows,opacity] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none', mobileOpenGroup === entry.label ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
                    <div className="overflow-hidden"><div className="border-t border-line">
                      {entry.items.map(item => entry.presentation === 'mega' ? (
                        <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="group flex min-h-16 items-center gap-3 border-b border-line px-1 text-[14px] font-medium text-ink transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand motion-reduce:transition-none">
                          <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand"><HealthIcon name={destinationIcon(item.href)} size={18} /></span>
                          <span className="min-w-0 flex-1">{item.label}</span>
                          <span aria-hidden="true" className="pr-1 text-base text-brand transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none">→</span>
                        </Link>
                      ) : <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="flex min-h-12 flex-col justify-center border-b border-line px-1 py-2 text-[14px] font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"><span>{item.label}</span>{item.description ? <span className="mt-0.5 text-[12px]/snug font-normal text-faint">{item.description}</span> : null}</Link>)}
                      {entry.all ? <Link href={entry.all.href} onClick={() => setMenuOpen(false)} className="mt-2 flex min-h-12 items-center justify-between rounded-lg bg-brand-tint px-3 text-[14px] font-semibold text-brand hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand">{entry.all.label.replace(/\s*→$/, '')}<span aria-hidden="true">→</span></Link> : null}
                    </div></div>
                  </div>
                </li>
              ) : (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-11 items-center rounded-(--radius-card) px-3 py-2.5 text-[15px] font-medium text-ink hover:bg-surface-tint focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
                  >
                    {entry.label}
                  </Link>
                </li>
              ),
            )}
            <li>
              <a
                href={signInHref}
                onClick={() => setMenuOpen(false)}
                className="flex min-h-11 items-center rounded-(--radius-card) px-3 py-2.5 text-[15px] font-medium text-ink hover:bg-surface-tint focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
              >
                {signInLabel}
              </a>
            </li>
          </ul>
          <HeroDemoButton
            href={action.href}
            onClick={action.href === '#demo' ? undefined : () => setMenuOpen(false)}
            className="mt-3 min-h-11 w-full"
          >
            {action.label}
          </HeroDemoButton>
          </motion.div>
        ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

function AudienceSwitch({ audience }: { audience: 'patient' | 'provider' }) {
  const isPatient = audience === 'patient'
  const destination = isPatient ? '/providers' : '/patients'
  const label = isPatient ? 'Switch to healthcare providers' : 'Switch to patients'

  return (
    <Link
      href={destination}
      aria-label={label}
      title={label}
      className="group grid h-9 w-9 place-items-center rounded-full border border-line bg-white/60 text-muted transition-colors hover:border-brand hover:bg-brand-tint hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[17px] w-[17px]">
        <path d="M7 7h10l-2.8-2.8M17 17H7l2.8 2.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    </Link>
  )
}

function MegaNavMenu({
  entry,
  open,
  onToggle,
  onClose,
}: {
  entry: NavMenuEntry
  open: boolean
  onToggle: (trigger: HTMLButtonElement) => void
  onClose: () => void
}) {
  const [activeHref, setActiveHref] = useState(entry.items[0]?.href ?? '')
  const panelId = useId()
  const reduce = useReducedMotion()
  const active = entry.items.find(item => item.href === activeHref) ?? entry.items[0]

  if (!active) return null

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={event => onToggle(event.currentTarget)}
        className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        {entry.label}
        <svg viewBox="0 0 12 12" aria-hidden="true" className={cx('h-3 w-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none', open && 'rotate-180')}><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>

      <AnimatePresence initial={false}>
      {open ? (
        <motion.section
          initial={{ opacity: 0, x: '-50%', y: reduce ? 0 : 6, scale: reduce ? 1 : 0.985 }}
          animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
          exit={{ opacity: 0, y: reduce ? 0 : 4, transition: { duration: 0.12 } }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          inert={!open} id={panelId} aria-label={`${entry.label} destinations`} data-menu-kind={entry.label === 'Products' ? 'products' : 'solutions'} className="health-mega-menu">
          <div className="health-mega-menu-list">
            <p className="px-3 pb-2 font-mono text-[11px] font-semibold tracking-[0.1em] text-faint uppercase">{entry.label}</p>
            <SharedLayoutBg as="ul" inset={0} pillClassName="!rounded-xl !bg-brand-tint">
              {entry.items.map(item => {
                const selected = item.href === active.href
                return <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    onMouseEnter={() => setActiveHref(item.href)}
                    onFocus={() => setActiveHref(item.href)}
                    data-active={selected}
                    className="health-mega-menu-row"
                  >
                    <span className="health-menu-icon"><HealthIcon name={destinationIcon(item.href)} size={21} /></span>
                    <span>
                      <span className="flex items-center gap-2"><b>{item.label}</b><span aria-hidden="true" className="health-mega-menu-arrow">→</span></span>
                      {item.description ? <small>{item.description}</small> : null}
                    </span>
                  </Link>
                </li>
              })}
            </SharedLayoutBg>
            {entry.all ? <Link href={entry.all.href} onClick={onClose} className="mt-2 inline-flex min-h-10 items-center px-3 text-[13px] font-semibold text-brand hover:text-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">{entry.all.label}</Link> : null}
          </div>
          <div className="health-mega-menu-preview">
            {active.href.startsWith('/products/') && <HeroBackground />}
            <motion.div key={active.href} className="health-menu-preview-art"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ duration: reduce ? 0 : 0.18 }}
            ><DestinationPreview item={active} /></motion.div>
            <div className="health-mega-menu-caption">
              <p>{active.preview?.caption ?? active.label}</p>
              <Link href={active.href} onClick={onClose}>Explore {active.label} <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </motion.section>
      ) : null}
      </AnimatePresence>
    </div>
  )
}

function NavMenu({
  entry,
  open,
  onToggle,
  onClose,
}: {
  entry: NavMenuEntry
  open: boolean
  onToggle: (trigger: HTMLButtonElement) => void
  onClose: () => void
}) {
  const panelId = useId()
  const reduce = useReducedMotion()
  const wide = entry.items.some(item => item.description)

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={event => onToggle(event.currentTarget)}
        className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
      >
        {entry.label}
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={cx('h-3 w-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none', open && 'rotate-180')}
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          inert={!open}
          id={panelId}
          className={cx(
            'absolute top-full left-1/2 z-50 mt-4 -translate-x-1/2 rounded-(--radius-panel) border border-white/70 bg-white/85 p-2 shadow-[0_20px_56px_rgba(15,39,66,0.18),inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-[18px] backdrop-saturate-[170%]',
            wide ? 'w-[420px]' : 'w-[240px]',
          )}
        >
          <ul className="flex flex-col">
            {entry.items.map(item => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  className="flex items-start gap-3 rounded-(--radius-card) p-3 hover:bg-surface-tint focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
                >
                  {item.mark ? (
                    <span
                      aria-hidden="true"
                      className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-tint font-mono text-[11px] font-semibold text-brand"
                    >
                      {item.mark}
                    </span>
                  ) : null}
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ink">{item.label}</span>
                    {item.description ? (
                      <span className="text-[13px] leading-snug text-muted">{item.description}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {entry.all ? (
            <Link
              href={entry.all.href}
              onClick={onClose}
              className="mt-1 flex min-h-11 items-center rounded-(--radius-card) px-3 py-2.5 text-sm font-semibold text-brand hover:bg-surface-tint focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
            >
              {entry.all.label}
            </Link>
          ) : null}
        </motion.div>
      ) : null}
      </AnimatePresence>
    </div>
  )
}

const PRODUCT_MENU: NavMenuEntry = {
  type: 'menu',
  label: 'Products',
  presentation: 'mega',
  items: PRODUCTS.map(product => ({
    label: product.name,
    href: ROUTES.product(product.slug),
    description: product.summary,
    mark: product.mark,
    get preview() { return PRODUCT_PREVIEWS[product.slug] ?? PRODUCT_PREVIEWS.identity },
  })),
  all: { label: 'View all products →', href: ROUTES.products },
}

const SOLUTIONS_MENU: NavMenuEntry = {
  type: 'menu',
  label: "Who it's for",
  presentation: 'mega',
  items: SOLUTION_AUDIENCES.map(audience => ({
    label: audience.label,
    href: ROUTES.solution(audience.id),
    get description() { return SOLUTION_PREVIEWS[audience.id]?.description },
    get preview() { return SOLUTION_PREVIEWS[audience.id]?.preview },
  })),
  all: { label: 'How each setting works →', href: ROUTES.solutions },
}

const PRODUCT_PREVIEWS: Record<string, NonNullable<NavMenuItem['preview']>> = {
  identity: { src: '/brand/access-pin-provider.png', alt: 'Patient using Health ID at a hospital', caption: 'One secure patient identity across connected care settings.' },
  ehr: { src: '/brand/provider-access-dashboard.png', alt: 'Health ID clinical workspace', caption: 'Clinical records and workflows that follow the patient.' },
  migrate: { src: '/brand/patient-health-record.png', alt: 'Health ID digital record on a phone', caption: 'Historical records, structured for the next care moment.' },
  laboratory: { src: '/brand/patient-health-record.jpeg', alt: 'Health information screen', caption: 'Orders and verified results connected to one record.' },
  pharmacy: { src: '/brand/share-health-record.png', alt: 'Health ID record sharing interface', caption: 'Prescriptions, dispensing and medication history in one workflow.' },
  outreach: { src: '/brand/connected-care-checkin.png', alt: 'Patient using Health ID at a healthcare facility', caption: 'Registration and healthcare delivery for community programmes.' },
  api: { src: '/brand/provider-access-dashboard.png', alt: 'Health ID integration dashboard', caption: 'Connect approved patient information to existing systems.' },
}

const SOLUTION_PREVIEWS: Record<string, { readonly description: string; readonly preview: NonNullable<NavMenuItem['preview']> }> = {
  hospitals: { description: 'One connected patient record across departments and branches.', preview: { ...SOLUTION_IMAGES.hospitals, caption: 'Coordinate care across every department.' } },
  clinics: { description: 'Start with everyday clinical workflows and add modules as needed.', preview: { ...SOLUTION_IMAGES.clinics, caption: 'A familiar workflow, connected to each patient.' } },
  'diagnostic-centres': { description: 'Connect laboratory and diagnostic results directly to patient records.', preview: { ...SOLUTION_IMAGES['diagnostic-centres'], caption: 'Verified results return to the right record.' } },
  pharmacies: { description: 'Manage prescriptions, dispensing and medication history.', preview: { ...SOLUTION_IMAGES.pharmacies, caption: 'Dispensing that stays connected to the prescription.' } },
  'public-health-programmes': { description: 'Support outreach, registration and population-level care delivery.', preview: { ...SOLUTION_IMAGES['public-health-programmes'], caption: 'Reach communities without creating another register.' } },
}

const _RESOURCES_MENU: NavMenuEntry = {
  type: 'menu',
  label: 'Resources',
  items: [
    { label: 'Documentation', href: ROUTES.documentation },
    { label: 'Security', href: ROUTES.security },
    { label: 'Privacy Policy', href: ROUTES.privacy },
    { label: 'Contact', href: ROUTES.contact },
  ],
  all: { label: 'Explore resources →', href: ROUTES.resources },
}

/** Navigation for the provider side of the site. */
export function ProviderNav() {
  return (
    <SiteNav
      entries={[
        PRODUCT_MENU,
        SOLUTIONS_MENU,
        { type: 'link', label: 'Pricing', href: ROUTES.pricing },
        { type: 'link', label: 'How it works', href: ROUTES.howItWorksProvider },
        { type: 'link', label: 'About', href: ROUTES.about },
        { type: 'link', label: 'Contact', href: ROUTES.contact },
      ]}
      signInHref={APP_ENTRY.staffSignIn}
      signInLabel="Sign in"
      action={{ label: 'Book a demo', href: '#demo' }}
      audience="provider"
    />
  )
}

/** Navigation for the patient side of the site. */
export function PatientNav() {
  return (
    <SiteNav
      entries={[
        { type: 'link', label: 'How it works', href: ROUTES.howItWorksPatient },
        { type: 'link', label: 'Your control', href: '/patients#control' },
      ]}
      signInHref={APP_ENTRY.patientSignIn}
      signInLabel="Sign in"
      action={{ label: 'Get your Health ID', href: APP_ENTRY.patientSignUp }}
      audience="patient"
    />
  )
}

function destinationIcon(href: string): HealthIconName {
  if (href.includes('patients')) return 'shield'
  if (href.includes('laboratory') || href.includes('diagnostic')) return 'laboratory'
  if (href.includes('pharmacy') || href.includes('pharmacies')) return 'medicine'
  if (href.includes('migrate')) return 'database'
  if (href.includes('outreach') || href.includes('public-health')) return 'location'
  if (href.includes('/api')) return 'code'
  return 'hospital'
}

function DestinationPreview({ item }: { item: NavMenuItem }) {
  const product = item.href.startsWith('/products/') ? findProductDetail(item.href.split('/').pop() ?? '') : undefined
  if (product) return <div className="health-menu-dashboard"><ProductDashboard product={product} /></div>
  return item.preview ? <Image src={item.preview.src} alt={item.preview.alt} fill sizes="700px" className="object-cover" style={{ objectPosition: item.preview.position ?? 'center' }} /> : <HealthIcon name={destinationIcon(item.href)} size={64} />
}
