/**
 * The support assistant is anonymous and outside the record: staff must not type a patient into it. The notice says
 * so above the question, and a question holding a Health ID, a NIN, an email address or a phone number is refused
 * before anything is sent.
 *
 * The guard reads a question as a person would, however it is typed: in any case; with spaces, dashes, signs,
 * brackets, quotes or words ("is", "number") between HID and the code; with the code read out in groups or across a
 * line break; and through Unicode tricks (full-width forms, invisible characters, other-script digits, Cyrillic or
 * Greek letters drawn like Latin ones). Ordinary questions still go: dates, times, date ranges, prices, versions,
 * references and product words such as "HID number" or "HID-Pharmacy". Where the two cannot be told apart, the guard
 * refuses (privacy first): the person only has to rephrase.
 */

export const SUPPORT_PRIVACY_NOTICE = 'For questions about using Health ID. Do not enter patient names, Health IDs, NINs or clinical details.'

export const PERSONAL_DETAILS_REFUSAL = 'Remove patient or personal details before sending.'

/** Whether a question holds a patient's or a person's details, which the support assistant must never receive. */
export function holdsPersonalDetails(text: string): boolean {
  const plain = plainForm(text)
  return holdsHealthId(plain) || EMAILS.some(email => email.test(plain)) || holdsPhoneOrNin(plain)
}

// --- The question as a reader sees it ---

// Every dash a keyboard or a paste can give: hyphen, the Unicode hyphens and dashes, and minus.
const DASHES = '\\-\\u2010-\\u2015\\u2212'

