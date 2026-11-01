import type { FlagLevel } from '../../../kasuwa/parts'
import type { VitalMeasurement } from '../../../staff/api'

/*
 * Common adult reference ranges for vital signs, used only to flag a value for a second look. They are adult defaults,
 * not a diagnosis: children, pregnancy, athletes and many conditions have other normals, and the clinician decides.
 * One table, so every screen that shows a vital flags it the same way.
 */
interface Range {
  /** At or above: high. */
  readonly highFrom?: number
  /** Above: high (for ranges whose limit is itself normal). */
  readonly highAbove?: number
  /** Below: low. */
  readonly lowBelow?: number
  /** Below: critical. */
  readonly criticalBelow?: number
}

export const ADULT_VITAL_RANGES: Readonly<Partial<Record<VitalMeasurement, Range>>> = {
  systolicMmhg: { highFrom: 140, lowBelow: 90 },
  diastolicMmhg: { highFrom: 90, lowBelow: 60 },
  pulseBpm: { highAbove: 100, lowBelow: 50 },
  temperatureC: { highFrom: 38.0, lowBelow: 35.5 },
  respiratoryRate: { highAbove: 20, lowBelow: 12 },
  oxygenSaturationPercent: { lowBelow: 94, criticalBelow: 90 },
}

/** The flag for one measurement against the adult range, or null when it is in range, unknown or not a number. */
export function vitalFlag(name: VitalMeasurement, value: unknown): FlagLevel | null {
  const range = ADULT_VITAL_RANGES[name]
  if (!range || value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (range.criticalBelow !== undefined && number < range.criticalBelow) return 'critical'
  if (range.lowBelow !== undefined && number < range.lowBelow) return 'low'
  if (range.highFrom !== undefined && number >= range.highFrom) return 'high'
  if (range.highAbove !== undefined && number > range.highAbove) return 'high'
  return null
}

const RANK: Readonly<Record<FlagLevel, number>> = { critical: 3, high: 2, low: 2, abnormal: 1 }

/** The more serious of two flags (blood pressure is one reading of two numbers). */
export function worstFlag(...flags: ReadonlyArray<FlagLevel | null>): FlagLevel | null {
  let worst: FlagLevel | null = null
  for (const flag of flags) if (flag && (!worst || RANK[flag] > RANK[worst])) worst = flag
  return worst
}
