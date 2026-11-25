/**
 * What each page of the Hospital EHR is for and how to use it, in the words its screens use. Written from a walk through
 * every page on 18 Nov 2026: each step names a button or field that is on that page. The Guide button in the top bar
 * opens the guide for the page open now (frame/PageGuide.tsx).
 */
export interface PageGuide {
  /** What the page is for, in one or two sentences. */
  readonly purpose: string
  /** How to do the page's main job, in order. */
  readonly steps: readonly string[]
  /** Where to go from here, or what to know. */
  readonly tips?: readonly string[]
}

const BACK_TIP = 'The arrow before a page’s title takes you back to where you came from.'

/** Keyed by the page's address under /provider: the longest key that starts the address wins. */
export const PAGE_GUIDES: Readonly<Record<string, PageGuide>> = {
  '': {
    purpose: 'Home shows what needs you today: access requests waiting, lab tests and prescriptions to work on, and your shortcuts.',
    steps: [
      'Select Find a patient to open a patient’s record.',
      'Under Needs attention, select a line to deal with it.',
      'Under Today’s work, select a test or a prescription to open it. Its Back arrow brings you Home.',
      'Under Shortcuts, select Edit to pin up to six pages you use most.',
    ],
    tips: ['The menu on the left lists every page your role can open.'],
  },
  patients: {
    purpose: 'Find a patient by their Health ID and open their record, or get access when you don’t have it yet.',
    steps: [
      'Paste or scan the Health ID (it starts with HID-) and it’s checked at once. If you type it, select Find or press Enter.',
      'If you can see the patient, their page opens at once.',
      'If you don’t have access yet, choose Use their Access PIN (if they’re with you), Ask the patient, or Emergency access.',
      'If no patient has that Health ID, check it with them. If they’re new, select Register a new patient. If you don’t see it, ask a colleague who registers patients.',
      'Patients who shared their record with you, and invitations to accept, are under Shared with you.',
    ],
    tips: [
      'On the patient’s page: Open chart for their consultations, Start a consultation, or Record vitals.',
      'Ask about this patient answers questions from their record, within your access.',
      'Close my grant closes the record when you’ve finished.',
    ],
  },
  registration: {
    purpose: 'Register a new patient at the front desk so they get a Health ID.',
    steps: [
      'If NIN checks are not working, the page says so. Select Check again, or Try again, to check them again.',
      'Select Create record and follow the steps: the NIN check, then the patient’s details.',
      'To carry on a registration started earlier, enter its Registration ID and select Open.',
    ],
    tips: ['When the patient has their Health ID, find them on Patients to open their record.'],
  },
  'in-person-check': {
    purpose: 'Check a patient who is registering on their own phone but can’t receive the code sent to the phone on their NIN record.',
    steps: [
      'Type the code shown on the patient’s phone (10 letters and numbers).',
      'Choose which original photo ID you looked at, and type the name and date of birth as they are on it.',
      'Tick all five statements, then select Check details. Health ID compares them with their NIN; you never see the record.',
    ],
  },
  'waiting-list': {
    purpose: 'Check patients in as they arrive and see where each one is: waiting, in triage, ready to be seen or being seen.',
    steps: [
      'Under Check in a patient, enter the full name and date of birth, or the Health ID with the last name, and select Find patient.',
      'Select Check in on the right patient’s card. A search result can be used for 10 minutes.',
      'Move each patient on with the button on their card: Start triage, Ready to be seen, Call in to be seen, Finished.',
      'Select Change to set the triage level, who will see them, or to take them off the list if they left.',
    ],
    tips: [
      'Level 1 is the most urgent: patients are listed by triage level, then by when they checked in.',
      'Checking a patient in does not open their chart: open it from Patients as usual. “Chart cannot be opened” means the patient has not allowed this facility to see it.',
    ],
  },
  triage: {
    purpose: 'Record and review vitals for the open patient: blood pressure, pulse, temperature, breathing, oxygen, weight and height.',
    steps: [
      'Open the patient first (Find a patient), or select Record vitals on their page or in a consultation.',
      'Choose the visit, then enter the readings. Values outside the normal adult range are flagged High or Low as you type, and BMI is worked out from weight and height.',
      'Select Save record. After saving, Back to consultation returns you to the visit.',
      'Select a reading in the list to see it, or to correct it with a reason.',
    ],
    tips: [BACK_TIP],
  },
  clinical: {
    purpose: 'The open patient’s consultations: start one, write notes and diagnoses, add vitals, and order lab tests and medicines.',
    steps: [
      'Select New consultation, fill in the complaint and what you found, then select Start consultation.',
      'Open a consultation from the list. Its latest vitals show at the top.',
      'Under Actions, add notes, then sign the note when you’re done.',
      'Under Orders, select New lab request or New prescription. Confirm the patient before you send.',
      'Under Vitals, select Record vitals to add readings to this visit.',
    ],
    tips: [
      'Start typing a diagnosis (for example "mal") and pick from the list: its ICD-10 code fills in. Lab tests fill their LOINC code where one is known; medicines, routes and how often are suggested too.',
      'Under the complaint box, tap a common complaint to add it.',
      'The line under the patient banner has Patient page and Change patient.', BACK_TIP],
  },
  nursing: {
    purpose: 'Nursing observations for the open patient.',
    steps: ['Open the patient first (Find a patient).', 'Select Create record to add an observation, or open one from the list to read it.'],
  },
  emergency: {
    purpose: 'Open a patient’s emergency summary when they can’t consent and care can’t wait.',
    steps: [
      'Enter the Health ID and why you need emergency access.',
      'Tick the box to confirm you understand it’s recorded, and the patient can see it.',
      'Select Open emergency access. The record is read-only and closes by itself.',
    ],
    tips: ['Use it only when the patient can’t consent. Otherwise use their Access PIN or ask them.'],
  },
  requests: {
    purpose: 'Ask patients to share their record with this facility, and follow the requests you sent.',
    steps: [
      'Select Ask for access, enter the Health ID and why, and send. The patient approves on their phone.',
      'Select Patient PIN if the patient is with you and has an Access PIN.',
      'Select a request in the list to see where it stands.',
    ],
  },
  laboratory: {
    purpose: 'The lab’s work: tests waiting for a sample, being tested, results to enter, and results to check and release.',
    steps: [
      'On Work list, pick a stage: Waiting for sample, Testing, Enter results, Check & release, Done.',
      'Select a test to open it. Check the patient’s name and date of birth before you take a sample.',
      'Follow the steps on the test: register the sample, enter results, then check and release them.',
      'New request adds a walk-in test. Results lists released results.',
    ],
    tips: [BACK_TIP],
  },
  'pharmacy/prescriptions': {
    purpose: 'Prescriptions sent to this pharmacy, to pick, check and hand over.',
    steps: [
      'Pick a tab: To dispense, Waiting for payment, Dispensed or All.',
      'Select a prescription to open it.',
      'Tick each step of Pick and hand over, enter the quantity to hand over, then select Dispense.',
      'Paper prescription adds one brought in on paper.',
    ],
    tips: ['A prescription with a missing dose says Can’t dispense: ask the prescriber first.'],
  },
  'pharmacy/sell': {
    purpose: 'Sell over the counter at the pharmacy.',
    steps: ['Select the products to add them.', 'Add customer or Find by Health ID if the sale is for a patient.', 'Select Take payment.'],
  },
  'pharmacy/sales': {
    purpose: 'Today’s bills and receipts at the pharmacy, paid or not.',
    steps: ['Choose Today or All.', 'Select a bill to see it. On the bill, select Take payment or Print receipt.'],
  },
  'pharmacy/stock': {
    purpose: 'What the pharmacy holds: low stock and medicines expiring soon.',
    steps: ['Choose All, Low or Expiring.', 'Select Receive stock when a delivery arrives.'],
  },
  'pharmacy/products': {
    purpose: 'What the pharmacy sells and what it costs, for cash and each HMO.',
    steps: ['Filter by Drugs or Other.', 'Select Add item to add a product with its cash and HMO prices.'],
  },
  payments: {
    purpose: 'Bills across the facility: what is still to pay, transfers to confirm, and what is paid.',
    steps: ['Choose a tab: To pay, Waiting for check, Bill follows or Paid.', 'Select View bill, or Take payment to record a payment.'],
  },
  'price-list': {
    purpose: 'The facility’s prices for drugs, lab tests and other items.',
    steps: ['Filter by Drugs, Lab tests or Other.', 'Select Add item to add one.'],
  },
  'end-of-day': {
    purpose: 'Open and close each till, and count what was taken.',
    steps: ['Select a till to open it or close it at the end of the day.'],
  },
  'payment-setup': {
    purpose: 'How patients pay at this facility.',
    steps: ['Choose where patients pay (at the cashier, at the counter, or either).', 'Turn on the ways to pay you accept, and when care waits for payment.'],
  },
  ocr: {
    purpose: 'Bring a patient’s paper records into Health ID by scanning them.',
    steps: [
      'Open the patient first (Find a patient): their documents can then be captured here.',
      'The front desk, doctors, nurses and clinicians start a reading: select Create record, or Extract with OCR on a document.',
      'Doctors, nurses and clinicians check what was read before it’s saved. If you can’t start a reading, select Find its reading on a document to open its reading.',
      'To reopen a job, enter its document ID and select Find job.',
    ],
    tips: ['The front desk sees the documents it uploaded and how their readings are going, not what was read.'],
  },
  outreach: {
    purpose: 'Community outreach: people registered in the field and the campaigns they came from.',
    steps: [
      'Select New registration to register someone.',
      'Under Waiting to link, select a person to link their Health ID.',
      'Select New campaign to plan an outreach, or open a running one.',
    ],
  },
  billing: {
    purpose: 'Your facility’s Health ID subscription.',
    steps: ['See your plan, its status and when it renews, and your invoices once you’ve paid.'],
  },
  audit: {
    purpose: 'Who did what at this facility, and when.',
    steps: ['Select Refresh for the latest. Use the filters to narrow it down.'],
  },
  staff: {
    purpose: 'The people who work here and what each one can do.',
    steps: ['See who works here and their roles. An administrator changes roles and access.'],
  },
  facility: {
    purpose: 'Your facility’s details, as Health ID holds them.',
    steps: ['Check your facility’s details and verification. The profile is read-only here.'],
  },
  help: {
    purpose: 'Short guides for the work your role does, and what’s new.',
    steps: ['Select a guide to see its steps.'],
  },
  institutions: {
    purpose: 'Choose which facility you’re working at.',
    steps: ['Select a facility. An open patient record closes when you switch.'],
  },
}

/** A sample page's guide: a design to look at, nothing saved. */
export const SAMPLE_GUIDE: PageGuide = {
  purpose: 'This page is a sample at the demo facilities: it shows how this part of the hospital will work. Nothing you do here is saved.',
  steps: ['Look around and try the buttons. Records here are made up.'],
  tips: [BACK_TIP],
}

/** The guide for an address under /provider, or null. */
export function guideFor(pathname: string): PageGuide | null {
  const rest = pathname.replace(/^\/provider\/?/, '').replace(/\/+$/, '')
  const keys = Object.keys(PAGE_GUIDES).filter(key => key === '' ? rest === '' : rest === key || rest.startsWith(`${key}/`))
  const best = keys.sort((a, b) => b.length - a.length)[0]
  return best === undefined ? null : PAGE_GUIDES[best]!
}
