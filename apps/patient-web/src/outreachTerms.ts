import type { OutreachConsentLanguage, OutreachConsentMethod } from './staff/api'

/*
 * The words of open sign-up on outreach. (owner decisions of 11 November 2026): the organiser terms an organiser
 * accepts, and the notice each person is given before they are registered. The owner reviewed and approved the
 * joint-controller terms and the DPIA (decision 4): their version is 2026-11-01, the version Identity accepts. (Identity also accepts 2026-11-14, but its availability read
 * still advertises 2026-11-01, so the website keeps 2026-11-01: a newer version here would lock sign-up.)
 * Plain English throughout; nothing here decides anything, Identity and Outreach do.
 */

/** The organiser terms' version, as Identity accepts it (identity-api OUTREACH_ORGANISER_TERMS_VERSION). */
export const ORGANISER_TERMS_VERSION = '2026-11-01'
/** The registration notice's version, recorded with each person's agreement (outreach-api consent.textVersion). */
export const REGISTRATION_NOTICE_VERSION = 'outreach-notice-2026-11-14'
/** The longest note an outreach group may keep on a registration (outreach-api OUTREACH_NOTES_LIMIT). */
export const OUTREACH_NOTES_LIMIT = 1000
/** How long details never linked to a Health ID are kept (owner decision 3). */
export const RETENTION_WORDS = '1 year after the campaign closes (or 1 year after it starts, if it is never closed)'

/** One section of the organiser terms: a heading and its paragraphs or points. */
export interface TermsSection {
  readonly heading: string
  readonly paragraphs: readonly string[]
  readonly points?: readonly string[]
}

/**
 * The organiser terms (version 2026-11-01), as the organiser reads them before accepting, and on their own page. Health
 * ID is a joint controller with each organiser; an organiser reports a breach within 24 hours; it is free for now.
 */
export const ORGANISER_TERMS: readonly TermsSection[] = [
  { heading: 'What Health ID Outreach is', paragraphs: [
    'Health ID Outreach lets your group register people you meet at health outreach events, such as screening days, '
      + 'vaccination drives and health talks. Your group gets its own private space. Only your own team can see what you '
      + 'collect. You never see any hospital’s records or the Health ID register.',
    'Health ID Outreach is free for now. If that ever changes, we will tell you before it does, and nothing will be charged '
      + 'without your agreement.',
  ] },
  { heading: 'Who looks after the details you collect', paragraphs: [
    'Your group and Health ID are joint controllers of the personal details you collect on Health ID Outreach, as the '
      + 'Nigeria Data Protection Act 2023 calls it. This means you and Health ID are both responsible for looking after them.',
    'Your group decides when and where to hold events and who to register. Health ID decides how the details are stored, '
      + 'who can see them, how long they are kept and when they are deleted.',
  ] },
  { heading: 'What you agree to do', paragraphs: [], points: [
    'Read the registration notice to each person (or let them read it) before you register them, and record how they agreed.',
    'For anyone under 18, register them only with their parent or guardian’s agreement, and record the guardian’s name.',
    'Collect only what the form asks for. Do not write diagnoses, test results or other health details in the notes.',
    'Use Health ID Outreach only for real outreach work. Do not use it to collect phone numbers for marketing, politics, '
      + 'religion or anything else.',
    'Invite only people you know and trust to your team, and remove anyone who stops helping.',
    'Keep your password to yourself, lock your phone or computer, and sign out on a shared device.',
    'Do not copy people’s details out of Health ID Outreach into other lists, chats or spreadsheets.',
  ] },
  { heading: 'Report a problem within 24 hours', paragraphs: [
    'Tell Health ID support within 24 hours of finding out if details may have been seen by someone who should not see '
      + 'them. For example: a phone or laptop with Health ID Outreach open is lost or stolen, someone else used your login, '
      + 'or details were sent to the wrong person.',
    'Health ID then decides what must be done, including telling the Nigeria Data Protection Commission when the law '
      + 'requires it.',
  ] },
  { heading: 'Health ID does not check your group', paragraphs: [
    'Health ID does not check who you are before your campaigns start. The people you register are told that your group is '
      + 'an unverified organiser. Do not use a name that suggests you are a hospital, a ministry or another official body.',
    'Health ID may pause your group, or close a campaign, if these terms are not followed or if people report a problem. '
      + 'While your group is paused, nobody in it can register anyone.',
  ] },
  { heading: 'How long details are kept', paragraphs: [
    `The details of people who are never linked to a Health ID are kept for ${RETENTION_WORDS}. Then they are deleted `
      + 'automatically. Health ID can delete one person’s details sooner if they ask.',
  ] },
  { heading: 'Health ID linking', paragraphs: [
    'Your team cannot link the people you register to a Health ID. Each person links their own Health ID later, from '
      + 'their own Health ID account.',
  ] },
  { heading: 'Stopping', paragraphs: [
    'You can stop using Health ID Outreach at any time by contacting Health ID support. Details already collected are '
      + 'kept and deleted as described above.',
  ] },
]

