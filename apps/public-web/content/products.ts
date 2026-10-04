/**
 * The Health ID product catalogue.
 *
 * Marketing content is build-time content. Public pricing and demo requests
 * use the commercial API; this catalogue describes product routes and copy.
 *
 * The slugs are the public URLs. Changing one changes a live address, so treat
 * them as part of the contract with anything that links here.
 *
 * The order here is the order every surface presents them in: the navigation
 * menu, the homepage product switcher and the footer all read this list rather
 * than restating it.
 */

export interface Product {
  readonly slug: string
  /** Two-letter mark shown in the products menu and the product cards. */
  readonly mark: string
  readonly name: string
  /**
   * One line, as it appears in the products menu and as the claim the homepage
   * switcher makes about the product.
   */
  readonly summary: string
  /** One sentence on what the product does, shown beneath the claim. */
  readonly body: string
  /** Opening statement on the product page. */
  readonly headline: string
  readonly intro: string
  readonly capabilities: readonly { readonly title: string; readonly body: string }[]
}

export const PRODUCTS: readonly Product[] = [
  {
    slug: 'identity',
    mark: 'Id',
    name: 'Health ID Identity',
    summary: 'Your Health ID, connected to your care history.',
    body: 'Carry one persistent identity between participating providers while you remain in control of access to your health information.',
    headline: 'Patient identity is built into every encounter.',
    intro:
      'A patient should not become a new person every time they enter another healthcare facility. Health ID Identity gives each patient one persistent Health ID. When an authorised provider identifies that patient, relevant healthcare information can remain connected to the same person over time.',
    capabilities: [
      { title: 'One identity', body: 'A single Health ID that stays with the patient.' },
      { title: 'Verified identifiers', body: 'Identity confirmed through verified contact details.' },
      { title: 'Connected history', body: 'Encounters across facilities attach to the same person.' },
    ],
  },
  {
    slug: 'ehr',
    mark: 'EH',
    name: 'Health ID EHR',
    summary: 'Digital clinical records built for modern healthcare delivery.',
    body: 'Capture consultations, diagnoses, medications, investigations and follow-up care from a single interface.',
    headline: 'Clinical documentation built around the patient.',
    intro:
      'Health ID EHR keeps consultations, diagnoses, investigations, prescriptions, results and clinical documents structured around one persistent patient identity. Every encounter contributes to the same longitudinal clinical history instead of becoming another isolated facility record.',
    capabilities: [
      {
        title: 'Patient & encounter',
        body: 'Patient registration, consultations, encounter history and follow-up records.',
      },
      {
        title: 'Clinical documentation',
        body: 'Diagnoses, clinical notes and medical documents held against the record.',
      },
      {
        title: 'Investigations & treatment',
        body: 'Investigations, laboratory results, prescriptions and medication history.',
      },
    ],
  },
  {
    slug: 'migrate',
    mark: 'Mi',
    name: 'Health ID Migrate',
    summary: 'Review and publish extracted clinical documents.',
    body: 'Process supported document jobs with OCR extraction, patient confirmation and human validation.',
    headline: 'Don’t lose years of records when you go digital.',
    intro:
      'Health ID Migrate supports document-level OCR jobs, human validation, patient confirmation and controlled publication into the clinical record.',
    capabilities: [
      { title: 'Capture', body: 'Scan or photograph existing patient files.' },
      { title: 'Extract and validate', body: 'Convert documents to structured data, reviewed before import.' },
      { title: 'Confirm patient', body: 'Confirm the patient for each validated document job.' },
    ],
  },
  {
    slug: 'laboratory',
    mark: 'La',
    name: 'Health ID Laboratory',
    summary: 'Investigations, samples, results and verification.',
    body: 'Receive requests from the clinical record, track every sample, and return verified results to the patient they belong to.',
    headline: 'Results that find their way back to the right patient.',
    intro:
      'Laboratory work is ordered, tracked and returned against the same Health ID the clinician used to request it, so a result does not depend on a printout reaching the right hands.',
    capabilities: [
      { title: 'Orders', body: 'Investigations requested against a patient identity, not a name.' },
      { title: 'Samples', body: 'Specimen tracking from collection through to analysis.' },
      { title: 'Verification', body: 'Results verified before they join the clinical record.' },
    ],
  },
  {
    slug: 'pharmacy',
    mark: 'Ph',
    name: 'Health ID Pharmacy',
    summary: 'Dispensing connected to the prescription that caused it.',
    body: 'Prescriptions raised in a consultation arrive against the same patient record, and what is dispensed returns to the medication history.',
    headline: 'Dispensing connected to the prescription that caused it.',
    intro:
      'Prescriptions raised in a consultation arrive in the pharmacy against the same patient record, and what is dispensed returns to the medication history.',
    capabilities: [
      { title: 'Prescriptions', body: 'Received directly from the consultation that raised them.' },
      { title: 'Dispensing', body: 'Recorded against the patient’s medication history.' },
      { title: 'Corrections', body: 'Record reversals when a dispensing needs correction.' },
    ],
  },
  {
    slug: 'outreach',
    mark: 'Or',
    name: 'Health ID Outreach',
    summary: 'Manage campaign registration cases in the field.',
    body: 'Run campaigns, assign members and reconcile registration cases to existing patient identities.',
    headline: 'Registration that reaches people where they are.',
    intro:
      'Health ID Outreach lets a facility create campaigns and record registration cases in communities and public health programmes. Reviewed cases can be linked to existing Health ID patients.',
    capabilities: [
      {
        title: 'Campaigns',
        body: 'Registration runs under a named campaign, so a programme can account for what it has registered.',
      },
      {
        title: 'Identity resolution',
        body: 'A case can be linked to an authorised existing patient after review.',
      },
      {
        title: 'Field workers',
        body: 'Outreach workers register under their own account, so activity is attributable.',
      },
    ],
  },
  {
    slug: 'api',
    mark: 'AP',
    name: 'Health ID API',
    summary: 'Gateway routes for approved integrations.',
    body: 'Use supported patient identity and health record routes within an authorised facility context.',
    headline: 'Explore supported Health ID integrations.',
    intro:
      'Approved facility integrations can use supported gateway routes for identity lookup, access checks and selected clinical workflows. Access requires the appropriate session, facility, purpose and permissions.',
    capabilities: [
      { title: 'Identity lookup', body: 'Resolve patients against the Health ID identity layer.' },
      { title: 'Authorised exchange', body: 'Exchange information within the scope a patient has approved.' },
      { title: 'Facility verification', body: 'Requests are attributable to a verified facility.' },
    ],
  },
]

export function findProduct(slug: string): Product | undefined {
  return PRODUCTS.find(product => product.slug === slug)
}
