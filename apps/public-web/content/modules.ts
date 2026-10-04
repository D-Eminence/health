/**
 * The module switcher — "One identity. Every system."
 *
 * Transcribed from the approved design, which is why the shape is unusual: the
 * tabs are a full-width segmented strip, the statement sits to the left of a
 * photographic glass panel, and the caption sits to its right. This content was
 * previously filed under `tabs.ts` alongside three other sections that no longer
 * exist on the homepage; it is the design's own copy, not a paraphrase.
 *
 * The panel content is what the design shows for each module: a small console
 * with a title, a badge and four status rows. Those rows are part of the section
 * rather than a second dashboard — they are how the design says "this is what
 * the module looks like in use" without a screenshot.
 *
 * Every figure, name and Health ID here is invented for the marketing site.
 */

/** Status of a row, shown as a coloured dot inside a pill. */
export type ModuleTone = 'ok' | 'pending' | 'active' | 'alert'

export interface ModuleWorkflow {
  /** A concise label makes the miniature diagram understandable out of context. */
  readonly label: string
  /** Ordered steps joined by the shared Health ID connection line. */
  readonly steps: readonly string[]
}

export interface HealthModule {
  /** Product slug: the tab's id, and where the product action leads. */
  readonly slug: string
  /** Label on the tab strip. */
  readonly tab: string
  /** The claim, as the display heading beside the panel. */
  readonly statement: string
  /** The supporting line on the far side of the panel. */
  readonly caption: string
  readonly panelTitle: string
  readonly panelBadge: string
  /** A compact visual workflow shown inside the approved centre panel. */
  readonly workflows: readonly ModuleWorkflow[]
  readonly rows: readonly {
    readonly label: string
    readonly value: string
    readonly tone: ModuleTone
  }[]
}

