import { useId, useState, type PointerEvent, type ReactNode } from 'react'
import { Icon } from './icon'

export function MetricCard({ label, value, change, icon }: { label: string; value: string; change: string; icon?: ReactNode }) {
  return <article className="ui-metric"><header><h3>{label}</h3>{icon}</header><strong>{value}</strong><p><span><Icon name="trend" />{change}</span> from last week</p></article>
}

type SeriesTone = 'users' | 'orders' | 'activation'
type ChartSeries = { label: string; tone: SeriesTone; values: number[]; unit?: string }
type ChartHover = { index: number; series: number }

function chartPoints(values: number[], min: number, max: number) {
  const left = 20, top = 12, width = 560, height = 168, span = Math.max(1, max - min)
  return values.map((value, index) => ({ x: left + index / Math.max(1, values.length - 1) * width, y: top + (1 - (value - min) / span) * height }))
}

export function LineChart({ title, labels, series, min = 0, max }: { title: string; labels: string[]; series: ChartSeries[]; min?: number; max: number }) {
  const [hover, setHover] = useState<ChartHover | null>(null)
  const patternId = `grid-${useId().replace(/:/g, '')}`
  const normalized = series.map(item => ({ ...item, values: item.values.slice(0, labels.length), points: chartPoints(item.values.slice(0, labels.length), min, max) }))
  const segment = 560 / Math.max(1, labels.length - 1)
  const setNearestSeries = (event: PointerEvent<SVGRectElement>, index: number) => {
    const svgRect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!svgRect) return setHover({ index, series: 0 })
    const y = (event.clientY - svgRect.top) / Math.max(1, svgRect.height) * 194
    const seriesIndex = normalized.reduce((best, item, itemIndex) => Math.abs(item.points[index].y - y) < Math.abs(normalized[best].points[index].y - y) ? itemIndex : best, 0)
    setHover({ index, series: seriesIndex })
  }
  const activePoints = hover ? normalized.map(item => item.points[hover.index]) : []

  return <div className={`ui-chart ${hover ? 'is-hovering' : ''}`} role="group" aria-label={title} onPointerLeave={() => setHover(null)}>
    <div className="ui-chart-legend">{normalized.map(item => <span key={item.label}><i data-tone={item.tone} />{item.label}</span>)}</div>
    <svg viewBox="0 0 600 194" preserveAspectRatio="none">
      <defs><pattern id={patternId} width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" /></pattern></defs>
      <rect x="20" y="12" width="560" height="168" fill={`url(#${patternId})`} />
      {normalized.map((item, index) => <polyline key={item.label} className={hover?.series === index ? 'is-hovered' : ''} data-tone={item.tone} points={item.points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')} />)}
      {hover && <><line className="ui-chart-guideline" x1={activePoints[0].x} x2={activePoints[0].x} y1="12" y2="180" />{activePoints.map((point, index) => <circle key={normalized[index].label} className="ui-chart-point" data-tone={normalized[index].tone} cx={point.x} cy={point.y} r="4" />)}</>}
      {labels.map((label, index) => { const center = 20 + index / Math.max(1, labels.length - 1) * 560; const start = index === 0 ? 20 : center - segment / 2; const end = index === labels.length - 1 ? 580 : center + segment / 2; return <rect key={label} className="ui-chart-hit" x={start} y="12" width={end - start} height="168" tabIndex={0} role="button" aria-label={`${label}. ${normalized.map(item => `${item.label}: ${item.values[index]}${item.unit || ''}`).join(', ')}`} onPointerMove={event => setNearestSeries(event, index)} onFocus={() => setHover({ index, series: 0 })} onBlur={() => setHover(null)} /> })}
    </svg>
    <div className="ui-chart-labels" aria-hidden="true">{labels.map(label => <span key={label}>{label}</span>)}</div>
    {hover && <div className={`ui-analytics-tooltip ${hover.index === 0 ? 'is-left-edge' : hover.index === labels.length - 1 ? 'is-right-edge' : ''}`} role="tooltip" style={{ left: `${activePoints[0].x / 6}%`, top: `${Math.max(8, Math.min(...activePoints.map(point => point.y)) / 1.94)}%` }}><strong>{labels[hover.index]}</strong>{normalized.map(item => <span key={item.label}><i data-tone={item.tone} />{item.label}<b>{item.values[hover.index]}{item.unit || ''}</b></span>)}</div>}
  </div>
}

type DonutValue = { label: string; value: number; display: string; tone: 'success' | 'pending' | 'failed' }

export function DonutChart({ title, values }: { title: string; values: DonutValue[] }) {
  const [active, setActive] = useState<number | null>(null)
  const total = values.reduce((sum, item) => sum + item.value, 0)
  let offset = 0
  return <div className={`ui-donut-layout ${active !== null ? 'is-hovering' : ''}`}>
    <div className="ui-donut-wrap"><svg className="ui-donut" viewBox="0 0 42 42" role="group" aria-label={title}>{values.map((item, index) => { const percent = item.value / total * 100; const node = <circle key={item.label} className={active === index ? 'is-hovered' : ''} data-tone={item.tone} cx="21" cy="21" r="15.9155" fill="none" strokeWidth="7" strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-offset} tabIndex={0} role="button" aria-label={`${item.label}: ${item.display}`} onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />; offset += percent; return node })}</svg>{active !== null && <div className="ui-analytics-tooltip ui-donut-tooltip" role="tooltip"><strong>{values[active].label}</strong><span>{values[active].display}</span></div>}</div>
    <dl className="ui-data-list">{values.map((item, index) => <div key={item.label} className={active === index ? 'is-hovered' : ''}><dt><i data-tone={item.tone} />{item.label}</dt><dd>{item.display}</dd></div>)}</dl>
  </div>
}

export function BarBreakdown({ items, total, totalDescription = 'Sum of all categories.' }: { items: { label: string; value: string; percent: number }[]; total?: string; totalDescription?: string }) {
  const [active, setActive] = useState<number | 'total' | null>(null)
  return <div className={`ui-bars ${active === 'total' ? 'is-total-hovered' : ''}`}>{total && <span className="ui-bars-total" tabIndex={0} onPointerEnter={() => setActive('total')} onPointerLeave={() => setActive(null)} onFocus={() => setActive('total')} onBlur={() => setActive(null)}><strong>{total}</strong>{active === 'total' && <span className="ui-analytics-tooltip" role="tooltip"><b>Total brokerage</b><span>{totalDescription}</span></span>}</span>}{items.map((item, index) => <div className={`ui-bar ${active === index ? 'is-hovered' : ''}`} key={item.label} tabIndex={0} onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}><div><span>{item.label}</span><strong>{item.value}</strong></div><i><b style={{ width: `${item.percent}%` }} /></i>{active === index && <span className="ui-analytics-tooltip" role="tooltip"><b>{item.label}</b><span>{item.value} · {item.percent}%</span></span>}</div>)}</div>
}
