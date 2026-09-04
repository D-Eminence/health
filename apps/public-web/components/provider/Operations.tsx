'use client'

import { Section, SectionHeader, TabList, TabPanel, Wrap, cx, useTabs } from '@hid/ui'
import { OPERATIONS, OPERATIONS_FLOW, OPERATIONS_STAGES } from '@/content/tabs'

const STAGE_STYLE: Record<string, string> = {
  Waiting: 'bg-caution/10 text-caution',
  Triage: 'bg-brand-tint text-brand',
  Consultation: 'bg-brand-tint text-brand',
  Laboratory: 'bg-stage/10 text-stage',
  Pharmacy: 'bg-positive/10 text-positive',
  Completed: 'bg-surface-sunk text-muted',
}

/**
 * The facility operations dashboard.
 *
 * The stage filters are real: selecting one narrows the queue below, which is
 * the point the section is making — that a supervisor can see where patients
 * are stuck. A static screenshot would not make that argument.
 */
export function OperationsSection() {
  const items = OPERATIONS_STAGES.map(stage => ({ id: stage, label: stage }))
  const { selectedId, setSelectedId, idPrefix } = useTabs(items)

  const rows =
    selectedId === 'All'
      ? OPERATIONS_FLOW
      : OPERATIONS_FLOW.filter(row => row.stage === selectedId)

  return (
    <Section id="dashboard" tone="sunk" labelledBy="operations-title">
      <Wrap>
        <SectionHeader
          eyebrow={OPERATIONS.eyebrow}
          id="operations-title"
          title={OPERATIONS.title}
          lede={OPERATIONS.lede}
        />

        <div className="mt-10 overflow-hidden rounded-(--radius-panel) border border-line bg-surface shadow-[0_18px_50px_rgba(11,27,46,0.08)]">
          <div className="flex items-center gap-2 border-b border-line bg-surface-tint px-4 py-2.5">
            <span aria-hidden="true" className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
              <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
              <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            </span>
            <span className="mx-auto rounded-(--radius-control) bg-surface px-3 py-1 font-mono text-[11px] text-faint">
              app.healthidentitydirectory.com
            </span>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line p-4 sm:p-5">
            <div>
              <p className="text-[16px] font-semibold text-ink">Today’s clinical operations</p>
              <p className="text-[13px] text-muted">{OPERATIONS.lede}</p>
            </div>
            <dl className="flex gap-6">
              {OPERATIONS.counts.map(count => (
                <div key={count.label} className="flex flex-col">
                  <dd className="font-display text-[26px] leading-none text-ink tabular-nums">
                    {count.value}
                  </dd>
                  <dt className="mt-1 text-[11px] text-faint">{count.label}</dt>
                </div>
              ))}
            </dl>
          </div>

          <div className="px-4 pt-4 sm:px-5">
            <TabList
              items={items}
              selectedId={selectedId}
              onSelect={setSelectedId}
              label="Filter patient flow by stage"
              idPrefix={idPrefix}
              variant="pill"
              className="pb-1"
            />
          </div>

          <TabPanel id={selectedId} idPrefix={idPrefix} className="p-4 sm:p-5">
            <p className="mb-3 text-[13px] font-semibold text-ink">
              Today’s patient flow
              <span className="ml-2 font-normal text-faint">
                {rows.length} {rows.length === 1 ? 'patient' : 'patients'}
              </span>
            </p>

            {/* Scrolls inside its own container so the page never moves sideways. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr>
                    {['Patient', 'Stage', 'Waiting', 'Assigned to', ''].map(column => (
                      <th
                        key={column}
                        scope="col"
                        className="border-b border-line pb-2 font-mono text-[10px] font-medium tracking-[0.08em] text-faint uppercase"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.hid} className="border-b border-line last:border-0">
                      <td className="py-3 pr-4">
                        <span className="block text-[13px] font-medium text-ink">{row.patient}</span>
                        <span className="block font-mono text-[11px] text-faint">{row.hid}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={cx(
                            'rounded-(--radius-control) px-2.5 py-1 text-[11px] font-medium whitespace-nowrap',
                            STAGE_STYLE[row.stage] ?? 'bg-surface-sunk text-muted',
                          )}
                        >
                          {row.stage}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-[13px] text-muted tabular-nums">{row.waited}</td>
                      <td className="py-3 pr-4 text-[13px] text-muted">{row.assignedTo}</td>
                      <td className="py-3 text-right text-[12px] font-medium text-brand">
                        {row.action}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted">
                No patients at this stage right now.
              </p>
            ) : null}
          </TabPanel>
        </div>
      </Wrap>
    </Section>
  )
}
