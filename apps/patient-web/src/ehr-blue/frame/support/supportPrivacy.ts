/**
 * The support assistant is anonymous and outside the record: staff must not type a patient into it. The notice says
 * so above the question, and a question that could hold a patient's Health ID, NIN, email address or phone number is
 * refused before anything is sent, with what to remove.
 *
 * The guard does not try to read a question as a person would, word by word (#61, option a): it refuses a few shapes
 * anyone can predict, and some ordinary questions have to be put another way.
 * 1. A character outside a closed set: Latin letters, digits, spaces, ASCII punctuation, common typographic marks and
 *    emoji. Other scripts, enclosed letters and digits ("ⓐ", "①", "🅰"), bidi controls, private-use and unassigned
 *    characters are refused. Other invisible characters are removed, which can only join text, never hide it.
 * 2. Any @, and an email address written without one ("ada at example dot com", "ada (at) gmail").
 * 3. An encoded character ("%40", "&amp;", "&#64;"), refused rather than read.
 * 4. A number of 7 or more digits, its groups counted together across up to 8 signs or spaces. Dates, clock times,
 *    amounts, version numbers and UUIDs are not counted when they stand alone.
 * 5. A code of 6 or more characters mixing letters and digits, in one piece or read out in groups; after HID, any 6
 *    letters and digits read out, with a digit among them.
 * 6. A Health ID of letters only as it is printed or keyed in: in capitals straight after HID, in a question not in
 *    capitals; or 6 or 8 letters in one case after HID, a patient ID or an ID and a colon, = or # ("hid: kqzxtw",
 *    "health_id=kqzxtw", "Patient ID: kqzxtw").
 * 7. Three or more spelling-alphabet words in a row ("kilo quebec zulu").
 * A Health ID of letters only written any other way cannot be told from a word here: support-api checks questions
 * against the Health IDs issued.
 */

export const SUPPORT_PRIVACY_NOTICE = 'For questions about using Health ID. Do not enter patient names, Health IDs, NINs or clinical details.'

export const PERSONAL_DETAILS_REFUSAL = 'Remove patient or personal details before sending.'

/** What to remove, said after the refusal. */
export const REFUSAL_REASONS = {
  characters: 'Use plain letters, numbers and punctuation.',
  encoded: 'Remove encoded characters such as %40 or &amp;.',
  email: 'Remove email addresses and the @ sign.',
  number: 'Remove phone numbers, NINs and other numbers of 7 or more digits.',
  code: 'Remove Health IDs and other codes that mix letters and digits.',
} as const

export type RefusalReason = keyof typeof REFUSAL_REASONS

/** Why a question is refused, or null when it may be sent. */
export function refusalFor(text: string): RefusalReason | null {
  const read = readable(text)
  if (read === null) return 'characters'
  if (ENCODED.test(read)) return 'encoded'
  if (holdsEmail(read)) return 'email'
  const numbers = withoutOrdinaryNumbers(asDigits(read))
  if (holdsLongNumber(numbers)) return 'number'
  if (holdsCode(numbers)) return 'code'
  return null
}

/** Whether a question could hold a patient's or a person's details, which the support assistant must never receive. */
export function holdsPersonalDetails(text: string): boolean {
  return refusalFor(text) !== null
}

/** The refusal as shown: the sentence, then what to remove. */
export function refusalMessage(reason: RefusalReason): string {
  return `${PERSONAL_DETAILS_REFUSAL} ${REFUSAL_REASONS[reason]}`
}

// --- 1. The characters a question may hold ---

