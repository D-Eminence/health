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
  lede: 'One connected healthcare platform for patient identity, electronic health records, laboratory operations, pharmacy workflows, outreach programmes and legacy record migration.',
  primary: 'Book a demo',
  secondary: 'Explore products',
} as const

/** Section 3 of the homepage. The modules themselves come from the catalogue. */
export const PRODUCTS_SECTION = {
  eyebrow: 'HID Modules',
  title: 'One identity. Every system.',
  lede: 'Health ID helps healthcare providers manage patient identity, electronic health records, laboratory operations, pharmacy workflows, outreach programmes, and legacy record migration from a single connected ecosystem.',
} as const

export const STANDARDS = {
  eyebrow: 'Clinical standards',
  title: 'Structured for modern healthcare records.',
  items: [
    {
      name: 'ICD-11',
      summary: 'Structured diagnosis and disease classification.',
      body: 'Support consistent clinical documentation through recognised diagnosis and disease classification.',
    },
    {
      name: 'RxNorm',
      summary: 'Standardised medication terminology.',
      body: 'Maintain consistent medication naming across prescription and medication records.',
    },
    {
      name: 'ISO/IEC 27001-aligned',
      summary: 'Information-security management controls.',
      body: "HID's information-security controls are designed in alignment with recognised information-security management principles.",
    },
    {
      name: 'HIPAA',
      summary: 'Healthcare privacy and data protection.',
      body: 'Applied to the handling and protection of electronic health information.',
    },
  ],
  // Stated plainly wherever these appear. Alignment with a standard is not
  // certification, and the design is careful to say so rather than implying an
  // audit.
  disclaimer:
    'These describe the standards and principles HID is built around. They are not claims of formal certification.',
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

export interface PricingPlan {
  readonly name: string
  readonly audience: string
  readonly monthlyNaira: number
  readonly badge?: string
  readonly includes: readonly string[]
}

const PRICING_PLANS: readonly PricingPlan[] = [
  {
    name: 'Clinic',
    audience: 'For clinics and smaller healthcare facilities getting started with HID.',
    monthlyNaira: 50_000,
    includes: [
      'Health ID Identity',
      'Health ID EHR',
      'Up to 10 staff accounts',
      'Standard onboarding',
    ],
  },
  {
    name: 'Hospital',
    audience:
      'For hospitals and larger healthcare facilities that need broader clinical operations.',
    monthlyNaira: 75_000,
    badge: 'Most popular',
    includes: [
      'Everything in Clinic',
      'Health ID Laboratory or Health ID Pharmacy',
      'Unlimited staff accounts',
      'Priority onboarding',
    ],
  },
]

export const PRICING = {
  eyebrow: 'Pricing',
  title: 'Simple pricing for healthcare providers.',
  lede: 'Choose monthly billing or save 20% when you pay yearly.',
  /** Applied to the monthly rate when billed yearly. */
  yearlyDiscount: 0.2,
  plans: PRICING_PLANS,
  enterprise:
    'Need multiple branches, all modules, Health ID API access or a custom deployment?',
  enterpriseAction: 'Talk to us about enterprise pricing',
  footnote:
    'Implementation is quoted separately. Health ID Migrate is priced separately based on migration volume and scope.',
} as const

export const PROVIDER_CTA = {
  title: 'Ready to modernise healthcare delivery?',
  lede: 'Pilots begin with one facility, one department, and the records you already hold.',
  primary: 'Book a demo',
  secondary: 'Hospital sign in',
} as const
