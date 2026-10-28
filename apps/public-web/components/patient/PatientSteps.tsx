'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Section, Wrap } from '@hid/ui'
import { Reveal } from '@/components/motion/Reveal'
import { StatefulButton, type ButtonState } from '@/components/motion/button/stateful'
import { BouncyAccordion } from '@/components/motion/bouncy-accordion'
import { HealthIcon } from '@/components/shared/HealthIcon'
import { EASE_OUT } from '@/lib/ease'
import { PATIENT_STEPS } from '@/content/patient'

function IdentityPreview() {
  const reduce = useReducedMotion()
  return <div className="patient-identity-visual" aria-label="Illustrative Health ID card">
    <Image src="/brand/access-pin-provider.png" alt="Patient viewing her Health ID on a phone at a hospital" width={1860} height={847} className="patient-identity-photo h-full w-full object-cover object-[72%_35%]" />
    <motion.div className="patient-id-reveal" initial={{ opacity: 0, y: reduce ? 0 : 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .3 }} transition={{ duration: .32, delay: reduce ? 0 : .15, ease: EASE_OUT }}>
      <div className="patient-id-card">
        <p>YOUR HEALTH ID</p>
        <div className="mt-6 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand">AF</span><span><b>Abeki Faridat</b><small>HID-7KQ2M9</small></span></div>
        <div className="mt-6 flex items-center justify-between border-t border-line pt-3"><span>Connected care</span><span className="patient-id-verified"><HealthIcon name="check" size={12} />Verified</span></div>
      </div>
    </motion.div>
    <motion.span className="patient-floating-chip patient-floating-chip-top" initial={{ opacity: 0, y: reduce ? 0 : 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: reduce ? 0 : .25, duration: .22 }}>One identity</motion.span>
    <motion.span className="patient-floating-chip patient-floating-chip-bottom" initial={{ opacity: 0, y: reduce ? 0 : 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: reduce ? 0 : .35, duration: .22 }}>Ready for care</motion.span>
  </div>
}

function AccessPreview() {
  const reduce = useReducedMotion()
  const [state, setState] = useState<ButtonState>('idle')
  const [filled, setFilled] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const preview = () => {
    if (state === 'loading') return
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (state === 'success') { setState('idle'); setFilled(0); return }
    if (reduce) { setFilled(4); setState('success'); return }
    setState('loading')
    for (let index = 1; index <= 4; index++) timers.current.push(setTimeout(() => setFilled(index), index * 150))
    timers.current.push(setTimeout(() => setState('success'), 900))
  }

  return <div className="patient-access-visual" aria-label="Illustrative access PIN approval">
    <div className="patient-access-request" data-approved={state === 'success'}>
      <p className="patient-preview-heading">ACCESS REQUEST <span>Preview</span></p>
      <div className="mt-5 flex items-center gap-3">
        <span className="patient-provider-mark" aria-hidden="true"><HealthIcon name="hospital" size={20} /></span>
        <span><b>Hospital Central</b><small>Consultation · Abeki Faridat</small></span>
      </div>
      <p className="patient-pin-label">Provide your access PIN</p>
      <div className="patient-pin-input" aria-hidden="true">
        {[0, 1, 2, 3].map(index => <span key={index} data-filled={filled > index}><motion.i initial={false} animate={{ opacity: filled > index ? 1 : 0, scale: reduce ? 1 : filled > index ? 1 : .4 }} transition={{ duration: .18, ease: EASE_OUT }} /></span>)}
      </div>
      <StatefulButton state={state} onClick={preview} className="patient-pin-button" loadingText={<span>Approving access</span>} successText={<span>Access granted · Replay</span>} aria-label={state === 'success' ? 'Replay access PIN preview' : state === 'loading' ? 'Approving access in preview' : 'Preview entering PIN to grant access'}>
        <span>Enter PIN to grant access</span>
      </StatefulButton>
      <p className="patient-privacy-note"><HealthIcon name="shield" size={14} /> Access remains protected until you approve it · End-to-end encrypted</p>
    </div>
  </div>
}

const HISTORY = [
  { name: 'Hospital A', action: 'Record viewed', when: 'Today', reason: 'Consultation', time: '10:24' },
  { name: 'Prime Laboratory', action: 'Result released', when: 'Yesterday', reason: 'Laboratory investigation', time: '14:32' },
  { name: 'Central Pharmacy', action: 'Prescription dispensed', when: '12 Mar', reason: 'Medication dispensing', time: '09:18' },
] as const

function HistoryPreview() {
  const reduce = useReducedMotion()
  const [expanded, setExpanded] = useState<string | null>(null)
  return <div className="patient-history-visual" aria-label="Illustrative access history">
    <p>ACCESS HISTORY</p>
    <ol>
      {HISTORY.map((item, index) => <motion.li key={item.name} initial={{ opacity: 0, x: reduce ? 0 : 8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: .24, delay: reduce ? 0 : .1 + index * .09, ease: EASE_OUT }}>
        <i /><span><b>{item.name}</b><small>{item.action} · {item.when}</small></span><em>Seen</em>
      </motion.li>)}
    </ol>
    <BouncyAccordion value={expanded} onValueChange={setExpanded} className="patient-history-accordion" classNames={{ item: 'patient-history-disclosure', trigger: 'patient-history-trigger', title: 'patient-history-trigger-label', content: 'patient-history-content' }}
      items={[{ id: 'full-history', title: expanded ? 'Show less' : 'View full history', description: <div className="patient-history-details"><p>Example access details</p>{HISTORY.map(item => <div key={item.name}><b>{item.name}</b><small>{item.when} · {item.time}</small><p>{item.reason}</p><span><HealthIcon name="shield" size={12} /> Authorised access</span></div>)}</div> }]}
    />
  </div>
}

/** One-time entrances and user-triggered examples keep the care story readable. */
export function PatientSteps() {
  const reduce = useReducedMotion()
  const visuals = [<IdentityPreview key="identity" />, <AccessPreview key="access" />, <HistoryPreview key="history" />]
  return <Section id="steps" labelledBy="steps-title"><Wrap>
    <Reveal className="mx-auto max-w-[760px] text-center">
      <p className="font-mono text-[12px] font-semibold tracking-[0.12em] text-brand uppercase">Your Health ID</p>
      <h2 id="steps-title" className="mt-4 font-display text-[clamp(2rem,3.5vw,2.5rem)] leading-[1.08] tracking-[-0.025em] text-ink">{PATIENT_STEPS.title}</h2>
    </Reveal>
    <ol className="patient-care-story mx-auto mt-14 grid max-w-[1280px] gap-12 lg:grid-cols-3 lg:gap-10">
      {PATIENT_STEPS.steps.map((step, index) => <li key={step.step}>
        <motion.article className={`patient-care-moment patient-care-${['identity', 'access', 'history'][index]}`} initial={{ opacity: 0, y: reduce ? 0 : 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .15 }} transition={{ duration: .28, delay: reduce ? 0 : index * .07, ease: EASE_OUT }}>
          <div className="patient-care-copy"><span>{step.step}</span><h3>{step.title}</h3><p>{step.body}</p></div>
          {visuals[index]}
        </motion.article>
      </li>)}
    </ol>
  </Wrap></Section>
}
