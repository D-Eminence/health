/**
 * The support assistant is anonymous and outside the record: staff must not type a patient into it. The notice says
 * so above the question, and a question holding a Health ID, a NIN, an email address or a phone number is refused
 * before anything is sent.
 *
 * The guard reads a question as a person would, however it is typed: in any case; with spaces, signs, brackets,
 * quotes or words ("is", "number") between HID and the code, or the code before HID ("abc234 is her HID"); with the
 * code read out in groups or across a line break; pasted from a link ("hid%20abc234") or a log ("health_id: abc234");
 * and through Unicode tricks (full-width forms, invisible characters, controls, text turned round, other-script
 * digits, every kind of dash, dot and bracket, letters drawn like Latin ones). Ordinary questions still go: dates,
 * times, date ranges, prices, versions, references and words written after HID ("HID pharmacy", "Health ID handles
 * referrals", "HID app 2FA", "HID support hours 9am-5pm"). Where the two cannot be told apart, the guard refuses
 * (privacy first): the person only has to rephrase.
 */
import { isEnglishWord } from './supportWords'

export const SUPPORT_PRIVACY_NOTICE = 'For questions about using Health ID. Do not enter patient names, Health IDs, NINs or clinical details.'

export const PERSONAL_DETAILS_REFUSAL = 'Remove patient or personal details before sending.'

/** Whether a question holds a patient's or a person's details, which the support assistant must never receive. */
export function holdsPersonalDetails(text: string): boolean {
  return readings(text).map(plainForm).some(plain => holdsHealthId(plain) || holdsEmail(plain) || holdsPhoneOrNin(plain))
}

// --- The question as a reader sees it ---

/**
 * The question as typed and, where a right-to-left override turns text round on screen, as it is shown: the reader of
 * "moc.elpmaxe @ ada" after a right-to-left override (U+202E) sees "ada @ example.com".
 */
function readings(text: string): string[] {
  if (!text.includes('\u202E')) return [text]
  return [text, text.replace(/\u202E([^\u202C\n]*)/g, (_, run: string) => [...run].reverse().join(''))]
}

// What a reader does not see: accents and other marks (NFKD splits them off their letters), format characters
// (zero-width space and joiners, LRM and RLM, bidi embeddings and isolates, invisible operators, soft hyphen, BOM,
// tags), the other default-ignorable ones (variation selectors, Hangul fillers) and control characters.
const UNSEEN = /[\p{M}\p{Cf}\p{Default_Ignorable_Code_Point}]|(?!\s)\p{Cc}/gu

// Circled digits that NFKD leaves alone: ❶ to ❿, ➀ to ➉, ➊ to ➓, ⓫ to ⓴, ⓵ to ⓾ and ⓿.
const CIRCLED = /[\u2776-\u2793\u24EB-\u24FF]/g

// Letters drawn like Latin ones (Cyrillic, Greek, small capitals, Lisu, IPA) and the dotless i, each pair the
// look-alike then what it stands for: "НID", "ʜɪᴅ", "hıd" and "ꓧꓲꓓ" are "HID", "АВС2З4" is "ABC234".
const LOOK_ALIKES = new Map([
  'АA ВB СC ЕE НH ІI ЈJ КK МM ОO РP ЅS ТT УY ХX ҺH ԚQ ԜW ӀI аa вb сc еe кk мm нh тt һh іi јj оo рp ѕs уy хx ԁd ԛq ԝw ӏl З3',
  'ΑA ΒB ΕE ΖZ ΗH ΙI ΚK ΜM ΝN ΟO ΡP ΤT ΥY ΧX οo ιi κk νv ρp τt υu',
  'ᴀA ʙB ᴄC ᴅD ᴇE ꜰF ɢG ʜH ɪI ᴊJ ᴋK ʟL ᴍM ɴN ᴏO ᴘP ʀR ꜱS ᴛT ᴜU ᴠV ᴡW ʏY ᴢZ ıi ǀI ɡg ɑa',
  'ꓮA ꓐB ꓚC ꓓD ꓰE ꓝF ꓖG ꓧH ꓲI ꓙJ ꓗK ꓡL ꓟM ꓠN ꓳO ꓑP ꓣR ꓢS ꓔT ꓴU ꓦV ꓪW ꓫX ꓬY ꓜZ',
].join(' ').split(' ').map(pair => [pair.charAt(0), pair.charAt(1)]))

