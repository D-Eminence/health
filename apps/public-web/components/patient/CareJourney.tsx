'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { Section, Wrap } from '@hid/ui'
import { PATIENT_JOURNEY } from '@/content/patient'

const labels = ['JAN', 'FEB', 'APR', 'TODAY'] as const

const chapterDetails = [
  { number: '01', next: 'FEB', nextTitle: 'A result joins the same record.' },
  { number: '02', next: 'APR', nextTitle: 'A new hospital already has context.' },
  { number: '03', next: 'TODAY', nextTitle: 'She remains in control.' },
  { number: '04', next: null, nextTitle: null },
] as const

/** A compact scrollytelling record: navigation gives direct access, while the
 * scroll states keep one care moment visually dominant. */
export function CareJourney() {
  const moments = PATIENT_JOURNEY.moments
  const chapterRefs = useRef<Array<HTMLElement | null>>([])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    let observer: IntersectionObserver | null = null

    const watchChapters = () => {
      observer?.disconnect()
      if (!media.matches) return
      observer = new IntersectionObserver(entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (!visible) return
        const index = Number((visible.target as HTMLElement).dataset.index)
        if (Number.isFinite(index)) setActiveIndex(index)
      }, { rootMargin: '-26% 0px -42% 0px', threshold: [0.2, 0.45, 0.7] })
      chapterRefs.current.forEach(chapter => chapter && observer?.observe(chapter))
    }

    watchChapters()
    media.addEventListener('change', watchChapters)
    return () => {
      observer?.disconnect()
      media.removeEventListener('change', watchChapters)
    }
  }, [])

  const chooseChapter = (index: number) => {
    setActiveIndex(index)
    chapterRefs.current[index]?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' })
  }

  if (moments.length !== 4) return null

  const current = moments[activeIndex] ?? moments[0]
  const detail = chapterDetails[activeIndex] ?? chapterDetails[0]
  if (!current) return null

  return (
    <Section labelledBy="journey-title" className="patient-journey-section">
      <Wrap>
        <div className="hikmah-journey-intro mx-auto max-w-[760px] text-center">
          <p className="font-mono text-[12px] font-semibold tracking-[0.12em] text-brand uppercase">Hikmah&apos;s journey</p>
          <h2 id="journey-title" className="mt-5 font-display text-[clamp(2rem,3.5vw,2.5rem)] leading-[1.08] tracking-[-0.025em] text-ink">One record, wherever care happens.</h2>
          <p className="mx-auto mt-5 max-w-[58ch] text-[15px]/relaxed text-muted sm:text-[16px]/relaxed">An illustrative care journey across participating settings. Each visit and access decision is an example.</p>
        </div>

        <div className="hikmah-focus mt-16">
          <nav className="hikmah-months" aria-label="Hikmah's care journey">
            {labels.map((label, index) => <button key={label} type="button" onClick={() => chooseChapter(index)} aria-current={activeIndex === index ? 'step' : undefined} data-active={activeIndex === index}>{label}</button>)}
          </nav>

          <div className="hikmah-focus-layout">
            <aside className="hikmah-sticky-visual" aria-label="Hikmah using her Health ID at a hospital">
              <div className="hikmah-photo-frame" data-stage={activeIndex}>
                <Image src="/brand/connected-care-checkin.png" alt="Hikmah presenting her protected Health ID at a hospital reception desk" fill sizes="(min-width: 1024px) 46vw, 100vw" className="object-cover object-[48%_center]" />
                <div className="hikmah-image-status" aria-label="Record access status">
                  <span><b>Health ID</b><em>Verified</em></span>
                  <span><b>Allergy</b><em>{activeIndex >= 2 ? 'Visible' : 'Recorded'}</em></span>
                  <span><b>Access</b><em>{activeIndex >= 2 ? 'Approved' : 'Protected'}</em></span>
                </div>
              </div>
            </aside>

            <div className="hikmah-focus-story">
              {moments.map((moment, index) => {
                const details = chapterDetails[index] ?? chapterDetails[0]
                const isActive = activeIndex === index
                return <article
                  key={moment.when}
                  ref={element => { chapterRefs.current[index] = element }}
                  className="hikmah-story-chapter"
                  data-index={index}
                  data-active={isActive}
                >
                  <p className="hikmah-story-label">{details.number} <span aria-hidden="true">—</span> {labels[index]}</p>
                  <h3>{moment.where}</h3>
                  <p>{moment.body}</p>
                  {index === 2 ? <span className="hikmah-story-status">Access approved by Hikmah</span> : null}
                  {details.next ? <div className="hikmah-next-preview"><p>{details.next}</p><b>{details.nextTitle}</b></div> : null}
                </article>
              })}
            </div>
          </div>

          <div className="hikmah-mobile-story" aria-live="polite">
            <p className="hikmah-story-label">{detail.number} <span aria-hidden="true">—</span> {labels[activeIndex]}</p>
            <h3>{current.where}</h3>
            <p>{current.body}</p>
            {activeIndex === 2 ? <span className="hikmah-story-status">Access approved by Hikmah</span> : null}
            {detail.next ? <div className="hikmah-next-preview"><p>{detail.next}</p><b>{detail.nextTitle}</b></div> : null}
          </div>
        </div>
      </Wrap>
    </Section>
  )
}
