'use client'

import { Card, Display, Section, SectionHeader, TabList, TabPanel, Wrap, useTabs } from '@hid/ui'
import { RECORD_SECTION, RECORD_TABS, RECORD_TIMELINE, ROLE_TABS, TEAMS_SECTION } from '@/content/tabs'

/**
 * The connected patient record.
 *
 * Filtering the timeline by record type is the argument: the same history reads
 * differently depending on what a clinician came looking for, and it is still
 * one record underneath.
 */
export function RecordSection() {
  const items = RECORD_TABS.map(tab => ({ id: tab, label: tab }))
  const { selectedId, setSelectedId, idPrefix } = useTabs(items)

  const entries = RECORD_TIMELINE.filter(entry =>
    (entry.tabs as readonly string[]).includes(selectedId),
  )

  return (
    <Section id="record" labelledBy="record-title">
      <Wrap>
        <SectionHeader
          id="record-title"
          title={RECORD_SECTION.title}
          lede={RECORD_SECTION.lede}
          size="md"
        />

        <Card className="mt-10 overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-4 sm:p-5">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 place-items-center rounded-full bg-brand-tint font-mono text-[12px] font-semibold text-brand"
            >
              AY
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[15px] font-semibold text-ink">
                {RECORD_SECTION.patient.name}
              </span>
              <span className="font-mono text-[11px] text-faint">
                {RECORD_SECTION.patient.hid}
              </span>
            </span>
            <span className="ml-auto rounded-(--radius-control) bg-positive/10 px-2.5 py-1 text-[11px] font-medium text-positive">
              {RECORD_SECTION.patient.status}
            </span>
          </div>

          <div className="px-4 sm:px-5">
            <TabList
              items={items}
              selectedId={selectedId}
              onSelect={setSelectedId}
              label="Filter the patient record"
              idPrefix={idPrefix}
            />
          </div>

          <TabPanel id={selectedId} idPrefix={idPrefix} className="p-4 sm:p-5">
            <ol className="flex flex-col gap-3">
              {entries.map(entry => (
                <li
                  key={`${entry.date}-${entry.event}`}
                  className="flex items-start gap-3 rounded-(--radius-card) border border-line p-3.5"
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                  />
                  <span className="flex min-w-0 flex-1 flex-col leading-snug">
                    <span className="text-[14px] font-medium text-ink">{entry.event}</span>
                    <span className="text-[12px] text-faint">{entry.place}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-faint">{entry.date}</span>
                </li>
              ))}
            </ol>

            {entries.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted">
                Nothing recorded under {selectedId} for this patient.
              </p>
            ) : null}
          </TabPanel>
        </Card>
      </Wrap>
    </Section>
  )
}

/**
 * Care teams.
 *
 * Each role sees a different workspace, so the tabs show what that role's home
 * screen actually contains rather than describing role-based access abstractly.
 */
export function TeamsSection() {
  const items = ROLE_TABS.map(role => ({ id: role.role, label: role.role }))
  const { selectedId, setSelectedId, idPrefix } = useTabs(items)
  const active = ROLE_TABS.find(role => role.role === selectedId) ?? ROLE_TABS[0]

  if (!active) return null

  return (
    <Section id="teams" tone="sunk" labelledBy="teams-title">
      <Wrap>
        <SectionHeader
          eyebrow={TEAMS_SECTION.eyebrow}
          id="teams-title"
          title={TEAMS_SECTION.title}
          size="md"
        />

        <div className="mt-10">
          <TabList
            items={items}
            selectedId={selectedId}
            onSelect={setSelectedId}
            label="Care team roles"
            idPrefix={idPrefix}
            variant="pill"
            className="justify-center pb-1"
          />

          <TabPanel id={selectedId} idPrefix={idPrefix} className="mt-8">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
              <div className="flex flex-col gap-3">
                <Display as="h3" size="sm">
                  {active.role}
                </Display>
                <p className="max-w-[52ch] text-[15px]/relaxed text-muted">{active.body}</p>
              </div>

              <ul className="grid gap-3 sm:grid-cols-2">
                {active.panels.map(panel => (
                  <li
                    key={panel}
                    className="rounded-(--radius-card) border border-line bg-surface px-4 py-3.5 text-[14px] font-medium text-ink"
                  >
                    {panel}
                  </li>
                ))}
              </ul>
            </div>
          </TabPanel>
        </div>
      </Wrap>
    </Section>
  )
}
