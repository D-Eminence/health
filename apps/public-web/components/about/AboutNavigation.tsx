'use client'

import { useEffect, useState } from 'react'

const SECTIONS = [
  ['about-title', 'About Health ID'],
  ['why-title', 'Why Health ID exists'],
  ['products-title', 'What Health ID is'],
  ['approach-title', 'Our approach'],
  ['patient-title', 'The patient journey'],
  ['paper-title', 'From paper to connected care'],
  ['workflow-title', 'Real healthcare workflows'],
  ['modular-title', 'Designed to be modular'],
  ['interoperability-title', 'Interoperability'],
  ['trust-title', 'Trust and accountability'],
  ['audiences-title', 'Who we are building for'],
  ['team-title', 'Our team'],
  ['vision-title', 'Our vision'],
  ['about-cta', 'Build with Health ID'],
] as const

export function AboutNavigation() {
  const [active, setActive] = useState<string>('about-title')

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('aria-labelledby') ?? entry.target.id
          if (id) setActive(id)
        }
      }
    }, { rootMargin: '-150px 0px -60% 0px', threshold: 0 })
    document.querySelectorAll('.about-content > section').forEach(section => observer.observe(section))
    return () => observer.disconnect()
  }, [])

  return <nav className="about-navigation" aria-label="On this page">
    <p className="about-navigation-label">On this page</p>
    <ol>{SECTIONS.map(([id, label], index) => <li key={id}>
      <a href={`#${id}`} aria-current={active === id ? 'location' : undefined} onClick={() => setActive(id)}>
        <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{label}
      </a>
    </li>)}</ol>
    <label className="about-mobile-navigation">
      <span>On this page</span>
      <select value={active} onChange={event => { setActive(event.target.value); window.location.hash = event.target.value }}>
        {SECTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
  </nav>
}