// What a reader does not see: accents and other marks (NFKD splits them off their letters), format characters
// (zero-width space and joiners, LRM and RLM, bidi embeddings and isolates, invisible operators, soft hyphen, BOM,
// tags) and the other default-ignorable ones (variation selectors, Hangul fillers).
const UNSEEN = /[\p{M}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu

// Cyrillic, Greek and small capital letters drawn like Latin ones, each pair the look-alike then its Latin letter:
// "НID" and "ʜɪᴅ" are "HID".
const LOOK_ALIKES = new Map([
  'АA ВB СC ЕE НH ІI ЈJ КK МM ОO РP ЅS ТT УY ХX ҺH ԚQ ԜW аa сc еe һh іi јj оo рp ѕs уy хx ԁd ԛq ԝw ӏl',
  'ΑA ΒB ΕE ΖZ ΗH ΙI ΚK ΜM ΝN ΟO ΡP ΤT ΥY ΧX οo ιi νv ρp υu',
  'ᴀA ʙB ᴄC ᴅD ᴇE ꜰF ɢG ʜH ɪI ᴊJ ᴋK ʟL ᴍM ɴN ᴏO ᴘP ʀR ꜱS ᴛT ᴜU ᴠV ᴡW ʏY ᴢZ',
].join(' ').split(' ').map(pair => [pair.charAt(0), pair.charAt(1)]))

/** The question as a reader sees it, for this check only: what is sent is the question as typed. */
function plainForm(text: string): string {
  return text
    // Full-width, mathematical, circled and other compatibility forms as plain letters and digits, accents apart.
    .normalize('NFKD')
    .replace(UNSEEN, '')
    .replace(/(?![0-9])\p{Nd}/gu, asciiDigit)
    .replace(/[\u0080-\uFFFF]/g, letter => LOOK_ALIKES.get(letter) ?? letter)
    // Spaces and line breaks (and the braille blank), however many, as one space.
    .replace(/[\s\u2800]+/g, ' ')
}

/** A digit of another script as 0 to 9 ("٣" and "३" are 3): Unicode keeps each script's ten digits together, from 0. */
function asciiDigit(digit: string): string {
  const code = digit.codePointAt(0) ?? 0
  let zero = code
  while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1
  return String((code - zero) % 10)
}

// --- Health IDs ---

/** A word of the question (a run of letters and digits) and what stands before it. */
interface Word { readonly text: string; readonly before: string }

// The Health ID alphabet (HEALTH_ID_PATTERN): letters and digits without 0, 1, I or O. A word holding one of those
// ends a Health ID being read out in groups, so "HID ABC 234 for her" stops at "for".
const IN_ALPHABET = /^[A-HJ-NP-Z2-9]+$/i

// A Health ID alone, as Health IDs are issued and printed: 6 characters in capitals, letters and digits ("7KQ2M9").
const ISSUED_HEALTH_ID = /^(?=.*\d)(?=.*[A-Z])[A-HJ-NP-Z2-9]{6}$/

// What stands between the words of "Health ID" or of HID spelled out ("H.I.D."): a space, a dot or a dash.
const WITHIN_HID = new RegExp(`^[\\s.${DASHES}]{0,3}$`)
// What people put between HID and its code: spaces, dashes, and the signs, brackets and quotes round a code
// ("HID: ABC234", "HID (ABC234)", "HID “abcdef”").
const ROUND_A_CODE = new RegExp(`^[\\s${DASHES}:#_/\\\\=*()\\[\\]{}<>"'\\u2018\\u2019\\u201C\\u201D\\u00AB\\u00BB]{0,6}$`)
// Any punctuation, as between words ("HID of the patient: ABC234") or before a code with a digit ("HID, ABC234").
const ANY_PUNCTUATION = /^[\s\p{P}\p{S}]{0,6}$/u
// Between the groups of a Health ID read out: one to three spaces, dashes, dots, slashes or underscores.
const BETWEEN_GROUPS = new RegExp(`^[\\s${DASHES}_./]{1,3}$`)
// Words that stand between HID and its code: "HID number ABC234", "Health ID is ABCDEF", "HID No: ABC234".
const NUMBER_WORDS = /^(?:is|was|number|no|nr|num|code|card)$/i

// Words written after HID that happen to use only Health ID letters, so "HID pharmacy", "HID-Pharmacy" or
// "HID SYSTEM" is not read as a Health ID. Only words of 6 letters or more without i or o matter: no other can be one.
const AFTER_HID = new Set(`
  number numbers system systems pharmacy health letter letters character characters length capitals uppercase
  server servers screen screens search searches scanner scanners reader readers camera header banner calendar
  member members manager managers partner partners agent agents nurses helpdesk headquarters central general
  payment payments charges renewal upgrade upgrades update updates updated release feature features manual
  access request requests status scheme transfer transfers referral emergency ambulance research address
  replacement change changes changed channel sample samples template webpage webapp gateway database backend
  attachment market branch branches result results tracker message messages alerts tablet wallet centre center
  tenant legacy express default secure secured usable unusable useful
  always already really became starts started appears appeared entered shared merged enabled needed renewed
  deleted accepted rejected crashed crashes freezes refuses returns returned resets cleared created replaced
  cancel cancelled canceled suspended scanned pasted wanted expected because unless anyway please thanks regards
  urgent yesterday tuesday wednesday thursday saturday sunday january february august september december twelve
  twenty eleven
`.trim().split(/\s+/))

// Short words and abbreviations people write in capitals, so "HID WEB APP" or "MY HID CARD PAGE" is not read as a
// Health ID read out in groups of letters ("HID ABC DEF").
const IN_CAPITALS = new Set(`
  app apps web ehr emr lab labs sms mfa key keys url pdf csv usb nhs tab tabs page card cards new the and are can
  has had was all any faq help desk team staff user users data beta test plan pay fee fees bank cash due fax tel
  scan menu bar ward bed beds day days year week back next send sent save edit full past date name age area case
`.trim().split(/\s+/))

/** Where a Health ID's characters follow HID: straight after it, after other words or punctuation, or after "is". */
type Placing = 'straight after HID' | 'after a number word' | 'after other words'

/** Whether the question holds a Health ID: after HID or "Health ID", against HID ("HIDABC234"), or alone as issued. */
function holdsHealthId(plain: string): boolean {
  const words = wordsOf(plain)
  return words.some((word, at) => ISSUED_HEALTH_ID.test(word.text) || againstHid(word.text)
    || (endsHid(words, at) && followsHid(words, at + 1)))
}

function wordsOf(plain: string): Word[] {
  const words: Word[] = []
  let end = 0
  for (const match of plain.matchAll(/[A-Za-z0-9]+/g)) {
    words.push({ text: match[0], before: plain.slice(end, match.index) })
    end = match.index + match[0].length
  }
  return words
}

/** Whether the word at `at` ends HID: "HID", "HIDs", "HealthID", "Health ID", "Health Identity", "H.I.D.", "Health I.D.". */
function endsHid(words: readonly Word[], at: number): boolean {
  const text = (back: number) => words[at - back]?.text.toLowerCase()
  const close = (back: number) => WITHIN_HID.test(words[at - back]?.before ?? '')
  if (text(0) === 'hid' || text(0) === 'hids' || text(0) === 'healthid') return true
  if (text(0) === 'id' || text(0) === 'identity') return text(1) === 'health' && close(0)
  return text(0) === 'd' && text(1) === 'i' && close(0) && close(1) && (text(2) === 'h' || text(2) === 'health')
}

/** Whether a word is HID typed against its code: "HIDABC234", "hidabcdef" (but "hidden" and "HIDE" are words). */
function againstHid(text: string): boolean {
  const code = /^(?:hid|healthid)([a-z0-9]+)$/i.exec(text)?.[1]
  return code !== undefined && !AFTER_HID.has(code.toLowerCase()) && isHealthId([code], 'straight after HID')
}

/**
 * Whether a Health ID follows HID, from the word at `next`: straight after it, or after up to four words between
 * ("HID number ABC 234", "The HID of the patient: ABC234", "Health ID for her is 7KQ2M9").
 */
function followsHid(words: readonly Word[], next: number): boolean {
  const first = words[next]
  if (!first || !ANY_PUNCTUATION.test(first.before)) return false
  if (healthIdFrom(words, next, ROUND_A_CODE.test(first.before) ? 'straight after HID' : 'after other words')) return true
  let placing: Placing = 'after a number word'
  for (let at = next; at < next + 4; at += 1) {
    const between = words[at], after = words[at + 1]
    if (!between || !after || !/^[a-z]+$/i.test(between.text) || !ANY_PUNCTUATION.test(after.before)) return false
    if (!NUMBER_WORDS.test(between.text)) placing = 'after other words'
    if (healthIdFrom(words, at + 1, placing)) return true
  }
  return false
}

/** Whether the words from `start` are a Health ID's characters, typed whole or read out in groups ("ABC 234"). */
function healthIdFrom(words: readonly Word[], start: number, placing: Placing): boolean {
  const groups: string[] = []
  for (const { text, before } of words.slice(start)) {
    if (groups.length > 0 && (!BETWEEN_GROUPS.test(before) || !IN_ALPHABET.test(text))) return false
    if (AFTER_HID.has(text.toLowerCase())) return false
    groups.push(text)
    if (isHealthId(groups, placing)) return true
    if (!IN_ALPHABET.test(text) || groups.join('').length >= 32) return false
  }
  return false
}

/**
 * Whether groups typed after HID read as a Health ID's 6 to 32 characters:
 * - one word with a digit ("ABC234", "abc234", "7KQ2M9"; straight after HID, a mistyped "ABC123" too), or of letters
 *   only, unless other words came between: in capitals ("ABCDEF"), or in any case straight after HID ("abcdef");
 * - groups in capitals: with a digit among them ("ABC 234", "A B C 2 3 4", "ABCD-EFGH-2345"), or of letters only
 *   in groups of one length that are not words ("ABC DEF", but not "WEB APP"), unless other words came between;
 * - groups in any case: of one length from 2 to 4, the last with a digit ("abc 234", "7kq 2m9"). Words and numbers
 *   rarely line up like that, so "HID 24 hrs late" and "Can a HID have 32 characters?" still go.
 */
function isHealthId(groups: readonly string[], placing: Placing): boolean {
  const id = groups.join(''), size = groups[0]?.length ?? 0
  // One character over and over is a placeholder ("HID-XXXXXX"), not a Health ID.
  if (id.length < 6 || id.length > 32 || /^(.)\1+$/i.test(id)) return false
  const digit = /\d/.test(id), capitals = !/[a-z]/.test(id), lettersOnlyCount = placing !== 'after other words'
  if (groups.length === 1) {
    if (!IN_ALPHABET.test(id)) return digit && placing === 'straight after HID'
    return digit || (capitals ? lettersOnlyCount : placing === 'straight after HID')
  }
  const oneLength = groups.every(group => group.length === size)
  const words = groups.some(group => IN_CAPITALS.has(group.toLowerCase()))
  if (capitals) return digit || (oneLength && lettersOnlyCount && !words)
  return oneLength && size >= 2 && size <= 4 && /\d/.test(groups.at(-1) ?? '')
}

// --- Email addresses ---

const EMAILS: readonly RegExp[] = [
  // name@host.tld, a space either side of the @ or not, the last part starting with a letter: "ada@example.com",
  // "ada @ example.test", "ada@163.com". A price is not one: "2 units @ 500.00", "Rate @ 2.5%".
  /[^\s@]+ ?@ ?[^\s@]+\.[A-Za-z]/,
  // name@host written together, without the dot: "ada@gmail", "ada@example . com".
  /[^\s@]+@[A-Za-z][\w-]/,
  // Spelled out: "ada(at)example", "ada [at] gmail".
  /[\w.+-]+ ?[([{] ?at ?[)\]}] ?\w/i,
  // "ada at example dot com", "ada @ example [dot] com".
  /[\w.+-]+ ?(?:@|\bat\b) ?[\w-]+ ?(?:\bdot\b|[([{] ?dot ?[)\]}]) ?[A-Za-z]{2}/i,
  // "ada at gmail.com": at a webmail host.
  /[\w.+-]+ at (?:gmail|googlemail|yahoo|ymail|hotmail|outlook|icloud|aol|protonmail|proton)\b/i,
]

// --- NINs and phone numbers ---

// What people put between a number's digits: spaces, dots, dashes, slashes, brackets, underscores, middle dots,
// bullets and tildes (a price's commas are not one).
const DIGIT_GAP = `[\\s().${DASHES}/_\\u00B7\\u2022~]`

/** Read once the ordinary numbers below are taken out, so "2026-10-30 14:30" or "Chrome 130.0.6723.91" is none. */
const NUMBERS: readonly RegExp[] = [
  // A NIN: eleven digits together.
  /(?<!\d)\d{11}(?!\d)/,
  // A phone number: 10 to 15 digits, with up to three of those between them and a + before.
  new RegExp(`(?<![\\d+])\\+?\\s?\\(?\\d(?:${DIGIT_GAP}{0,3}\\d){9,14}(?!\\d)`),
  // A Nigerian landline as written at home: 0 and 8 more digits ("01 234 5678", "(09) 876 5432").
  new RegExp(`(?<![\\d+])\\(?0\\d(?:${DIGIT_GAP}{0,3}\\d){7}(?!\\d)`),
]

// A calendar date, year, day or month first (year 19xx or 20xx, a real month and day), with dashes, slashes or dots.
const DAY = '(?:0?[1-9]|[12]\\d|3[01])', MONTH = '(?:0?[1-9]|1[0-2])', YEAR = '(?:19|20)\\d{2}'
const IN_DATE = `[${DASHES}/.]`
const DATE = `(?:${[[YEAR, MONTH, DAY], [DAY, MONTH, YEAR], [MONTH, DAY, YEAR]].map(parts => parts.join(IN_DATE)).join('|')})`
// A part of an IP address: 0 to 255, without a leading 0.
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
// Standing alone: no digit right before or after, across the gaps a phone number's digits can have.
const ALONE_BEFORE = `(?<!\\d${DIGIT_GAP}{0,3})`, ALONE_AFTER = `(?!${DIGIT_GAP}{0,3}\\d)`
// An amount, with its currency before or after it.
const AMOUNT = '[1-9][\\d,]*(?:\\.\\d{1,2})?', CURRENCY = '(?:\\u20A6|\\bNGN|\\$|\\bUSD|\\u00A3|\\u20AC)'

/** Numbers that are not a person's, each taken out before NUMBERS is read. */
const ORDINARY_NUMBERS: readonly RegExp[] = [
  // A UUID, such as a facility's id.
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  // A reference with a year in it: "INV-2026-000123", "ORD-20261030-0042", Health ID's invoices "HID-2026-000123".
  /\b[A-Z]{2,5}[-/](?:19|20)\d{2}(?:\d{4})?[-/]\d{1,8}\b/g,
  // A date or a date range ("30/10/2026", "2026-10-01–2026-10-31"), standing alone: one that runs on into more digits
  // ("1990-12-25-4567", "0803.12.30.4567") is part of a number and stays.
  new RegExp(`(?<!\\d${IN_DATE}?)${DATE}(?:\\s?[${DASHES}]\\s?${DATE})?(?!${IN_DATE}?\\d)`, 'g'),
  // A clock time: "14:30", "07:15:00".
  /(?<![\d:])(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?![\d:])/g,
  // A version: "Chrome 130.0.6723.91", "Windows 10.0.19045", "1.0.2026.1030". A phone number's groups do not fit:
  // its first is longer or starts with 0, its second longer than 2 digits.
  /(?<![\d.])(?:0|[1-9]\d{0,2})\.\d{1,2}(?:\.\d{1,5}){1,2}(?!\.?\d)/g,
  // An IP address: "192.168.100.254".
  new RegExp(`(?<![\\d.])(?:${OCTET}\\.){3}${OCTET}(?!\\.?\\d)`, 'g'),
  // An amount of money, standing alone: "₦10000000.00", "NGN 25000000", "5000000 naira".
  new RegExp(`${ALONE_BEFORE}(?:${CURRENCY} ?${AMOUNT}|${AMOUNT} ?(?:naira|NGN)\\b)${ALONE_AFTER}`, 'gi'),
]

function holdsPhoneOrNin(plain: string): boolean {
  // The letter O typed for a 0 in a number ("O8O3 123 4567") is the 0 it stands for; "No12345678" keeps its o.
  const digits = plain.replace(/(?<![A-Za-z])[Oo](?=\d)|(?<=\d)[Oo]/g, '0')
  const left = ORDINARY_NUMBERS.reduce((text, ordinary) => text.replace(ordinary, ' '), digits)
  return NUMBERS.some(number => number.test(left))
}
