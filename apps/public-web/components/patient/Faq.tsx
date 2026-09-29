import { Section, SectionHeader, Wrap } from '@hid/ui'
import { PATIENT_FAQ } from '@/content/patient'
import { HealthIcon } from '@/components/shared/HealthIcon'

/**
 * Frequently asked questions.
 *
 * Native `<details>` elements rather than a JavaScript accordion: they open,
 * close, respond to the keyboard and are searchable by the browser's find
 * function with no client bundle at all. The page stays a server component.
 */
export function PatientFaq() {
  return (
    <Section id="faq" labelledBy="faq-title">
      <Wrap>
        <SectionHeader id="faq-title" title={PATIENT_FAQ.title} size="md" />

        <ul className="mx-auto mt-10 flex max-w-[720px] flex-col gap-2">
          {PATIENT_FAQ.items.map(item => (
            <li key={item.question}>
              <details className="group rounded-(--radius-card) border border-line bg-surface open:bg-surface-tint">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[16px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <span
                    aria-hidden="true"
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-muted transition-transform group-open:rotate-45"
                  >
                    <HealthIcon name="plus" size={13} />
                  </span>
                </summary>
                <p className="px-5 pb-5 text-[15px]/relaxed text-muted">{item.answer}</p>
              </details>
            </li>
          ))}
        </ul>
      </Wrap>
    </Section>
  )
}
