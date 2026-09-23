import { DashboardShell } from './DashboardShell'
import { HealthIcon, type HealthIconName } from './HealthIcon'
import { cx } from '@hid/ui'
import type {
  DashboardAlerts,
  DashboardList,
  DashboardMetric,
  DashboardProfile,
  DashboardProgress,
  DashboardStages,
  DashboardTable,
  DashboardTimeline,
  ProductDetail,
  StatusTone,
} from '@/content/product-details'

/**
 * The dashboard illustration on a product page.
 *
 * Each module shows the panels that make sense for its work, so this composes
 * whichever of `table`, `alerts`, `lists`, `stages`, `profile`, `timeline` and
 * `progress` the product declares rather than forcing one layout on all seven.
 *
 * It is artwork built from markup: no data is fetched, nothing is interactive,
 * and every name and figure is invented. The whole thing carries one `role="img"`
 * and a description, so assistive technology hears a summary instead of walking
 * a decorative table cell by cell.
 */

const STATUS_STYLE: Record<StatusTone, string> = {
  ok: 'bg-positive/10 text-positive',
  pending: 'bg-caution/10 text-caution',
  active: 'bg-brand-tint text-brand',
  alert: 'bg-critical/10 text-critical',
}

const STATUS_DOT: Record<StatusTone, string> = {
  ok: 'bg-positive',
  pending: 'bg-caution',
  active: 'bg-brand',
  alert: 'bg-critical',
}

const METRIC_TONE = {
  neutral: 'text-ink',
  caution: 'text-caution',
  critical: 'text-critical',
} as const

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="console-panel rounded-(--radius-card) border border-line p-4">
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      {children}
    </div>
  )
}

function StatusPill({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span
      className={cx(
        'rounded-(--radius-control) px-2.5 py-1 text-[11px] font-medium whitespace-nowrap',
        STATUS_STYLE[tone],
      )}
    >
      {children}
    </span>
  )
}

function Metrics({ metrics }: { metrics: readonly DashboardMetric[] }) {
  return (
    <div className="console-metrics grid grid-cols-2 gap-3 lg:grid-cols-4">
      {metrics.map((metric, index) => (
        <div key={metric.label} className="console-metric rounded-(--radius-card) border border-line p-3.5">
          <span className="console-metric-icon"><HealthIcon name={(['people', 'activity', 'file', 'check'] as readonly HealthIconName[])[index] ?? 'activity'} size={17} /></span>
          <p className="console-metric-label">
            {metric.label}
          </p>
          <p className="console-metric-value">
            {metric.value}
          </p>
          <p className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2 text-[11px]">
            <span className="text-faint">{metric.footLabel}</span>
            <span className={cx('font-medium', METRIC_TONE[metric.tone])}>{metric.footValue}</span>
          </p>
        </div>
      ))}
    </div>
  )
}