/** The few points the organiser sees beside the box they tick, with the full terms a link away. */
export const ORGANISER_TERMS_SUMMARY: readonly string[] = [
  'Your group and Health ID are joint controllers of the details you collect: you both look after them.',
  'Read the notice to each person and record how they agreed. A parent or guardian agrees for anyone under 18.',
  'Tell Health ID support within 24 hours if details may have been seen by the wrong person.',
]

/**
 * The registration notice (version outreach-notice-2026-11-14), read to each person before they are registered, or read
 * by them. `group`: the outreach group's name, as the working facility is named. With health checks and a Health ID made
 * at the event, which the person agrees to separately ("They want a Health ID"). Owner approved in chat on 2026-11-13:
 * Q68 notice approved; line 2 adds the area (Q71 add area).
 */
export function registrationNotice(group: string): readonly string[] {
  const who = group.trim() || 'This outreach group'
  return [
    `${who} is registering people at this event on Health ID Outreach.`,
    'We will write down your name, age and sex, the area where you live, your phone number or email if you want to give them, and the results of today\'s health checks, so the team can care for you and follow up.',
    `Only this outreach team and Health ID can see your details. ${who} and Health ID are both responsible for looking after them.`,
    'If you agree, we will also make a Health ID for you from these details. You can start using it later with your email, or with the code on your slip, and add the rest of your details then.',
    `If you don't get a Health ID, your details are deleted ${RETENTION_WORDS}.`,
    'You can say no to being registered. You can also say yes to being registered but no to a Health ID.',
    'To have your details deleted sooner, or to complain, contact Health ID support.',
  ]
}

/**
 * The registration notice's earlier version (outreach-notice-2026-11-01), kept for the record: registrations agreed
 * before 14 November 2026 were given these words. Outreach still accepts the version.
 */
export function registrationNotice20261101(group: string): readonly string[] {
  const who = group.trim() || 'This outreach group'
  return [
    `${who} is registering people at this event on Health ID Outreach.`,
    'We will write down your name, age and sex, and your phone number if you want to give it, so the team can follow up with you.',
    `Only this outreach team and Health ID can see your details. ${who} and Health ID are both responsible for looking after them.`,
    'This does not give you a Health ID. You can link your own Health ID to this record later, from your own Health ID account.',
    `If your details are never linked to a Health ID, they are deleted ${RETENTION_WORDS}.`,
    'You can say no. If you say no, we will not write down your details.',
    'To have your details deleted sooner, or to complain, contact Health ID support.',
  ]
}

/** The languages the notice can be given in. Any but English means the notice was read aloud in that language. */
export const CONSENT_LANGUAGES: ReadonlyArray<{ readonly value: OutreachConsentLanguage; readonly label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'yo', label: 'Yoruba (read aloud in Yoruba)' },
  { value: 'ha', label: 'Hausa (read aloud in Hausa)' },
  { value: 'ig', label: 'Igbo (read aloud in Igbo)' },
  { value: 'pcm', label: 'Nigerian Pidgin (read aloud in Pidgin)' },
]

/** How the person agreed, in the words the form offers. */
export const CONSENT_METHODS: ReadonlyArray<{ readonly value: OutreachConsentMethod; readonly label: string; readonly hint: string }> = [
  { value: 'verbal_read_aloud', label: 'I read it to them and they said yes', hint: 'Read every line of the notice to them.' },
  { value: 'self_ticked', label: 'They read it themselves and agreed', hint: 'Let them read the notice on this screen.' },
  { value: 'guardian', label: 'Their parent or guardian agreed for them', hint: 'Needed for anyone under 18.' },
]
