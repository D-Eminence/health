import Link from 'next/link'
import { Wrap } from '@hid/ui'
import { PRODUCTS } from '@/content/products'
import { APP_ENTRY, ROUTES } from '@/content/site'
import { DEMO_INBOX } from '@/lib/demo-request'
import { Logo } from './Logo'

const FOOTER_GROUPS = [
  {
    title: 'Products',
    links: PRODUCTS.map(product => ({ label: product.name, href: ROUTES.product(product.slug) })),
  },
  {
    title: 'Explore',
    links: [
      { label: 'For providers', href: ROUTES.providers },
      { label: 'For patients', href: ROUTES.patients },
      { label: 'How it works', href: ROUTES.howItWorksProvider },
      { label: 'Pricing', href: ROUTES.pricing },
      { label: 'Solutions', href: ROUTES.solutions },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About Health ID', href: ROUTES.about },
      { label: 'Blog', href: ROUTES.blog },
      { label: 'Earn with us', href: ROUTES.earn },
      { label: 'Contact', href: ROUTES.contact },
      { label: 'Resources', href: ROUTES.resources },
      { label: 'Documentation', href: ROUTES.documentation },
      { label: 'Security', href: ROUTES.security },
      { label: 'Privacy', href: ROUTES.privacy },
    ],
  },
  {
    title: 'Sign in',
    links: [
      { label: 'Patient sign in', href: APP_ENTRY.patientSignIn },
      { label: 'Hospital sign in', href: APP_ENTRY.staffSignIn },
    ],
  },
] as const

export interface SiteFooterProps {
  readonly cta?: boolean
}

export function SiteFooter(_: SiteFooterProps) {
  return (
    <footer className="health-footer">
      <Wrap className="health-footer-wrap">
        <div className="health-footer-intro">
          <div className="health-footer-brand">
            <Logo variant="full" />
            <p>One health identity, connecting patients and healthcare providers across the systems that care for them.</p>
          </div>
          <a className="health-footer-contact" href={`mailto:${DEMO_INBOX}`}>
            <span>Building a more connected healthcare operation?</span>
            <strong>Talk to our team <span aria-hidden="true">↗</span></strong>
          </a>
        </div>

        <nav aria-label="Footer navigation" className="health-footer-navigation">
          {FOOTER_GROUPS.map(group => (
            <div className="health-footer-column" key={group.title}>
              <h2>{group.title}</h2>
              <ul>
                {group.links.map(link => <li key={link.href}>
                  <Link href={link.href}>{link.label}<span aria-hidden="true">↗</span></Link>
                </li>)}
              </ul>
            </div>
          ))}
        </nav>

        <div className="health-footer-bottom">
          <p>© 2026 Health Identity Directory Technologies Ltd. All rights reserved.</p>
          <p className="health-footer-tagline">One Identity. Connected Records. Better Care.</p>
          <Link href={ROUTES.chooser}>Change your experience <span aria-hidden="true">↗</span></Link>
        </div>
      </Wrap>
    </footer>
  )
}
