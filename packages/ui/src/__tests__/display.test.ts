import { afterEach, describe, expect, it } from 'vitest'
import {
  ageInYears, formatDate, formatDateTime, formatPhone, formatTime, formatTimeOrDateTime, formatWeekday, lagosClock,
  lagosDay, sameLagosDay,
} from '../display'

/*
 * EHR list P2-4 (owner decisions Q181 A, Q182 A, Q183 B). A device set to another zone must still see Lagos time: each
 * case below runs with the process zone moved away from Lagos and checks the device really is elsewhere first.
 */
const DEVICE_ZONES = ['America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata', 'UTC', 'Africa/Lagos']
const originalZone = process.env.TZ

function onDevice(zone: string) {
  process.env.TZ = zone
}

afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

describe('Lagos time on every device (Q181 A)', () => {
  it('the test really moves the device zone', () => {
    onDevice('America/Los_Angeles')
    expect(new Date('2026-11-18T23:30:00Z').getHours()).toBe(15)
    onDevice('Pacific/Kiritimati')
    expect(new Date('2026-11-18T23:30:00Z').getHours()).toBe(13)
  })

  for (const zone of DEVICE_ZONES) {
    it(`a device in ${zone} sees the Lagos day and clock`, () => {
      onDevice(zone)
      // 23:30 UTC is 00:30 the next day in Lagos.
      expect(formatDateTime('2026-11-18T23:30:00Z')).toBe('19 Nov 2026, 00:30')
      expect(formatDate('2026-11-18T23:30:00Z')).toBe('19 Nov 2026')
      expect(formatTime('2026-11-18T23:30:00Z')).toBe('00:30')
      expect(formatWeekday('2026-11-18T23:30:00Z')).toBe('Thursday')
      expect(lagosDay(new Date('2026-11-18T23:30:00Z'))).toBe('2026-11-19')
      // An afternoon time stays on the 24-hour clock.
      expect(formatDateTime('2026-11-18T13:05:00Z')).toBe('18 Nov 2026, 14:05')
      // A calendar day is that day on every device, never shifted by a zone.
      expect(formatDate('1991-03-04')).toBe('4 Mar 1991')
      expect(formatDateTime('1991-03-04')).toBe('4 Mar 1991')
      expect(formatTime('1991-03-04')).toBe('')
      // A time with an offset is read as the instant it names.
      expect(formatDateTime('2026-11-18T08:00:00-05:00')).toBe('18 Nov 2026, 14:00')
    })
  }

  it('Lagos keeps UTC+1 all year, with no daylight saving', () => {
    onDevice('Europe/London')
    expect(formatDateTime('2026-07-01T12:00:00Z')).toBe('1 Jul 2026, 13:00')
    expect(formatDateTime('2026-01-01T12:00:00Z')).toBe('1 Jan 2026, 13:00')
    expect(lagosClock('2026-12-31T23:00:00Z')).toEqual({ year: 2027, month: 1, day: 1, hour: 0, minute: 0, weekday: 5 })
  })

  it('takes a Date, a millisecond count or a string, and gives the fallback for anything else', () => {
    const at = Date.UTC(2026, 8, 3, 6, 7)
    expect(formatDateTime(at)).toBe('3 Sep 2026, 07:07')
    expect(formatDateTime(new Date(at))).toBe('3 Sep 2026, 07:07')
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined, 'No date')).toBe('No date')
    expect(formatDate('', 'Not available')).toBe('Not available')
    expect(formatDateTime('not a date', 'Time unavailable')).toBe('Time unavailable')
    expect(formatDate('2026-02-30')).toBe('')
    expect(formatTime(Number.NaN, 'none')).toBe('none')
  })

  it('compares days in Lagos, not on the device', () => {
    onDevice('America/Los_Angeles')
    // Both are 18 Nov in Los Angeles, but 18 Nov and 19 Nov in Lagos.
    expect(sameLagosDay('2026-11-18T22:00:00Z', '2026-11-18T23:30:00Z')).toBe(false)
    expect(sameLagosDay('2026-11-18T23:10:00Z', '2026-11-18T23:30:00Z')).toBe(true)
    expect(sameLagosDay('nope', 'nope')).toBe(false)
    expect(formatTimeOrDateTime('2026-11-18T23:10:00Z', '2026-11-18T23:30:00Z')).toBe('00:10')
    expect(formatTimeOrDateTime('2026-11-18T22:00:00Z', '2026-11-18T23:30:00Z')).toBe('18 Nov 2026, 23:00')
    expect(formatTimeOrDateTime(null, Date.now(), 'never')).toBe('never')
  })

  it('counts age to the Lagos day', () => {
    onDevice('America/Los_Angeles')
    // 23:30 UTC on 3 Mar is already 4 Mar in Lagos: the birthday has come.
    expect(ageInYears('1991-03-04', '2026-03-03T23:30:00Z')).toBe(35)
    expect(ageInYears('1991-03-04', '2026-03-03T22:30:00Z')).toBe(34)
    expect(ageInYears('1991-03-04T00:00:00Z', '2026-03-04T12:00:00Z')).toBe(35)
    expect(ageInYears('2030-01-01', '2026-03-04T12:00:00Z')).toBeNull()
    expect(ageInYears('', '2026-03-04T12:00:00Z')).toBeNull()
    expect(ageInYears('unknown', '2026-03-04T12:00:00Z')).toBeNull()
  })

  for (const zone of DEVICE_ZONES) {
    it(`counts age from the Lagos day of a date of birth sent as a time, on a device in ${zone}`, () => {
      onDevice(zone)
      // Midnight in Lagos on 4 Mar 1991, sent in UTC: born on the 4th, as formatDate shows, so not 35 until 4 Mar 2026.
      expect(formatDate('1991-03-03T23:00:00Z')).toBe('4 Mar 1991')
      expect(ageInYears('1991-03-03T23:00:00Z', '2026-03-03T12:00:00Z')).toBe(34)
      expect(ageInYears('1991-03-03T23:00:00.000Z', '2026-03-03T22:30:00Z')).toBe(34)
      expect(ageInYears('1991-03-03T23:00:00Z', '2026-03-03T23:00:00Z')).toBe(35)
      expect(ageInYears('1991-03-03T23:00:00Z', '2026-03-04T12:00:00Z')).toBe(35)
      // The same instant written with its offset, or as Postgres writes it.
      expect(ageInYears('1991-03-04T00:00:00+01:00', '2026-03-03T12:00:00Z')).toBe(34)
      expect(ageInYears('1991-03-04T00:00:00+0100', '2026-03-03T12:00:00Z')).toBe(34)
      expect(ageInYears('1991-03-03 23:00:00+00', '2026-03-03T12:00:00Z')).toBe(34)
      expect(ageInYears('1991-03-04 00:00:00+01', '2026-03-04T12:00:00Z')).toBe(35)
      // Midnight UTC is 01:00 the same day in Lagos.
      expect(ageInYears('1991-03-04T00:00:00Z', '2026-03-03T12:00:00Z')).toBe(34)
      expect(ageInYears('1991-03-04T00:00:00Z', '2026-03-04T12:00:00Z')).toBe(35)
      // A time with no zone keeps the day as written, wherever the device is.
      expect(ageInYears('1991-03-04T00:00:00', '2026-03-03T12:00:00Z')).toBe(34)
      expect(ageInYears('1991-03-04T00:00:00', '2026-03-04T12:00:00Z')).toBe(35)
      // Not a time: no age.
      expect(ageInYears('1991-02-30T23:00:00Z', '2026-03-04T12:00:00Z')).toBeNull()
      expect(ageInYears('1991-03-03T25:00:00Z', '2026-03-04T12:00:00Z')).toBeNull()
    })
  }
})

