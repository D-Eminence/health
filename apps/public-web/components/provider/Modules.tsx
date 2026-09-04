'use client'

import { Card, Display, Section, SectionHeader, TabList, TabPanel, Wrap, cx, useTabs } from '@hid/ui'
import { MODULES_SECTION, MODULE_TABS } from '@/content/tabs'
import type { StatusTone } from '@/content/product-details'

const TONE: Record<StatusTone, string> = {
  ok: 'bg-positive/10 text-positive',
  pending: 'bg-caution/10 text-caution',
  active: 'bg-brand-tint text-brand',
  alert: 'bg-critical/10 text-critical',
}

/**
 * The module switcher.
 *
 * Tabs rather than five stacked sections: the modules are alternatives a reader
 * chooses between, not a sequence they work through, and showing one at a time
 * keeps the comparison honest.
 */
export function ModulesSection() {
  const items = MODULE_TABS.map(module => ({ id: module.tab, label: module.tab }))
  const { selectedId, setSelectedId, idPrefix } = useTabs(items)
  const active = MODULE_TABS.find(module => module.tab === selectedId) ?? MODULE_TABS[0]

  if (!active) return null

  return (
    <Section id="modules" labelledBy="modules-title">
      <Wrap>
        <SectionHeader
          eyebrow={MODULES_SECTION.eyebrow}
          id="modules-title"
          title={MODULES_SECTION.title}
        />

        <div className="mt-10">
          <TabList
            items={items}
            selectedId={selectedId}
            onSelect={setSelectedId}
            label="Health ID modules"
            idPrefix={idPrefix}
            variant="pill"
            className="justify-center pb-1"
          />

          <TabPanel id={selectedId} idPrefix={idPrefix} className="mt-8 rounded-(--radius-panel)">
            <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:gap-14">
              <div className="flex flex-col gap-3">
                <Display as="h3" size="md">
                  {active.statement}
                </Display>
                <p className="max-w-[56ch] text-[15px]/relaxed text-muted">{active.caption}</p>
              </div>

              <Card className="p-5">
                <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
                  <p className="text-[14px] font-semibold text-ink">{active.panelTitle}</p>
                  <span className="rounded-(--radius-control) bg-surface-sunk px-2.5 py-1 font-mono text-[11px] text-muted">
                    {active.panelBadge}
                  </span>
                </div>

                <dl className="mt-3 flex flex-col gap-2.5">
                  {active.rows.map(row => (
                    <div key={row.label} className="flex items-center justify-between gap-3">
                      <dt className="text-[13px] text-muted">{row.label}</dt>
                      <dd
                        className={cx(
                          'rounded-(--radius-control) px-2.5 py-1 text-[11px] font-medium whitespace-nowrap',
                          TONE[row.tone],
                        )}
                      >
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>
          </TabPanel>
        </div>
      </Wrap>
    </Section>
  )
}
