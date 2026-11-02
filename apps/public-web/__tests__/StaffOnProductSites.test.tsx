import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const navigation = vi.hoisted(() => ({ params: new URLSearchParams() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => navigation.params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
vi.mock('@/components/shared/DemoDialog', () => ({ DemoDialog: () => null }))

beforeEach(() => {
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('IntersectionObserver', Observer)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('This test makes no requests.'))))
  navigation.params = new URLSearchParams()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

/** Loads the site's modules afresh for this deployment, as a build for it would. */
async function deployedAs(environment: 'production' | 'staging' | 'local') {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', environment)
  vi.stubEnv('NEXT_PUBLIC_HID_PORTAL_ORIGIN', environment === 'production' ? 'https://app.healthidentitydirectory.com'
    : environment === 'staging' ? 'https://staging.healthidentitydirectory.com' : '')
  return import('@/content/site')
}

/**
 * The patient portal (app.) is for patients only, and each product site has its own staff sign-in and facility sign-up
 * (owner, 2026-11-02). The public site's staff links go to the product sites directly: the EHR site's when no product
 * is named, the chosen product's own site's when one is. Local development, which has no product sites, keeps the
 * local portal's.
 */
describe('the public site’s staff links', () => {
  it.each([
    ['production', 'https://ehr.healthidentitydirectory.com'],
    ['staging', 'https://ehr.staging.healthidentitydirectory.com'],
  ] as const)('in %s, staff sign in and facilities sign up on the EHR site (%s)', async (environment, ehr) => {
    const { APP_ENTRY } = await deployedAs(environment)
    expect(APP_ENTRY.staffSignIn).toBe(`${ehr}/provider/sign-in`)
    expect(APP_ENTRY.providerSignUp).toBe(`${ehr}/provider/enroll`)
    // Patients still sign in and get a Health ID on the patient portal.
    expect(new URL(APP_ENTRY.patientSignIn).pathname).toBe('/sign-in')
    expect(new URL(APP_ENTRY.patientSignUp).pathname).toBe('/enroll')
  })

  it('in local development, keeps the local portal’s staff pages, as there are no product sites', async () => {
    const { APP_ENTRY } = await deployedAs('local')
    expect(APP_ENTRY.staffSignIn).toBe('http://localhost:3200/provider/sign-in')
    expect(APP_ENTRY.providerSignUp).toBe('http://localhost:3200/provider/enroll')
  })

  it.each([
    ['laboratory', 'https://lab.healthidentitydirectory.com/provider/enroll?product=laboratory'],
    ['pharmacy', 'https://pharmacy.healthidentitydirectory.com/provider/enroll?product=pharmacy'],
    ['migrate', 'https://migrate.healthidentitydirectory.com/provider/enroll?product=migrate'],
    ['ehr', 'https://ehr.healthidentitydirectory.com/provider/enroll?product=ehr'],
    [null, 'https://ehr.healthidentitydirectory.com/provider/enroll'],
    ['outreach', 'https://ehr.healthidentitydirectory.com/provider/enroll'],
    ['toString', 'https://ehr.healthidentitydirectory.com/provider/enroll'],
    ['https://evil.example', 'https://ehr.healthidentitydirectory.com/provider/enroll'],
  ])('in production, a facility signing up for %s goes to %s', async (product, href) => {
    const { productSignUpHref } = await deployedAs('production')
    expect(productSignUpHref(product)).toBe(href)
  })

  it('in local development, a facility signs up on the local portal, with its product', async () => {
    const { productSignUpHref } = await deployedAs('local')
    expect(productSignUpHref('laboratory')).toBe('http://localhost:3200/provider/enroll?product=laboratory')
    expect(productSignUpHref(null)).toBe('http://localhost:3200/provider/enroll')
  })

  it.each([
    ['laboratory', 'https://lab.healthidentitydirectory.com/provider/enroll?product=laboratory'],
    ['pharmacy', 'https://pharmacy.healthidentitydirectory.com/provider/enroll?product=pharmacy'],
    [null, 'https://ehr.healthidentitydirectory.com/provider/enroll'],
    ['api', 'https://ehr.healthidentitydirectory.com/provider/enroll'],
  ])('“Setup Your Facility” for %s opens %s at once', async (product, href) => {
    await deployedAs('production')
    if (product) navigation.params = new URLSearchParams({ product })
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, replace })
    const { ProviderApplyRedirect } = await import('../app/provider/apply/ProviderApplyRedirect')
    render(createElement(ProviderApplyRedirect))
    expect(replace).toHaveBeenCalledWith(href)
    expect(screen.getByRole('link', { name: 'Continue to facility setup' }).getAttribute('href')).toBe(href)
  })

  it.each([
    ['laboratory', 'production', 'https://lab.healthidentitydirectory.com/provider/sign-in'],
    ['pharmacy', 'production', 'https://pharmacy.healthidentitydirectory.com/provider/sign-in'],
    ['migrate', 'production', 'https://migrate.healthidentitydirectory.com/provider/sign-in'],
    ['ehr', 'production', 'https://ehr.healthidentitydirectory.com/provider/sign-in'],
    ['laboratory', 'staging', 'https://lab.staging.healthidentitydirectory.com/provider/sign-in'],
    ['laboratory', 'local', 'http://localhost:3200/provider/sign-in'],
  ] as const)('the facility completion page for %s, in %s, signs in at %s', async (product, environment, href) => {
    await deployedAs(environment)
    vi.stubEnv('NEXT_PUBLIC_HID_API_BASE_URL', 'https://healthidentitydirectory.com')
    vi.stubEnv('NEXT_PUBLIC_HID_APP_ORIGIN', 'https://healthidentitydirectory.com')
    const { ProviderCompletionForm } = await import('../app/provider/complete/ProviderCompletionForm')
    render(createElement(ProviderCompletionForm, { initialProduct: product }))
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(href)
  })

  it('the facility completion page signs in on the product chosen on the page', async () => {
    await deployedAs('production')
    vi.stubEnv('NEXT_PUBLIC_HID_API_BASE_URL', 'https://healthidentitydirectory.com')
    vi.stubEnv('NEXT_PUBLIC_HID_APP_ORIGIN', 'https://healthidentitydirectory.com')
    const { ProviderCompletionForm } = await import('../app/provider/complete/ProviderCompletionForm')
    render(createElement(ProviderCompletionForm, { initialProduct: 'ehr' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Product' }), { target: { value: 'pharmacy' } })
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href'))
      .toBe('https://pharmacy.healthidentitydirectory.com/provider/sign-in')
  })

  it('in production, no footer, navigation or product page link opens a staff page on the patient portal', async () => {
    await deployedAs('production')
    const { SiteFooter } = await import('@/components/layout/SiteFooter')
    const { ProviderNav } = await import('@/components/layout/SiteNav')
    const { default: ProductPage } = await import('../app/products/[slug]/page')
    render(createElement('div', null, createElement(SiteFooter), createElement(ProviderNav)))
    render(await ProductPage({ params: Promise.resolve({ slug: 'pharmacy' }) }))
    const hrefs = screen.getAllByRole('link', { hidden: true }).map(link => link.getAttribute('href') ?? '')
    expect(hrefs.length).toBeGreaterThan(10)
    for (const href of hrefs) expect(href, href).not.toMatch(/^https:\/\/app\.healthidentitydirectory\.com\/provider/)
    // The footer's and the navigation's staff sign-in: the EHR site's. The pharmacy page's own: the pharmacy site's.
    for (const link of screen.getAllByRole('link', { name: 'Hospital sign in', hidden: true })) {
      expect(['https://ehr.healthidentitydirectory.com/provider/sign-in',
        'https://pharmacy.healthidentitydirectory.com/provider/sign-in']).toContain(link.getAttribute('href'))
    }
    expect(hrefs).toContain('https://ehr.healthidentitydirectory.com/provider/sign-in')
    expect(hrefs).toContain('https://pharmacy.healthidentitydirectory.com/provider/sign-in')
  })
})
