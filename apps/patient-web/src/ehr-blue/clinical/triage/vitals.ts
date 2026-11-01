import { createElement, useEffect, useState } from 'react'
import { Value } from '../../../kasuwa/parts'
import { staffApi, type ClinicalRecord, type VitalCorrection, type VitalMeasurement, type VitalMeasurements } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import type { Chart } from '../parts/chart'
import type { KeyValue } from '../parts/KeyValueList'
import { vitalFlag, worstFlag } from './ranges'

/** The sidebar label, the list's heading; the create page's heading ("New " + the label, lower case). */
export const TITLE = 'Triage & Vitals'
export const NEW_TITLE = 'New triage & vitals'
export const AMEND_LABEL = 'Amend observation'

/**
 * Today's vital measurements (as EHR's DTO limits them): a plain label, its unit, the input step and range. Steps are
 * what a ward measures to: SpO₂ in whole percent, weight and temperature to one decimal place.
 */
export interface VitalField {
  readonly name: VitalMeasurement
  readonly label: string
  readonly unit: string
  readonly step: string
  readonly min: string
  readonly max: string
}

export const VITAL_FIELDS: readonly VitalField[] = [
  { name: 'systolicMmhg', label: 'BP systolic', unit: 'mmHg', step: '1', min: '30', max: '350' },
  { name: 'diastolicMmhg', label: 'BP diastolic', unit: 'mmHg', step: '1', min: '10', max: '250' },
  { name: 'pulseBpm', label: 'Pulse', unit: 'bpm', step: '1', min: '10', max: '350' },
  { name: 'temperatureC', label: 'Temperature', unit: '°C', step: '0.1', min: '20', max: '50' },
  { name: 'respiratoryRate', label: 'Respiratory rate', unit: 'breaths/min', step: '1', min: '1', max: '100' },
  { name: 'oxygenSaturationPercent', label: 'SpO₂', unit: '%', step: '1', min: '0', max: '100' },
  { name: 'weightKg', label: 'Weight', unit: 'kg', step: '0.1', min: '0.2', max: '700' },
  { name: 'heightCm', label: 'Height', unit: 'cm', step: '0.1', min: '20', max: '300' },
]

/** "Pulse (bpm)": a field's label with its unit. */
export function fieldLabel(field: VitalField): string {
  return `${field.label} (${field.unit})`
}

/** The order today's create sends the measurements in. */
export const BODY_ORDER: readonly VitalMeasurement[] = [
  'heightCm', 'weightKg', 'temperatureC', 'pulseBpm', 'respiratoryRate', 'systolicMmhg', 'diastolicMmhg', 'oxygenSaturationPercent',
]

/** Today's vitals wording, word for word. */
export const ENTER_ONE = 'Enter at least one vital measurement.'
export const BOTH_BP = 'Enter both systolic and diastolic blood pressure, or leave both blank.'
export const CHANGE_ONE = 'Change at least one value before saving a correction.'
export const CORRECTION_HINT = 'The values below become the current vitals; what was recorded is kept. A measurement left blank is not part of the corrected vitals.'
export const RETRACTED_TEXT = 'Recorded in error: do not use these values. They can no longer be corrected.'
export const CORRECTION_MISSING = 'The current correction was not returned.'
export const CORRECTIONS_FAILED = 'Corrections could not be loaded.'
export const CORRECTION_UNREAD = 'These vitals were corrected, but the correction could not be loaded, so the values below are as first recorded and may not be current.'
export const LOADING_CORRECTION = 'Loading the correction…'
export const CORRECTION_SAVED = 'Vital correction saved.'
export const CORRECTION_FAILED = 'The correction could not be saved.'
export const RELOAD_FIRST = 'Reload the vitals before correcting them.'
export const RETRACTED_SINCE = 'These vitals were marked entered in error since they were loaded, so the correction was not saved.'
export const CHANGED_SINCE = 'These vitals changed since they were loaded, so the correction was not saved: check them, and correct them again if it is still needed.'

/** Today's sentence after a change, on the list read again: it could not be read, or (the record changed) it was. */
export function reloadSentence(reload: { readonly failed: string } | { readonly items: readonly unknown[] }, what: string, listChanged: boolean) {
  if ('failed' in reload) return ` The list could not be reloaded; refresh it to see the ${what}.`
  return listChanged ? ' The list was reloaded.' : ''
}

export type VitalValues = Readonly<Record<string, unknown>>

/** Today's one-line summary ("BP 120/80 mmHg · 36.6 °C · 72 bpm"), values printed as sent. */
export function vitalSummary(values: VitalValues) {
  return [
    values.systolicMmhg != null && values.diastolicMmhg != null ? `BP ${values.systolicMmhg}/${values.diastolicMmhg} mmHg` : '',
    values.temperatureC != null ? `${values.temperatureC} °C` : '',
    values.pulseBpm != null ? `${values.pulseBpm} bpm` : '',
    values.respiratoryRate != null ? `${values.respiratoryRate} breaths/min` : '',
    values.oxygenSaturationPercent != null ? `SpO₂ ${values.oxygenSaturationPercent}%` : '',
    values.weightKg != null ? `${values.weightKg} kg` : '',
    values.heightCm != null ? `${values.heightCm} cm` : '',
  ].filter(Boolean).join(' · ')
}