describe('one date format (Q182 A)', () => {
  it('is never all in numbers', () => {
    for (const month of [0, 3, 8, 11]) {
      const text = formatDateTime(Date.UTC(2026, month, 3, 9))
      expect(text).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/)
      expect(text).not.toMatch(/\d+\/\d+/)
    }
  })
})

describe('phone numbers (Q183 B)', () => {
  it('shows a Nigerian number as it is dialled at home', () => {
    expect(formatPhone('+2348031234567')).toBe('0803 123 4567')
    expect(formatPhone('2348031234567')).toBe('0803 123 4567')
    expect(formatPhone('08031234567')).toBe('0803 123 4567')
    expect(formatPhone('+234 803 123 4567')).toBe('0803 123 4567')
    expect(formatPhone('+234 (0) 803-123-4567')).toBe('0803 123 4567')
    expect(formatPhone('0803.123.4567')).toBe('0803 123 4567')
  })

  it('keeps every Nigerian mobile prefix in the mobile form', () => {
    for (const prefix of ['701', '703', '708', '802', '803', '805', '810', '813', '816', '901', '903', '912', '916']) {
      expect(formatPhone(`+234${prefix}1234567`)).toBe(`0${prefix} 123 4567`)
    }
    // 0700 and 0800 business and free-call numbers are ten digits too.
    expect(formatPhone('+2347002255482')).toBe('0700 225 5482')
    expect(formatPhone('+2348001234567')).toBe('0800 123 4567')
  })

  it('shows a Nigerian landline as it is dialled at home', () => {
    // The Commission's own examples, the older way: Lagos, Abuja, Port Harcourt, Kano.
    expect(formatPhone('+23414630643')).toBe('01 463 0643')
    expect(formatPhone('+23494630643')).toBe('09 463 0643')
    expect(formatPhone('+23484460643')).toBe('084 460 643')
    expect(formatPhone('+23464460643')).toBe('064 460 643')
    // Ibadan, Enugu, Jos.
    expect(formatPhone('+23422310123')).toBe('02 231 0123')
    expect(formatPhone('+23442250123')).toBe('042 250 123')
    expect(formatPhone('+23473460643')).toBe('073 460 643')
    // A digit short (an older six-digit Lagos number, or one missing a digit: they cannot be told apart): as written.
    expect(formatPhone('+2341463064')).toBe('+2341463064')
    expect(formatPhone('+2347346064')).toBe('+2347346064')
    // The same numbers since 2024, with 20 before the area code.
    expect(formatPhone('+2342014630643')).toBe('0201 463 0643')
    expect(formatPhone('+234 20 1 463 0643')).toBe('0201 463 0643')
    expect(formatPhone('+2342042250123')).toBe('02042 250 123')
    expect(formatPhone('+2342094630643')).toBe('0209 463 0643')
    expect(formatPhone('+2342084460643')).toBe('02084 460 643')
    expect(formatPhone('+2342064460643')).toBe('02064 460 643')
    // However it was stored.
    expect(formatPhone('014630643')).toBe('01 463 0643')
    expect(formatPhone('01-463 0643')).toBe('01 463 0643')
    expect(formatPhone('02014630643')).toBe('0201 463 0643')
    expect(formatPhone('+234 1 463 0643')).toBe('01 463 0643')
    expect(formatPhone('+234 (1) 463-0643')).toBe('01 463 0643')
    expect(formatPhone('+234 01 463 0643')).toBe('01 463 0643')
    // Not an area code (80 and 81 are mobile ranges), or too short to be a number: as written, never international.
    expect(formatPhone('+23480460643')).toBe('+23480460643')
    expect(formatPhone('+234123456')).toBe('+234123456')
    // 20 before a mobile prefix, or before a 0, is not a 2024 landline.
    expect(formatPhone('+2342080460643')).toBe('+2342080460643')
    expect(formatPhone('+2342001234567')).toBe('+2342001234567')
  })

  it('shows a foreign number in international form, never ending on a short group', () => {
    expect(formatPhone('+447700900123')).toBe('+44 770 090 0123')
    expect(formatPhone('+14155550123')).toBe('+1 415 555 0123')
    expect(formatPhone('+233241234567')).toBe('+233 241 234 567')
    expect(formatPhone('+27821234567')).toBe('+27 821 234 567')
    expect(formatPhone('+8613800138000')).toBe('+86 138 0013 8000')
    expect(formatPhone('+6581234567')).toBe('+65 8123 4567')
    expect(formatPhone('+4930123456')).toBe('+49 3012 3456')
    expect(formatPhone('+3546101234')).toBe('+354 610 1234')
    expect(formatPhone('+12423570123')).toBe('+1 242 357 0123')
    expect(formatPhone('+49301234567890')).toBe('+49 301 234 567 890')
    expect(formatPhone('+861234567890123')).toBe('+86 123 456 789 0123')
    for (const number of ['+8613800138000', '+4930123456', '+6581234567', '+491511234567', '+33612345678',
      '+5521987654321', '+2250701234567', '+3726123456', '+35312345678', '+9611234567', '+96171123456']) {
      const shown = formatPhone(number)
      // No group after the country code is shorter than three digits, and no digit is lost.
      expect(shown.split(' ').slice(1).every(group => group.length >= 3), `${number}: ${shown}`).toBe(true)
      expect(shown.replace(/\D/g, '')).toBe(number.slice(1))
    }
  })

  it('leaves out a stored "(0)" trunk for any country, and no other digit', () => {
    expect(formatPhone('+44 (0)20 7946 0958')).toBe('+44 207 946 0958')
    expect(formatPhone('+44 (0) 7700 900123')).toBe('+44 770 090 0123')
    expect(formatPhone('+44(0)7700900123')).toBe('+44 770 090 0123')
    expect(formatPhone('+49 (0)30 1234 5678')).toBe('+49 301 234 5678')
    expect(formatPhone('+41 (0) 44 668 18 00')).toBe('+41 446 681 800')
    expect(formatPhone('+1 (0) 415 555 0123')).toBe('+1 415 555 0123')
    expect(formatPhone('+234 (0) 803-123-4567')).toBe('0803 123 4567')
    expect(formatPhone('+234 (0)1 463 0643')).toBe('01 463 0643')
    expect(formatPhone('+234 (0) 209 463 0643')).toBe('0209 463 0643')
    expect(formatPhone('234 (0) 803 123 4567')).toBe('0803 123 4567')
    // Where the 0 is the number's own first digit, it stays.
    expect(formatPhone('+39 (0)6 1234 5678')).toBe('+39 061 234 5678')
    expect(formatPhone('+39 06 1234 5678')).toBe('+39 061 234 5678')
    expect(formatPhone('+225 (0)7 01 23 45 67')).toBe('+225 070 123 4567')
    // A 0 anywhere else is a digit of the number: the home 0, or one in the middle.
    expect(formatPhone('(0)803 123 4567')).toBe('0803 123 4567')
    expect(formatPhone('+44 20 (0) 7946 095')).toBe('+44 200 794 6095')
    // A bracketed area code is not a trunk.
    expect(formatPhone('+44 (01) 632 960 001')).toBe('+44 016 3296 0001')
  })

  it('shows a Nigerian landline as it is written at home: 0, the area code, then the subscriber number', () => {
    // Lagos (1), Ibadan (2) and Abuja (9) have a one-digit area code and a seven-digit subscriber number.
    expect(formatPhone('+23412345678')).toBe('01 234 5678')
    expect(formatPhone('23412345678')).toBe('01 234 5678')
    expect(formatPhone('012345678')).toBe('01 234 5678')
    expect(formatPhone('+234 (0)1 234 5678')).toBe('01 234 5678')
    expect(formatPhone('+234 (0) 1-234-5678')).toBe('01 234 5678')
    expect(formatPhone('+2340 1 234 5678')).toBe('01 234 5678')
    expect(formatPhone('01.234.5678')).toBe('01 234 5678')
    expect(formatPhone('(01) 234 5678')).toBe('01 234 5678')
    expect(formatPhone('+23422345678')).toBe('02 234 5678')
    expect(formatPhone('+23492345678')).toBe('09 234 5678')
    // Every other area has a two-digit code and a six-digit subscriber number.
    expect(formatPhone('+23442123456')).toBe('042 123 456')
    expect(formatPhone('084 123 456')).toBe('084 123 456')
    expect(formatPhone('+234 (0) 84 123456')).toBe('084 123 456')
  })

  it('still shows a Nigerian mobile as "0803 123 4567" beside the landline rule', () => {
    expect(formatPhone('+2349031234567')).toBe('0903 123 4567')
    expect(formatPhone('+2348131234567')).toBe('0813 123 4567')
    expect(formatPhone('+234 (0) 903 123 4567')).toBe('0903 123 4567')
  })

  it('never shows a mobile missing digits as a landline', () => {
    // 70, 80, 81, 90 and 91 begin Nigerian mobile prefixes (0701, 0803, 0813, 0903, 0912), not area codes.
    expect(formatPhone('0803 123 45')).toBe('0803 123 45')
    expect(formatPhone('+234 803 123 45')).toBe('+234 803 123 45')
    expect(formatPhone('070123456')).toBe('070123456')
    expect(formatPhone('+23481312345')).toBe('+23481312345')
    expect(formatPhone('+234 903 123 45')).toBe('+234 903 123 45')
    expect(formatPhone('091 234 567')).toBe('091 234 567')
    // Abuja keeps its one-digit area code, and the two-digit codes beside the mobile prefixes stay landlines.
    expect(formatPhone('09 234 5678')).toBe('09 234 5678')
    expect(formatPhone('+23496123456')).toBe('09 612 3456')
    expect(formatPhone('+23471123456')).toBe('071 123 456')
    expect(formatPhone('+23482123456')).toBe('082 123 456')
  })

  it('never shows ten digits as a mobile unless they begin with a mobile prefix', () => {
    // Ten digits are a mobile (70, 80, 81, 90, 91) or a landline with the 2024 20, so this is a landline too long.
    expect(formatPhone('01 234 567 890')).toBe('01 234 567 890')
    expect(formatPhone('+234 1 234 567 890')).toBe('+234 1 234 567 890')
    expect(formatPhone('+234 42 123 456 78')).toBe('+234 42 123 456 78')
    expect(formatPhone('+2347031234567')).toBe('0703 123 4567')
    expect(formatPhone('+2349121234567')).toBe('0912 123 4567')
  })

  it('never reads a national number that starts with 0, and shows a doubled trunk as written', () => {
    expect(formatPhone('+2340(0)12345678')).toBe('+2340(0)12345678')
    expect(formatPhone('+234 0 0803 123 4567')).toBe('+234 0 0803 123 4567')
    expect(formatPhone('2340012345678')).toBe('2340012345678')
  })

  it('drops the trunk 0 after 234 written without a "+"', () => {
    expect(formatPhone('234 (0)1 234 5678')).toBe('01 234 5678')
    expect(formatPhone('2340 1 234 5678')).toBe('01 234 5678')
    expect(formatPhone('234 (0)803 123 4567')).toBe('0803 123 4567')
    expect(formatPhone('2340803 123 4567')).toBe('0803 123 4567')
    expect(formatPhone('(234) (0) 84 123456')).toBe('084 123 456')
  })

  it('never leaves a group of one or two digits after the country code', () => {
    expect(formatPhone('+8613800138000')).toBe('+86 138 0013 8000')
    expect(formatPhone('+4420794600')).toBe('+44 2079 4600')
    expect(formatPhone('+35312345')).toBe('+353 12345')
    expect(formatPhone('+3531234')).toBe('+353 1234')
    expect(formatPhone('+12345678901234')).toBe('+1 234 567 890 1234')
    for (const stored of ['+3531234', '+35312345', '+4420794600', '+8613800138000', '+447700900123', '+12345678901234',
      '+123456789012345', '+493023125123']) {
      const shown = formatPhone(stored)
      expect(shown.replace(/\D/g, '')).toBe(stored.replace(/\D/g, ''))
      for (const group of shown.split(' ').slice(1)) expect(group.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('drops a "(0)" trunk written after a foreign country code, and keeps a bare 0 as written', () => {
    expect(formatPhone('+44 (0) 20 7946 0000')).toBe('+44 207 946 0000')
    expect(formatPhone('+44(0)2079460000')).toBe('+44 207 946 0000')
    expect(formatPhone('+44 ( 0 ) 20 7946 0000')).toBe('+44 207 946 0000')
    expect(formatPhone('+44 020 7946 0000')).toBe('+44 020 7946 0000')
    expect(formatPhone('+(44) (0) 20 7946 0000')).toBe('+44 207 946 0000')
    expect(formatPhone('+(44)(0)2079460000')).toBe('+44 207 946 0000')
    expect(formatPhone('+(234) (0) 1 234 5678')).toBe('01 234 5678')
    expect(formatPhone('(+44) (0) 20 7946 0000')).toBe('+44 207 946 0000')
    expect(formatPhone('(+44)(0)2079460000')).toBe('+44 207 946 0000')
    expect(formatPhone('(+44) 20 7946 0000')).toBe('+44 207 946 0000')
  })

  it('leaves anything that is not a number as it came, and gives the fallback for none', () => {
    expect(formatPhone('+234 •••• 4567')).toBe('+234 •••• 4567')
    expect(formatPhone('  ask at the desk ')).toBe('ask at the desk')
    expect(formatPhone(null, 'Not recorded')).toBe('Not recorded')
    expect(formatPhone('   ')).toBe('')
  })
})
