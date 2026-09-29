'use client'

import { Display, Eyebrow, Section, TabList, TabPanel, TextLink, Wrap, useTabs } from '@hid/ui'
import { MODULES, type ModuleTone } from '@/content/modules'
import { PRODUCTS_SECTION } from '@/content/provider'
import { ROUTES } from '@/content/site'
import { HealthIcon } from '@/components/shared/HealthIcon'

const STATUS_DOT: Record<ModuleTone, string> = {
  ok: 'bg-[#37db91]',
  pending: 'bg-[#ffbf32]',
  active: 'bg-[#62aeff]',
  alert: 'bg-[#ff786f]',
}
/**
 * The module switcher — "One identity. Every system."
 *
 * Three parts, exactly as designed: a full-width segmented strip of modules, and
 * beneath it a three-column body — the claim, the photographic product panel, and
 * the supporting line with the way through to the module's page.
 *
 * The panel is the design's, not a second dashboard: a photograph under a navy
 * overlay, with two solid blocks on top of it showing the module in use. It
 * is what makes the section read as a product rather than a list of names, so it
 * stays.
 *
 * Client-side because it is a tab set. `key` on the body is deliberate: changing
 * it re-mounts the body so the design's fade-and-rise replay on every choice
 * rather than only on first paint.
 */
export function ProductsSection() {
  const items = MODULES.map(module => ({ id: module.slug, label: module.tab }))
  const { selectedId, setSelectedId, idPrefix } = useTabs(items)
  const active = MODULES.find(module => module.slug === selectedId) ?? MODULES[0]

  if (!active) return null

  return (
    <Section id="products" tone="sunk" labelledBy="products-title">
      <Wrap>
        <div className="flex flex-col items-center gap-4 text-center">
          <Eyebrow>{PRODUCTS_SECTION.eyebrow}</Eyebrow>
          <Display as="h2" id="products-title">
            {PRODUCTS_SECTION.title}
          </Display>
          <p className="max-w-[720px] text-base/relaxed text-muted">{PRODUCTS_SECTION.lede}</p>
        </div>

        <div className="mt-9">
          <TabList
            items={items}
            selectedId={selectedId}
            onSelect={setSelectedId}
            label="Health ID modules"
            idPrefix={idPrefix}
            variant="strip"
          />
        </div>

        <TabPanel id={selectedId} idPrefix={idPrefix} className="mt-14">
          <div
            key={selectedId}
            className="tab-fade grid items-center gap-8 lg:grid-cols-[0.85fr_1.5fr_0.85fr] lg:gap-8"
          >
            <Display as="h3" size="sm">
              {active.statement}
            </Display>

            {/* The photographic panel gives the module state a calm, practical backdrop. */}
            <div
              className="relative isolate flex flex-col gap-2.5 overflow-hidden rounded-(--radius-panel) bg-[#c9dcf3] bg-cover bg-center p-[34px]"
              style={{ backgroundImage: "url('/brand/modules-panel.webp')" }}
            >
              <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 bg-inverse-surface/55"
              />

              <div className="rounded-(--radius-card) border border-white/20 bg-[#1f2933]">
                <div className="flex items-center justify-between gap-3 px-[18px] py-[14px]">
                  <b className="text-[14.5px] font-semibold text-white">{active.panelTitle}</b>
                  <span className="rounded-(--radius-control) bg-white/14 px-[10px] py-[5px] font-mono text-[11px] text-white/80">
                    {active.panelBadge}
                  </span>
                </div>
              </div>

              <div className="overflow-hidden rounded-(--radius-card) border border-white/20 bg-[#1f2933]">
                <dl aria-label={`${active.tab} module status`}>
                  {active.rows.map((row, rowIndex) => (
                    <div key={row.label} className={rowIndex > 0 ? 'module-status-row flex items-center justify-between gap-3 border-t border-white/10 px-[18px] py-[17px]' : 'module-status-row flex items-center justify-between gap-3 px-[18px] py-[17px]'}>
                      <dt className="text-[14px] font-medium text-white/90">{row.label}</dt>
                      <dd className="rounded-(--radius-control) border border-white/14 bg-white/12 px-[12px] py-[6px] text-[12px] font-semibold text-white/88">
                        <span className={`module-status-dot mr-2 inline-block h-2 w-2 rounded-full ${STATUS_DOT[row.tone]}`} />
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <p className="text-[14.5px]/relaxed text-muted">{active.caption}</p>
              <TextLink
                href={ROUTES.product(active.slug)}
                className="t-learn text-[15px]"
                aria-label={`Explore Health ID ${active.tab}`}
              >
                Learn more
                <HealthIcon name="arrow" size={16} />
              </TextLink>
            </div>
          </div>
        </TabPanel>
      </Wrap>
    </Section>
  )
}
