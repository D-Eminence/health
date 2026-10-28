import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import TermsPage from '../app/terms/page'
import PrivacyPage from '../app/privacy/page'

// The page frame (navigation, footer, dialogs) needs the app router; the documents do not.
vi.mock('@/components/layout/SiteNav', () => ({ ProviderNav: () => null }))
vi.mock('@/components/layout/SiteFooter', () => ({ SiteFooter: () => null }))
vi.mock('@/components/shared/BackToTop', () => ({ BackToTop: () => null }))
vi.mock('@/components/shared/DemoDialog', () => ({ DemoDialog: () => null }))
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from '../content/legal'
import { ROUTES } from '../content/site'

/** hid-1.0's agreement had 36 sections; the two pages share them out, each once. */
describe('the Terms of Service and Privacy Policy', () => {
  it('live at /terms and /privacy, and keep the website notice at /resources/privacy', () => {
    expect(ROUTES.terms).toBe('/terms')
    expect(ROUTES.privacyPolicy).toBe('/privacy')
    expect(ROUTES.privacy).toBe('/resources/privacy')
  })

  it('carry all 36 of hid-1.0’s sections between them, none twice and none empty', () => {
    expect(TERMS_OF_SERVICE.sections).toHaveLength(15)
    expect(PRIVACY_POLICY.sections).toHaveLength(21)
    const titles = [...TERMS_OF_SERVICE.sections, ...PRIVACY_POLICY.sections].map(section => section.title)
    expect(new Set(titles).size).toBe(36)
    for (const section of [...TERMS_OF_SERVICE.sections, ...PRIVACY_POLICY.sections]) {
      expect((section.paragraphs?.length ?? 0) + (section.bullets?.length ?? 0)).toBeGreaterThan(0)
    }
    expect(TERMS_OF_SERVICE.sections[0]?.title).toBe('Introduction')
    expect(PRIVACY_POLICY.sections[0]?.title).toBe('Data Ownership')
  })

  it('renders the terms as numbered sections, linking to the privacy policy', () => {
    render(<TermsPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeTruthy()
    const sections = screen.getAllByRole('heading', { level: 2 })
    expect(sections.map(heading => heading.textContent)).toEqual(TERMS_OF_SERVICE.sections.map((section, index) => `${index + 1}. ${section.title}`))
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Read the Privacy Policy' }).getAttribute('href')).toBe('/privacy')
  })

  it('renders the privacy policy as numbered sections, linking to the terms', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(21)
    expect(screen.getByText('Data Breach Notification', { exact: false }).tagName).toBe('H2')
    expect(screen.getByRole('link', { name: 'Read the Terms of Service' }).getAttribute('href')).toBe('/terms')
  })
})
