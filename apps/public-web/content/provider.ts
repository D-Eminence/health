/**
 * Copy for the healthcare provider surface.
 *
 * Held apart from the components so the words can be reviewed, corrected and
 * eventually translated without touching layout code.
 *
 * The healthcare provider homepage carries the hero, benefits, product
 * switcher, pricing and closing call to action. Deeper detail remains on its
 * dedicated page, so no claim needs to be repeated.
 */

export const PROVIDER_HERO = {
  eyebrow: 'Health ID platform',
  headline: 'Digitise your healthcare operations.',
  headlineAccent: 'Move towards paperless care.',
  lede: 'A connected platform for patient identity, clinical records, laboratory results, prescription dispensing, outreach registration cases and document migration.',
  primary: 'Setup Your Facility',
  secondary: 'Explore products',
} as const

/** Section 3 of the homepage. The modules themselves come from the catalogue. */
export const PRODUCTS_SECTION = {
  eyebrow: 'HID Modules',
  title: 'One identity. Every system.',
  lede: 'Explore supported workflows for patient identity, clinical records, laboratory results, prescription dispensing, outreach cases and document migration.',
} as const

export const STANDARDS = {
  eyebrow: 'Security and record design',
  title: 'Controls visible in the current workflow.',
  items: [
    {
      name: 'Clinical records',
      summary: 'Encounters, notes and diagnoses.',
      body: 'Supported record routes keep clinical entries linked to the appropriate patient and encounter.',
    },
    {
      name: 'Facility context',
      summary: 'Organisation-scoped access.',
      body: 'Staff requests carry an authorised facility, role and purpose of use.',
    },
    {
      name: 'Patient access',
      summary: 'Consent and emergency paths.',
      body: 'Patient record access is checked through the supported consent, PIN and emergency workflows.',
    },
    {
      name: 'Audit',
      summary: 'Attributable activity.',
      body: 'Access and important changes are recorded with actor and request context.',
    },
  ],
  disclaimer:
    'These descriptions are based on supported platform workflows; they are not a certification claim.',
} as const

export const ACCESS_SECTION = {
  title: 'Connected records, protected by consent and access controls.',
  lede: 'Access to patient information remains controlled by role, purpose and authorised scope.',
  controls: [
    {
      title: 'Role-based access',
      body: 'Staff receive access appropriate to their responsibilities.',
    },
    {
      title: 'Patient authorisation',
      body: "A Health ID alone does not automatically unlock a patient's medical history.",
    },
    {
      title: 'Scoped access',
      body: 'Access can be limited to the information required for the care being provided.',
    },
    {
      title: 'Emergency access',
      body: 'Approved emergency access can support urgent clinical care when a patient cannot provide normal authorisation.',
    },
    {
      title: 'Audit history',
      body: 'Record access and important clinical actions remain attributable to the users who performed them.',
    },
  ],
} as const

export const PRICING = {
  eyebrow: 'Pricing',
  title: 'Pricing for connected care.',
  lede: 'Explore the current Health ID product catalogue. We will confirm the right scope and price for your organisation.',
  enterprise:
    'Need multiple branches, all modules, Health ID API access or a custom deployment?',
  enterpriseAction: 'Talk to us about enterprise pricing',
  footnote: 'The available price and billing terms are set by the Health ID commercial catalogue.',
} as const

export const PROVIDER_CTA = {
  title: 'Ready to modernise healthcare delivery?',
  lede: 'Pilots begin with one facility, one department, and the records you already hold.',
  primary: 'Setup Your Facility',
  secondary: 'Hospital sign in',
} as const
