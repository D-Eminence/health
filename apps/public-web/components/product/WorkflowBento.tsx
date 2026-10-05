'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cx } from '@hid/ui'
import { HeroDemoButton } from '@/components/shared/HeroDemoButton'
import { HealthIcon } from '@/components/shared/HealthIcon'
import type { ProductDetail } from '@/content/product-details'
import { isApplicationProduct, providerApplicationHref, PROVIDER_SETUP_CTA } from '@/lib/provider-application'

const CTA: Record<string, string> = {
  outreach: 'Plan an outreach programme',
  api: 'Explore integration options',
}

type StepPreview = { readonly route: string; readonly detail: string; readonly result: string }

/** Sample states correspond to supported route families, never live gateway data. */
const PREVIEWS: Record<string, readonly StepPreview[]> = {
  migrate: [
    { route: 'EHR document upload', detail: 'A source document is attached to a patient record.', result: 'Source retained' },
    { route: 'OCR job', detail: 'One job tracks one document through extraction.', result: 'Job created' },
    { route: 'OCR extraction', detail: 'Extracted fields are available for review.', result: 'Review needed' },
    { route: 'OCR validation', detail: 'An authorised reviewer records the validation decision.', result: 'Validated' },
    { route: 'Patient confirmation', detail: 'The reviewer confirms the patient for the job.', result: 'Patient confirmed' },
    { route: 'OCR publication', detail: 'Validated information is published through a controlled route.', result: 'Published' },
  ],
  laboratory: [
    { route: 'Lab request', detail: 'A request is associated with a patient and care purpose.', result: 'Received' },
    { route: 'Patient lookup', detail: 'Staff check identity in their authorised facility context.', result: 'Identity checked' },
    { route: 'Sample collection', detail: 'Collection details are recorded against the request.', result: 'Collected' },
    { route: 'Lab processing', detail: 'The sample moves through the available lab workflow.', result: 'Processing' },
    { route: 'Result entry', detail: 'Structured results are recorded for review.', result: 'Entered' },
    { route: 'Verification', detail: 'Authorised staff verify and release the result.', result: 'Released' },
  ],
  pharmacy: [
    { route: 'Prescription work item', detail: 'A clinician-issued prescription enters the dispensing queue.', result: 'Received' },
    { route: 'Patient lookup', detail: 'The patient is identified before medication is dispensed.', result: 'Identity checked' },
    { route: 'Dispensing', detail: 'Medication, quantity and instructions are recorded.', result: 'Recorded' },
    { route: 'Medication record', detail: 'The dispensing remains associated with the patient.', result: 'Connected' },
    { route: 'Work item review', detail: 'Staff review the recorded dispensing details.', result: 'Reviewed' },
    { route: 'Reversal', detail: 'A correction is made by recording a reversal.', result: 'Corrected' },
    { route: 'Audit', detail: 'Actions retain staff and facility context.', result: 'Attributable' },
  ],
  outreach: [
    { route: 'Campaign', detail: 'An authorised staff member creates a campaign.', result: 'Created' },
    { route: 'Campaign member', detail: 'Staff are assigned to the campaign.', result: 'Assigned' },
    { route: 'Registration case', detail: 'Temporary patient details are captured in a case.', result: 'Received' },
    { route: 'Case review', detail: 'Identity resolution is reviewed before linking.', result: 'Review needed' },
    { route: 'Existing patient link', detail: 'An authorised existing patient is linked to the case.', result: 'Resolved' },
    { route: 'Case list', detail: 'Staff review the campaign and its case statuses.', result: 'Visible' },
  ],
  api: [
    { route: 'POST /api/v1/identity/patient-lookup', detail: 'Identity lookup requires a staff session, facility and care purpose.', result: 'Scoped' },
    { route: 'POST /api/v1/identity/authorization/check', detail: 'Check the requested patient, scope and purpose before access.', result: 'Checked' },
    { route: '/api/v1/identity/access-requests', detail: 'Use the supported patient access request workflow.', result: 'Controlled' },
    { route: '/api/v1/ehr', detail: 'Clinical records use the permitted encounter and patient routes.', result: 'Authorised' },
    { route: '/api/v1/lab · /api/v1/pharmacy', detail: 'Contribute through the supported service routes.', result: 'Scoped' },
    { route: '/api/v1/audit/events', detail: 'Access activity remains attributable for review.', result: 'Recorded' },
  ],
}

