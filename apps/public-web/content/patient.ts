/**
 * Copy for the patient landing page.
 *
 * The patient voice is deliberately different from the provider voice: shorter
 * sentences, second person, and no product names where a plain word will do.
 */

export const PATIENT_HERO = {
  eyebrow: 'Health ID for patients',
  headline: 'Your medical history',
  headlineAccent: 'should arrive before you do.',
  lede: 'Health ID gives you a persistent identity and a place to review records shared through participating care teams.',
  primary: 'Get your Health ID',
  secondary: 'I already have a Health ID',
  footnote: 'Your records remain subject to the relevant access controls.',
} as const

export const PATIENT_STEPS = {
  title: 'Your care history can stay connected across participating providers.',
  steps: [
    {
      step: '01',
      title: 'Get your Health ID',
      body: 'Your Health ID stays with you throughout your healthcare journey.',
    },
    {
      step: '02',
      title: 'Provide your access PIN to your providers',
      body: 'A hospital identifies you using your Health ID, but your records remain protected until you provide access.',
    },
    {
      step: '03',
      title: 'Access history',
      body: 'See who accessed your records, when, and why.',
    },
  ],
} as const

export const PATIENT_JOURNEY = {
  eyebrow: "Hikmah's journey",
  title: 'One record, wherever care happens.',
  lede: 'An illustrative journey through participating care settings.',
  moments: [
    {
      when: 'January',
      where: 'Hospital visit',
      body: 'Malaria treated. Allergy information and prescription added to your Health ID.',
    },
    {
      when: 'February',
      where: 'Laboratory',
      body: 'Blood test completed. Result added to your record.',
    },
    {
      when: 'April',
      where: 'A new hospital. Her history already there.',
      body: 'In Abuja, Hikmah shared her Health ID and entered her PIN. Before prescribing, the doctor could already see her sulfa-drug allergy.',
    },
    {
      when: 'Today',
      where: 'She remains in control.',
      body: 'Review access history and respond to supported access requests.',
    },
  ],
} as const

export const PATIENT_CONTROL = {
  eyebrow: 'Your record. Your control.',
  title: 'Keeping a record is different from giving someone access to it.',
  lede: 'Your Health ID helps you maintain your health history, but having your Health ID does not automatically give a healthcare provider access to your information. When access is required, it should follow the appropriate Health ID access and consent workflow.',
  guarantees: [
    {
      title: 'Control access',
      body: 'Authorise appropriate access when a healthcare provider needs your information.',
    },
    {
      title: 'See access history',
      body: 'Review who accessed your information and when.',
    },
    {
      title: 'Use an access PIN',
      body: 'Set an access PIN for supported provider access workflows.',
    },
  ],
} as const

export const PATIENT_UPLOAD = {
  title: 'A record from participating care teams.',
  body: 'When participating facilities document your care, supported encounters, notes and results can be linked to your Health ID under the applicable access controls.',
} as const

export const PATIENT_FAQ = {
  title: 'Frequently asked questions.',
  items: [
    {
      question: 'Does every hospital now see all my records?',
      answer:
        'No. Hospitals see what your consent and their role allow. A pharmacist sees medication. A receptionist sees registration details. Neither sees your full clinical history.',
    },
    {
      question: 'What does it cost me?',
      answer:
        'Ask the Health ID team about current patient and facility terms before enrolling.',
    },
    {
      question: 'What if my hospital is not on HID yet?',
      answer:
        'You can still create a Health ID. Records from a facility become available through Health ID when that facility participates in the supported workflow.',
    },
    {
      question: 'What happens if I lose my phone?',
      answer:
        'Your account and supported records are held by Health ID. Use the account recovery flow to regain access.',
    },
  ],
} as const

export const PATIENT_CTA = {
  title: 'Start building the health history that stays with you.',
  body: 'Create your Health ID and keep your medical information connected as your care continues — wherever you receive it.',
  action: 'Get your Health ID',
  secondary: 'I already have a Health ID',
  footnote: 'Your records remain subject to the relevant access controls.',
} as const
