import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatWhen, ageInYears as clinicalAge } from '../ehr-blue/clinical/parts/format'
import { progressTime } from '../ehr-blue/clinical/consult/orders/progress'
import { dateText } from '../ehr-blue/departments/parts/format'
import { clockText } from '../ehr-blue/departments/pharmacy/pharmacyText'
import { checkInWhen, lagosToday, timeText } from '../ehr-blue/departments/waiting/waitingRules'
import { eventTime } from '../ehr-blue/departments/audit/AuditCompliance'
import { phoneText } from '../ehr-blue/departments/outreach/outreachParts'
import { ageInYears as searchAge, today as searchToday } from '../ehr-blue/clinical/patients/searchWords'
import { stampText } from '../ehr-blue/departments/laboratory/labText'
import { calendarDate, lagosDay, routeDay, routeMoment } from '../staff/orderRoutes'
import { dayAndTime } from '../routes/whoHasAccess'
import { dayLabel as recordDayLabel } from '../routes/recordSearch'
import { shareDay } from '../shareRecords'
import { dayLabel } from '../plainLabels'
import { ninHeldText } from '../ninCheck'
import { maskPhone } from '../profileParity'
import { localToday } from '../routes/enrollment/PasswordStep'
import { lagosToday as deskToday } from '../ehr-blue/departments/registration/withoutNin'
import { lagosToday as clinicianToday, formatDate as clinicianDate } from '../staff/clinician/copy'