// Punctuation as a reader sees it, each kind as its plain sign: every dash and what is drawn as one ("‐", "—", "⸺",
// "−", "ー", "─") as "-"; dots and bullets ("·", "•", "∙", "・", "。") as "."; slashes ("⁄", "∕", "╱") as "/"; bars as
// "|"; brackets of any kind ("[", "{", "<", "【", "「") as "(" and ")"; and quotes ("“", "‹") as '"'.
const READ_AS: readonly (readonly [RegExp, string])[] = [
  [/[\p{Pd}\u2212\u02D7\u2043\u2053\u2500\u2501\u2796\u30FC]/gu, '-'],
  [/[\u00B7\u2022\u2027\u2219\u22C5\u25CF\u2E31\u16EB\u06D4\u3002\u30FB]/g, '.'],
  [/[\u2044\u2215\u29F8\u2571]/g, '/'],
  [/[\u00A6\u2223\u2502]/g, '|'],
  [/[\p{Ps}<]/gu, '('],
  [/[\p{Pe}>]/gu, ')'],
  [/[\p{Pi}\p{Pf}]/gu, '"'],
]

// The HTML escapes a pasted page can hold, by name: "&commat;" is @, "&nbsp;" a space.
const NAMED_ESCAPES = new Map(Object.entries({
  nbsp: ' ', commat: '@', period: '.', hyphen: '-', dash: '-', plus: '+', amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'',
}))

// Digits spelled out, two or more in a row: "zero eight zero three" is 0803, "oh" standing for zero too.
const DIGIT_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const SPELLED_DIGITS = new RegExp(`\\b(?:oh|${DIGIT_NAMES.join('|')})(?:[\\s,.-]+(?:oh|${DIGIT_NAMES.join('|')}))+\\b`, 'gi')

/** The question as a reader sees it, for this check only: what is sent is the question as typed. */
function plainForm(text: string): string {
  const plain = text
    // A pasted link's or page's escapes as what they stand for: "%20" and "&#32;" are spaces, "%40" and "&#64;" an @.
    .replace(/%([2-7][0-9A-F])/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(x[0-9a-f]{1,6}|\d{1,7});/gi, (escape, code: string) => fromCode(/^x/i.test(code) ? parseInt(code.slice(1), 16) : Number(code)) ?? escape)
    .replace(/&([a-z]+);/gi, (escape, name: string) => NAMED_ESCAPES.get(name.toLowerCase()) ?? escape)
    .replace(CIRCLED, circledNumber)
    // Full-width, mathematical, circled and other compatibility forms as plain letters and digits, accents apart.
    .normalize('NFKD')
    .replace(UNSEEN, '')
    .replace(/(?![0-9])\p{Nd}/gu, asciiDigit)
    .replace(/[\u0080-\uFFFF]/g, letter => LOOK_ALIKES.get(letter) ?? letter)
    .replace(SPELLED_DIGITS, run => run.split(/[\s,.-]+/).map(name => String(Math.max(0, DIGIT_NAMES.indexOf(name.toLowerCase())))).join(' '))
  return READ_AS.reduce((read, [marks, sign]) => read.replace(marks, sign), plain)
    // Spaces and line breaks (and the braille blank), however many, as one space.
    .replace(/[\s\u2800]+/g, ' ')
}

/** The character an HTML escape's number stands for, or undefined when no character has it. */
function fromCode(code: number): string | undefined {
  return code <= 0x10FFFF ? String.fromCodePoint(code) : undefined
}

