import { Wrap } from '@hid/ui'
import { CtaBand } from '@/components/shared/CtaBand'

/**
 * Closing call to action for the product and information pages.
 *
 * The homepage carries its call to action in the footer instead, so no page
 * asks twice.
 */
export function ProviderClosing({
  title,
  lede,
  primary,
  primaryHref = '#demo',
  secondary,
  secondaryHref,
}: {
  title: string
  lede: string
  primary: string
  primaryHref?: string
  secondary: string
  secondaryHref: string
}) {
  return (
    <section className="bg-surface px-0 py-14 sm:py-16">
      <Wrap>
        <CtaBand
          title={title}
          lede={lede}
          primary={{ label: primary, href: primaryHref }}
          secondary={{ label: secondary, href: secondaryHref }}
        />
      </Wrap>
    </section>
  )
}
