/**
 * The Health ID product catalogue.
 *
 * Marketing content is build-time content. The public site is granted exactly
 * one backend service and is deliberately unable to fetch anything, so this is
 * the source of truth for the products menu and the product detail routes.
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
    summary: 'Move paper records into searchable digital health records.',
    body: 'Digitise legacy files with scanning, OCR, validation workflows and structured data extraction.',
    headline: 'Don’t lose years of records when you go digital.',
    intro:
      'Health ID Migrate helps facilities move historical medical records into the digital system while preserving the clinical information they already hold.',
    capabilities: [
      { title: 'Capture', body: 'Scan or photograph existing patient files.' },
      { title: 'Extract and validate', body: 'Convert documents to structured data, reviewed before import.' },
      { title: 'Match', body: 'Connect each record to the correct patient identity.' },
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
      { title: 'Inventory', body: 'Stock levels and reorder thresholds across the facility.' },
    ],
  },
  {
    slug: 'outreach',
    mark: 'Or',
    name: 'Health ID Outreach',
    summary: 'Register patients and issue Health IDs in the field.',
    body: 'Run registration campaigns outside the facility, with every new patient issued a Health ID through the same verified identity flow.',
    headline: 'Registration that reaches people where they are.',
    intro:
      'Health ID Outreach lets a programme register patients outside the facility — in communities, workplaces and public health campaigns — and issue each one a Health ID through the same verified identity flow used at registration. The records created in the field are ordinary Health ID records, not a separate register to be reconciled later.',
    capabilities: [
      {
        title: 'Campaigns',
        body: 'Registration runs under a named campaign, so a programme can account for what it has registered.',
      },
      {
        title: 'Verified registration',
        body: 'Each new patient is verified and issued a Health ID through the standard identity flow.',
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
    summary: 'Keep the EHR you already use.',
    body: 'Connect persistent patient identity and authorised healthcare information to the systems your team already runs.',
    headline: 'Keep the EHR you already use.',
    intro:
      'Healthcare facilities with existing software do not need to replace it to participate in HID. Health ID API can connect supported patient identity and authorised healthcare information with existing systems. Your team continues working from familiar software while HID provides the connectivity layer.',
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
