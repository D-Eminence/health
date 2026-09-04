import Link from 'next/link'
import { Wrap } from '@hid/ui'
import { PRODUCTS } from '@/content/products'
import { APP_ENTRY, ROUTES } from '@/content/site'
import { Logo } from './Logo'

const COMPANY_LINKS = [
  { label: 'How it works', href: ROUTES.howItWorksProvider },
  { label: 'Pricing', href: ROUTES.pricing },
  { label: 'For patients', href: ROUTES.patients },
  { label: 'For providers', href: ROUTES.providers },
]

const ACCESS_LINKS = [
  { label: 'Patient sign in', href: APP_ENTRY.patientSignIn },
  { label: 'Hospital sign in', href: APP_ENTRY.staffSignIn },
]

export function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-line bg-surface-tint">
      <Wrap className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="flex flex-col gap-3">
            <Logo />
            <p className="max-w-[280px] text-sm/relaxed text-muted">
              One health identity, connecting patients and healthcare providers across the systems
              that care for them.
            </p>
          </div>

          <FooterColumn title="Products">
            {PRODUCTS.map(product => (
              <FooterLink key={product.slug} href={ROUTES.product(product.slug)}>
                {product.name}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title="Company">
            {COMPANY_LINKS.map(link => (
              <FooterLink key={link.href} href={link.href}>
                {link.label}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title="Access">
            {ACCESS_LINKS.map(link => (
              <FooterLink key={link.href} href={link.href}>
                {link.label}
              </FooterLink>
            ))}
          </FooterColumn>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-[13px] text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {year} Health ID. All rights reserved.</p>
          {/* The chooser is the way back to the other audience, which is what
              the entry screen promises when it says "you can change this later". */}
          <Link href={ROUTES.chooser} className="font-medium text-muted hover:text-brand">
            Change your experience
          </Link>
        </div>
      </Wrap>
    </footer>
  )
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-mono text-[11px] font-medium tracking-[0.12em] text-faint uppercase">
        {title}
      </h2>
      <ul className="flex flex-col gap-2.5">{children}</ul>
    </div>
  )
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-sm text-muted hover:text-brand">
        {children}
      </Link>
    </li>
  )
}