function Preview({ product, index }: { product: ProductDetail; index: number }) {
  const reducedMotion = useReducedMotion()
  const step = product.workflows[index]
  const example = PREVIEWS[product.slug]?.[index]
  if (!step || !example) return null

  return (
    <motion.div
      key={`${product.slug}-${index}`}
      initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: 'easeOut' }}
      className="overflow-hidden rounded-2xl border border-line bg-white"
      aria-label={`${step.title} illustrative preview`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-tint px-4 py-3 sm:px-5">
        <div>
          <p className="font-mono text-[9px] font-semibold tracking-[.1em] text-brand">{product.name.toUpperCase()}</p>
          <p className="mt-1 text-[13px] font-semibold text-ink">{step.title}</p>
        </div>
        <span className="rounded-full bg-brand-tint px-2.5 py-1 text-[10px] font-semibold text-brand">Illustrative</span>
      </div>
      <div className="p-3 sm:p-4">
        <ol className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" aria-label="Workflow stages">
          {product.workflows.map((item, position) => (
            <li key={item.title} className={cx(
              'rounded-md px-1.5 py-2 text-center text-[9px] font-medium',
              position === index ? 'bg-brand text-white' : position < index ? 'bg-surface-tint text-muted' : 'border border-line text-faint',
            )}>{String(position + 1).padStart(2, '0')}</li>
          ))}
        </ol>
        <div className="mt-3 grid gap-3 sm:grid-cols-[.82fr_1.18fr]">
          <div className="rounded-xl border border-line bg-surface-tint p-3">
            <p className="font-mono text-[9px] font-semibold text-muted">SUPPORTED WORKFLOW</p>
            <p className="mt-3 break-words text-[12px] font-semibold text-ink">{example.route}</p>
            <p className="mt-2 text-[11px]/relaxed text-muted">{example.detail}</p>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="font-mono text-[9px] font-semibold text-muted">EXAMPLE STATE</p>
            <p className="mt-3 text-[13px] font-semibold text-ink">{example.result}</p>
            <p className="mt-2 text-[11px]/relaxed text-muted">{step.body}</p>
            <p className="mt-3 border-t border-line pt-3 text-[10px] text-faint">Sample workflow only. No request is sent from this illustration.</p>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export function WorkflowBento({ product }: { product: ProductDetail }) {
  const [selected, setSelected] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const current = hovered ?? selected
  return (
    <section id="workflows" aria-labelledby="workflows-title" className="bg-white py-14 sm:py-20 lg:py-24">
      <div className="mx-auto w-full max-w-[1240px] px-6">
        <div className="max-w-[600px]">
          <p className="font-mono text-[11px] font-semibold tracking-[.12em] text-brand">{product.name.toUpperCase()}</p>
          <h2 id="workflows-title" className="mt-3 font-display text-[clamp(2rem,4vw,3.25rem)] leading-[1.06] tracking-[-.03em] text-ink">Core capabilities</h2>
          <p className="mt-3 text-[15px]/relaxed text-muted">Select a step to see how the supported workflow is represented. These examples do not use live patient data.</p>
        </div>
        <div className="mt-9 grid items-start gap-8 lg:grid-cols-[minmax(300px,.78fr)_minmax(0,1.22fr)] lg:gap-12">
          <ol aria-label={`${product.name} capabilities`} className="overflow-hidden rounded-2xl border border-line bg-white">
            {product.workflows.map((item, index) => (
              <li key={item.title} className="border-b border-line last:border-0">
                <button type="button" aria-pressed={selected === index}
                  onClick={() => { setSelected(index); setHovered(null) }}
                  onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)} onBlur={() => setHovered(null)}
                  className={cx('group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand motion-reduce:transition-none', selected === index ? 'bg-brand-tint/70' : 'hover:bg-surface-tint')}>
                  <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg font-mono text-[10px] font-semibold', selected === index ? 'bg-brand text-white' : 'bg-surface-tint text-muted')}>{String(index + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1"><span className={cx('block text-[14px] font-semibold', selected === index ? 'text-brand' : 'text-ink')}>{item.title}</span><span className="mt-1 block text-[13px]/relaxed text-muted sm:text-[14px]/relaxed">{item.body}</span></span>
                  <HealthIcon name="arrow" size={15} className="mt-1 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </button>
                {selected === index ? <div className="px-3 pb-4 lg:hidden"><Preview product={product} index={index} /></div> : null}
              </li>
            ))}
          </ol>
          <div className="hidden lg:sticky lg:top-24 lg:block"><Preview product={product} index={current} /></div>
        </div>
        {isApplicationProduct(product.slug)
          ? <HeroDemoButton href={providerApplicationHref(product.slug)} size="sm" className="mt-6">{PROVIDER_SETUP_CTA}</HeroDemoButton>
          : <HeroDemoButton href="#demo" size="sm" className="mt-6">{CTA[product.slug] ?? product.cta}</HeroDemoButton>}
      </div>
    </section>
  )
}
