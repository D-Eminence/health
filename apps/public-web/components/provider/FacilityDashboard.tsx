/**
 * An illustration of the clinician dashboard.
 *
 * Every name, Health ID and figure below is invented for this page. No real
 * patient or clinician data appears on the public site, and none is fetched —
 * this application has no access to a clinical service. Treat it as artwork
 * built from markup rather than a screenshot, which keeps it legible, scalable
 * and translatable.
 */

const ILLUSTRATIVE_CLINICIAN = { initials: 'AE', name: 'Dr. Amaka Eze', role: 'Consultant' }

const TABS = [
  'Dashboard',
  'Patients',
  'Consultation',
  'Inpatient',
  'Laboratory',
  'Radiology',
  'Referrals',
] as const

interface DashboardStat {
  readonly label: string
  readonly value: string
  readonly foot: string
  readonly footValue: string
  /** Renders the footer figure in the caution colour. */
  readonly warn?: boolean
}

const STATS: readonly DashboardStat[] = [
  { label: 'My patients today', value: '18', foot: 'Seen', footValue: '9' },
  { label: 'Ready for doctor', value: '9', foot: 'Longest wait', footValue: '24 min', warn: true },
  { label: 'Results to review', value: '6', foot: 'Urgent', footValue: '2', warn: true },
  { label: 'Pending sign-offs', value: '3', foot: 'From', footValue: 'Residents' },
]

const QUEUE = [
  { initials: 'NB', name: 'Ngozi Bello', detail: 'HID-71-2204 · 31F · ANC 34w' },
  { initials: 'SO', name: 'Samuel Okoro', detail: 'HID-44-8810 · 45M' },
  { initials: 'AM', name: 'Aisha Mohammed', detail: 'HID-20-5517 · 28F' },
] as const

const ALERTS = [
  'ICU bed capacity at 90% — 1 bed free.',
  '3 drugs below reorder level in Pharmacy.',
  '2 urgent lab results awaiting clinician review.',
] as const

export function FacilityDashboard() {
  return (
    <div
      role="img"
      aria-label="Illustration of the Health ID clinician dashboard, showing today's patient queue, workload figures and facility alerts."
      className="overflow-hidden rounded-t-(--radius-panel) border border-line border-b-0 bg-surface shadow-[0_-2px_10px_rgba(11,27,46,0.04),0_24px_60px_rgba(11,27,46,0.12)]"
    >
      {/* Everything inside is decorative detail; the label above describes it. */}
      <div aria-hidden="true">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink">
            Hospital — Main
            <span className="text-faint">&rsaquo;</span>
          </span>
          <span className="hidden flex-1 rounded-lg border border-line px-3 py-1.5 text-[13px] text-faint sm:block">
            Search patients by name or HID
          </span>
          <span className="ml-auto flex items-center gap-2 rounded-full border border-line px-2.5 py-1 text-[12px] text-muted sm:ml-0">
            <span className="h-1.5 w-1.5 rounded-full bg-positive" />
            Morning
            <span className="font-mono text-faint">07:00</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-tint font-mono text-[10px] font-semibold text-brand">
              {ILLUSTRATIVE_CLINICIAN.initials}
            </span>
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-[12px] font-semibold text-ink">
                {ILLUSTRATIVE_CLINICIAN.name}
              </span>
              <span className="text-[11px] text-faint">{ILLUSTRATIVE_CLINICIAN.role}</span>
            </span>
          </span>
        </div>

        <div className="flex gap-6 overflow-x-auto border-b border-line px-4">
          {TABS.map((tab, index) => (
            <span
              key={tab}
              className={
                index === 0
                  ? 'border-b-2 border-brand py-3 text-[13px] font-semibold whitespace-nowrap text-brand'
                  : 'py-3 text-[13px] whitespace-nowrap text-muted'
              }
            >
              {tab}
            </span>
          ))}
        </div>

        <div className="p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[17px] font-semibold text-ink">
                Good morning, {ILLUSTRATIVE_CLINICIAN.name}
              </p>
              <p className="text-[13px] text-muted">Your clinical day at a glance.</p>
            </div>
            <span className="rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-white">
              Start consultation
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map(stat => (
              <div key={stat.label} className="rounded-(--radius-card) border border-line p-3.5">
                <p className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
                  {stat.label}
                </p>
                <p className="mt-1 font-display text-[32px] leading-none text-ink tabular-nums">
                  {stat.value}
                </p>
                <p className="mt-3 flex items-center justify-between border-t border-line pt-2 text-[11px]">
                  <span className="text-faint">{stat.foot}</span>
                  <span className={stat.warn ? 'font-medium text-caution' : 'text-ink'}>
                    {stat.footValue}
                  </span>
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-(--radius-card) border border-line p-4">
              <p className="flex items-center justify-between text-[13px] font-semibold text-ink">
                Ready for doctor
                <span className="text-[12px] font-medium text-brand">Open queue &rsaquo;</span>
              </p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {QUEUE.map(patient => (
                  <li key={patient.initials} className="flex items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-sunk font-mono text-[10px] font-semibold text-muted">
                      {patient.initials}
                    </span>
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate text-[13px] font-medium text-ink">
                        {patient.name}
                      </span>
                      <span className="truncate font-mono text-[11px] text-faint">
                        {patient.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-(--radius-card) border border-line p-4">
              <p className="text-[13px] font-semibold text-ink">Needs attention</p>
              <ul className="mt-3 flex flex-col gap-2.5">
                {ALERTS.map(alert => (
                  <li key={alert} className="flex items-start gap-2.5 text-[13px] text-muted">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-caution" />
                    {alert}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
