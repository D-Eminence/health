/**
 * The sign-up's country code picker (hid-1.0 parity B2): Identity takes a phone number of any country as E.164
 * ("+", the country code and the number), and a Nigerian number written locally (0 and ten digits) as +234. The
 * picker starts at Nigeria. The numbering plans of the North American countries share +1.
 */
export interface PhoneCountry {
  /** ISO 3166-1 alpha-2: the option's value. */
  readonly iso: string
  readonly name: string
  /** The calling code, digits only. */
  readonly code: string
  /**
   * The trunk prefix: what is dialled inside the country before the number, and left out after the country code.
   * Absent for the usual single 0; null where a leading 0 is part of the number (Italy, San Marino, Benin, Côte
   * d'Ivoire, Congo); otherwise the prefix as a pattern, which says how many digits follow it where the number itself
   * may start with the same digit (8 in Russia and Kazakhstan, 06 in Hungary).
   */
  readonly trunk?: RegExp | null
}

export const DEFAULT_PHONE_COUNTRY = 'NG'

const LIST: ReadonlyArray<readonly [string, string, string]> = [
  ['NG', 'Nigeria', '234'],
  ['AF', 'Afghanistan', '93'], ['AL', 'Albania', '355'], ['DZ', 'Algeria', '213'], ['AD', 'Andorra', '376'],
  ['AO', 'Angola', '244'], ['AG', 'Antigua and Barbuda', '1'], ['AR', 'Argentina', '54'], ['AM', 'Armenia', '374'],
  ['AU', 'Australia', '61'], ['AT', 'Austria', '43'], ['AZ', 'Azerbaijan', '994'], ['BS', 'Bahamas', '1'],
  ['BH', 'Bahrain', '973'], ['BD', 'Bangladesh', '880'], ['BB', 'Barbados', '1'], ['BY', 'Belarus', '375'],
  ['BE', 'Belgium', '32'], ['BZ', 'Belize', '501'], ['BJ', 'Benin', '229'], ['BT', 'Bhutan', '975'],
  ['BO', 'Bolivia', '591'], ['BA', 'Bosnia and Herzegovina', '387'], ['BW', 'Botswana', '267'], ['BR', 'Brazil', '55'],
  ['BN', 'Brunei', '673'], ['BG', 'Bulgaria', '359'], ['BF', 'Burkina Faso', '226'], ['BI', 'Burundi', '257'],
  ['CV', 'Cabo Verde', '238'], ['KH', 'Cambodia', '855'], ['CM', 'Cameroon', '237'], ['CA', 'Canada', '1'],
  ['CF', 'Central African Republic', '236'], ['TD', 'Chad', '235'], ['CL', 'Chile', '56'], ['CN', 'China', '86'],
  ['CO', 'Colombia', '57'], ['KM', 'Comoros', '269'], ['CG', 'Congo', '242'], ['CD', 'Congo (Democratic Republic)', '243'],
  ['CR', 'Costa Rica', '506'], ['CI', 'Côte d’Ivoire', '225'], ['HR', 'Croatia', '385'], ['CU', 'Cuba', '53'],
  ['CY', 'Cyprus', '357'], ['CZ', 'Czechia', '420'], ['DK', 'Denmark', '45'], ['DJ', 'Djibouti', '253'],
  ['DM', 'Dominica', '1'], ['DO', 'Dominican Republic', '1'], ['EC', 'Ecuador', '593'], ['EG', 'Egypt', '20'],
  ['SV', 'El Salvador', '503'], ['GQ', 'Equatorial Guinea', '240'], ['ER', 'Eritrea', '291'], ['EE', 'Estonia', '372'],
  ['SZ', 'Eswatini', '268'], ['ET', 'Ethiopia', '251'], ['FJ', 'Fiji', '679'], ['FI', 'Finland', '358'],
  ['FR', 'France', '33'], ['GA', 'Gabon', '241'], ['GM', 'Gambia', '220'], ['GE', 'Georgia', '995'],
  ['DE', 'Germany', '49'], ['GH', 'Ghana', '233'], ['GR', 'Greece', '30'], ['GD', 'Grenada', '1'],
  ['GT', 'Guatemala', '502'], ['GN', 'Guinea', '224'], ['GW', 'Guinea-Bissau', '245'], ['GY', 'Guyana', '592'],
  ['HT', 'Haiti', '509'], ['HN', 'Honduras', '504'], ['HK', 'Hong Kong', '852'], ['HU', 'Hungary', '36'],
  ['IS', 'Iceland', '354'], ['IN', 'India', '91'], ['ID', 'Indonesia', '62'], ['IR', 'Iran', '98'],
  ['IQ', 'Iraq', '964'], ['IE', 'Ireland', '353'], ['IL', 'Israel', '972'], ['IT', 'Italy', '39'],
  ['JM', 'Jamaica', '1'], ['JP', 'Japan', '81'], ['JO', 'Jordan', '962'], ['KZ', 'Kazakhstan', '7'],
  ['KE', 'Kenya', '254'], ['KI', 'Kiribati', '686'], ['KW', 'Kuwait', '965'], ['KG', 'Kyrgyzstan', '996'],
  ['LA', 'Laos', '856'], ['LV', 'Latvia', '371'], ['LB', 'Lebanon', '961'], ['LS', 'Lesotho', '266'],
  ['LR', 'Liberia', '231'], ['LY', 'Libya', '218'], ['LI', 'Liechtenstein', '423'], ['LT', 'Lithuania', '370'],
  ['LU', 'Luxembourg', '352'], ['MO', 'Macao', '853'], ['MG', 'Madagascar', '261'], ['MW', 'Malawi', '265'],
  ['MY', 'Malaysia', '60'], ['MV', 'Maldives', '960'], ['ML', 'Mali', '223'], ['MT', 'Malta', '356'],
  ['MH', 'Marshall Islands', '692'], ['MR', 'Mauritania', '222'], ['MU', 'Mauritius', '230'], ['MX', 'Mexico', '52'],
  ['FM', 'Micronesia', '691'], ['MD', 'Moldova', '373'], ['MC', 'Monaco', '377'], ['MN', 'Mongolia', '976'],
  ['ME', 'Montenegro', '382'], ['MA', 'Morocco', '212'], ['MZ', 'Mozambique', '258'], ['MM', 'Myanmar', '95'],
  ['NA', 'Namibia', '264'], ['NR', 'Nauru', '674'], ['NP', 'Nepal', '977'], ['NL', 'Netherlands', '31'],
  ['NZ', 'New Zealand', '64'], ['NI', 'Nicaragua', '505'], ['NE', 'Niger', '227'], ['KP', 'North Korea', '850'],
  ['MK', 'North Macedonia', '389'], ['NO', 'Norway', '47'], ['OM', 'Oman', '968'], ['PK', 'Pakistan', '92'],
  ['PW', 'Palau', '680'], ['PS', 'Palestine', '970'], ['PA', 'Panama', '507'], ['PG', 'Papua New Guinea', '675'],
  ['PY', 'Paraguay', '595'], ['PE', 'Peru', '51'], ['PH', 'Philippines', '63'], ['PL', 'Poland', '48'],
  ['PT', 'Portugal', '351'], ['QA', 'Qatar', '974'], ['RO', 'Romania', '40'], ['RU', 'Russia', '7'],
  ['RW', 'Rwanda', '250'], ['KN', 'Saint Kitts and Nevis', '1'], ['LC', 'Saint Lucia', '1'],
  ['VC', 'Saint Vincent and the Grenadines', '1'], ['WS', 'Samoa', '685'], ['SM', 'San Marino', '378'],
  ['ST', 'São Tomé and Príncipe', '239'], ['SA', 'Saudi Arabia', '966'], ['SN', 'Senegal', '221'], ['RS', 'Serbia', '381'],
  ['SC', 'Seychelles', '248'], ['SL', 'Sierra Leone', '232'], ['SG', 'Singapore', '65'], ['SK', 'Slovakia', '421'],
  ['SI', 'Slovenia', '386'], ['SB', 'Solomon Islands', '677'], ['SO', 'Somalia', '252'], ['ZA', 'South Africa', '27'],
  ['KR', 'South Korea', '82'], ['SS', 'South Sudan', '211'], ['ES', 'Spain', '34'], ['LK', 'Sri Lanka', '94'],
  ['SD', 'Sudan', '249'], ['SR', 'Suriname', '597'], ['SE', 'Sweden', '46'], ['CH', 'Switzerland', '41'],
  ['SY', 'Syria', '963'], ['TW', 'Taiwan', '886'], ['TJ', 'Tajikistan', '992'], ['TZ', 'Tanzania', '255'],
  ['TH', 'Thailand', '66'], ['TL', 'Timor-Leste', '670'], ['TG', 'Togo', '228'], ['TO', 'Tonga', '676'],
  ['TT', 'Trinidad and Tobago', '1'], ['TN', 'Tunisia', '216'], ['TR', 'Türkiye', '90'], ['TM', 'Turkmenistan', '993'],
  ['TV', 'Tuvalu', '688'], ['UG', 'Uganda', '256'], ['UA', 'Ukraine', '380'], ['AE', 'United Arab Emirates', '971'],
  ['GB', 'United Kingdom', '44'], ['US', 'United States', '1'], ['UY', 'Uruguay', '598'], ['UZ', 'Uzbekistan', '998'],
  ['VU', 'Vanuatu', '678'], ['VE', 'Venezuela', '58'], ['VN', 'Vietnam', '84'], ['YE', 'Yemen', '967'],
  ['ZM', 'Zambia', '260'], ['ZW', 'Zimbabwe', '263'],
]

