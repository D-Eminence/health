import { isHidApiError } from '@hid/http'
import type { OrderRouteDispensing, OrderRouteResult } from '../../../../staff/api'
import { ORDERS_NOT_AVAILABLE, ORDERS_PAUSED, paused, routeDay, routeMissing } from '../../../../staff/orderRoutes'

/**
 * The lines staff/routes/OrderRoutes.tsx writes under an order sent to another facility, which it keeps private (not
 * exported): what came back (results, corrections, withdrawn results, dispensings) and why a read was refused, word
 * for word. Every exported word function is imported from staff/orderRoutes.ts. Once OrderRoutes.tsx exports these,
 * this file imports them instead.
 */

/** OrderRoutes.tsx `attestationProblem`. */
export function attestationProblem(error: unknown): string {
  if (paused(error)) return ORDERS_PAUSED
  if (routeMissing(error)) return ORDERS_NOT_AVAILABLE
  if (isHidApiError(error) && error.status === 403) return 'Your role at this facility can’t send orders to other facilities.'
  return 'The confirmation could not be loaded. Try again.'
}

/** OrderRoutes.tsx `viewProblem`. */
export function viewProblem(error: unknown): string {
  if (routeMissing(error)) return ORDERS_NOT_AVAILABLE
  if (isHidApiError(error) && error.status === 403) return 'Your access to this patient does not cover this order’s details.'
  if (isHidApiError(error) && error.status === 404) return 'This order was not found. Reload the list.'
  return 'The details could not be loaded. Try again.'
}

function resultValue(result: OrderRouteResult): string {
  const value = result.resultType === 'text' ? result.textValue ?? '' : result.numericValue === null ? '' : String(result.numericValue)
  const flag = result.abnormalFlag && !['normal', 'unknown'].includes(result.abnormalFlag)
    ? `, flagged ${result.abnormalFlag === 'critical_candidate' ? 'possibly critical' : result.abnormalFlag}` : ''
  return `${[value, result.unit ?? ''].filter(Boolean).join(' ')}${flag}${result.referenceRange ? `, reference ${result.referenceRange}` : ''}`
}

function byVersion(first: OrderRouteResult, second: OrderRouteResult): number {
  const versions = (first.resultVersion ?? 0) - (second.resultVersion ?? 0)
  return versions !== 0 ? versions : (first.occurredAt ?? '').localeCompare(second.occurredAt ?? '')
}

function firstReturned(reports: readonly OrderRouteResult[]): string {
  return reports.map(report => report.occurredAt ?? '').sort()[0] ?? ''
}

function resultGroupLines(reports: readonly OrderRouteResult[], facility: string): string[] {
  const named = reports.find(report => report.test.name)?.test.name
  const releases = reports.filter(report => report.kind !== 'entered_in_error').sort(byVersion)
  const voids = reports.filter(report => report.kind === 'entered_in_error')
  const voidsAll = voids.find(report => report.resultVersion === null)
  const voidOf = (release: OrderRouteResult) => voidsAll
    ?? voids.find(report => report.resultVersion !== null && report.resultVersion === release.resultVersion)
  const label = (state: string) => named ? `${named}${state ? ` (${state})` : ''}: `
    : state ? `${state.charAt(0).toUpperCase()}${state.slice(1)}: ` : ''
  const released = (release: OrderRouteResult) => `Released by ${facility} on ${routeDay(release.occurredAt)}: ${resultValue(release)}`
  if (releases.length === 0) {
    return voids.map(report => `${label('do not use')}Marked entered in error by ${facility} on ${routeDay(report.occurredAt)}: do not use it.`)
  }
  const latest = releases[releases.length - 1]!
  const latestVoid = voidOf(latest)
  const corrected = latest.revisionKind !== null && latest.revisionKind !== 'original'
  const lines: string[] = []
  if (latestVoid) {
    lines.push(`${label('do not use')}Marked entered in error by ${facility} on ${routeDay(latestVoid.occurredAt)}: the value released on `
      + `${routeDay(latest.occurredAt)}, ${resultValue(latest)}. No value of this result stands: contact ${facility}.`)
  } else if (releases.length === 1) {
    lines.push(`${label('')}${released(latest)}${corrected && latest.correctionReason
      ? `. Corrected on ${routeDay(latest.occurredAt)}: ${latest.correctionReason}` : ''}`)
  } else {
    lines.push(`${label('current result')}${released(latest)}. Corrected on ${routeDay(latest.occurredAt)}`
      + `${latest.correctionReason ? `: ${latest.correctionReason}` : '.'}`)
  }
  for (let index = releases.length - 2; index >= 0; index -= 1) {
    const earlier = releases[index]!
    const voided = voidOf(earlier)
    lines.push(`${label('replaced')}${released(earlier)}. Replaced by the correction of ${routeDay(releases[index + 1]!.occurredAt)}`
      + `${voided && voided !== latestVoid ? `, and marked entered in error on ${routeDay(voided.occurredAt)}` : ''}: do not use it.`)
  }
  return lines
}