// Bidi controls change the order text is shown in, so what a reader sees is not what is checked: refused.
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u
// Enclosed letters and digits ("ⓐ", "①", "❶", "㉑", "🅰", "🄐", regional indicator letters): NFKC would turn some into
// plain ones and lose what they stood for ("ⓐ" for @); all are letters and digits drawn as symbols.
const ENCLOSED = /[\u2460-\u24FF\u2776-\u2793\u3200-\u32FF\u{1F100}-\u{1F2FF}]/u
// Letters NFKD does not split from their marks, in the languages staff write (Hausa ɓ ɗ ƙ ƴ, ŋ, ß, æ, œ, the dotless
// i), and the modifier apostrophe Hausa uses (ʼy), each the letter then what it is read as.
const LETTERS = new Map([
  ['\u0253', 'b'], ['\u0181', 'B'], ['\u0257', 'd'], ['\u018A', 'D'], ['\u0199', 'k'], ['\u0198', 'K'], ['\u01B4', 'y'],
  ['\u01B3', 'Y'], ['\u014B', 'n'], ['\u014A', 'N'], ['\u00DF', 'ss'], ['\u00E6', 'ae'], ['\u00C6', 'AE'], ['\u0153', 'oe'],
  ['\u0152', 'OE'], ['\u0131', 'i'], ['\u02BC', '\''],
])
const OTHER_LETTERS = new RegExp(`[${[...LETTERS.keys()].join('')}]`, 'g')
// Typographic marks, as their plain signs: quotes, dashes and the minus, middle dots and bullets, fraction and
// division slashes, the multiplication sign, arrows ("HID → Settings"), and every kind of space and line break.
const TYPOGRAPHY: readonly (readonly [RegExp, string])[] = [
  [/[\u2018\u2019\u201A\u201B\u2032]/g, '\''],
  [/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB\u2039\u203A]/g, '"'],
  [/[\u2010-\u2015\u2212]/g, '-'],
  [/[\u00B7\u2022\u2027\u2219\u22C5]/g, '.'],
  [/[\u2044\u2215]/g, '/'],
  [/\u00D7/g, 'x'],
  [/[\u2190-\u21FF]/g, '>'],
  [/[\p{Zs}\u2028\u2029\t\r\n]+/gu, ' '],
]
// What may be left: ASCII letters, digits and signs, a few more signs (¡ ¢ £ ¤ ¥ § © ® ° ± ¶ ¿ ÷ ₦ €), and emoji.
const ALLOWED = /^(?:[\x20-\x7E\u00A1-\u00A5\u00A7\u00A9\u00AE\u00B0\u00B1\u00B6\u00BF\u00F7\u20A6\u20AC]|\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*$/u

/**
 * The question in plain characters, for this check only (what is sent is the question as typed), or null when it holds
 * a character outside the set.
 */
function readable(text: string): string | null {
  if (BIDI.test(text) || ENCLOSED.test(text)) return null
  const plain = text
    // Full-width, mathematical and other compatibility forms as plain letters and digits ("＠" is "@", "𝟎" is "0").
    .normalize('NFKC')
    .replace(OTHER_LETTERS, letter => LETTERS.get(letter) ?? letter)
    // Accents and other marks apart, then removed: "ọ" is "o".
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    // Invisible characters (zero-width spaces and joiners, soft hyphens, variation selectors, fillers, tags) removed;
    // control characters as spaces.
    .replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, '')
    .replace(/[^\P{Cc}\t\r\n]/gu, ' ')
  const signs = TYPOGRAPHY.reduce((read, [marks, sign]) => read.replace(marks, sign), plain)
  return ALLOWED.test(signs) ? signs.trim() : null
}

// --- 3. Encoded characters ---

// A link's escape ("%40") or a page's ("&amp;", "&#64;", "&#x40;").
const ENCODED = /%[0-9a-f]{2}|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,31});/i

// --- 2. Email addresses ---

// The last part of an address: the common ones, and any two letters (every country's).
const TLD = '(?:com|net|org|edu|gov|mil|int|info|biz|name|pro|app|dev|xyz|live|life|cloud|online|site|tech|store|shop|health|africa|email|global|digital|agency|company|network|world|space|solutions|services|[a-z]{2})'
// A part of a host name: two or more letters, digits or dashes ("9a.m. on Monday" is no host).
const HOST = '[a-z0-9][a-z0-9-]+'
const DOT = '\\s*(?:\\.|\\bdot\\b)\\s*'
// Someone at a host: "ada at example.com", "ada.obi at mail.example.co.uk", "ada at example dot com".
const AT_HOST = new RegExp(`[\\w.+-]+\\s+at\\s+(${HOST}(?:${DOT}${HOST})*${DOT}${TLD})\\b`, 'gi')
// Someone at a mail service, without its ".com": "ada at gmail", "write to ada at yahoo please".
const AT_MAIL = /[\w.+-]+\s+at\s+(?:gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|msn|icloud|aol|protonmail|proton|gmx|zoho|yandex|fastmail)\b/i
// Health ID's own addresses, which staff are told to use: "Log in at app.healthid.ng".
const OWN_HOST = /(?:^|\.)(?:healthid\.ng|healthidentitydirectory\.com)$/i