/**
 * Where the trunk prefix is not a single 0 (ITU national numbering plans, as libphonenumber reads them). Benin
 * (since 30 November 2024), Côte d'Ivoire (since 2021) and Congo write a 0 that stays after the country code: +229 01
 * 97 12 34 56, +225 07 07 12 34 56, +242 06 123 4567. Gabon's eight-digit numbers keep theirs (+241 06 03 12 34); a
 * nine-digit one is dialled with a 0 in front. Russia and Kazakhstan dial 8 before the ten digits (whose own first
 * digit may be 8: 800 numbers), Belarus 8, 80 or 0 before nine, Lithuania 8 or 0 before eight, Turkmenistan 8 before
 * eight, and Hungary 06.
 */
const TRUNK: ReadonlyMap<string, RegExp | null> = new Map([
  ['IT', null], ['SM', null], ['BJ', null], ['CI', null], ['CG', null],
  ['GA', /^0(?=\d{8}$)/],
  ['RU', /^8(?=\d{10}$)/], ['KZ', /^8(?=\d{10}$)/],
  ['BY', /^(?:80|8|0)(?=\d{9}$)/],
  ['LT', /^[08](?=\d{8}$)/],
  ['TM', /^8(?=\d{8}$)/],
  ['HU', /^06/],
])