/** A digit of another script as 0 to 9 ("٣" and "३" are 3): Unicode keeps each script's ten digits together, from 0. */
function asciiDigit(digit: string): string {
  const code = digit.codePointAt(0) ?? 0
  let zero = code
  while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1
  return String((code - zero) % 10)
}

/** The number a circled digit stands for ("❽" is 8, "⓫" is 11, "⓿" is 0). */
function circledNumber(circled: string): string {
  const code = circled.charCodeAt(0)
  // ❶, ➀ and ➊ each start a run of ten, from 1.
  if (code >= 0x2776) return String(((code - 0x2776) % 10) + 1)
  if (code === 0x24FF) return '0'
  return String(code >= 0x24F5 ? code - 0x24F5 + 1 : code - 0x24EB + 11)
}

// A clock time: "14:30", "07:15:00". Read as a time, not as a number or a Health ID's digits.
const CLOCK_TIME = /(?<![\d:])(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?![\d:])/g

// --- Health IDs ---

/** A word of the question (a run of letters and digits) and what stands before it. */
interface Word { readonly text: string; readonly before: string }

// The Health ID alphabet (HEALTH_ID_PATTERN): letters and digits without 0, 1, I or O. A word holding one of those
// ends a Health ID being read out in groups, so "HID ABC 234 for her" stops at "for".
const IN_ALPHABET = /^[A-HJ-NP-Z2-9]+$/i

// A Health ID alone, as Health IDs are issued and printed: 6 characters in capitals, letters and digits ("7KQ2M9").
const ISSUED_HEALTH_ID = /^(?=.*\d)(?=.*[A-Z])[A-HJ-NP-Z2-9]{6}$/

// What stands between the words of "Health ID" or of HID spelled out ("H.I.D.", "h-i-d", "health_id"): a space, a
// dot, a dash or an underscore.
const WITHIN_HID = /^[\s._-]{0,3}$/
// What people put between HID and its code, or between words: up to six spaces, signs, brackets, quotes, arrows or
// emoji ("HID: ABC234", "HID (ABC234)", "HID, KQZXTW", "| HID | KQZXTW |", "health_id=kqzxtw", "?q=HID+KQZXTW",
// "HID → KQZXTW", "HID…kqzxtw", "HID of the patient: ABC234").
const ROUND_A_CODE = /^[\s\p{P}\p{S}]{0,6}$/u
// Between the groups of a Health ID read out: up to four spaces and signs ("ABC 234", "ABC·234", "ABC -- 234").
const BETWEEN_GROUPS = /^[\s\-_./:,+|*~]{1,4}$/
// Words that bring in a code: "HID number ABC234", "Health ID is ABCDEF", "HID No: ABC234", "abc234 is her HID".
const NUMBER_WORDS = /^(?:is|was|number|no|nr|num|code|card)$/i
// What may stand between HID and its code: words, and short numbers ("HID for bed 4 patient: abc234").
const WORD_BETWEEN = /^(?:[a-z]+|\d{1,3})$/i
// Words starting with "hid" that are not HID typed against a code ("HIDE the menu", "Hidden fees").
const HIDE = new Set('hidden hide hides hider hiders hidey hiding hideous hideout hideouts'.split(' '))

// Short words and abbreviations, read as words in a group after HID ("HID WEB APP", "HID app 2FA", "HID card due
// on the 5th"). Longer words are on the English word list.
const SHORT_WORDS = new Set(`
  app apps web ehr emr lab labs sms mfa key keys url pdf csv usb nhs tab tabs ram lte new the and are can has had
  was all any faq pay fee due fax tel bar bed day age yes per say hrs at as by be up an am we us my me he
`.trim().split(/\s+/))
// Dates and times in words, read out after HID as often as a code is: "9am", "5pm", "2nd", "23rd", "24h", "Jan", "Tue".
const CALENDAR = /^(?:\d{1,2}(?:am|pm|st|nd|rd|th|h|hr|hrs)|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|dec|tue|tues|wed|thu|thur|thurs|sat|sun)$/i
// Technical terms with a digit: "2FA", "4G", "5G", "4GB", "512MB".
const TERMS = /^\d{1,4}(?:fa|g|gb|mb|kb|tb)$/i

