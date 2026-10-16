import type { Metadata } from 'next'
import { Section, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { BackToTop } from '@/components/shared/BackToTop'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { ReferralForm } from '@/components/referral/ReferralForm'
import { REFERRAL_PAGE } from '@/content/referral'

export const metadata: Metadata = {
  title: 'Earn with Health ID',
  description: REFERRAL_PAGE.lede,
}

/**
 * "Earn with Health ID": the facility referral programme. The intro and three
 * steps sit beside the two-step referral form; the rules follow in one quiet
 * section underneath.
 */
export default function EarnPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy="earn-title">
          <Wrap>
            <div className="mx-auto grid max-w-[1080px] items-start gap-x-20 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
              <div className="min-w-0 lg:pt-6">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{REFERRAL_PAGE.eyebrow}</p>
                <h1 id="earn-title" className="mt-4 font-display text-[clamp(2.5rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-balance text-ink">
                  {REFERRAL_PAGE.title}
                </h1>
                <p className="mt-5 max-w-[46ch] text-[17px]/relaxed text-muted">{REFERRAL_PAGE.lede}</p>

                <ol aria-label="How referrals work" className="mt-10 flex flex-col gap-5">
                  {REFERRAL_PAGE.steps.map((step, index) => (
                    <li key={step.title} className="flex items-baseline gap-4">
                      <span aria-hidden="true" className="w-5 shrink-0 font-display text-xl leading-none text-brand tabular-nums">{index + 1}</span>
                      <p className="text-[15px]/relaxed text-muted">
                        <span className="font-semibold text-ink">{step.title}.</span> {step.body}
                      </p>
                    </li>
                  ))}
                </ol>

                <p className="mt-10 max-w-[46ch] border-l-2 border-brand pl-4 text-[14px]/relaxed text-muted">
                  {REFERRAL_PAGE.reward ? <>You earn <strong className="font-semibold text-ink">{REFERRAL_PAGE.reward}</strong>.</> : REFERRAL_PAGE.rewardPending}
                </p>
              </div>

              <section id="refer" aria-labelledby="refer-title"
                className="min-w-0 scroll-mt-28 rounded-(--radius-card) border border-line-strong bg-surface p-6 sm:p-8">
                <h2 id="refer-title" className="font-display text-[2rem] leading-[1.1] text-ink">{REFERRAL_PAGE.formTitle}</h2>
                <ReferralForm lede={REFERRAL_PAGE.formLede} />
              </section>
            </div>
          </Wrap>
        </Section>

        <Section labelledBy="earn-rules" tone="sunk">
          <Wrap>
            <div className="mx-auto max-w-[1080px]">
              <h2 id="earn-rules" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{REFERRAL_PAGE.rulesTitle}</h2>
              <ul className="mt-6 grid gap-x-16 gap-y-5 md:grid-cols-2">
                {REFERRAL_PAGE.rules.map(rule => (
                  <li key={rule} className="border-t border-line-strong pt-4 text-[15px]/relaxed text-text">{rule}</li>
                ))}
              </ul>
            </div>
          </Wrap>
        </Section>
      </main>
      <SiteFooter />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
