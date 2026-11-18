import type { PageGuide } from '../ehr-blue/frame/pageGuides'

/**
 * The patient portal's page guides, in the words its screens use (walked through on 18 Nov 2026). The Guide button in
 * the top bar opens the one for the page open now.
 */
const PORTAL_GUIDES: Readonly<Record<string, PageGuide>> = {
  '/': {
    purpose: 'Home shows your Health ID card, anything waiting for you, your records at a glance and recent activity.',
    steps: [
      'Show your card at a hospital or clinic: it has your Health ID, blood group, genotype and allergies.',
      'If a hospital asked to see your records, select Review the request.',
      'Select Share records to let a doctor or hospital see your records.',
      'Select a line under Latest from your providers to read that record.',
    ],
    tips: ['Records, Access and Profile are in the menu (at the bottom on a phone).'],
  },
  '/records': {
    purpose: 'Everything your providers recorded: visits, notes, vitals, diagnoses, medicines, lab tests and documents.',
    steps: [
      'Choose a type, or All.',
      'Search by date, type or words.',
      'Select a record to read it in full. Close takes you back to the list.',
    ],
    tips: ['Only you can see this page. Every view of your records by a provider is recorded.'],
  },
  '/access/share': {
    purpose: 'Share your records with a doctor, nurse or hospital.',
    steps: [
      'Who: search the clinician or hospital by name (at least 3 characters), or invite them by email.',
      'Access: choose what they can see and for how long.',
      'Check: read it through, then share.',
    ],
    tips: ['You can end their access at any time on Access & sharing.'],
  },
  '/access': {
    purpose: 'Who can see your records. No facility sees them until you say yes, and you can take access back at any time.',
    steps: [
      'Requests: select a request to see who is asking, why and for how long, then Approve or Deny.',
      'Who has access: see who can see your records now, and end their access.',
      'Activity: every time your records were opened.',
      'Select Share records to share with someone yourself.',
    ],
  },
  '/profile': {
    purpose: 'Your details, how you sign in, and your Access PIN.',
    steps: [
      'Add a photo to your card.',
      'Select About you, Insurance & hospital or Health information to check and update them.',
      'Set an Access PIN so a hospital can open your record when you’re with them.',
    ],
  },
  '/notifications': {
    purpose: 'What happened with your Health ID: requests, who opened your records, and account changes.',
    steps: ['Select Review request or Open Access & sharing to act on one.', 'Select Mark as read when you’ve seen it.'],
  },
}

/** The guide for a patient portal address, or null. */
export function portalGuideFor(pathname: string): PageGuide | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  const keys = Object.keys(PORTAL_GUIDES).filter(key => key === '/' ? path === '/' : path === key || path.startsWith(`${key}/`))
  const best = keys.sort((a, b) => b.length - a.length)[0]
  return best === undefined ? null : PORTAL_GUIDES[best]!
}