export const MODULES: readonly HealthModule[] = [
  {
    slug: 'identity',
    tab: 'Identity',
    statement: 'One patient identity that every connected facility can verify.',
    caption:
      'A persistent Health ID helps a facility find the right patient. Record access follows a separate, authorised workflow.',
    panelTitle: 'Patient Lookup',
    workflows: [
      { label: 'Identity verification', steps: ['Patient', 'Health ID', 'Identity verified'] },
      {
        label: 'Record access (separate)',
        steps: ['Access request', 'Patient authorises', 'Appropriate record scope'],
      },
    ],
    panelBadge: 'HID-4471-08',
    rows: [
      { label: 'Identity verified', value: 'Confirmed', tone: 'ok' },
      { label: 'Access PIN', value: 'Awaiting patient', tone: 'pending' },
      { label: 'Linked facilities', value: '4 connected', tone: 'active' },
      { label: 'Consent scope', value: 'Clinical only', tone: 'ok' },
    ],
  },
  {
    slug: 'ehr',
    tab: 'EHR',
    statement: 'A full clinical record system for facilities that do not have one.',
    caption:
      'Encounters, notes, prescriptions and results in one place — and every entry attaches to the patient identity, not just your database.',
    panelTitle: 'Consultation',
    workflows: [
      {
        label: 'Clinical workflow',
        steps: ['Identify patient', 'Consultation', 'Diagnosis', 'Treatment', 'Connected record'],
      },
    ],
    panelBadge: 'Dr. Bello · Clinic',
    rows: [
      { label: 'Presenting complaint', value: 'Recorded', tone: 'ok' },
      { label: 'Vitals', value: 'Recorded', tone: 'ok' },
      { label: 'Prescription', value: 'Sent to pharmacy', tone: 'active' },
      { label: 'Lab request', value: 'Awaiting sample', tone: 'pending' },
    ],
  },
  {
    slug: 'migrate',
    tab: 'Migrate',
    statement: 'Years of paper folders, turned into records a doctor can search.',
    caption:
      'Capture on a phone camera, OCR-assisted extraction, then human validation before anything is matched to a patient.',
    panelTitle: 'OCR Job',
    workflows: [
      {
        label: 'Migration workflow',
        steps: [
          'Paper record',
          'Capture',
          'OCR-assisted extraction',
          'Human validation',
          'Patient confirmation',
          'Connected history',
        ],
      },
    ],
    panelBadge: '1 document',
    rows: [
      { label: 'Pages captured', value: 'Complete', tone: 'ok' },
      { label: 'OCR extraction', value: 'Processing', tone: 'active' },
      { label: 'Human validation', value: 'In review', tone: 'pending' },
      { label: 'Patient confirmation', value: 'Needed', tone: 'alert' },
    ],
  },
  {
    slug: 'laboratory',
    tab: 'Laboratory',
    statement: 'Verified laboratory results, connected to the right patient.',
    caption:
      'The diagnostic workflow runs from request to verified release. Results are available through the applicable authorised access.',
    panelTitle: 'Investigations',
    workflows: [
      {
        label: 'Laboratory workflow',
        steps: [
          'Investigation request',
          'Patient verification',
          'Sample',
          'Processing',
          'Verification',
          'Result',
        ],
      },
    ],
    panelBadge: 'HID-4471-08',
    rows: [
      { label: 'Full blood count', value: 'Verified', tone: 'ok' },
      { label: 'Malaria parasite', value: 'Verified', tone: 'ok' },
      { label: 'Liver function', value: 'Processing', tone: 'active' },
      { label: 'Critical value', value: 'Clinician alerted', tone: 'alert' },
    ],
  },
  {
    slug: 'pharmacy',
    tab: 'Pharmacy',
    statement: 'Dispensing tied to the prescription, not to a paper slip.',
    caption:
      'Prescription work items, dispensing and reversals stay tied to the patient record under access controls.',
    panelTitle: 'Dispensing',
    workflows: [
      {
        label: 'Pharmacy workflow',
        steps: ['Prescription', 'Patient verification', 'Dispensing', 'Medication history'],
      },
    ],
    panelBadge: 'Prescription example',
    rows: [
      { label: 'Prescription received', value: 'Verified', tone: 'ok' },
      { label: 'Dispensing', value: 'Recorded', tone: 'ok' },
      { label: 'Medication details', value: 'Captured', tone: 'ok' },
      { label: 'Reversal', value: 'Available when needed', tone: 'pending' },
    ],
  },
  {
    slug: 'outreach',
    tab: 'Outreach',
    statement: 'Campaign registration cases that can be reconciled.',
    caption:
      'Record a registration case under a campaign and link it to an existing patient identity after authorised review.',
    panelTitle: 'Outreach Session',
    workflows: [
      {
        label: 'Outreach workflow',
        steps: ['Campaign', 'Registration case', 'Identity review', 'Existing patient link'],
      },
    ],
    panelBadge: 'Ilorin · Day 2',
    rows: [
      { label: 'Campaign', value: 'Active', tone: 'ok' },
      { label: 'Registration case', value: 'Received', tone: 'ok' },
      { label: 'Identity resolution', value: 'Pending', tone: 'active' },
      { label: 'Existing patient link', value: 'Review needed', tone: 'pending' },
    ],
  },
  {
    slug: 'api',
    tab: 'API',
    statement: 'Keep the system you already paid for. Connect it to the network.',
    caption:
      'The gateway exposes supported identity, clinical and audit endpoints for approved integrations with facility-scoped access.',
    panelTitle: 'Integration',
    workflows: [
      {
        label: 'Integration workflow',
        steps: ['Existing healthcare software', 'Health ID API', 'Identity and consent', 'Authorised record exchange'],
      },
    ],
    panelBadge: 'facility.api.v1',
    rows: [
      { label: 'Identity lookup', value: 'Connected', tone: 'ok' },
      { label: 'Authorisation check', value: 'Available', tone: 'ok' },
      { label: 'Supported record routes', value: 'Available', tone: 'ok' },
      { label: 'Audit events', value: 'Recorded', tone: 'active' },
    ],
  },
]