/** Nigeria first, as the default, then every other country by name. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = LIST.map(([iso, name, code]) => {
  const trunk = TRUNK.get(iso)
  return trunk === undefined ? { iso, name, code } : { iso, name, code, trunk }
})

export function phoneCountry(iso: string): PhoneCountry {
  return PHONE_COUNTRIES.find(country => country.iso === iso) ?? PHONE_COUNTRIES[0]!
}

/** E.164: "+", then 7 to 15 digits, the first not 0. */
const E164 = /^\+[1-9]\d{6,14}$/
/** A Nigerian number: +234 and ten digits, as Identity has always stored it. */
const NIGERIA = /^\+234\d{10}$/

/**
 * The number as sent: E.164. Spaces, dashes, dots and brackets go. A number typed with "+" is taken as it is,
 * whatever the picker says; otherwise the country's code goes in front, without the trunk prefix dialled inside
 * the country (most often a 0), and keeping a 0 that is part of the number. Null when what results is not a phone
 * number, or for Nigeria not +234 and ten digits.
 */
export function internationalPhone(typed: string, iso: string): string | null {
  const compact = typed.replace(/[\s().-]/g, '')
  if (compact === '') return null
  let number: string
  if (compact.startsWith('+')) number = compact
  else if (/^00[1-9]/.test(compact)) number = `+${compact.slice(2)}`
  else {
    if (!/^\d+$/.test(compact)) return null
    const country = phoneCountry(iso)
    const trunk = country.trunk === undefined ? /^0/ : country.trunk
    let national = trunk ? compact.replace(trunk, '') : compact
    // A North American number written with its leading 1.
    if (country.code === '1' && national.length === 11 && national.startsWith('1')) national = national.slice(1)
    // A Nigerian number typed with its country code but without "+" (2348012345678).
    if (country.iso === 'NG' && /^234\d{10}$/.test(national)) national = national.slice(3)
    number = `+${country.code}${national}`
  }
  if (!E164.test(number)) return null
  if (number.startsWith('+234') && !NIGERIA.test(number)) return null
  return number
}
