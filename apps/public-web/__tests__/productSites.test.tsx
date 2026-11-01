import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PRODUCT_SITE_SUBDOMAINS, ROUTES, productSiteHref } from '@/content/site'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  push.mockReset()
})

/**
 * Every product is its own site (owner, 2026-11-01): the edge serves each product's page as that site's front page
 * and sends /products/<slug> there, so this site links to the product's site itself, with no redirect between.
 */
describe('product sites', () => {
  it('links each product with a site of its own to that site, in production and staging', () => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'production')
    expect(ROUTES.product('ehr')).toBe('https://ehr.healthidentitydirectory.com/')
    expect(ROUTES.product('laboratory')).toBe('https://lab.healthidentitydirectory.com/')
    expect(ROUTES.product('pharmacy')).toBe('https://pharmacy.healthidentitydirectory.com/')
    expect(ROUTES.product('migrate')).toBe('https://migrate.healthidentitydirectory.com/')
    expect(ROUTES.product('outreach')).toBe('https://outreach.healthidentitydirectory.com/')
    // The API has no site of its own, and Identity is the patients' page.
    expect(ROUTES.product('api')).toBe('/products/api')
    expect(ROUTES.product('identity')).toBe('/patients')

    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'staging')
    expect(ROUTES.product('laboratory')).toBe('https://lab.staging.healthidentitydirectory.com/')
    expect(ROUTES.product('migrate')).toBe('https://migrate.staging.healthidentitydirectory.com/')
    expect(ROUTES.product('api')).toBe('/products/api')
  })

  it('keeps its own product pages in local development, where no edge serves the product sites', () => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'local')
    for (const slug of Object.keys(PRODUCT_SITE_SUBDOMAINS)) {
      expect(productSiteHref(slug)).toBeNull()
      expect(ROUTES.product(slug)).toBe(`/products/${slug}`)
    }
  })

  it('opens a product site from search by a full navigation', async () => {
    vi.stubEnv('NEXT_PUBLIC_HID_ENVIRONMENT', 'production')
    vi.stubEnv('NEXT_PUBLIC_HID_PORTAL_ORIGIN', 'https://app.healthidentitydirectory.com')
    vi.stubEnv('NEXT_PUBLIC_HID_APP_ORIGIN', window.location.origin)
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: window.location.origin, assign })
    await search('Health ID Laboratory')
    expect(assign).toHaveBeenCalledWith('https://lab.healthidentitydirectory.com/')
    expect(push).not.toHaveBeenCalled()
  })

  it('keeps this site\'s own search results in the page on this site', async () => {
    vi.stubEnv('NEXT_PUBLIC_HID_APP_ORIGIN', window.location.origin)
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: window.location.origin, assign })
    await search('Pricing')
    expect(push).toHaveBeenCalledWith('/pricing')
    expect(assign).not.toHaveBeenCalled()
  })

  it('opens this site\'s pages on this site when the page is a product site\'s front page', async () => {
    vi.stubEnv('NEXT_PUBLIC_HID_APP_ORIGIN', 'https://healthidentitydirectory.com')
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'https://lab.healthidentitydirectory.com', assign })
    await search('Pricing')
    expect(assign).toHaveBeenCalledWith('https://healthidentitydirectory.com/pricing')
    expect(push).not.toHaveBeenCalled()
  })
})

/** Searches as a visitor does, with the search built for the environment stubbed above (its table is built on load). */
async function search(term: string) {
  vi.resetModules()
  const { GlobalSearch, GlobalSearchProvider } = await import('@/components/layout/GlobalSearch')
  render(<GlobalSearchProvider><GlobalSearch /></GlobalSearchProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Search Health ID' }))
  const input = screen.getByRole('combobox', { name: 'Search Health ID' })
  fireEvent.change(input, { target: { value: term } })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'Enter' })
}
