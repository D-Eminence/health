'use client'

import Link from 'next/link'
import { ModuleDashboardPreview } from './ModuleDashboardPreview'
import { findProductDetail } from '@/content/product-details'
import { useMemo, useRef, useState } from 'react'
import { cx } from '@hid/ui'
import { HEALTH_ID_MODULES, type HealthIDModule, type HealthIDModuleSlug } from '@/content/module-showcase'
import { HealthIcon } from '@/components/shared/HealthIcon'

export interface HealthIDModuleShowcaseProps {
  readonly currentModule?: HealthIDModuleSlug
  readonly defaultActive?: HealthIDModuleSlug
  readonly heading?: boolean
  readonly items?: readonly HealthIDModule[]
  readonly embedded?: boolean
}

/**
 * A single data-driven ecosystem navigator. Desktop uses physical expansion;
 * tablet and mobile use the same selection state with a readable tab row.
 */
export function HealthIDModuleShowcase({ currentModule, defaultActive, heading = true, items = HEALTH_ID_MODULES, embedded = false }: HealthIDModuleShowcaseProps) {
  const modules = useMemo(() => items.filter(module => module.slug !== currentModule), [items, currentModule])
  const first = modules.find(module => module.slug === defaultActive) ?? modules[0]
  const [activeSlug, setActiveSlug] = useState<HealthIDModuleSlug>(first?.slug ?? 'identity')
  const touchStart = useRef<number | null>(null)
  const active = modules.find(module => module.slug === activeSlug) ?? first

  if (!active) return null

  const selectNext = (direction: 1 | -1) => {
    const index = modules.findIndex(module => module.slug === active.slug)
    const next = modules[(index + direction + modules.length) % modules.length]
    if (next) setActiveSlug(next.slug)
  }

  const Container = embedded ? 'div' : 'section'

  return (
    <Container aria-label={embedded ? 'Health ID products' : undefined} aria-labelledby={embedded ? undefined : 'other-modules-title'} className={embedded ? 'module-showcase-embedded' : 'module-showcase-section'}>
      <div className={embedded ? undefined : 'mx-auto w-full max-w-[1400px] px-5 sm:px-8 lg:px-12'}>
        {!embedded && <div className="module-showcase-heading">
          <p className="font-mono text-[12px] font-semibold tracking-[0.12em] text-faint uppercase">Other modules</p>
          {heading ? <h2 id="other-modules-title" className="mt-4 font-display text-[clamp(2rem,3.6vw,3rem)] leading-[1.04] tracking-[-0.03em] text-ink">Explore the rest of Health ID.</h2> : <h2 id="other-modules-title" className="sr-only">Other Health ID modules</h2>}
        </div>}

        <div className="module-showcase-desktop mt-10" aria-live="polite">
          {modules.map(module => (
            <div key={module.slug} className={cx('module-showcase-panel', module.slug === active.slug && 'is-active')}>
              {module.slug === active.slug ? <ActiveModule module={module} /> : <CollapsedModule module={module} onSelect={() => setActiveSlug(module.slug)} />}
            </div>
          ))}
        </div>

        <div
          className="module-showcase-compact mt-10"
          onPointerDown={event => { if (event.pointerType === 'touch') touchStart.current = event.clientX }}
          onPointerUp={event => {
            if (event.pointerType !== 'touch' || touchStart.current === null) return
            const delta = event.clientX - touchStart.current
            touchStart.current = null
            if (Math.abs(delta) > 48) selectNext(delta < 0 ? 1 : -1)
          }}
        >
          <ActiveModule module={active} />
          <div className="module-showcase-tabs mt-4" role="tablist" aria-label={embedded ? 'Health ID products' : 'Other Health ID modules'}>
            {modules.map(module => <button key={module.slug} type="button" role="tab" aria-selected={module.slug === active.slug} onClick={() => setActiveSlug(module.slug)} className="module-showcase-tab">{module.shortName}</button>)}
          </div>
        </div>
      </div>
    </Container>
  )
}

function ActiveModule({ module }: { module: HealthIDModule }) {
  return (
    <article className="module-showcase-active" aria-label={`${module.name} module`}>
      <ModuleVisual module={module} />
      <div key={module.slug} className="module-showcase-content">
        <p className="text-[13px] font-semibold text-brand">{module.name}</p>
        <h3 className="mt-4 font-display text-[clamp(1.875rem,3vw,2.5rem)] leading-[1.05] tracking-[-0.03em] text-ink">{module.statement}</h3>
        <p className="mt-5 max-w-[42ch] text-[15px]/relaxed text-muted sm:text-[16px]/relaxed">{module.description}</p>
        <Link href={module.href} className="module-showcase-cta mt-7 inline-flex min-h-11 items-center gap-1 text-[15px] font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">{module.cta}<HealthIcon name="arrow" size={16} className="module-showcase-arrow" /></Link>
      </div>
    </article>
  )
}

function ModuleVisual({ module }: { module: HealthIDModule }) {
  const product = findProductDetail(module.slug)
  return product ? <ModuleDashboardPreview product={product} /> : null
}

function CollapsedModule({ module, onSelect }: { module: HealthIDModule; onSelect: () => void }) {
  return <button type="button" onClick={onSelect} className="module-showcase-collapsed" aria-label={`Show ${module.name}`}>
    <span>{module.shortName}</span><HealthIcon name="arrow" size={16} className="module-showcase-collapsed-arrow" />
  </button>
}
