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
 * "Earn with Health ID": the facility referral programme. The left column says
 * how it works and who it is for; the right column is the referral form.
 */
export default function EarnPage() {
  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy="earn-title">
          <Wrap>
            <div className="mx-auto grid max-w-[1080px] gap-x-24 gap-y-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{REFERRAL_PAGE.eyebrow}</p>
                <h1 id="earn-title" className="mt-4 font-display text-[clamp(2.5rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-balance text-ink">
                  {REFERRAL_PAGE.title}
                </h1>
                <p className="mt-5 text-base/relaxed text-muted">{REFERRAL_PAGE.lede}</p>
                <p className="mt-4 text-[15px]/relaxed text-ink">
                  {REFERRAL_PAGE.reward ? <>You earn <strong className="font-semibold">{REFERRAL_PAGE.reward}</strong>.</> : REFERRAL_PAGE.rewardPending}
                </p>

                <ol aria-label="How referrals work" className="mt-12 flex flex-col border-t border-line-strong">
                  {REFERRAL_PAGE.steps.map((step, index) => (
                    <li key={step.title} className="flex gap-5 border-b border-line py-6">
                      <span aria-hidden="true" className="font-display text-2xl leading-none text-brand tabular-nums">{index + 1}</span>
                      <div>
                        <h2 className="text-[16px] font-semibold text-ink">{step.title}</h2>
                        <p className="mt-1.5 text-[15px]/relaxed text-muted">{step.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-1">
                  <section aria-labelledby="earn-who">
                    <h2 id="earn-who" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{REFERRAL_PAGE.whoTitle}</h2>
                    <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-[15px]/relaxed text-text marker:text-faint">
                      {REFERRAL_PAGE.who.map(item => <li key={item}>{item}</li>)}
                    </ul>
                  </section>
                  <section aria-labelledby="earn-rules">
                    <h2 id="earn-rules" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{REFERRAL_PAGE.rulesTitle}</h2>
                    <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-[15px]/relaxed text-text marker:text-faint">
                      {REFERRAL_PAGE.rules.map(item => <li key={item}>{item}</li>)}
                    </ul>
                  </section>
                </div>
              </div>

              <section id="refer" aria-labelledby="refer-title" className="min-w-0 scroll-mt-28 lg:sticky lg:top-28 lg:self-start">
                <h2 id="refer-title" className="font-display text-[clamp(1.875rem,3vw,2.25rem)] leading-[1.1] text-ink">{REFERRAL_PAGE.formTitle}</h2>
                <p className="mt-2 mb-8 text-[15px] text-muted">{REFERRAL_PAGE.formLede}</p>
                <ReferralForm />
              </section>
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
