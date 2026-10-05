/**
 * Copy for the pages behind the navigation: solutions, company, contact and
 * resources.
 *
 * Written to the same rule as the rest of the site: say what the platform
 * does, and claim nothing it cannot honour. The resource pages in particular
 * describe this website and the platform as they actually are, because a
 * security or privacy page that overstates is worse than no page at all.
 */

export const SOLUTIONS_PAGE = {
  eyebrow: 'Solutions',
  title: 'Built for the way each care setting works.',
  lede: 'Health ID is one platform, but a hospital, a clinic, a diagnostic centre, a pharmacy and a public health programme use it differently. Start with the workflow you need, and connect the rest when you are ready.',
  audiences: [
    {
      id: 'hospitals',
      title: 'Hospitals',
      lede: 'One patient identity across every department, with authorised teams working from the relevant connected record.',
      points: [
        'Identity, encounters, laboratory and prescription dispensing use the same patient reference.',
        'Clinical and pharmacy activity remains governed by role, facility and care purpose.',
        'Role-based access gives each staff member the workflows their role requires, and nothing more.',
        'Historical paper files can be brought in through Health ID Migrate rather than abandoned.',
      ],
      products: ['identity', 'ehr', 'laboratory', 'pharmacy', 'migrate'],
    },
    {
      id: 'clinics',
      title: 'Clinics',
      lede: 'Start with registration and consultation, and add modules when the clinic needs them.',
      points: [
        'Health ID Identity and Health ID EHR cover the everyday clinic workflow.',
        'Patients arriving from another facility can be identified rather than registered again.',
        'Prescriptions and investigations leave the consultation already attached to the patient.',
        'Modules can be added one at a time, without a migration project.',
      ],
      products: ['identity', 'ehr', 'pharmacy'],
    },
    {
      id: 'diagnostic-centres',
      title: 'Diagnostic centres',
      lede: 'Investigations ordered against an identity, not against a name written on a request slip.',
      points: [
        'Receive requests from a connected facility, or create them for walk-in patients.',
        'Track every sample from collection through processing to verification.',
        'Verified results return to the record that requested them and can join the patient’s history through the applicable authorised workflow.',
      ],
      products: ['laboratory', 'identity'],
    },
    {
      id: 'pharmacies',
      title: 'Pharmacies',
      lede: 'Dispensing connected to the prescription that caused it.',
      points: [
        'Prescriptions arrive against the patient record rather than on a slip of paper.',
        'What is dispensed returns to the patient’s medication history.',
        'Dispensing records and corrections remain attributable to the authorised team.',
      ],
      products: ['pharmacy', 'identity'],
    },
    {
      id: 'public-health-programmes',
      title: 'Public health programmes',
      lede: 'Manage outreach campaigns and review field registration cases.',
      points: [
        'Run registration campaigns in communities, workplaces and outreach events.',
        'Campaign members can capture registration cases under their assigned facility.',
        'Reviewed cases can be reconciled to an existing patient identity.',
      ],
      products: ['outreach', 'identity'],
    },
  ],
} as const

export const ABOUT_PAGE = {
  eyebrow: 'About Health ID',
  title: 'Building the infrastructure for connected healthcare.',
  lede: 'Health ID is creating the digital infrastructure that helps healthcare organizations identify patients, manage care, digitize legacy records, and connect healthcare services across one ecosystem.',
  paragraphs: [
    'Healthcare information is usually organised around the institution that holds it. A patient seen at three facilities becomes three records, and the clinician in front of them sees only the part their own system holds.',
    'Health ID inverts that. The identity belongs to the patient, and facilities work against it. Registration, clinical records, investigations, prescriptions and outreach registration all contribute to one connected history.',
    'We work with hospitals, clinics, diagnostic centres, pharmacies and public health programmes. Facilities with existing software keep it and connect through Health ID API; facilities on paper start with Health ID Migrate.',
  ],
  principles: [
    { title: 'Identity is separate from access', body: 'A Health ID identifies a patient. It does not, by itself, open their medical history.' },
    { title: 'Access is deliberate', body: 'Records are reached by role, purpose and authorised scope, with patient consent where it applies.' },
    { title: 'Clear scope', body: 'Product examples are illustrative, while available workflows are described against the supported gateway routes.' },
  ],
} as const

export const CONTACT_PAGE = {
  eyebrow: 'Contact',
  title: 'Talk to us about your facility.',
  lede: 'Tell us what you run today and what you would like to change. Demonstrations are arranged with the clinical and administrative teams who would use the system, not as a generic sales call.',
  demoTitle: 'Book a demo',
  emailLabel: 'Email',
  patientNote:
    'For questions about your own Health ID or your medical records, please contact the healthcare facility that created your record. We cannot discuss an individual patient’s information from this website.',
} as const

export const DOCUMENTATION_PAGE = {
  eyebrow: 'Resources',
  title: 'Documentation.',
  lede: 'Written material accompanies every module, and implementation documentation is provided to your team during onboarding.',
  sections: [
    {
      title: 'Product documentation',
      body: 'Each product page describes what the module does and where it sits in the patient journey. Start there for an overview of a module before an implementation.',
    },
    {
      title: 'Implementation and onboarding',
      body: 'Facilities receive setup guidance for their modules, and staff receive onboarding material for the workflows their role uses.',
    },
    {
      title: 'Integration reference',
      body: 'Facilities and vendors integrating through Health ID API receive the interface reference as part of the integration.',
    },
  ],
  cta: 'Ask about documentation',
} as const

export const SECURITY_PAGE = {
  eyebrow: 'Resources',
  title: 'Security and access.',
  lede: 'Health information is only useful if it can be trusted. Access to patient information is controlled by role, purpose and authorised scope, and important actions remain attributable.',
  websiteNote:
    'The public pages do not show clinical records. Pricing, demo requests and organization applications use the Health ID gateway. The application asks for a CAC registration identifier and administrator contact details.',
} as const

export const PRIVACY_PAGE = {
  eyebrow: 'Resources',
  title: 'Privacy on this website.',
  lede: 'This notice covers this website only: the public pages you are reading. It is not the notice that governs the patient information held in the Health ID platform, which is provided to patients and to facilities separately.',
  points: [
    {
      title: 'Public browsing and forms',
      body: 'Public pages do not request your clinical records. Pricing is read from the Health ID gateway. Demo requests and organization applications are sent to Health ID when you submit their forms.',
    },
    {
      title: 'Demo requests',
      body: 'The demo form sends the contact details and message you provide to Health ID so the team can respond. A bot check runs in configured environments.',
    },
    {
      title: 'Organization applications',
      body: 'The facility setup form sends the product, facility type, CAC registration identifier and proposed administrator contact to Health ID for verification and review. Completing missing organization details requires an email code. An application does not create a staff account.',
    },
    {
      title: 'Please do not send patient information',
      body: 'The demo and facility setup forms do not request patient details. Do not include patient information in a demo message or in any email to us.',
    },
    {
      title: 'Clinical information is different',
      body: 'Patient records held in the platform are governed by the terms agreed with the facility that created them, and by the notice given to the patient. Questions about your own records should go to that facility.',
    },
  ],
  contactNote: 'Questions about this notice can be sent to',
} as const
