/**
 * Plain words for values the services send as codes, shared by the patient app and the Hospital EHR (owner rule: patient
 * and facility screens say things in plain friendly English, never an id, a code, a raw permission word or a media
 * type). Each function answers with words for the values it knows and a plain fallback for any other: never the value.
 */

/** What a facility may do with a patient's records, as the patient and the facility see it. */
export function accessLevelLabel(scope: string | null | undefined): string {
  switch ((scope ?? '').trim().toLowerCase()) {
    case 'read': case 'read_records': case 'view': case 'view_only':
      return 'Can view records'
    case 'write': case 'write_records': case 'read_write': case 'read_write_records':
      return 'Can view and add records'
    case 'break_glass': case 'emergency':
      return 'Emergency access'
    default:
      return 'Access to records'
  }
}

/** "today", "yesterday", "21 Sept", or "21 Sept 2025" in another year; '' when the value is not a date. */
export function dayLabel(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return ''
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  if (Number.isNaN(day.getTime())) return ''
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((start(now) - start(day)) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return day.toLocaleDateString('en-GB', day.getFullYear() === now.getFullYear()
    ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A consultation named by its day, never by its id: "Consultation · today", "Consultation · 21 Sept". */
export function consultationLabel(encounter: { readonly startedAt?: string | null }, now: Date = new Date()): string {
  const day = dayLabel(encounter.startedAt, now)
  return day ? `Consultation · ${day}` : 'Consultation'
}

const VISIT_CLASSES: Readonly<Record<string, string>> = {
  ambulatory: 'Outpatient visit', amb: 'Outpatient visit', outpatient: 'Outpatient visit', outpatient_visit: 'Outpatient visit',
  emergency: 'Emergency visit', emer: 'Emergency visit', emergency_visit: 'Emergency visit', emergency_department: 'Emergency visit',
  inpatient: 'Inpatient stay', imp: 'Inpatient stay', inpatient_encounter: 'Inpatient stay', acute: 'Inpatient stay',
  nonac: 'Inpatient stay', inpatient_stay: 'Inpatient stay',
  home: 'Home visit', hh: 'Home visit', home_health: 'Home visit', home_visit: 'Home visit',
  virtual: 'Virtual visit', vr: 'Virtual visit', telehealth: 'Virtual visit', virtual_visit: 'Virtual visit',
  observation: 'Observation stay', obsenc: 'Observation stay',
  ss: 'Short stay', short_stay: 'Short stay',
  prenc: 'Pre-admission visit',
  field: 'Field visit', fld: 'Field visit',
  other: 'Other visit',
}

/** The kind of visit (the encounter's class, FHIR-style codes included): "Outpatient visit"; "Visit" for any other. */
export function visitClassLabel(value: string | null | undefined): string {
  const key = (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return Object.hasOwn(VISIT_CLASSES, key) ? VISIT_CLASSES[key]! : 'Visit'
}

const VISIT_STATUSES: Readonly<Record<string, string>> = {
  planned: 'Planned', arrived: 'Arrived', triaged: 'Triaged', in_progress: 'In progress', inprogress: 'In progress',
  open: 'In progress', active: 'In progress', on_hold: 'On hold', onleave: 'On leave', on_leave: 'On leave',
  finished: 'Finished', completed: 'Finished', closed: 'Finished', signed: 'Finished', discharged: 'Finished',
  cancelled: 'Cancelled', canceled: 'Cancelled', entered_in_error: 'Entered in error', unknown: 'Status not known',
}

/** Where a visit is: "In progress", "Finished"; "Status not known" for any other value. */
export function visitStatusLabel(value: string | null | undefined): string {
  const key = (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return Object.hasOwn(VISIT_STATUSES, key) ? VISIT_STATUSES[key]! : 'Status not known'
}

const FILE_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'JPEG image', 'image/jpg': 'JPEG image', 'image/pjpeg': 'JPEG image',
  'image/png': 'PNG image', 'image/tiff': 'TIFF image', 'image/tif': 'TIFF image',
  'image/heic': 'HEIC image', 'image/heif': 'HEIF image', 'image/webp': 'WebP image', 'image/gif': 'GIF image',
  'application/pdf': 'PDF document',
}

/** A file's type in words ("JPEG image", "PDF document"); "File" for a type not known here, never the media type. */
export function fileTypeLabel(mediaType: string | null | undefined): string {
  const key = (mediaType ?? '').split(';')[0]!.trim().toLowerCase()
  return Object.hasOwn(FILE_TYPES, key) ? FILE_TYPES[key]! : 'File'
}

/**
 * A file size as the services send it (a number, or text: pg returns bigint as a string), in KB counted in 1024s as
 * before ("56 KB", an empty file "0 KB"), or MB from 1024 KB ("1.4 MB"); `unknown` when there is no usable size.
 */
export function fileSizeLabel(value: number | string | null | undefined, unknown = 'Size unknown'): string {
  const count = value == null || value === '' ? NaN : Number(value)
  if (!Number.isFinite(count) || count < 0) return unknown
  const kb = Math.ceil(count / 1024)
  return kb < 1024 ? `${kb.toLocaleString('en-GB')} KB` : `${(count / 1024 / 1024).toFixed(1)} MB`
}

/** A file's virus check in words, or '' for a value not known here (nothing is said rather than the raw word). */
export function scanStatusLabel(value: string | null | undefined): string {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'clean': case 'no_threats_found': return 'Checked'
    case 'pending': case 'scanning': case 'queued': return 'Being checked for viruses'
    case 'infected': case 'threats_found': case 'quarantined': return 'Blocked: virus found'
    case 'failed': case 'error': case 'unsupported': case 'access_denied': return 'Couldn’t be checked'
    default: return ''
  }
}

/** A system code shown in plain words: "outpatient_visit" reads as "Outpatient visit"; "Not recorded" for none. */
export function plainCode(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  const words = value.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const PATIENT_ACCESS_STATUSES: Readonly<Record<string, string>> = {
  active: 'Active', approved: 'Approved', pending: 'Waiting for you', denied: 'You said no', rejected: 'You said no',
  revoked: 'Ended', ended: 'Ended', expired: 'Time ran out', cancelled: 'Cancelled', canceled: 'Cancelled', withdrawn: 'Withdrawn',
}

/**
 * A facility's request or access as the patient sees it on Access: "Waiting for you", "You said no", "Active", "Ended",
 * "Time ran out"; "Closed" for any other value, never the value.
 */
export function patientAccessStatusLabel(value: string | null | undefined): string {
  const key = (value ?? '').trim().toLowerCase()
  return Object.hasOwn(PATIENT_ACCESS_STATUSES, key) ? PATIENT_ACCESS_STATUSES[key]! : 'Closed'
}

const GENDERS: Readonly<Record<string, string>> = { female: 'Female', male: 'Male', intersex: 'Intersex', other: 'Other' }

/**
 * The gender on the profile in words: "Female", "Male", "Intersex", "Other". "unknown" (one of the sign-up's choices)
 * and none both read "Not given", as every detail not there does; any other value in plain words, never as stored.
 */
export function genderLabel(value: string | null | undefined): string {
  const key = (value ?? '').trim().toLowerCase()
  if (!key || key === 'unknown') return 'Not given'
  return Object.hasOwn(GENDERS, key) ? GENDERS[key]! : plainCode(key)
}

/** The country on the profile by its name ("Nigeria"), never its two-letter code; "Not given" for none. */
export function countryLabel(value: string | null | undefined): string {
  const text = (value ?? '').trim()
  if (!text) return 'Not given'
  if (!/^[a-z]{2}$/i.test(text)) return text
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(text.toUpperCase()) ?? text.toUpperCase() } catch { return text.toUpperCase() }
}
