'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cx, toast } from '@hid/ui'

const SNIPPETS = {
  JavaScript: [
    "const patient = await healthId.patients.verify({",
    "  healthId: 'HID-[redacted]',",
    "  purpose: 'consultation',",
    '})',
  ],
  Python: [
    'patient = health_id.patients.verify(',
    "    health_id='HID-[redacted]',",
    "    purpose='consultation',",
    ')',
  ],
  cURL: [
    "curl --request POST 'https://api.example/verify' \\",
    "  --header 'Authorization: Bearer [redacted]' \\",
    "  --data '{ \"healthId\": \"HID-[redacted]\" }'",
  ],
} as const

type Language = keyof typeof SNIPPETS

/**
 * Illustrative only: the public site does not publish production endpoint
 * syntax. The interaction communicates request-to-authorised-response without
 * pretending to be a live API console.
 */
export function ApiCodeVisual() {
  const [language, setLanguage] = useState<Language>('JavaScript')
  const [state, setState] = useState<'ready' | 'sending' | 'complete'>('ready')
  const reduceMotion = useReducedMotion()

  const send = () => {
    if (state === 'sending') return
    setState('sending')
    window.setTimeout(() => setState('complete'), 420)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SNIPPETS[language].join('\n'))
      toast.success('Copied to clipboard', { dedupeKey: 'api-code-example' })
    } catch {
      toast.error('Unable to copy example', {
        description: 'Check your browser permissions and try again.',
        dedupeKey: 'api-code-example',
        action: { label: 'Retry', onAction: () => void copy(), dismissOnAction: false },
      })
    }
  }

  return (
    <div
      role="group"
      aria-label="Illustrative Health ID API request and authorised response"
      className="overflow-hidden rounded-(--radius-card) border-[0.5px] border-line-strong bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-tint px-4 py-3 sm:px-5">
        <p className="font-mono text-[11px] font-medium tracking-[0.1em] text-faint uppercase">Illustrative request</p>
        <span className="inline-flex items-center gap-2 text-[12px] font-medium text-muted">
          <span className={cx('h-1.5 w-1.5 rounded-full', state === 'complete' ? 'bg-positive' : 'bg-brand')} />
          {state === 'sending' ? 'Requesting' : state === 'complete' ? '200 OK' : 'Ready'}
        </span>
      </div>

      <div className="grid lg:grid-cols-[1.12fr_0.88fr]">
        <div className="border-b border-line p-5 lg:border-r lg:border-b-0 sm:p-6">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Code language">
            {(Object.keys(SNIPPETS) as Language[]).map(item => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={language === item}
                onClick={() => setLanguage(item)}
                className={cx(
                  'min-h-9 rounded-(--radius-control) px-3 text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                  language === item ? 'bg-brand text-white' : 'text-muted hover:bg-surface-tint hover:text-ink',
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end"><button type="button" onClick={copy} className="min-h-9 rounded-lg px-3 text-[11px] font-medium text-muted transition-colors hover:bg-surface-tint hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand motion-reduce:transition-none">Copy example</button></div>
          <pre className="mt-2 overflow-x-auto font-mono text-[13px]/relaxed text-ink">
            <code>{SNIPPETS[language].map((line, index) => <span key={line} className="block"><span className="mr-4 select-none text-faint">{String(index + 1).padStart(2, '0')}</span>{line}</span>)}</code>
          </pre>
          <button
            type="button"
            onClick={send}
            className="mt-6 min-h-11 rounded-(--radius-control) bg-brand px-5 text-[14px] font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {state === 'sending' ? 'Sending request...' : state === 'complete' ? 'Request complete' : 'Send illustrative request'}
          </button>
        </div>

        <div className="bg-surface p-5 sm:p-6">
          <p className="font-mono text-[11px] font-medium tracking-[0.1em] text-faint uppercase">Illustrative response</p>
          <div className="mt-5 rounded-(--radius-card) border border-line bg-surface-tint p-4">
            <p className="text-[13px] font-semibold text-ink">{state === 'complete' ? 'Identity verified' : state === 'sending' ? 'Validating request' : 'Awaiting request'}</p>
            <dl className="mt-4 grid gap-3 text-[13px]">
              <div className={cx('flex items-center justify-between gap-4 transition-opacity duration-200 motion-reduce:transition-none', state === 'sending' && 'opacity-50')}><dt className="text-muted">Identity</dt><dd className="font-medium text-ink">HID-[redacted]</dd></div>
              <div className={cx('flex items-center justify-between gap-4 transition-opacity duration-200 motion-reduce:transition-none', state === 'sending' && 'opacity-50')}><dt className="text-muted">Access</dt><dd className="font-medium text-muted">Not requested</dd></div>
              <div className={cx('flex items-center justify-between gap-4 transition-opacity duration-200 motion-reduce:transition-none', state === 'sending' && 'opacity-50')}><dt className="text-muted">Purpose</dt><dd className="font-medium text-ink">Consultation</dd></div>
            </dl>
            {state === 'complete' ? <div aria-live="polite" className="mt-3 grid gap-2 border-t border-line pt-3">{[['Result', 'Identity verified'], ['Medical-record access', 'Not requested']].map(([label, value], index) => <motion.div key={label} initial={{ opacity: 0, y: reduceMotion ? 0 : 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18, delay: reduceMotion ? 0 : index * 0.1 }} className="flex items-center justify-between gap-4 text-[12px]"><span className="text-muted">{label}</span><span className="font-medium text-ink">{value}</span></motion.div>)}</div> : null}
          </div>
          <p className="mt-4 text-[13px]/relaxed text-muted">Identity verification does not by itself provide medical-record access.</p>
        </div>
      </div>
    </div>
  )
}
