import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { OUTREACH_SIGN_UP_CTA, outreachSignUpHref, productSignInHref } from '@/content/site'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/products/outreach',
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
// The page's demo form reads the site's whole configuration, which is not what this test is about. Its stand-in says
// "Book a demo" as the real one does while closed, so a page that still carries it is caught.
vi.mock('@/components/shared/DemoDialog', () => ({ DemoDialog: () => <dialog data-testid="demo-dialog"><h2>Book a demo</h2></dialog> }))

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

async function renderProductPage(slug: string) {
  const { default: ProductPage } = await import('../app/products/[slug]/page')
  return render(await ProductPage({ params: Promise.resolve({ slug }) }))
}

/**
 * The outreach product page (the front page of outreach.) offers what outreach. now does: an organiser signs up and
 * starts running outreach (health#221), at /provider/enroll on the outreach site, the address that site gives the
 * organiser sign-up. It no longer offers a demo, and never facility sign-up, which has no outreach product. Sign in stays.
 */
describe('the outreach product page’s main action', () => {
  it.each([
    ['production', 'https://outreach.healthidentitydirectory.com/provider/enroll'],
    ['staging', 'https://outreach.staging.healthidentitydirectory.com/provider/enroll'],
  ])('is the organiser sign-up on the outreach site in %s', (environment, href) => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', environment)
    expect(outreachSignUpHref()).toBe(href)
  })

  it('is the local portal’s organiser sign-up in local development, where there is no product site', () => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'local')
    expect(new URL(outreachSignUpHref()).pathname).toBe('/provider/start-outreach')
  })

  it.each(['production', 'staging'])('shows "Start running outreach" in the navigation, hero and closing in %s, never "Book a demo"', async environment => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', environment)
    await renderProductPage('outreach')
    const href = outreachSignUpHref()

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: OUTREACH_SIGN_UP_CTA, hidden: true }).getAttribute('href')).toBe(href)
    expect(within(nav).getAllByRole('link', { name: 'Sign in', hidden: true })[0]?.getAttribute('href'))
      .toBe(productSignInHref('outreach'))

    const main = screen.getByRole('main')
    // The hero, the capabilities section and the closing section each lead to the sign-up.
    const inMain = within(main).getAllByRole('link', { name: OUTREACH_SIGN_UP_CTA, hidden: true })
    expect(inMain.length).toBeGreaterThanOrEqual(3)
    for (const link of inMain) expect(link.getAttribute('href')).toBe(href)
    expect(within(main).getByRole('link', { name: 'Hospital sign in', hidden: true }).getAttribute('href'))
      .toBe(productSignInHref('outreach'))

    expect(screen.queryByText(/book a demo/i)).toBeNull()
    expect(screen.queryByTestId('demo-dialog')).toBeNull()
    expect(screen.queryByText('Setup Your Facility')).toBeNull()
    expect(screen.queryByText('Run an outreach campaign')).toBeNull()
    for (const link of screen.getAllByRole('link', { hidden: true })) {
      expect(link.getAttribute('href')).not.toBe('#demo')
      expect(link.getAttribute('href') ?? '').not.toContain('/provider/apply')
    }
  })
})

describe('the api product page', () => {
  it('still offers "Book a demo" in the navigation, hero and closing, all opening the demo dialog', async () => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'production')
    await renderProductPage('api')

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Book a demo', hidden: true }).getAttribute('href')).toBe('#demo')

    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: 'Book a demo', hidden: true }).getAttribute('href')).toBe('#demo')
    expect(within(main).getByRole('link', { name: 'Explore integration options', hidden: true }).getAttribute('href')).toBe('#demo')
    expect(within(main).getByRole('link', { name: 'Connect your stack', hidden: true }).getAttribute('href')).toBe('#demo')
    expect(screen.queryByText(OUTREACH_SIGN_UP_CTA)).toBeNull()
    expect(screen.getByTestId('demo-dialog')).toBeTruthy()
  })
})
