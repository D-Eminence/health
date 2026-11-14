import { describe, expect, it } from 'vitest'
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES, internationalPhone, phoneCountry } from '../routes/enrollment/phoneCountries'

/** The sign-up's phone number as sent (hid-1.0 parity B2): E.164 of any country, Nigerian local numbers as +234. */
describe('a sign-up phone number as E.164 (internationalPhone)', () => {
  it('puts the country code in front of a number written locally, without its leading 0', () => {
    expect(internationalPhone('0801 234 5678', 'NG')).toBe('+2348012345678')
    expect(internationalPhone('8012345678', 'NG')).toBe('+2348012345678')
    expect(internationalPhone('07700 900123', 'GB')).toBe('+447700900123')
    expect(internationalPhone('024 123 4567', 'GH')).toBe('+233241234567')
    expect(internationalPhone('(212) 555-0123', 'US')).toBe('+12125550123')
    expect(internationalPhone('1 212 555 0123', 'CA')).toBe('+12125550123')
  })

  it('keeps the 0 where it is part of the number', () => {
    expect(internationalPhone('06 1234 5678', 'IT')).toBe('+390612345678')
    expect(internationalPhone('0549 886377', 'SM')).toBe('+3780549886377')
    // Benin since 30 November 2024, Côte d'Ivoire since 2021, Congo: the 0 stays after the country code.
    expect(internationalPhone('01 97 12 34 56', 'BJ')).toBe('+2290197123456')
    expect(internationalPhone('07 07 12 34 56', 'CI')).toBe('+2250707123456')
    expect(internationalPhone('06 123 4567', 'CG')).toBe('+242061234567')
    // Gabon: an eight-digit number keeps its 0; a nine-digit one is dialled with a 0 in front.
    expect(internationalPhone('06 03 12 34', 'GA')).toBe('+24106031234')
    expect(internationalPhone('077 12 34 56', 'GA')).toBe('+24177123456')
  })

  it('leaves out a trunk prefix other than 0, and only where it is one', () => {
    // Russia and Kazakhstan dial 8 before the ten digits; a ten-digit number starting 8 is the number itself.
    expect(internationalPhone('8 912 345 67 89', 'RU')).toBe('+79123456789')
    expect(internationalPhone('912 345 67 89', 'RU')).toBe('+79123456789')
    expect(internationalPhone('8 800 555 35 35', 'RU')).toBe('+78005553535')
    expect(internationalPhone('800 555 35 35', 'RU')).toBe('+78005553535')
    expect(internationalPhone('8 701 234 5678', 'KZ')).toBe('+77012345678')
    // Hungary dials 06.
    expect(internationalPhone('06 30 123 4567', 'HU')).toBe('+36301234567')
    expect(internationalPhone('06 1 234 5678', 'HU')).toBe('+3612345678')
    expect(internationalPhone('30 123 4567', 'HU')).toBe('+36301234567')
    // Belarus 8, 80 or 0; Lithuania 8 or 0; Turkmenistan 8.
    expect(internationalPhone('8 029 123 45 67', 'BY')).toBe('+375291234567')
    expect(internationalPhone('80 29 123 45 67', 'BY')).toBe('+375291234567')
    expect(internationalPhone('029 123 45 67', 'BY')).toBe('+375291234567')
    expect(internationalPhone('8 612 34567', 'LT')).toBe('+37061234567')
    expect(internationalPhone('0 612 34567', 'LT')).toBe('+37061234567')
    expect(internationalPhone('8 65 123456', 'TM')).toBe('+99365123456')
  })

  it('takes a number typed with + or 00 and its country code as it is, whatever the picker says', () => {
    expect(internationalPhone('+44 7700 900123', 'NG')).toBe('+447700900123')
    expect(internationalPhone('0044 7700 900123', 'NG')).toBe('+447700900123')
    expect(internationalPhone('2348012345678', 'NG')).toBe('+2348012345678')
  })

  it('refuses what is not a phone number, and a Nigerian number of the wrong length', () => {
    expect(internationalPhone('', 'NG')).toBeNull()
    expect(internationalPhone('12', 'NG')).toBeNull()
    expect(internationalPhone('0801 234 567', 'NG')).toBeNull()
    expect(internationalPhone('+234 801 234 56789', 'GB')).toBeNull()
    expect(internationalPhone('+0123456789', 'NG')).toBeNull()
    expect(internationalPhone('+1234567890123456', 'NG')).toBeNull()
    expect(internationalPhone('0801-ABC', 'NG')).toBeNull()
  })

  it('starts at Nigeria, lists every country once, and falls back to Nigeria for an unknown one', () => {
    expect(DEFAULT_PHONE_COUNTRY).toBe('NG')
    expect(PHONE_COUNTRIES[0]).toEqual({ iso: 'NG', name: 'Nigeria', code: '234' })
    expect(new Set(PHONE_COUNTRIES.map(country => country.iso)).size).toBe(PHONE_COUNTRIES.length)
    expect(PHONE_COUNTRIES.every(country => /^[A-Z]{2}$/.test(country.iso) && /^[1-9]\d{0,2}$/.test(country.code))).toBe(true)
    expect(phoneCountry('XX').iso).toBe('NG')
    expect(internationalPhone('0801 234 5678', 'XX')).toBe('+2348012345678')
  })
})
