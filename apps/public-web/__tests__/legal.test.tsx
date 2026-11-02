import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import TermsPage from '../app/terms/page'
import PrivacyPage from '../app/privacy/page'

// The page frame (navigation, footer, dialogs) needs the app router; the documents do not.
vi.mock('@/components/layout/SiteNav', () => ({ ProviderNav: () => null }))
vi.mock('@/components/layout/SiteFooter', () => ({ SiteFooter: () => null }))
vi.mock('@/components/shared/BackToTop', () => ({ BackToTop: () => null }))
vi.mock('@/components/shared/DemoDialog', () => ({ DemoDialog: () => null }))
import { DATA_PROTECTION_OFFICER, PRIVACY_POLICY, TERMS_OF_SERVICE } from '../content/legal'
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

  it('renders the privacy policy as the privacy notice, then numbered sections, linking to the terms', () => {
    render(<PrivacyPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeTruthy()
    // The notice's own heading comes first, then hid-1.0's 21 numbered sections.
    expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent))
      .toEqual(['Privacy notice', ...PRIVACY_POLICY.sections.map((section, index) => `${index + 1}. ${section.title}`)])
    expect(screen.getByText('Data Breach Notification', { exact: false }).tagName).toBe('H2')
    expect(screen.getByRole('link', { name: 'Read the Terms of Service' }).getAttribute('href')).toBe('/terms')
  })

  it('names the Data Protection Officer, with their email and phone, in the notice and in the policy', () => {
    expect(DATA_PROTECTION_OFFICER).toEqual({ name: 'Ibrahim Umar', email: 'ibrahim@healthidentitydirectory.com', phone: '+2347026717252' })
    render(<PrivacyPage />)
    const notice = screen.getByRole('region', { name: 'Privacy notice' })
    expect(within(notice).getByText(/contact our Data Protection Officer, Ibrahim Umar/)).toBeTruthy()
    expect(within(notice).getByRole('link', { name: 'ibrahim@healthidentitydirectory.com' }).getAttribute('href')).toBe('mailto:ibrahim@healthidentitydirectory.com')
    expect(within(notice).getByRole('link', { name: '+2347026717252' }).getAttribute('href')).toBe('tel:+2347026717252')
    expect(within(notice).getByText(/certified by the Nigeria Data Protection Commission \(NDPC\)\. \[owner to add: certificate number and date\]/)).toBeTruthy()
    expect(within(notice).getByText(/complain to the Nigeria Data Protection Commission \(NDPC\) at ndpc\.gov\.ng/)).toBeTruthy()

    const dpoSection = screen.getByRole('heading', { level: 2, name: /Data Protection Officer \(DPO\)$/ }).closest('li')
    expect(dpoSection).not.toBeNull()
    expect(within(dpoSection as HTMLElement).getByText('HID\'s Data Protection Officer (DPO) is Ibrahim Umar. Email ibrahim@healthidentitydirectory.com or call +2347026717252.')).toBeTruthy()
    expect(within(dpoSection as HTMLElement).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Monitoring compliance with data protection laws.', 'Advising on data privacy obligations.', 'Serving as a point of contact for users and regulators.',
    ])
    expect(screen.queryByText(/may appoint/)).toBeNull()
  })

  it('promises only what the product does: no emergency review, and a profile photo is the only upload today', () => {
    render(<PrivacyPage />)
    const notice = screen.getByRole('region', { name: 'Privacy notice' })
    expect(within(notice).getByText(/a health worker can open your records without asking you first\. They must give a reason\. You are told each time, it is recorded in the audit log, and their access ends by itself after 30 minutes\./)).toBeTruthy()
    expect(within(notice).queryByText(/reviewed/)).toBeNull()
    expect(within(notice).queryByText(/emergency summary/)).toBeNull()
    expect(within(notice).getByText(/If you add a profile photo, it is made smaller and its hidden details/)).toBeTruthy()
    expect(within(notice).getByText(/You cannot add your own health documents, or photos or files of your paper records, to Health ID yet\./)).toBeTruthy()
    expect(within(notice).queryByText(/cannot upload your own photos/)).toBeNull()
  })
})