/** As the design prints it: stored decimals ("98.00", "68.400") lose their trailing zeros ("98", "68.4"). Display only. */
function shown(value: unknown): string {
  if (value == null || value === '') return ''
  const text = String(value)
  return /^-?\d+\.\d*0$/.test(text) ? text.replace(/\.?0+$/, '') : text
}

/**
 * The measurements as a saved record lists them: "BP 120/80 mmHg", "Pulse 80 bpm", "Temperature 37.2 °C", each with
 * its unit and, outside the adult range (ranges.ts), its flag; only those recorded.
 */
export function measurementItems(values: VitalValues): KeyValue[] {
  const items: KeyValue[] = []
  const add = (label: string, value: string, unit: string, flag: ReturnType<typeof vitalFlag>) => {
    if (value) items.push({ label, value: createElement(Value, { value, unit, flag }) })
  }
  const systolic = shown(values.systolicMmhg)
  const diastolic = shown(values.diastolicMmhg)
  add('BP', systolic && diastolic ? `${systolic}/${diastolic}` : '', 'mmHg',
    worstFlag(vitalFlag('systolicMmhg', values.systolicMmhg), vitalFlag('diastolicMmhg', values.diastolicMmhg)))
  for (const name of ['pulseBpm', 'temperatureC', 'oxygenSaturationPercent', 'respiratoryRate', 'weightKg', 'heightCm'] as const) {
    const field = VITAL_FIELDS.find(item => item.name === name)!
    add(field.label, shown(values[name]), field.unit, vitalFlag(name, values[name]))
  }
  return items
}

/** A measurement as a number, or undefined when it was not recorded. */
export function measured(values: VitalValues, name: VitalMeasurement): number | undefined {
  const value = values[name]
  return value == null || value === '' ? undefined : Number(value)
}

/** A vital's status: EHR before hid-system #74 sends none, and then every vital is final. */
export function vitalStatus(vital: ClinicalRecord): string {
  return typeof vital.status === 'string' && vital.status ? vital.status : 'final'
}

export function correctionNumber(vital: ClinicalRecord): number {
  const value = Number(vital.currentCorrectionNo ?? 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function isRetracted(vital: ClinicalRecord) {
  return vital.status === 'entered_in_error'
}

/** The measurements in today's body order, numbers only. */
export function orderedMeasurements(values: VitalMeasurements): VitalMeasurements {
  const body: VitalMeasurements = {}
  for (const name of BODY_ORDER) if (values[name] !== undefined) body[name] = values[name]
  return body
}

export type Corrections =
  | { readonly state: 'none' }
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'shown'; readonly latest: VitalCorrection; readonly items: readonly VitalCorrection[] }

/** A vital's corrections, today's read (no re-check), and the one EHR names current. */
export async function readCorrections(chart: Pick<Chart, 'facilityId' | 'patientId'>, encounterId: string, vitalId: string, number: number): Promise<Corrections> {
  if (number === 0) return { state: 'none' }
  try {
    const items = await staffApi.vitalCorrections(chart.facilityId, chart.patientId, encounterId, vitalId)
    const latest = items.find(item => item.correctionNo === number)
    if (!latest) return { state: 'failed', message: CORRECTION_MISSING }
    const kept = items.filter(item => item.correctionNo <= number).sort((a, b) => a.correctionNo - b.correctionNo)
    return { state: 'shown', latest, items: kept }
  } catch (caught) {
    return { state: 'failed', message: refusalText(caught, CORRECTIONS_FAILED) }
  }
}

/** The corrections of the given vitals, read for each corrected one (as each of today's rows does). */
export function useCorrections(chart: Chart, vitals: readonly { readonly encounterId: string; readonly vital: ClinicalRecord }[] | null) {
  const { facilityId, patientId } = chart
  const [read, setRead] = useState<ReadonlyMap<string, Corrections>>(new Map())
  const wanted = (vitals ?? []).filter(item => correctionNumber(item.vital) > 0)
  const signature = JSON.stringify(wanted.map(item => [item.encounterId, item.vital.id, correctionNumber(item.vital), String(item.vital.rowVersion)]))

  useEffect(() => {
    let current = true
    const list = JSON.parse(signature) as [string, string, number, string][]
    for (const [encounterId, id, number] of list) {
      const key = `${id}-${number}`
      void readCorrections({ facilityId, patientId }, encounterId, id, number).then(result => {
        if (current) setRead(map => new Map(map).set(key, result))
      })
    }
    return () => { current = false }
  }, [facilityId, patientId, signature])

  return (vital: ClinicalRecord): Corrections => {
    const number = correctionNumber(vital)
    if (number === 0) return { state: 'none' }
    return read.get(`${vital.id}-${number}`) ?? { state: 'loading' }
  }
}

/** The values a vital holds now: the current correction's, the recorded ones, or null while that is not known. */
export function currentValues(vital: ClinicalRecord, corrections: Corrections): VitalValues | null {
  if (corrections.state === 'none') return vital
  return corrections.state === 'shown' ? corrections.latest.replacementValues : null
}