function holdsEmail(read: string): boolean {
  if (read.includes('@')) return true
  const spelled = read
    // "at" and "dot" wrapped in signs, read as the words: "ada (at) example [dot] com", "ada "at" gmail", "ada _at_ x".
    .replace(/(?:[^\w\s]+|(?<![a-z0-9])_+)\s*(at|dot)\s*(?:[^\w\s]+|_+(?![a-z0-9]))/gi, (_, word: string) => ` ${word} `)
    // "(a)" for @, and a dot in brackets: "ada(a)example.com", "example[.]com".
    .replace(/\s*\(a\)\s*/gi, ' at ')
    .replace(/\s*[[({]\.[\])}]\s*/g, '.')
  if (AT_MAIL.test(spelled)) return true
  return [...spelled.matchAll(AT_HOST)].some(([, host]) => !OWN_HOST.test(host!.replace(/\s*(?:\.|\bdot\b)\s*/gi, '.')))
}

// --- 4. Numbers ---

// Digits spelled out, two or more together or beside a figure: "zero eight zero three" is "0 8 0 3", "o eight" "0 8".
const DIGIT_WORDS = new Map(Object.entries({ zero: '0', oh: '0', o: '0', nought: '0', nil: '0', one: '1', two: '2', three: '3',
  four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' }))
const DIGIT_WORD = `(?:${[...DIGIT_WORDS.keys()].join('|')})`
const SPELLED = new RegExp(`\\b(?:${DIGIT_WORD}|\\d+)(?:[\\s,.-]+(?:${DIGIT_WORD}|\\d+))+\\b`, 'gi')

/** The question with digits spelled out as figures, and O, o, I and l among figures as 0 and 1 ("08O3" is "0803"). */
function asDigits(read: string): string {
  return read
    // A run read out with digit words is one number, whatever is between them: "oh eight oh three, one two three".
    .replace(SPELLED, run => new RegExp(`\\b${DIGIT_WORD}\\b`, 'i').test(run)
      ? run.replace(new RegExp(`\\b${DIGIT_WORD}\\b`, 'gi'), word => DIGIT_WORDS.get(word.toLowerCase()) ?? word).replace(/[^\d]+/g, '') : run)
    .replace(/\b[0-9OoIl]+\b/g, group => (group.match(/\d/g)?.length ?? 0) >= 2 ? group.replace(/[Oo]/g, '0').replace(/[Il]/g, '1') : group)
}

const DAY = '(?:0?[1-9]|[12]\\d|3[01])', MONTH = '(?:0?[1-9]|1[0-2])', YEAR = '(?:19|20)\\d{2}', IN_DATE = '[-/.]'
// A calendar date, year, day or month first: "2026-10-30", "30/10/2026", "10/30/2026", "30.10.26".
const DATE = `(?:${YEAR}${IN_DATE}${MONTH}${IN_DATE}${DAY}|${DAY}${IN_DATE}${MONTH}${IN_DATE}(?:${YEAR}|\\d{2})|${MONTH}${IN_DATE}${DAY}${IN_DATE}(?:${YEAR}|\\d{2}))`
// A clock time: "14:30", "07.00", "07:15:00", "9am", "2 p.m.".
const TIME = '(?:(?:[01]?\\d|2[0-3])[:.][0-5]\\d(?:[:.][0-5]\\d)?(?:\\s?[ap]\\.?m\\b\\.?)?|(?:1[0-2]|0?[1-9])\\s?[ap]\\.?m\\b\\.?)'
// A date with its time ("2026-10-30 07:15", "2026-10-30T07:15:00Z", "2026-10-30-0915", "30/10/26 1430hrs"), or a time.
const STAMP = `(?:${DATE}(?:(?:[\\sT_-]+|(?=T))(?:${TIME}(?:Z|[+-]\\d{2}:\\d{2})?|(?:[01]\\d|2[0-3])[0-5]\\d(?:[0-5]\\d)?(?:\\s?(?:h|hrs)\\b)?))?|${TIME})`
// Dates and times standing alone, one or a range: "09:00-17:30", "2026-10-01 – 2026-10-31", "07.00-15.00 / 15.00-23.00".
const STAMPS = new RegExp(`(?<![\\w.:/]|\\d[-_ ])${STAMP}(?:\\s*(?:-|/|to)\\s*${STAMP})*(?!\\s?[-_/.:,]?\\s?\\d|[\\w:/])`, 'gi')
// A version number after its word: "v1.0.2026.1030", "Version 130.0.6723.92", "Build 22631.4317".
const VERSION = /\b(?:v|ver|version|build)\s?[:.]?\s?\d+(?:\.\d+)+\b/gi
// A UUID: "0f2b5a5e-7c1d-4e8a-9b3c-2d4e6f8a0b1c".
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
// An amount: after a currency, up to 9 digits ("₦25000", "NGN 1,500,000.00", "N25000", "#500"; after N or # at least 3,
// so "N 4" in a code read out is not one); with thousands commas ("1,000,000") or two decimals ("45000.00"); or before
// "naira".
const CURRENCY = '(?:(?:\u20A6|NGN|\\$|USD|\u00A3|GBP|\u20AC|EUR)\\s?(?=\\d)|[N#]\\s?(?=\\d{3}))'
const AMOUNT = new RegExp(`(?<![\\w.,])(?:${CURRENCY}(?:\\d{1,3}(?:,\\d{3})+|\\d{1,9})(?:\\.\\d+)?|\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d{1,7}\\.\\d{2}|\\d{1,9}(?:\\.\\d+)?\\s?(?:[Nn]aira|[Kk]obo|NAIRA|KOBO)\\b)(?![\\d,A-Za-z]|\\.\\d)`, 'g')
// What stands for an ordinary number once it is taken out: neither a digit, a letter nor a sign joining numbers.
const TAKEN_OUT = ' \u00A7 '

/** The question with its ordinary numbers taken out: dates, times, versions, UUIDs and amounts. */
function withoutOrdinaryNumbers(read: string): string {
  return [UUID, VERSION, STAMPS, AMOUNT].reduce((rest, ordinary) => rest.replace(ordinary, TAKEN_OUT), read)
}

/** The runs of digits in a question, counted together across up to 8 signs or spaces; ", " and "; " end one. */
function digitRuns(text: string): string[] {
  const runs: string[] = []
  let run = '', end = -1
  for (const group of text.matchAll(/\d+/g)) {
    const between = end < 0 ? '' : text.slice(end, group.index)
    const joins = end >= 0 && /^[^\p{L}\p{N}\u00A7]{1,8}$/u.test(between) && !/[,;] /.test(between)
    run = joins ? run + group[0] : (run && runs.push(run), group[0])
    end = group.index + group[0].length
  }
  if (run) runs.push(run)
  return runs
}

function holdsLongNumber(text: string): boolean {
  return digitRuns(text).some(run => run.length >= 7)
}

// --- 5, 6 and 7. Codes ---

/** A word of the question (a run of letters and digits) and what stands before it. */
interface Word { readonly text: string; readonly before: string }

function wordsOf(text: string): Word[] {
  const words: Word[] = []
  let end = 0
  for (const word of text.matchAll(/[A-Za-z0-9]+/g)) {
    words.push({ text: word[0], before: text.slice(end, word.index) })
    end = word.index + word[0].length
  }
  return words
}

const MIXED = (code: string) => /\d/.test(code) && /[A-Za-z]/.test(code)
// Figures with a short ending that are not part of a code: an ordinal ("2nd", "23rd"), a quantity ("4GB", "500mg",
// "24hrs", "2FA") or a version ("v2", "V3").
const UNIT = '(?:fa|gb|mb|kb|tb|hz|ghz|mhz|px|hrs?|hours?|ms|mins?|minutes?|secs?|seconds?|days?|weeks?|months?|years?|mg|ml|kg|cm|mm|km)'
const TERM = new RegExp(`^(?:\\d+(?:st|nd|rd|th)|\\d{1,4}${UNIT}|v\\d+)$`, 'i')
const ORDINAL = (word: string) => TERM.test(word)
// A unit written apart from its number is read with it: "24 HRS" is "24HRS", "256 GB" "256GB".
const WITH_UNITS = new RegExp(`\\b(\\d{1,4}) ?(${UNIT})\\b`, 'gi')
// A group of two or more letters with a digit ("2XT", "kqz2"): a code's, not a ward's or a room's ("3B").
const CODE_LIKE = (word: string) => /\d/.test(word) && (word.match(/[A-Za-z]/g)?.length ?? 0) >= 2
// What joins the groups of a code read out: up to 3 signs or spaces, but not ", ", "; " or ". ".
const JOINS = (between: string) => /^[^\p{L}\p{N}\u00A7]{1,3}$/u.test(between) && !/[,;.] /.test(between)

/** A group a code read out can be made of: with a digit, in capitals up to 4 letters, or one character. */
function groupOfCode(word: string): boolean {
  if (/^(?:hid|id)$/i.test(word) || ORDINAL(word)) return false
  return (/\d/.test(word) && word.length <= 8) || /^[A-Z]{2,4}$/.test(word) || word.length === 1
}

/** The words of letters among `words`, besides HID's own. */
function lettered(words: readonly Word[]): string[] {
  return words.map(word => word.text).filter(word => /^[A-Za-z]{2,}$/.test(word) && !/^(?:hid|id|health)$/i.test(word))
}

/** Whether a question is written in capitals: a word of 5 or more capitals, and none in lower case. */
function inCapitals(words: readonly Word[]): boolean {
  const plain = lettered(words)
  return plain.some(word => word.length >= 5) && plain.every(word => word === word.toUpperCase())
}

function holdsCode(question: string): boolean {
  const text = question.replace(WITH_UNITS, '$1$2')
  const words = wordsOf(text)
  // In one piece: "kqz2xt", "HealthIDABC234", "7KQ2M9", "X6528B".
  if (words.some(({ text: word }) => word.length >= 6 && MIXED(word) && !ORDINAL(word))) return true
  // Read out in groups: "KQZ 2XT", "kqz2 m9", "A B C 2 3 4", "ABCD-EFGH-2345". In a question written in capitals, a word
  // of capitals is not joined to a plain number ("CAN A HID HAVE 32 CHARACTERS?").
  const shouting = inCapitals(words)
  // A term between two groups joined to both, one of them with a digit, is a group of the code ("K7Q 2FA XTW").
  const group = words.map(word => groupOfCode(word.text))
  for (let at = 1; at < words.length - 1; at += 1) {
    const [before, after] = [words[at - 1]!.text, words[at + 1]!.text]
    if (!group[at] && ORDINAL(words[at]!.text) && group[at - 1] && group[at + 1] && JOINS(words[at]!.before)
      && JOINS(words[at + 1]!.before) && /\d/.test(before + after)) group[at] = true
  }
  let code = '', last = ''
  for (const [at, word] of words.entries()) {
    const plainPair = shouting && ((/^[A-Z]+$/.test(last) && /^\d+$/.test(word.text)) || (/^\d+$/.test(last) && /^[A-Z]+$/.test(word.text)))
    code = group[at] ? (at > 0 && code && JOINS(word.before) && !plainPair ? code : '') + word.text : ''
    last = word.text
    if (code.length >= 6 && MIXED(code)) return true
  }
  return afterHid(text) || spelledAloud(text)
}

// Words before "id" that make it a Health ID (with the usual misspellings), and what follows "health" or "patient".
const HEALTH = /^(?:health|heath|helath|helth|hlth|healt|healh)$/i
const ID_WORD = /^(?:id|ids|identity|identifier|identification|no|num|number)$/i
// Words that come between HID and its code: "HID is ...", "HID of the patient: ...", "HID number ...".
const CONNECTOR = /^(?:is|was|of|for|the|a|my|our|her|his|their|this|that|patient|patients|number|no|nr|num|code|card|s)$/i
// The Health ID alphabet without its digits: letters except I and O. Health IDs are issued with 6 characters (the demo
// tenant's with 8), and nearly one in five of them has no digit.
const HID_LETTERS = /^[A-HJ-NP-Z]{6,32}$/
// 6 or 8 such letters in one case, as a Health ID keyed in after a label and a sign: "kqzxtw", "ABCDEFGH".
const KEYED_IN = /^(?:[a-hj-np-z]{6}|[a-hj-np-z]{8}|[A-HJ-NP-Z]{6}|[A-HJ-NP-Z]{8})$/
const NATO = new Set('alfa alpha bravo charlie delta echo foxtrot golf hotel india juliet juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey whisky xray yankee zulu'.split(' '))

/** Where the words of an HID label end, if one starts at `at`: "HID", "H.I.D.", "h1d", "Health ID", "patientHealthId". */
function hidLabelEnd(words: readonly Word[], at: number): number {
  const word = (offset: number) => words[at + offset]?.text.toLowerCase() ?? ''
  if (/^(?:hid|hids|h1d|hld|healthid|healthids|patientid)$/.test(word(0))) return at + 1
  if (word(0) === 'h' && word(1) === 'i' && word(2) === 'd') return at + 3
  if (word(0) === 'h' && word(1) === 'id') return at + 2
  if ((HEALTH.test(word(0)) || word(0) === 'patient') && ID_WORD.test(word(1)) && word(1) !== 'no') return at + 2
  if (HEALTH.test(word(0)) && word(1) === 'i' && word(2) === 'd') return at + 3
  return -1
}

/**
 * After HID, a code read out: up to 6 connecting words, then groups of digits, short letter groups, single characters
 * and spelled digits or letters, joined across any signs. 6 or more with a digit among them are a Health ID ("hid abc
 * 234", "HID 234 567", "HID seven K Q two M nine"); 6 or more capitals first, in a question not in capitals, are one
 * of letters only ("HID-KQZXTW", "Health ID is KQZXTW").
 */
function afterHid(text: string): boolean {
  const split = text.replace(WITH_UNITS, '$1$2')
    // "h|d" and "h!d" as HID, and HID glued to what follows split from it ("HIDABC 234"), but not "hidden" or "hide".
    .replace(/\bh[|!]d\b/gi, 'hid')
    .replace(/\bhid(?!(?:den|e|es|ing|eous|eout|eouts|er|ers|ey|s)\b)(?=[a-z0-9])/gi, 'hid ')
    // camelCase and PascalCase keys as words: "patientHealthId", "HIDNo".
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  const words = wordsOf(split)
  for (let at = 0; at < words.length; at += 1) {
    const idEnd = idLabelEnd(words, at)
    if (idEnd >= 0) {
      let after = idEnd
      while (after - idEnd < 6 && CONNECTOR.test(words[after]?.text ?? '')) after += 1
      if (keyedIn(words, at, after)) return true
    }
    let next = hidLabelEnd(words, at)
    if (next < 0) continue
    // The connecting words skipped; a one-letter one ("a", "s") may be the code's first group, so the code is read
    // from there too.
    const starts: number[] = []
    for (let skipped = 0; skipped < 6 && CONNECTOR.test(words[next]?.text ?? ''); skipped += 1) {
      if (words[next]!.text.length === 1) starts.push(next)
      next += 1
    }
    // Letters only, in its printed form: capitals (not one letter repeated, as in "HID-XXXXXX"), in a question whose
    // other words are not in capitals.
    const first = words[next]
    const others = lettered(words.filter((_, index) => index < at || index > next))
    const othersInCapitals = others.length > 0 && others.every(word => word === word.toUpperCase())
    if (first && HID_LETTERS.test(first.text) && !/^(.)\1+$/.test(first.text) && !/\u00A7/.test(first.before)
      && !othersInCapitals) return true
    if (keyedIn(words, at, next)) return true
    // In a question written in capitals, a word of capitals is part of the code only beside a group of two or more
    // letters with a digit ("HID KQZ 2XT"), not beside a number ("CAN A HID HAVE 32 CHARACTERS?").
    const shouting = inCapitals(words)
    // Just before HID, after its connecting words: letters and then digits ("abc 234 is her HID").
    let back = at - 1
    while (back >= 0 && CONNECTOR.test(words[back]!.text)) back -= 1
    const [before, last] = [words[back - 1]?.text ?? '', words[back]?.text ?? '']
    if (back >= 1 && (/^\d+$/.test(last) || CODE_LIKE(last)) && /^[A-Za-z0-9]{1,4}$/.test(before)
      && (before + last).length >= 6 && (before + last).length <= 8 && !TERM.test(last)) return true
    for (const start of [next, ...starts]) if (codeFrom(words, start, shouting)) return true
  }
  return false
}

/**
 * A Health ID of letters only, keyed in after its label and a sign: the word after HID (or a patient ID, or an ID) and
 * its connecting words is 6 or 8 letters in one case, with a colon, = or # before it ("hid: kqzxtw", "HID number: abcdef",
 * "health_id=kqzxtw", "Patient ID: kqzxtw"). A word after HID and a space is not read so: "HID backup failed".
 */
function keyedIn(words: readonly Word[], at: number, next: number): boolean {
  const word = words[next]
  if (!word || !KEYED_IN.test(word.text) || /^(.)\1+$/.test(word.text)) return false
  const signs = words.slice(at + 1, next + 1).map(between => between.before).join('')
  return /[:=#]/.test(signs) && !/\u00A7/.test(signs)
}

/** Where a label that a keyed-in Health ID can follow ends: HID's, or "ID" and "Patient ID" alone ("ID: kqzxtw"). */
function idLabelEnd(words: readonly Word[], at: number): number {
  return /^id$/i.test(words[at]?.text ?? '') ? at + 1 : -1
}

/** Whether the groups from `start` on read as a Health ID with a digit (see afterHid). */
function codeFrom(words: readonly Word[], start: number, shouting: boolean): boolean {
  let code = ''
  for (let index = start; index < words.length; index += 1) {
    const word = words[index]!.text, lower = word.toLowerCase(), following = words[index + 1]?.text ?? ''
    const previous = words[index - 1]?.text ?? ''
    if (index > start && /\u00A7/.test(words[index]!.before)) break
    const capitals = /^[A-Z]{1,4}$/.test(word) && shouting && !CODE_LIKE(following) && !CODE_LIKE(previous)
    // A term between groups of the code is one of them ("hid kqz 2fa xtw").
    const between = TERM.test(word) && code !== '' && /^[A-Za-z0-9]{1,8}$/.test(following) && !TERM.test(following)
      && /\d/.test(following)
    const group = DIGIT_WORDS.has(lower) && lower !== 'o' ? DIGIT_WORDS.get(lower)!
      : NATO.has(lower) ? lower.charAt(0)
        : (/\d/.test(word) && !TERM.test(word)) || between ? word
          : capitals ? ''
            : /^[a-z]{1,3}$/i.test(word) || (/^[a-z]{4}$/i.test(word) && MIXED(following) && !TERM.test(following)) ? word : ''
    if (!group) break
    code += group
    if (code.length >= 6 && /\d/.test(code)) return true
  }
  return false
}

/** Three or more spelling-alphabet words in a row: "kilo quebec zulu", "Kilo Quebec Zulu X-ray Tango Whiskey". */
function spelledAloud(text: string): boolean {
  let run = 0
  for (const { text: word } of wordsOf(text.replace(/\bx-ray\b/gi, 'xray'))) {
    const lower = word.toLowerCase()
    run = NATO.has(lower) ? run + 1 : DIGIT_WORDS.has(lower) || /^\d$/.test(word) ? run : 0
    if (run >= 3) return true
  }
  return false
}