vi.mock('../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'local', apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

/*
 * EHR list P2-4 (owner decisions Q181 A, Q182 A, Q183 B): a staff or patient screen shows Lagos time whatever zone the
 * device is set to, writes a date one way ("18 Nov 2026", 24-hour clock, never all numbers), and shows a Nigerian phone
 * number as "0803 123 4567". Each case runs on a device set to Los Angeles (UTC-8 in November), where 23:30 UTC on 18
 * Nov is still the afternoon of the 18th but Lagos is already at 00:30 on the 19th.
 */
const LATE = '2026-11-18T23:30:00Z'
const originalZone = process.env.TZ

afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

function onLosAngelesDevice() {
  process.env.TZ = 'America/Los_Angeles'
  // The device really is elsewhere: its own clock reads 15:30 on the 18th.
  expect(new Date(LATE).getHours()).toBe(15)
  expect(new Date(LATE).getDate()).toBe(18)
}

describe('a device in another zone sees Lagos time (Q181 A)', () => {
  it('on the clinical and department pages', () => {
    onLosAngelesDevice()
    expect(formatWhen(LATE)).toBe('19 Nov 2026, 00:30')
    expect(dateText(LATE)).toBe('19 Nov 2026, 00:30')
    expect(dateText(null)).toBe('Not available')
    expect(eventTime(LATE)).toBe('19 Nov 2026, 00:30')
    expect(eventTime('garbled')).toBe('Time unavailable')
    expect(stampText(LATE)).toBe('19 Nov 2026, 00:30')
    expect(timeText(LATE)).toBe('00:30')
    expect(lagosToday(new Date(LATE))).toBe('2026-11-19')
    expect(searchToday(new Date(LATE))).toBe('2026-11-19')
    expect(deskToday(new Date(LATE))).toBe('2026-11-19')
    expect(clinicianToday(new Date(LATE))).toBe('2026-11-19')
    expect(checkInWhen({ checkInDay: '2026-11-17', checkedInAt: '2026-11-17T15:40:00Z' }, '2026-11-19')).toBe('17 Nov 2026, 16:40')
  })

  it('says a time alone only when it is today in Lagos', () => {
    onLosAngelesDevice()
    // 22:50 UTC is 23:50 on the 18th in Lagos: not the same Lagos day as LATE, though it is on the device.
    expect(progressTime('2026-11-18T22:50:00Z', new Date(LATE))).toBe('18 Nov 2026, 23:50')
    expect(progressTime('2026-11-18T23:10:00Z', new Date(LATE))).toBe('00:10')
    expect(clockText('2026-11-18T22:50:00Z', Date.parse(LATE))).toBe('18 Nov 2026, 23:50')
    expect(clockText('2026-11-18T23:10:00Z', Date.parse(LATE))).toBe('00:10')
    expect(dayLabel('2026-11-18T22:50:00Z', new Date(LATE))).toBe('yesterday')
    expect(dayLabel('2026-11-18T23:10:00Z', new Date(LATE))).toBe('today')
    expect(dayLabel('2026-09-03', new Date(LATE))).toBe('3 Sep 2026')
    expect(ninHeldText(Date.parse('2026-11-18T23:40:00Z'), Date.parse('2026-11-18T22:50:00Z')))
      .toBe('This NIN check is on hold. Try again after 00:40 tomorrow.')
  })

  it('on the order, access and sharing pages', () => {
    onLosAngelesDevice()
    expect(routeMoment(LATE)).toBe('19 Nov 2026, 00:30')
    expect(routeDay(LATE)).toBe('19 Nov 2026')
    expect(lagosDay(LATE)).toBe('2026-11-19')
    expect(dayAndTime(LATE)).toBe('19 Nov 2026, 00:30')
    expect(shareDay(LATE)).toBe('19 Nov 2026')
    expect(clinicianDate(LATE)).toBe('19 Nov 2026')
    expect(recordDayLabel('2026-03-03')).toBe('Tuesday 3 Mar 2026')
  })

  it('keeps a calendar day as written on every device', () => {
    onLosAngelesDevice()
    expect(calendarDate('1991-03-04')).toBe('4 Mar 1991')
    expect(dateText('1991-03-04')).toBe('4 Mar 1991')
    expect(calendarDate(null)).toBe('Not recorded')
  })

  it('counts age and limits dates of birth to the Lagos day', () => {
    onLosAngelesDevice()
    // On the device it is still 18 Nov, but in Lagos the 19th: a patient born on 19 Nov 1990 has turned 36.
    expect(clinicalAge('1990-11-19', new Date(LATE))).toBe(36)
    expect(searchAge('1990-11-19', new Date(LATE))).toBe(36)
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('renders Lagos time on a page', () => {
    onLosAngelesDevice()
    render(<p>Recorded {formatWhen(LATE)}</p>)
    expect(screen.getByText('Recorded 19 Nov 2026, 00:30')).toBeTruthy()
  })
})

describe('phone numbers on screen (Q183 B)', () => {
  it('shows a Nigerian number as dialled at home and a foreign one international', () => {
    expect(phoneText('+2348031234567')).toBe('0803 123 4567')
    expect(phoneText('+447700900123')).toBe('+44 770 090 0123')
    expect(phoneText('+234 •••• 4567')).toBe('+234 •••• 4567')
    expect(phoneText(null)).toBe('Not recorded')
    expect(maskPhone('+2348031234567')).toBe('0••• ••• 4567')
    expect(maskPhone('08031234567')).toBe('0••• ••• 4567')
    expect(maskPhone('+14155550123')).toBe('+1 •••• 0123')
  })
})

/*
 * The guard that keeps it so: outside @hid/ui/display, no screen formats a date or time with the browser's own
 * formatter, which would use the device's zone and locale.
 */
describe('one helper formats every date and time', () => {
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const DEVICE_FORMATTERS = [
    /\.toLocaleDateString\(/, /\.toLocaleTimeString\(/, /Intl\.DateTimeFormat/, /\.toDateString\(/, /\.toTimeString\(/,
    /new Date\([^)]*\)\.toLocaleString\(/, /\.toLocaleString\([^)]*(?:hour|month|timeZone|dateStyle)/,
  ]

  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap(name => {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path)
      return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : []
    })
  }

  it('finds no device-zone formatter in the patient and staff screens', () => {
    const found = sources(SRC).flatMap(path => readFileSync(path, 'utf8').split('\n')
      .flatMap((line, index) => DEVICE_FORMATTERS.some(pattern => pattern.test(line)) ? [`${relative(SRC, path)}:${index + 1}`] : []))
    expect(found).toEqual([])
  })
})
