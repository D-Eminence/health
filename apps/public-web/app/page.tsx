import Image from 'next/image'
import Link from 'next/link'
import { Display, Wrap } from '@hid/ui'
import { AUDIENCES, CHOOSER } from '@/content/site'
import { LogoImage } from '@/components/layout/Logo'

export const metadata = {
  title: 'Choose how you use Health ID',
  description:
    'Health ID works differently for patients and for healthcare providers. Choose the experience that fits your role.',
}

/**
 * The entry screen.
 *
 * Health ID serves two audiences with genuinely different products, so the site
 * asks once rather than trying to address both at the top of one page. Both
 * options are plain links: the choice routes, it does not set state, so it
 * survives a shared URL and works with JavaScript disabled.
 */
export default function ChooserPage() {
  return (
    <main
      id="main"
      className="flex min-h-screen flex-col justify-center bg-surface-tint py-16"
    >
      <Wrap>
        <div className="flex flex-col items-center gap-7">
          <span className="flex items-center gap-2 text-brand">
            <LogoImage variant="nav" />
          </span>

          <div className="flex flex-col items-center gap-4">
            <Display as="h1" size="lg" className="text-center">
              {CHOOSER.title}
            </Display>
            <p className="max-w-[520px] text-center text-base/relaxed text-muted">{CHOOSER.lede}</p>
          </div>

          <ul className="grid w-full max-w-[820px] gap-5 sm:grid-cols-2">
            {AUDIENCES.map(audience => (
              <li key={audience.id} className="flex">
                <Link
                  href={audience.href}
                  className="group flex flex-1 flex-col items-center gap-4 rounded-(--radius-panel) border border-white/70 bg-white/65 p-8 text-center shadow-[0_18px_48px_rgba(15,39,66,0.10),inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-xl backdrop-saturate-150 transition-shadow hover:shadow-[0_24px_60px_rgba(15,39,66,0.16)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <Image
                    src={audience.image}
                    alt={audience.imageAlt}
                    width={180}
                    height={130}
                    className="h-[118px] w-auto object-contain"
                    priority
                  />
                  <Display as="h2" size="sm">
                    {audience.title}
                  </Display>
                  <p className="max-w-[38ch] text-[15px]/relaxed text-muted">{audience.body}</p>
                  <span className="mt-auto pt-3 font-semibold text-brand group-hover:text-brand-dark">
                    Continue <span aria-hidden="true">&rarr;</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <p className="text-[13px] text-faint">{CHOOSER.footnote}</p>
        </div>
      </Wrap>
    </main>
  )
}
