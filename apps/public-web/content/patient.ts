/**
 * Copy for the patient landing page.
 *
 * The patient voice is deliberately different from the provider voice: shorter
 * sentences, second person, and no product names where a plain word will do.
 */

export const PATIENT_HERO = {
  eyebrow: 'For patients',
  headline: 'Your medical history',
  headlineAccent: 'should arrive before you do.',
  lede: 'One Health ID. Every connected hospital, laboratory and pharmacy sees what they need to treat you — and only when you allow it.',
  primary: 'Get your Health ID',
  secondary: 'See how it works',
  footnote: 'Free for patients.',
} as const

export const PATIENT_STEPS = {
  title: 'Your care history stays connected, wherever you go.',
  steps: [
    {
      step: '01',
      title: 'Get your Health ID',
      body: 'You receive one Health ID that stays with you throughout your healthcare journey.',
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
  eyebrow: 'One year, one record',
  title: 'What it actually looks like.',
  lede: 'Four visits, four different places, and not one of them asks you to start again.',
  moments: [
    {
      when: 'January',
      where: 'Hospital A, Ilorin',
      body: 'You are treated for malaria. The diagnosis, your allergy to sulfa drugs, and your prescription attach to your Health ID.',
    },
    {
      when: 'February',
      where: 'A laboratory, elsewhere',
      body: 'You do a blood test at a connected lab. The result joins the same record, without you carrying a printout anywhere.',
    },
    {
      when: 'April',
      where: 'Hospital B, Abuja',
      body: 'You travel and fall ill. The doctor asks for your Health ID, you enter your PIN, and your allergy is on screen before you finish sitting down.',
    },
    {
      when: 'Always',
      where: 'Your phone, any time',
      body: 'You open your access history and see all three. If a facility no longer needs access, you revoke it.',
    },
  ],
} as const

export const PATIENT_CONTROL = {
  eyebrow: 'Your control',
  title: 'You hold the key.',
  lede: 'Connecting your records to a network only works if you decide who opens them. So you do.',
  guarantees: [
    {
      title: 'Your PIN is the key',
      body: 'Your name or Health ID does not give a facility access to your medical records. Access is granted when you enter your access PIN.',
    },
    {
      title: 'You can take it back',
      body: "Revoke a facility's access from your dashboard, and their access ends immediately.",
    },
    {
      title: 'Nothing happens invisibly',
      body: 'Every time your record is viewed, it is noted — who, where, and when. You can read the whole list.',
    },
    {
      title: 'Emergencies still work',
      body: 'If you arrive unconscious and cannot give a PIN, a doctor can use emergency access to treat you. They must state a reason, and it appears in your history like everything else.',
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
  title: 'Start with your Health ID.',
  action: 'Get your Health ID',
} as const
