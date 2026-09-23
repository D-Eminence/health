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
  lede: 'Health ID gives you a place to keep your medical history connected — whether your care comes from a Health ID provider or somewhere else.',
  primary: 'Get your Health ID',
  secondary: 'I already have a Health ID',
  footnote: 'Free for patients.',
} as const

export const PATIENT_STEPS = {
  title: 'Your care history stays connected, wherever you go.',
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
  lede: 'Four visits in different places. No repeated registration, no missing context.',
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
      body: 'Review access history and revoke access at any time.',
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
      title: 'Revoke access',
      body: 'Remove access when a facility no longer needs it.',
    },
  ],
} as const

export const PATIENT_UPLOAD = {
  title: 'Including the records we didn’t create.',
  body: 'Not every hospital is connected yet. Until yours is, you can add your own scans, test results, prescriptions and discharge summaries to your Health ID — so the history is complete when a doctor finally needs it.',
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
        'Nothing. Your Health ID is free. Healthcare facilities pay to be part of the network.',
    },
    {
      question: 'What if my hospital is not on HID yet?',
      answer:
        'You can still hold your Health ID and upload your own documents — test results, scans, discharge summaries — so they are with you when you need them.',
    },
    {
      question: 'What happens if I lose my phone?',
      answer:
        'Your records live with your Health ID, not on your device. You recover your account and everything is still there.',
    },
  ],
} as const

export const PATIENT_CTA = {
  title: 'Start building the health history that stays with you.',
  body: 'Create your Health ID and keep your medical information connected as your care continues — wherever you receive it.',
  action: 'Get your Health ID',
  secondary: 'I already have a Health ID',
  footnote: 'Free for patients.',
} as const