function Table({ table }: { table: DashboardTable }) {
  return (
    <Panel title={table.title}>
      {/* A real table: the rows are tabular, and it scrolls in its own
          container so a narrow screen never scrolls the page sideways. */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-left">
          <thead>
            <tr>
              {table.columns.map(column => (
                <th
                  key={column}
                  className="border-b border-line pb-2 font-mono text-[10px] font-medium tracking-[0.08em] text-faint uppercase"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map(row => (
              <tr key={row.primary} className="border-b border-line last:border-0">
                <td className="py-2.5 pr-4">
                  <span className="block text-[13px] font-medium text-ink">{row.primary}</span>
                  <span className="block font-mono text-[11px] text-faint">{row.secondary}</span>
                </td>
                <td className="py-2.5 text-right">
                  <StatusPill tone={row.tone}>{row.detail}</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function Alerts({ alerts }: { alerts: DashboardAlerts }) {
  return (
    <Panel title={alerts.title}>
      <ul className="mt-3 flex flex-col gap-2.5">
        {alerts.items.map(item => (
          <li key={item.text} className="flex items-start gap-2.5 text-[13px] text-muted">
            <span className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[item.tone])} />
            {item.text}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function ListPanel({ list }: { list: DashboardList }) {
  return (
    <Panel title={list.title}>
      <ul className="mt-3 flex flex-col gap-2">
        {list.items.map(item => (
          <li key={item.label} className="flex items-center justify-between gap-3">
            <span className="truncate text-[13px] text-ink">{item.label}</span>
            <StatusPill tone={item.tone}>{item.value}</StatusPill>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function Stages({ stages }: { stages: DashboardStages }) {
  return (
    <Panel title={stages.title}>
      <ol className="mt-3 grid gap-2 sm:grid-cols-5">
        {stages.steps.map(step => (
          <li
            key={step.label}
            className="flex flex-col gap-1 rounded-(--radius-card) bg-surface-tint p-3"
          >
            <span className="font-display text-[22px] leading-none text-ink tabular-nums">
              {step.value}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className={cx('h-1.5 w-1.5 rounded-full', STATUS_DOT[step.tone])} />
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function Profile({ profile }: { profile: DashboardProfile }) {
  return (
    <Panel title={profile.title}>
      <div className="mt-3 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-tint font-mono text-[12px] font-semibold text-brand">
          {profile.name
            .split(' ')
            .map(part => part[0])
            .join('')}
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[14px] font-semibold text-ink">{profile.name}</span>
          <span className="font-mono text-[11px] text-faint">{profile.id}</span>
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3">
        {profile.fields.map(field => (
          <div key={field.label} className="flex flex-col">
            <dt className="text-[11px] text-faint">{field.label}</dt>
            <dd className="text-[13px] text-ink">{field.value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 border-t border-line pt-3 text-[11px] text-faint">Connected facilities</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {profile.connected.map(facility => (
          <li
            key={facility}
            className="rounded-(--radius-control) bg-surface-sunk px-2.5 py-1 text-[11px] text-ink"
          >
            {facility}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function Timeline({ timeline }: { timeline: DashboardTimeline }) {
  return (
    <Panel title={timeline.title}>
      <ol className="mt-3 flex flex-col gap-3">
        {timeline.items.map(item => (
          <li key={`${item.event}-${item.when}`} className="flex items-start gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-[13px] font-medium text-ink">{item.event}</span>
              <span className="truncate text-[11px] text-faint">{item.detail}</span>
            </span>
            <span className="shrink-0 font-mono text-[11px] text-faint">{item.when}</span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

function Progress({ progress }: { progress: DashboardProgress }) {
  const total = progress.segments.reduce((sum, segment) => sum + segment.value, 0)

  return (
    <Panel title={progress.title}>
      <p className="mt-1 text-[11px] text-faint">{progress.total}</p>

      {/* One bar, split by share of the total, so the segments always add up
          to the whole rather than being sized by eye. */}
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-(--radius-control) bg-surface-sunk">
        {progress.segments.map(segment => (
          <span
            key={segment.label}
            className={STATUS_DOT[segment.tone]}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-col gap-1.5">
        {progress.segments.map(segment => (
          <li key={segment.label} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="flex items-center gap-2 text-muted">
              <span className={cx('h-1.5 w-1.5 rounded-full', STATUS_DOT[segment.tone])} />
              {segment.label}
            </span>
            <span className="text-ink tabular-nums">{segment.value.toLocaleString('en-NG')}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function ProductDashboard({ product }: { product: ProductDetail }) {
  const sidePanels = [
    product.alerts ? <Alerts key="alerts" alerts={product.alerts} /> : null,
    product.profile ? <Profile key="profile" profile={product.profile} /> : null,
    product.timeline ? <Timeline key="timeline" timeline={product.timeline} /> : null,
    product.progress ? <Progress key="progress" progress={product.progress} /> : null,
    ...(product.lists ?? []).map(list => <ListPanel key={list.title} list={list} />),
  ].filter(Boolean)

  return (
    <DashboardShell slug={product.slug} title={product.dash}>
      <Metrics metrics={product.metrics} />
      {product.stages ? <Stages stages={product.stages} /> : null}
      <div className={cx('console-panels grid gap-3', product.table && sidePanels.length > 0 && 'lg:grid-cols-2')}>
        {product.table ? <Table table={product.table} /> : null}
        {sidePanels}
      </div>
    </DashboardShell>
  )
}
