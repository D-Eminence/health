/**
 * Copy for the healthcare provider landing page.
 *
 * Held apart from the components so the words can be reviewed, corrected and
 * eventually translated without touching layout code.
 */

export const PROVIDER_HERO = {
  eyebrow: 'Health ID EHR',
  headline: 'Digitise your healthcare operations.',
  headlineAccent: 'Move towards paperless care.',
  lede: 'Manage patient records, consultations, appointments, prescriptions, clinical notes, staff access and daily hospital workflows from your laptop or phone — even when the internet is unavailable.',
  primary: 'Book an EHR demo',
  secondary: 'Explore Health ID EHR',
} as const

export const PLATFORM = {
  title: 'One platform for connected healthcare delivery.',
  lede: 'HID gives healthcare providers the tools to manage care digitally while keeping every clinical interaction connected to the right patient. From registration and consultation to laboratory results, prescriptions and follow-up, every record contributes to a more complete patient history.',
  steps: ['Register', 'Consult', 'Investigate', 'Prescribe', 'Follow up'],
} as const

export const ADOPTION_PATHS = [
  {
    situation: 'You already run an EMR',
    product: 'Health ID API',
    slug: 'api',
    body: 'Keep your system. Connect it to the identity layer through the API and your patients become findable across the network.',
  },
  {
    situation: 'You have no EMR',
    product: 'Health ID EHR',
    slug: 'ehr',
    body: 'Use ours. Clinical records, prescriptions, results and encounters, with patient identity built into every entry.',
  },
  {
    situation: 'You are still on paper',
    product: 'Health ID Migrate',
    slug: 'migrate',
    body: 'Start with the archive. We digitise existing folders through capture, OCR and human validation before anything goes live.',
  },
] as const

export const FEATURES = {
  eyebrow: 'Features',
  title: 'Smarter identity for connected healthcare',
  lede: 'Powerful, connected tools that help healthcare providers digitise operations, improve care delivery, and connect every patient journey.',
  items: [
    {
      title: 'Patient search & registration',
      body: 'Find and register patients using Health ID, verified phone number, or existing facility records.',
    },
    {
      title: 'Unified patient health records',
      body: 'Access consultations, diagnoses, prescriptions, laboratory results, documents, and relevant clinical history from one connected patient record.',
    },
    {
      title: 'Role-based access control',
      body: 'Give each staff member access only to the patient information and workflows required for their role.',
    },
    {
      title: 'Audit & access tracking',
      body: 'Every patient record access and update is logged, helping your organisation maintain transparency, accountability, and oversight.',
    },
    {
      title: 'Seamless interoperability',
      body: 'Securely exchange relevant patient information across authorised hospitals, laboratories, pharmacies, and other connected care providers.',
    },
  ],
} as const

export const EHR_SECTION = {
  eyebrow: 'Health ID EHR',
  title: 'Clinical documentation built around the patient.',
  lede: 'Health ID EHR keeps consultations, diagnoses, investigations, prescriptions, results and clinical documents structured around one persistent patient identity. Every encounter contributes to the same longitudinal clinical history instead of becoming another isolated facility record.',
  groups: [
    {
      title: 'Patient & encounter',
      items: ['Patient registration', 'Consultations', 'Encounter history', 'Follow-up records'],
    },
    {
      title: 'Clinical documentation',
      items: ['Diagnoses', 'Clinical notes', 'Medical documents'],
    },
    {
      title: 'Investigations & treatment',
      items: ['Investigations', 'Laboratory results', 'Prescriptions', 'Medication history'],
    },
  ],
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
  // Stated plainly on the page. Alignment with a standard is not certification,
  // and the design is careful to say so rather than implying an audit.
  disclaimer:
    'These describe the standards and principles HID is built around. They are not claims of formal certification.',
} as const

export const IDENTITY_SECTION = {
  eyebrow: 'Health ID Identity',
  title: 'Patient identity is built into every encounter.',
  lede: 'A patient should not become a new person every time they enter another healthcare facility. Health ID Identity gives each patient one persistent Health ID. When an authorised provider identifies that patient, relevant healthcare information can remain connected to the same person over time.',
  strapline: 'One patient. One identity. One connected clinical history.',
  touchpoints: [
    { place: 'Hospital', event: 'Consultation recorded' },
    { place: 'Laboratory', event: 'Result attached' },
    { place: 'Pharmacy', event: 'Medication dispensed' },
  ],
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

export const MIGRATE_SECTION = {
  eyebrow: 'Health ID Migrate',
  title: 'Don’t lose years of records when you go digital.',
  lede: 'Health ID Migrate helps facilities move historical medical records into the digital system while preserving the clinical information they already hold.',
  stages: [
    { step: '01', title: 'Capture', body: 'Scan or photograph existing patient files.' },
    {
      step: '02',
      title: 'Extract',
      body: 'Convert relevant information from the document into structured data.',
    },
    {
      step: '03',
      title: 'Validate',
      body: 'Review extracted information before it becomes part of the clinical record.',
    },
    { step: '04', title: 'Match', body: 'Connect the record to the correct patient identity.' },
    {
      step: '05',
      title: 'Import',
      body: "Add validated information to the patient's digital history.",
    },
  ],
} as const

export const API_SECTION = {
  eyebrow: 'Health ID API',
  title: 'Keep the EHR you already use.',
  lede: 'Healthcare facilities with existing software do not need to replace it to participate in HID. Health ID API can connect supported patient identity and authorised healthcare information with existing systems. Your team continues working from familiar software while HID provides the connectivity layer.',
  chain: ['Existing EHR', 'Health ID API', 'Health ID Identity', 'Connected patient record'],
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
  title: 'Start with one department.',
  lede: 'Pilots begin with one facility, one department, and the records you already hold.',
  primary: 'Book an EHR demo',
  secondary: 'Hospital sign in',
} as const
