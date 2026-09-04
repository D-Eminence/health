/**
 * The Health ID product catalogue.
 *
 * Marketing content is build-time content. The public site is granted exactly
 * one backend service and is deliberately unable to fetch anything, so this is
 * the source of truth for the products menu and the product detail routes.
 *
 * The slugs are the public URLs. Changing one changes a live address, so treat
 * them as part of the contract with anything that links here.
 */

export interface Product {
  readonly slug: string
  /** Two-letter mark shown in the products menu. */
  readonly mark: string
  readonly name: string
  /** One line, as it appears in the products menu. */
  readonly summary: string
  /** Opening statement on the product page. */
  readonly headline: string
  readonly intro: string
  readonly capabilities: readonly { readonly title: string; readonly body: string }[]
}

export const PRODUCTS: readonly Product[] = [
  {
    slug: 'ehr',
    mark: 'EH',
    name: 'Health ID EHR',
    summary: 'Clinical records, consultations and patient care.',
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
    slug: 'laboratory',
    mark: 'La',
    name: 'Health ID Laboratory',
    summary: 'Investigations, samples, results and verification.',
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
    summary: 'Prescriptions, dispensing, inventory and POS.',
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
    slug: 'identity',
    mark: 'Id',
    name: 'Health ID Identity',
    summary: 'Persistent patient identity across providers.',
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
    slug: 'connect',
    mark: 'Co',
    name: 'Health ID Connect',
    summary: 'Cross-provider access with consent and audit.',
    headline: 'Connected records, protected by consent and access controls.',
    intro:
      'Access to patient information remains controlled by role, purpose and authorised scope. A Health ID alone does not unlock a medical history.',
    capabilities: [
      { title: 'Role-based access', body: 'Staff receive access appropriate to their responsibilities.' },
      { title: 'Patient authorisation', body: 'Access is granted by the patient, and can be withdrawn.' },
      { title: 'Audit history', body: 'Record access remains attributable to the user who performed it.' },
    ],
  },
  {
    slug: 'migrate',
    mark: 'Mi',
    name: 'Health ID Migrate',
    summary: 'Paper archives to structured digital records.',
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
    slug: 'api',
    mark: 'AP',
    name: 'Health ID API',
    summary: 'Integrate Health ID into your existing systems.',
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