/**
 * Where a Health ID's characters stand: straight after HID (only signs between) or just before it ("abc234 (HID)",
 * "kqzxtw is her HID"); brought in by "is", "number" or a colon after other words; or just after other words.
 */
type Placing = 'straight after HID' | 'just before HID' | 'after a number word or colon' | 'after other words'

/** Whether the question holds a Health ID: after HID or "Health ID", before it, against it ("HIDABC234"), or alone as issued. */
function holdsHealthId(plain: string): boolean {
  const words = wordsOf(plain.replace(CLOCK_TIME, ' '))
  return words.some((word, at) => {
    if (ISSUED_HEALTH_ID.test(word.text) || gluedToHid(words, at)) return true
    const start = hidStart(words, at)
    return start >= 0 && (followsHid(words, at + 1) || precedesHid(words, start))
  })
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

/**
 * Where HID ends at the word `at`, the index of its first word, or -1: "HID", "HIDs", "HealthID", "Health ID",
 * "Health IDs", "Health Identity", "Health identifier", "H.I.D.", "Health I.D.", "health_id", and "HlD" or "H1D"
 * typed for HID.
 */
function hidStart(words: readonly Word[], at: number): number {
  const text = (back: number) => words[at - back]?.text.toLowerCase() ?? ''
  const close = (back: number) => WITHIN_HID.test(words[at - back]?.before ?? '')
  if (/^(?:hids?|healthids?)$/.test(text(0)) || /^H[l1]D$/.test(words[at]?.text ?? '')) return at
  if (/^(?:ids?|identity|identifier|identification)$/.test(text(0))) return text(1) === 'health' && close(0) ? at - 1 : -1
  const spelled = text(0) === 'd' && text(1) === 'i' && close(0) && close(1) && (text(2) === 'h' || text(2) === 'health')
  return spelled ? at - 2 : -1
}

/** Whether a word is HID typed against its code, read on into the groups after it: "HIDABC234", "HIDABC 234", "Health IDabc234". */
function gluedToHid(words: readonly Word[], at: number): boolean {
  const word = words[at], previous = words[at - 1]
  const afterHealth = previous?.text.toLowerCase() === 'health' && WITHIN_HID.test(word?.before ?? '')
  const code = /^(?:hid|healthid)([a-z0-9]{2,})$/i.exec(word?.text ?? '')?.[1]
    ?? (afterHealth ? /^id([a-z0-9]{2,})$/i.exec(word?.text ?? '')?.[1] : undefined)
  if (!word || code === undefined || HIDE.has(word.text.toLowerCase())) return false
  return healthIdFrom([{ text: code, before: '' }, ...words.slice(at + 1)], 0, 'straight after HID')
}

/**
 * Whether a Health ID follows HID, from the word at `next`: straight after it, after up to four other words ("HID for
 * patient abc234"), or after up to eight when "is", "number" or a colon brings it in ("HID of the lady in bed four is
 * kqz2xt", "The HID of the patient: ABC234").
 */
function followsHid(words: readonly Word[], next: number): boolean {
  const first = words[next]
  if (!first || !ROUND_A_CODE.test(first.before)) return false
  if (healthIdFrom(words, next, 'straight after HID')) return true
  for (let at = next; at < next + 8; at += 1) {
    const between = words[at], after = words[at + 1]
    if (!between || !after || !WORD_BETWEEN.test(between.text) || !ROUND_A_CODE.test(after.before)) return false
    const brought = NUMBER_WORDS.test(between.text) || /[:=#]/.test(after.before)
    if ((brought || at < next + 4) && healthIdFrom(words, at + 1, brought ? 'after a number word or colon' : 'after other words')) return true
  }
  return false
}

/**
 * Whether a Health ID stands within six words before HID, from HID's first word `start`: "Patient abc234 (HID)",
 * "ABC-234 is the HID", "kqz2xt (her Health ID)". "is" or a bracket joins it to HID, so letters only count too
 * ("KQZXTW is her HID").
 */
function precedesHid(words: readonly Word[], start: number): boolean {
  const before = words.slice(0, start)
  const bracketed = /\(\s*$/.test(words[start]?.before ?? '')
  for (let at = Math.max(0, start - 6); at < start; at += 1) {
    const joined = (bracketed && at === start - 1) || before.slice(at + 1).some(word => /^(?:is|was)$/i.test(word.text))
    if (healthIdFrom(before, at, joined ? 'just before HID' : 'after other words')) return true
  }
  return false
}

/** Whether the words from `start` are a Health ID's characters, typed whole or read out in groups ("ABC 234"). */
function healthIdFrom(words: readonly Word[], start: number, placing: Placing): boolean {
  const groups: string[] = []
  for (const { text, before } of words.slice(start)) {
    if (groups.length > 0 && (!BETWEEN_GROUPS.test(before) || !IN_ALPHABET.test(text))) return false
    // Numbers in a list are not a code read out: "HID down on 22, 23, 24".
    if (groups.length > 0 && before.includes(',') && /^\d+$/.test(groups.join('') + text)) return false
    // A long word ends the reading: "HID pharmacy 2", "HID SYSTEM 2 DOWN".
    if (text.length >= 6 && isEnglishWord(text)) return false
    groups.push(text)
    if (isHealthId(groups, placing)) return true
    if (!IN_ALPHABET.test(text) || groups.join('').length >= 32) return false
  }
  return false
}

/** Whether a group read after HID is a word, a date or time, or a term ("app", "STEP", "9am", "Jan", "2FA"), not a code's. */
function isWord(group: string): boolean {
  return SHORT_WORDS.has(group.toLowerCase()) || CALENDAR.test(group) || TERMS.test(group) || (group.length >= 4 && isEnglishWord(group))
}

/**
 * Whether groups typed by HID read as a Health ID's 6 to 32 characters:
 * - one word that is not an English word: with a digit ("ABC234", "abc234", "7KQ2M9"; straight after HID, a mistyped
 *   "ABC123" too); of letters only in capitals ("ABCDEF"), unless other words came between; of letters only in any
 *   case ("abcdef") straight after or just before HID;
 * - groups that are not all words, dates or terms ("9am 5pm", "app 2FA", "the 5th" and "4GB RAM" are):
 *   - in capitals with a digit ("ABC 234", "A B C 2 3 4", "ABCD-EFGH-2345"): of one length, or of different lengths
 *     where no other words came between and no group is a word of 4 or more letters ("HID PAGE SAY V2" is a question);
 *   - in capitals, letters only: of one length with no word among them ("ABC DEF", but not "WEB APP"), unless other
 *     words came between;
 *   - in any case: of one length up to 4, with a digit ("abc 234", "7kq xmz", "a b c 2 3 4").
 */
function isHealthId(groups: readonly string[], placing: Placing): boolean {
  const id = groups.join(''), size = groups[0]?.length ?? 0
  // One character over and over is a placeholder ("HID-XXXXXX"), not a Health ID.
  if (id.length < 6 || id.length > 32 || /^(.)\1+$/i.test(id)) return false
  const digit = /\d/.test(id), capitals = !/[a-z]/.test(id), brought = placing !== 'after other words'
  if (groups.length === 1) {
    if (!IN_ALPHABET.test(id)) return digit && placing === 'straight after HID'
    if (digit) return true
    if (isEnglishWord(id)) return false
    return capitals ? brought : placing === 'straight after HID' || placing === 'just before HID'
  }
  if (groups.every(isWord)) return false
  const oneLength = groups.every(group => group.length === size)
  if (capitals && digit) return oneLength || (brought && !groups.some(group => group.length >= 4 && isWord(group)))
  if (capitals) return oneLength && brought && !groups.some(isWord)
  return digit && oneLength && size <= 4
}

// --- Email addresses ---

// Webmail names, read as an address's host even without ".com" ("ada@gmail", "ada at yahoo"); "live" only with its dot.
const WEBMAIL = '(?:gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live(?=\\.)|msn|icloud|aol|protonmail|proton|gmx|zoho|yandex)'
// Words written before "at Gmail" in a question about mail, so "Codes arrive late at Gmail" is not "ada at gmail".
const BEFORE_AT_WEBMAIL = '(?:in|on|up|out|to|late|early|spam|junk|inbox|folder|here|there|arrive[sd]?|land(?:s|ed)?|bounce[sd]?|look(?:ed)?|accounts?|users?|staff|e?mails?|messages?|codes?|sent|delivered|delayed|blocked|received|stuck|fail(?:s|ed)?|works?|sign|log)'

const EMAILS: readonly RegExp[] = [
  // name@host.tld, a space either side of the @ or not, the last part starting with a letter: "ada@example.com",
  // "ada @ example.test", "ada@163.com", "ada @ example。com". A price is not one: "2 units @ 500.00", "Rate @ 2.5%".
  /[^\s@]+ ?@ ?[^\s@]+\.[A-Za-z]/,
  // name@host written together, without the dot: "ada@gmail", "ada@example . com". A price in naira is not one
  // ("2 units@N500"), nor a handle in brackets ("(@HealthIDng)").
  /[^\s@]*\w@(?![Nn]\d)[A-Za-z][\w-]/,
  // At a webmail name, a space either side of the @: "ada @ gmail", "Email ada @ yahoo".
  new RegExp(`[^\\s@]*\\w ?@ ?${WEBMAIL}\\b`, 'i'),
  // Spelled out: "ada at example dot com", "ada @ example dot com"; but "Look at the dot matrix printer" is not.
  /[\w.+-]+ ?(?:@|\bat\b) ?(?!(?:the|a|an|this|that|my|our|your)\b)[\w-]+ ?\bdot\b ?[A-Za-z]{2}/i,
  // At a webmail name, spelled out: "ada at gmail.com", "ada at yahoo".
  new RegExp(`(?<![\\w.+-])(?!${BEFORE_AT_WEBMAIL} )[\\w.+-]+ at ${WEBMAIL}\\b`, 'i'),
]

function holdsEmail(plain: string): boolean {
  const written = plain
    // "[@]", "(at)", "<at>", " _at_ " and " -at- " as @, "[.]", "(dot)" and " _dot_ " as a dot: "ada[@]example[.]com".
    .replace(/ ?(?:\( ?(?:@|at) ?\)|(?<= )[-_]at[-_](?= )) ?/gi, '@')
    .replace(/ ?(?:\( ?(?:\.|dot) ?\)|(?<= )[-_]dot[-_](?= )) ?/gi, '.')
    // A doubled @ as one: "ada@@example.com".
    .replace(/@(?: ?@)+/g, '@')
    // A time, not a host: "@ 9a.m." is "@ 9am".
    .replace(/(\d ?[ap])\.m\b\.?/gi, '$1m')
  return EMAILS.some(email => email.test(written))
}

// --- NINs and phone numbers ---

// What people put between a number's digits, up to five together: spaces, dots, dashes, slashes, brackets,
// underscores, bars, backslashes and tildes ("(0803) - 123 - 4567", "0803 ... 123 ... 4567"). A price's commas are not one.
const GAP = '[\\s().\\-/\\\\_|~]{0,5}'

/** Read once the ordinary numbers below are taken out, so "2026-10-30 14:30" or "Chrome 130.0.6723.91" is none. */
const NUMBERS: readonly RegExp[] = [
  // A NIN: eleven digits together.
  /(?<!\d)\d{11}(?!\d)/,
  // A phone number: 10 to 15 digits, with those between them and a + (or "++") before.
  new RegExp(`(?<![\\d+])\\+*\\s?\\(?\\d(?:${GAP}\\d){9,14}(?!\\d)`),
  // A Nigerian landline as written at home: 0 and 8 more digits ("01 234 5678", "(09) 876 5432", "(0)1 234 5678").
  new RegExp(`(?<![\\d+])\\(?0(?:${GAP}\\d){8}(?!\\d)`),
]

// A calendar date, year, day or month first (year 19xx or 20xx, a real month and day), or with a two-digit year last
// ("30/10/26"), with dashes, slashes or dots.
const DAY = '(?:0?[1-9]|[12]\\d|3[01])', MONTH = '(?:0?[1-9]|1[0-2])', YEAR = '(?:19|20)\\d{2}'
const IN_DATE = '[-/.]'
const DATE = `(?:${[[YEAR, MONTH, DAY], [DAY, MONTH, YEAR], [MONTH, DAY, YEAR], [DAY, MONTH, '\\d{2}'], [MONTH, DAY, '\\d{2}']]
  .map(parts => parts.join(IN_DATE)).join('|')})`
// A 24-hour time with a dot or nothing between hours and minutes: "07.00", "1430".
const TIME = '(?:[01]\\d|2[0-3])\\.?[0-5]\\d'
// A part of an IP address: 0 to 255, without a leading 0.
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
// Standing alone: no digit right before or after, across the gaps a phone number's digits can have.
const ALONE_BEFORE = `(?<!\\d${GAP})`, ALONE_AFTER = `(?!${GAP}\\d)`
// An amount, with its currency before or after it.
const AMOUNT = '[1-9][\\d,]*(?:\\.\\d{1,2})?', CURRENCY = '(?:\\u20A6|\\bNGN|\\$|\\bUSD|\\u00A3|\\u20AC)'

/** Numbers that are not a person's, each taken out before NUMBERS is read. */
const ORDINARY_NUMBERS: readonly RegExp[] = [
  // A UUID, such as a facility's id.
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  // A reference with a year (and month and day) in it, in any case: "INV-2026-000123", "ord-20261030-0042",
  // "RCT-202610-00042", "T-2026-004821", Health ID's invoices "HID-2026-000123". A NIN or a phone number with a label
  // in front ("NIN-1990-1234567", "TEL-2080-3123456") is not one.
  /\b(?!(?:NIN|TEL|MOB|GSM|PHONE|CALL|CELL))[A-Z]{1,5}[-/](?:19|20)\d{2}(?:\d{2}){0,2}[-/]\d{1,8}\b/gi,
  // A date or a date range ("30/10/2026", "2026-10-01–2026-10-31", "01/10/26 - 31/10/26"), standing alone: one that
  // runs on into more digits ("1990-12-25-4567", "0803.12.30.4567") is part of a number and stays.
  new RegExp(`(?<!\\d${IN_DATE}?)${DATE}(?:\\s?-\\s?${DATE})?(?!${IN_DATE}?\\d)`, 'g'),
  // Years in a list: "2024/2025/2026".
  new RegExp(`${ALONE_BEFORE}${YEAR}(?:\\s?[-/,]\\s?${YEAR}){2,}${ALONE_AFTER}`, 'g'),
  // A date and time run together, as in a file name: "Screenshot_20261030-143015.png", "export_20261030_143015.csv".
  new RegExp(`(?<!\\d)${YEAR}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])[-_T]?(?:[01]\\d|2[0-3])[0-5]\\d[0-5]\\d(?!\\d)`, 'g'),
  CLOCK_TIME,
  // Shift times, one or a list, standing alone: "07.00-15.00 / 15.00-23.00", "0700-1500/1500-2300", "1430hrs".
  new RegExp(`${ALONE_BEFORE}${TIME}(?:\\s?-\\s?${TIME}(?:\\s?[/,]\\s?${TIME}\\s?-\\s?${TIME})*|hrs\\b)${ALONE_AFTER}`, 'gi'),
  // A version: "Chrome 130.0.6723.91", "Windows 10.0.19045", "1.0.20261030". A phone number's groups do not fit: its
  // first is longer or starts with 0, its second longer than 2 digits, and a + never comes before ("+234.1.234.5678").
  /(?<![\d.+])(?:0|[1-9]\d{0,2})\.\d{1,2}(?:\.\d{1,8}){1,2}(?!\.?\d)/g,
  // A version of four parts with a long first part, as new Teams has: "24295.606.3238.6194".
  /(?<![\d.+])[1-9]\d{4}(?:\.\d{1,4}){3}(?!\.?\d)/g,
  // A build number: "Build 18025.20140", "Build 20261030.12".
  new RegExp(`\\bbuild ?\\d+(?:\\.\\d+)+${ALONE_AFTER}`, 'gi'),
  // An IP address: "192.168.100.254".
  new RegExp(`(?<![\\d.])(?:${OCTET}\\.){3}${OCTET}(?!\\.?\\d)`, 'g'),
  // An amount of money or a range of amounts, standing alone: "₦10000000.00", "NGN 25000 - 50000", "5000000 naira".
  new RegExp(`${ALONE_BEFORE}(?:${CURRENCY} ?${AMOUNT}(?: ?- ?(?:${CURRENCY} ?)?${AMOUNT})?|${AMOUNT}(?: ?- ?${AMOUNT})? ?(?:naira|NGN)\\b)${ALONE_AFTER}`, 'gi'),
  // A percentage: "(50%)".
  new RegExp(`(?<![\\d.])\\d{1,3}(?:\\.\\d{1,2})? ?%${ALONE_AFTER}`, 'g'),
  // HTTP status codes in a list: "401/403/500/502".
  new RegExp(`${ALONE_BEFORE}[1-5]\\d{2}(?:/[1-5]\\d{2}){2,}${ALONE_AFTER}`, 'g'),
  // A Nigeria Health Facility Registry code (state/LGA/ward/ownership/level/serial): "24/12/1/2/1/0001".
  new RegExp(`${ALONE_BEFORE}\\d{2}/\\d{2}/\\d{1,2}/\\d/\\d/\\d{4}${ALONE_AFTER}`, 'g'),
  // A map position: "9.0765 7.3986", "9.0765, 7.3986".
  new RegExp(`${ALONE_BEFORE}-?\\d{1,3}\\.\\d{4,7},? -?\\d{1,3}\\.\\d{4,7}${ALONE_AFTER}`, 'g'),
  // A facility's tax number and a Remita payment reference, after their labels: "TIN 12345678-0001", "RRR 280456123456".
  new RegExp(`\\bTIN\\b[\\s:#-]*\\d{8}-\\d{4}${ALONE_AFTER}`, 'gi'),
  new RegExp(`\\bRRR\\b[\\s:#-]*\\d(?:[\\s-]?\\d){11}${ALONE_AFTER}`, 'gi'),
]

function holdsPhoneOrNin(plain: string): boolean {
  // Letters typed for digits in a number are the digits they stand for: O and the zeros drawn like it ("O8O3",
  // "Ø8Ø3", "〇8〇3", "∅8∅3") are 0, l and I are 1 ("0803 l23 4567"); "No12345678" keeps its o. A + between digits
  // is a link's space ("tel=+234+803+123+4567").
  const digits = plain
    .replace(/(?<![A-Za-z])[Oo\u00D8\u00F8\u3007\u2205](?=\d)|(?<=\d)[Oo\u00D8\u00F8\u3007\u2205]/g, '0')
    .replace(/(?<![A-Za-z])[lI](?=\d)|(?<=\d)[lI]/g, '1')
    .replace(/(?<=\d)\+(?=\d)/g, ' ')
  const left = ORDINARY_NUMBERS.reduce((text, ordinary) => text.replace(ordinary, ' '), digits)
  return NUMBERS.some(number => number.test(left))
}