function resultGroups(results: readonly OrderRouteResult[]): OrderRouteResult[][] {
  const groups = new Map<string, OrderRouteResult[]>()
  results.forEach((result, index) => {
    const key = result.resultId ?? `unidentified-${index}`
    groups.set(key, [...(groups.get(key) ?? []), result])
  })
  return [...groups.values()].sort((first, second) => firstReturned(first).localeCompare(firstReturned(second)))
}

/** OrderRoutes.tsx `resultLines`: what came back from the laboratory, result by result. */
export function resultLines(results: readonly OrderRouteResult[], facility: string): string[] {
  return resultGroups(results).flatMap(reports => resultGroupLines(reports, facility))
}

export interface WithdrawnLine { readonly key: string; readonly text: string; readonly value: string | null }

/** OrderRoutes.tsx `withdrawnResultLines`: results another person's, withdrawn, their values hidden until asked for. */
export function withdrawnResultLines(results: readonly OrderRouteResult[], facility: string, endedAt: string | null): WithdrawnLine[] {
  return resultGroups(results).flatMap((reports, group): WithdrawnLine[] => {
    const named = reports.find(report => report.test.name)?.test.name
    const label = named ? `${named} (do not use)` : 'Do not use'
    const releases = reports.filter(report => report.kind !== 'entered_in_error').sort(byVersion).reverse()
    const voids = reports.filter(report => report.kind === 'entered_in_error')
    const voidOf = (release: OrderRouteResult) => voids.find(report => report.resultVersion === null)
      ?? voids.find(report => report.resultVersion !== null && report.resultVersion === release.resultVersion)
    const withdrawn = (on: string | null | undefined) => `${label}: another person’s result, withdrawn by ${facility} on `
      + `${routeDay(on ?? endedAt)}.`
    if (releases.length === 0) {
      return voids.map((report, index) => ({ key: `${group}-void-${index}`, text: withdrawn(report.occurredAt), value: null }))
    }
    return releases.map((release, index) => ({ key: `${group}-${release.resultVersion ?? index}`,
      text: withdrawn(voidOf(release)?.occurredAt),
      value: `Released by ${facility} on ${routeDay(release.occurredAt)}: ${resultValue(release)}` }))
  })
}

/** OrderRoutes.tsx `dispensingLines`. */
export function dispensingLines(dispensings: readonly OrderRouteDispensing[], facility: string): string[] {
  return [...dispensings].sort((first, second) => (first.occurredAt ?? '').localeCompare(second.occurredAt ?? '')).map(item =>
    item.kind === 'reversed'
      ? `Dispensing reversed on ${routeDay(item.occurredAt)}: contact ${facility}.`
      : `Dispensed by ${facility}: ${[item.quantityDispensed === null ? '' : String(item.quantityDispensed), item.quantityUnit ?? ''].filter(Boolean).join(' ') || 'quantity not recorded'} on ${routeDay(item.occurredAt)}${item.medication.display ? ` (${item.medication.display})` : ''}.`)
}
