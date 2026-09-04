'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { ButtonLink, cx } from '@hid/ui'
import { PRODUCTS } from '@/content/products'
import { APP_ENTRY, ROUTES } from '@/content/site'
import { Logo } from './Logo'

export interface NavLink {
  readonly label: string
  readonly href: string
}

export interface SiteNavProps {
  readonly links: readonly NavLink[]
  /** Provider navigation carries the products menu; the patient site does not. */
  readonly showProducts?: boolean
  readonly signInHref: string
  readonly signInLabel: string
  readonly action: { readonly label: string; readonly href: string }
}

/**
 * The floating pill navigation.
 *
 * Client-side because the products menu and the small-screen menu are
 * disclosure widgets. Everything it links to is a plain URL, so the nav still
 * works before hydration.
 */
export function SiteNav({
  links,
  showProducts = false,
  signInHref,
  signInLabel,
  action,
}: SiteNavProps) {
  const [productsOpen, setProductsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const productsId = useId()
  const menuId = useId()
  const productsRef = useRef<HTMLDivElement>(null)

  // Close the products menu on an outside click or Escape, the two ways a
  // person expects to dismiss a menu they opened by accident.
  useEffect(() => {
    if (!productsOpen) return

    const onPointerDown = (event: MouseEvent) => {
      if (!productsRef.current?.contains(event.target as Node)) setProductsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProductsOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [productsOpen])

  return (
    <div className="sticky top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-5">
      <nav
        aria-label="Primary"
        className="mx-auto flex w-full max-w-[1180px] items-center gap-4 rounded-[26px] border border-line bg-surface/90 px-4 py-2.5 shadow-[0_1px_2px_rgba(11,27,46,0.06),0_8px_24px_rgba(11,27,46,0.06)] backdrop-blur-md sm:px-5"
      >
        <Logo />

        <div className="ml-auto hidden items-center gap-7 lg:flex">
          {showProducts ? (
            <div className="relative" ref={productsRef}>
              <button
                type="button"
                aria-expanded={productsOpen}
                aria-controls={productsId}
                onClick={() => setProductsOpen(open => !open)}
                className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
              >
                Products
                <svg
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  className={cx('h-3 w-3 transition-transform', productsOpen && 'rotate-180')}
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

              {productsOpen ? (
                <div
                  id={productsId}
                  className="absolute top-full left-1/2 z-50 mt-4 w-[420px] -translate-x-1/2 rounded-(--radius-panel) border border-line bg-surface p-2 shadow-[0_12px_40px_rgba(11,27,46,0.14)]"
                >
                  <ul className="flex flex-col">
                    {PRODUCTS.map(product => (
                      <li key={product.slug}>
                        <Link
                          href={ROUTES.product(product.slug)}
                          onClick={() => setProductsOpen(false)}
                          className="flex items-start gap-3 rounded-(--radius-card) p-3 hover:bg-surface-tint focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
                        >
                          <span
                            aria-hidden="true"
                            className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-tint font-mono text-[11px] font-semibold text-brand"
                          >
                            {product.mark}
                          </span>
                          <span className="flex flex-col gap-0.5">
                            <span className="text-sm font-semibold text-ink">{product.name}</span>
                            <span className="text-[13px] leading-snug text-muted">
                              {product.summary}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={ROUTES.products}
                    onClick={() => setProductsOpen(false)}
                    className="mt-1 block rounded-(--radius-card) px-3 py-2.5 text-sm font-semibold text-brand hover:bg-surface-tint"
                  >
                    View all products &rarr;
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className={cx('flex items-center gap-2.5', !showProducts && 'ml-auto', 'lg:ml-7')}>
          <a
            href={signInHref}
            className="hidden text-sm font-semibold text-ink hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:inline-flex"
          >
            {signInLabel}
          </a>
          <ButtonLink href={action.href} size="sm" className="hidden sm:inline-flex">
            {action.label}
          </ButtonLink>

          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen(open => !open)}
            className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink lg:hidden"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
              {menuOpen ? (
                <path
                  d="M3 3l10 10M13 3L3 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M2 4.5h12M2 11.5h12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {menuOpen ? (
        <div
          id={menuId}
          className="mx-auto mt-2 w-full max-w-[1180px] rounded-(--radius-panel) border border-line bg-surface p-4 shadow-[0_12px_40px_rgba(11,27,46,0.12)] lg:hidden"
        >
          <ul className="flex flex-col gap-1">
            {showProducts ? (
              <li>
                <Link
                  href={ROUTES.products}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-(--radius-card) px-3 py-2.5 text-[15px] font-medium text-ink hover:bg-surface-tint"
                >
                  Products
                </Link>
              </li>
            ) : null}
            {links.map(link => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-(--radius-card) px-3 py-2.5 text-[15px] font-medium text-ink hover:bg-surface-tint"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={signInHref}
                className="block rounded-(--radius-card) px-3 py-2.5 text-[15px] font-medium text-ink hover:bg-surface-tint"
              >
                {signInLabel}
              </a>
            </li>
          </ul>
          <ButtonLink href={action.href} className="mt-3 w-full">
            {action.label}
          </ButtonLink>
        </div>
      ) : null}
    </div>
  )
}

/** Navigation for the provider side of the site. */
export function ProviderNav() {
  return (
    <SiteNav
      showProducts
      links={[
        { label: 'How it works', href: ROUTES.howItWorksProvider },
        { label: 'Pricing', href: ROUTES.pricing },
      ]}
      signInHref={APP_ENTRY.staffSignIn}
      signInLabel="Sign in"
      action={{ label: 'Book an EHR demo', href: '#demo' }}
    />
  )
}

/** Navigation for the patient side of the site. */
export function PatientNav() {
  return (
    <SiteNav
      links={[
        { label: 'How it works', href: ROUTES.howItWorksPatient },
        { label: 'Your control', href: '/patients#control' },
      ]}
      signInHref={APP_ENTRY.patientSignIn}
      signInLabel="Sign in"
      action={{ label: 'Get your Health ID', href: APP_ENTRY.patientSignUp }}
    />
  )
}
