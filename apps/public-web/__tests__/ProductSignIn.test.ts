import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { APP_ENTRY, PRODUCT_SITE_SUBDOMAINS, productSignInHref, productSiteHref } from '@/content/site'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/products/laboratory',
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
// The page's demo form reads the site's whole configuration, which is not what this test is about.
vi.mock('@/components/shared/DemoDialog', () => ({ DemoDialog: () => null }))

beforeEach(() => {
  // The page's sections measure and watch themselves as the visitor scrolls, which jsdom does not do.
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('IntersectionObserver', Observer)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }))
  // Nothing here may reach the network.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('This test makes no requests.'))))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/**
 * Each product page's Sign in goes to that product's own site's staff sign-in (owner, 2026-11-01: each product its own
 * sign-in): the site productSiteHref names for this build's deployment (health#108), whose front page is this same
 * page. Where there is no product site (local development, or a page with no site of its own), the portal's own staff
 * sign-in. The portal's address plays no part: this module was loaded with the local portal, and the product sites
 * still follow NEXT_PUBLIC_HID_ENVIRONMENT alone. Only the link changes: the pages' design and words stay as they are.
 */
describe('a product page’s Sign in', () => {
  it.each([
    ['ehr', 'https://ehr.healthidentitydirectory.com/provider/sign-in'],
    ['laboratory', 'https://lab.healthidentitydirectory.com/provider/sign-in'],
    ['pharmacy', 'https://pharmacy.healthidentitydirectory.com/provider/sign-in'],
    ['migrate', 'https://migrate.healthidentitydirectory.com/provider/sign-in'],
    ['outreach', 'https://outreach.healthidentitydirectory.com/provider/sign-in'],
  ])('on %s opens %s in production', (slug, href) => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'production')
    expect(productSignInHref(slug)).toBe(href)
  })

  it.each([
    ['ehr', 'https://ehr.staging.healthidentitydirectory.com/provider/sign-in'],
    ['laboratory', 'https://lab.staging.healthidentitydirectory.com/provider/sign-in'],
    ['pharmacy', 'https://pharmacy.staging.healthidentitydirectory.com/provider/sign-in'],
    ['migrate', 'https://migrate.staging.healthidentitydirectory.com/provider/sign-in'],
    ['outreach', 'https://outreach.staging.healthidentitydirectory.com/provider/sign-in'],
  ])('on %s opens %s on staging', (slug, href) => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'staging')
    expect(productSignInHref(slug)).toBe(href)
  })

  it.each([['local development', 'local'], ['no environment', undefined]])(
    'keeps the portal’s staff sign-in for every product in %s, where this site serves the product pages itself',
    (_name, environment) => {
      vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', environment)
      for (const slug of Object.keys(PRODUCT_SITE_SUBDOMAINS)) expect(productSignInHref(slug)).toBe(APP_ENTRY.staffSignIn)
    })

  it.each(['production', 'staging'])('keeps the portal’s staff sign-in in %s for the pages with no product site', environment => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', environment)
    for (const slug of ['identity', 'api', 'toString', '']) expect(productSignInHref(slug)).toBe(APP_ENTRY.staffSignIn)
  })

  it.each(['production', 'staging'])('signs in on the product site’s own host in %s, for every product site', environment => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', environment)
    for (const slug of Object.keys(PRODUCT_SITE_SUBDOMAINS)) {
      const site = productSiteHref(slug)
      expect(site, slug).not.toBeNull()
      expect(new URL(productSignInHref(slug)).origin, slug).toBe(new URL(site ?? '').origin)
    }
  })

  it('is the Sign in the product page’s navigation shows', async () => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'production')
    const { default: ProductPage } = await import('../app/products/[slug]/page')
    render(await ProductPage({ params: Promise.resolve({ slug: 'laboratory' }) }))
    const signIn = screen.getAllByRole('link', { name: 'Sign in', hidden: true })
    expect(signIn.length).toBeGreaterThan(0)
    for (const link of signIn) expect(link.getAttribute('href')).toBe('https://lab.healthidentitydirectory.com/provider/sign-in')
  })

  // Even where the product sites exist, the api page (no site of its own) and every other provider page, which use the
  // navigation's default, keep the portal's staff sign-in.
  it('stays the portal’s staff sign-in on the api page in production', async () => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'production')
    const { default: ProductPage } = await import('../app/products/[slug]/page')
    render(await ProductPage({ params: Promise.resolve({ slug: 'api' }) }))
    const signIn = screen.getAllByRole('link', { name: 'Sign in', hidden: true })
    expect(signIn.length).toBeGreaterThan(0)
    for (const link of signIn) expect(link.getAttribute('href')).toBe(APP_ENTRY.staffSignIn)
  })

  it('stays the portal’s staff sign-in in the provider navigation’s default in production', async () => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'production')
    const { ProviderNav } = await import('@/components/layout/SiteNav')
    render(createElement(ProviderNav))
    const signIn = screen.getAllByRole('link', { name: 'Sign in', hidden: true })
    expect(signIn.length).toBeGreaterThan(0)
    for (const link of signIn) expect(link.getAttribute('href')).toBe(APP_ENTRY.staffSignIn)
  })
})
