import { Display } from '@hid/ui'
import { HeroDemoButton } from './HeroDemoButton'

export interface CtaBandProps {
  readonly title: string
  readonly lede?: string
  readonly primary: { readonly label: string; readonly href: string }
  readonly secondary?: { readonly label: string; readonly href: string }
}

/**
 * The closing call to action.
 *
 * The one dark moment in an otherwise light page: a navy panel with brand light
 * bleeding through frosted glass. It closes the site the way the hero opens it:
 * same material, opposite ground, so the two ends of a page belong to each
 * other.
 */
export function CtaBand({ title, lede, primary, secondary }: CtaBandProps) {
  return (
    <div className="rounded-(--radius-panel) border border-line bg-white px-8 py-12 sm:px-12 sm:py-14">

      <div className="relative flex flex-col items-center gap-5 text-center">
        <Display as="h2" size="md">
          {title}
        </Display>
        {lede ? <p className="max-w-[52ch] text-base/relaxed text-muted">{lede}</p> : null}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
          <HeroDemoButton href={primary.href}>
            {primary.label}
          </HeroDemoButton>
          {secondary ? (
            <a
              href={secondary.href}
              className="inline-flex items-center justify-center rounded-(--radius-control) border border-line-strong bg-white px-7 py-3.5 text-[15px] font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
            >
              {secondary.label}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}
