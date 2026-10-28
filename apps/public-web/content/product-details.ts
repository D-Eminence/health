/**
 * Product dashboards and detail copy.
 *
 * Transcribed from the approved design's product pages. Each module shows a
 * different arrangement of panels because each one does a different job: a
 * laboratory has a pipeline, a pharmacy has stock lists, an identity service
 * has a profile, so panels are optional rather than forced into one shape.
 *
 * Every figure, name and Health ID here is invented for the marketing site.
 * These examples are visibly labelled; no patient record is fetched here.
 */

/** Status of a row or item, shown as a coloured pill. */
export type StatusTone = 'ok' | 'pending' | 'active' | 'alert'

/** Emphasis on a metric's footer figure. */
export type MetricTone = 'neutral' | 'caution' | 'critical'

export interface DashboardMetric {
  readonly label: string
  readonly value: string
  readonly footLabel: string
  readonly footValue: string
  readonly tone: MetricTone
}

export interface DashboardTable {
  readonly title: string
  /** Headings for the entity column and the detail column. */
  readonly columns: readonly [string, string]
  readonly rows: readonly {
    readonly primary: string
    readonly secondary: string
    readonly detail: string
    readonly tone: StatusTone
  }[]
}

export interface DashboardAlerts {
  readonly title: string
  readonly items: readonly { readonly tone: StatusTone; readonly text: string }[]
}

export interface DashboardList {
  readonly title: string
  readonly items: readonly {
    readonly label: string
    readonly value: string
    readonly tone: StatusTone
  }[]
}

export interface DashboardStages {
  readonly title: string
  readonly steps: readonly {
    readonly label: string
    readonly value: string
    readonly tone: StatusTone
  }[]
}

export interface DashboardProfile {
  readonly title: string
  readonly name: string
  readonly id: string
  readonly fields: readonly { readonly label: string; readonly value: string }[]
  readonly connected: readonly string[]
}

export interface DashboardTimeline {
  readonly title: string
  readonly items: readonly {
    readonly event: string
    readonly detail: string
    readonly when: string
  }[]
}

export interface DashboardProgress {
  readonly title: string
  readonly total: string
  readonly segments: readonly {
    readonly label: string
    readonly value: number
    readonly tone: StatusTone
  }[]
}

export interface ProductDetail {
  readonly slug: string
  readonly name: string
  readonly eyebrow: string
  readonly title: string
  readonly sub: string
  readonly cta: string
  /** Title shown on the dashboard illustration. */
  readonly dash: string
  readonly metrics: readonly DashboardMetric[]
  readonly table?: DashboardTable
  readonly alerts?: DashboardAlerts
  readonly lists?: readonly DashboardList[]
  readonly stages?: DashboardStages
  readonly profile?: DashboardProfile
  readonly timeline?: DashboardTimeline
  readonly progress?: DashboardProgress
  /** The narrative section beneath the dashboard. */
  readonly narrativeTitle: string
  readonly narrativeBody: readonly string[]
  /** What the module does, day to day. */
  readonly workflows: readonly { readonly title: string; readonly body: string }[]
  /** How it connects to the rest of the platform. */
  readonly integrations: readonly { readonly name: string; readonly body: string }[]
  readonly closingTitle: string
  readonly closingBody: string
}

export const PRODUCT_DETAILS: readonly ProductDetail[] = [
  {
    slug: "ehr",
    name: "Health ID EHR",
    eyebrow: "Clinical operations",
    title: "Move your clinical operations beyond paper and fragmented records.",
    sub: "Give authorised teams one connected workspace to manage patient records, clinical workflows, and care from one place.",
    cta: "Setup Your Facility",
    dash: "Clinical dashboard",
    metrics: [
      { label: "Encounters", value: "18", footLabel: "Completed", footValue: "9", tone: "neutral" },
      { label: "Clinical notes", value: "9", footLabel: "Awaiting signature", footValue: "3", tone: "caution" },
      { label: "Lab requests", value: "6", footLabel: "In progress", footValue: "2", tone: "critical" },
      { label: "Documents", value: "3", footLabel: "On record", footValue: "3", tone: "neutral" },
    ],
    table: {
      title: "Recent encounters",
      columns: ["Patient", "Detail"],
      rows: [
        { primary: "Ngozi Bello", secondary: "HID-N4B7X2 · consultation", detail: "Completed", tone: "ok" },
        { primary: "Samuel Okoro", secondary: "HID-S8K3P5 · follow-up", detail: "In progress", tone: "pending" },
        { primary: "Aisha Mohammed", secondary: "HID-A2M9T6 · consultation", detail: "Note draft", tone: "active" },
      ],
    },
    alerts: {
      title: "Needs attention",
      items: [
        { tone: "alert", text: "One encounter needs a signed clinical note." },
        { tone: "pending", text: "Two lab requests remain in progress." },
        { tone: "active", text: "A document is awaiting its scan result." },
      ],
    },
    narrativeTitle: "Built around the patient, not the file number.",
    narrativeBody: [
      "Traditional hospital systems identify a patient only within that facility. A new folder, a new number, a history that starts again.",
      "Health ID EHR connects the clinical record to a persistent health identity, so participating settings can recognise the same patient while applicable organisation, role, permission, purpose and consent controls govern record access.",
    ],
    workflows: [
      { title: "Registration", body: "Find an existing patient by their Health ID before creating a new record, helping prevent duplicate patient identities." },
      { title: "Consultation", body: "Record presenting complaints, examination findings, diagnoses, and treatment plans, all linked to the patient encounter." },
      { title: "Prescriptions", body: "Create and route prescriptions to a connected pharmacy for authorised dispensing workflows while keeping the patient's medication history up to date." },
      { title: "Laboratory tests", body: "Order laboratory tests and receive verified results in the patient's record when released to the authorised care team." },
      { title: "Vitals and documents", body: "Record encounter vitals and attach clinical documents to the correct patient under the organisation's access controls." },
      { title: "Roles and audit", body: "Limit doctors, nurses, receptionists, and administrators to the organisation-approved roles, permissions and care purposes, with activities recorded for accountability." },
    ],
    integrations: [
      { name: "Health ID Identity", body: "Verify the correct patient before anything is written." },
      { name: "Health ID Laboratory", body: "Send investigations and receive verified results through the authorised ordering workflow." },
      { name: "Health ID Pharmacy", body: "Send prescriptions and maintain medication history for authorised care workflows." },
      { name: "Health ID Migrate", body: "Validate and publish supported historical documents into the EHR." },
    ],
    closingTitle: "Move your clinical operations beyond paper and fragmented records.",
    closingBody: "Give your team one connected workspace for managing patient care.",
  },
  {
    slug: "laboratory",
    name: "Health ID Laboratory",
    eyebrow: "Diagnostics",
    title: "One connected workspace for your entire laboratory.",
    sub: "Manage laboratory tests and verified results for authorised care workflows. From test requests and sample collection to result verification and patient records, run your laboratory in one secure, connected system.",
    cta: "Setup Your Facility",
    dash: "Laboratory dashboard",
    metrics: [
      { label: "Tests today", value: "84", footLabel: "Completed", footValue: "51", tone: "neutral" },
      { label: "Awaiting collection", value: "12", footLabel: "Oldest", footValue: "38 min", tone: "caution" },
      { label: "Awaiting verification", value: "9", footLabel: "Senior review", footValue: "Required", tone: "neutral" },
      { label: "Results for review", value: "2", footLabel: "Release", footValue: "Pending", tone: "critical" },
    ],
    table: {
      title: "Work queue",
      columns: ["Patient", "Investigation"],
      rows: [
        { primary: "Musa Ibrahim", secondary: "Full blood count", detail: "Processing", tone: "active" },
        { primary: "Grace John", secondary: "Urinalysis", detail: "Awaiting review", tone: "pending" },
        { primary: "Ifeanyi Nwosu", secondary: "Liver function", detail: "Verified", tone: "ok" },
        { primary: "Halima Sani", secondary: "Malaria parasite", detail: "Critical", tone: "alert" },
      ],
    },
    stages: {
      title: "Investigation pipeline",
      steps: [
        { label: "Requested", value: "18", tone: "active" },
        { label: "Sample collected", value: "12", tone: "active" },
        { label: "Processing", value: "14", tone: "pending" },
        { label: "Review", value: "9", tone: "pending" },
        { label: "Completed", value: "51", tone: "ok" },
      ],
    },
    narrativeTitle: "A result should not become another PDF on someone’s phone.",
    narrativeBody: [
      "Between the request slip, the sample book and the printed report, a laboratory result passes through several systems that do not know each other.",
      "With HID, an approved result becomes part of the patient’s longitudinal medical history, available only when the applicable consent or access mechanism, organisation, professional role, permissions and care purpose allow it.",
    ],
    workflows: [
      { title: "Receive requests", body: "Receive test requests from Health ID EHR or create new requests for walk-in patients." },
      { title: "Verify the patient", body: "Verify the patient's Health ID and prevent duplicate laboratory records." },
      { title: "Sample collection", body: "Track sample type, collection time, collector, status and notes." },
      { title: "Processing", body: "Track every test from request and sample collection through processing, review, and completion." },
      { title: "Result entry", body: "Enter, review, and manage structured test results in one place." },
      { title: "Verification and release", body: "Authorised staff approve results before release to the authorised ordering care team." },
    ],
    integrations: [
      { name: "Health ID EHR", body: "Receive investigation requests and return verified results through the authorised ordering workflow." },
      { name: "Health ID Identity", body: "Attach every result to the right patient." },
      { name: "Health ID API", body: "Connect an existing laboratory information system." },
    ],
    closingTitle: "Turn your laboratory into a connected part of the patient’s journey.",
    closingBody: "From hospital laboratories to multi-branch diagnostic networks and screening programmes.",
  },
  {
    slug: "pharmacy",
    name: "Health ID Pharmacy",
    eyebrow: "Prescription dispensing",
    title: "Manage your pharmacy. Keep every medication connected.",
    sub: "Receive prescription work items, record dispensing and reversals, and keep medication activity connected to the patient under authorised care workflows.",
    cta: "Setup Your Facility",
    dash: "Pharmacy dashboard",
    metrics: [
      { label: "Prescriptions today", value: "46", footLabel: "Dispensed", footValue: "31", tone: "neutral" },
      { label: "Awaiting dispensing", value: "15", footLabel: "Oldest", footValue: "19 min", tone: "caution" },
      { label: "Dispensing records", value: "31", footLabel: "Reversals", footValue: "1", tone: "caution" },
      { label: "OCR imports", value: "3", footLabel: "For review", footValue: "1", tone: "neutral" },
    ],
    table: {
      title: "Prescription queue",
      columns: ["Patient", "Prescription"],
      rows: [
        { primary: "Amina Yusuf", secondary: "3 medications", detail: "Pending", tone: "pending" },
        { primary: "David James", secondary: "1 medication", detail: "Dispensed", tone: "ok" },
        { primary: "Chinwe Okafor", secondary: "2 medications", detail: "Allergy check", tone: "active" },
      ],
    },
    lists: [
      {
        title: "Dispensing details",
        items: [
          { label: "Amoxicillin 500mg", value: "Recorded", tone: "ok" },
          { label: "Metformin 850mg", value: "Pending", tone: "pending" },
          { label: "Paracetamol 1g", value: "Recorded", tone: "ok" },
        ],
      },
      {
        title: "Work item states",
        items: [
          { label: "New prescription", value: "Received", tone: "active" },
          { label: "Dispensing", value: "Completed", tone: "ok" },
          { label: "Correction", value: "Reversal", tone: "pending" },
        ],
      },
    ],
    narrativeTitle: "Medication history is health history.",
    narrativeBody: [
      "What a patient has been prescribed and what they actually collected is clinical information, but it usually stays locked inside one pharmacy’s books.",
      "Health ID Pharmacy connects dispensing activity to the patient’s persistent identity, so care teams can use relevant medication history only when the applicable consent or access mechanism, organisation, professional role, permissions and care purpose allow it.",
    ],
    workflows: [
      { title: "Prescription management", body: "Receive prescriptions that Health ID clinicians send you, and record what you dispense." },
      { title: "Patient verification", body: "Verify the patient's Health ID identity before dispensing medication." },
      { title: "Dispensing", body: "Record medications dispensed, quantities, dosage instructions, and dispensing details." },
      { title: "Medication history", body: "Keep prescription and dispensing records connected to the patient's longitudinal medication history under applicable access controls." },
      { title: "Dispensing review", body: "Review each work item and its medication details before recording a dispensing." },
      { title: "Corrections", body: "Create a reversal when a dispensing must be corrected, preserving the activity history." },
      { title: "Roles and audit", body: "Limit pharmacists, technicians, cashiers, and administrators to the organisation-approved roles, permissions and purpose, with actions recorded for accountability." },
    ],
    integrations: [
      { name: "Health ID EHR", body: "Receive prescriptions for authorised dispensing workflows after a clinician issues them." },
      { name: "Health ID Identity", body: "Dispense against a verified patient, not a name on a slip." },
      { name: "Health ID API", body: "Connect existing pharmacy or POS software." },
    ],
    closingTitle: "Manage your pharmacy and build a more complete medication history.",
    closingBody: "For teams that need a connected prescription and dispensing workflow.",
  },
  {
    slug: "identity",
    name: "Health ID Identity",
    eyebrow: "The foundation",
    title: "Connect every patient to one persistent health identity.",
    sub: "Create and verify persistent patient identities that help healthcare providers reduce duplicate records, improve identification, and connect information across the patient journey. Identity is separate from record access.",
    cta: "Connect to Health ID Identity",
    dash: "Identity administration",
    metrics: [
      { label: "Total HID patients", value: "4,182", footLabel: "New today", footValue: "37", tone: "neutral" },
      { label: "Verified patients", value: "3,940", footLabel: "Rate", footValue: "94.2%", tone: "neutral" },
      { label: "Potential duplicates", value: "11", footLabel: "Awaiting", footValue: "Merge", tone: "caution" },
      { label: "Verification issues", value: "4", footLabel: "Escalated", footValue: "1", tone: "critical" },
    ],
    profile: {
      title: "Patient identity",
      name: "Amina Yusuf",
      id: "HID-R3W8H4",
      fields: [
        { label: "Date of birth", value: "14 Mar 1991" },
        { label: "Phone", value: "Verified" },
        { label: "Gender", value: "Female" },
        { label: "Status", value: "Verified" },
      ],
      connected: ["Al-Noor Hospital", "Prime Diagnostics", "Central Pharmacy"],
    },
    timeline: {
      title: "Identity activity",
      items: [
        { event: "Identity created", detail: "Al-Noor Hospital", when: "12 Aug" },
        { event: "Phone verified", detail: "OTP confirmed", when: "12 Aug" },
        { event: "Hospital linked", detail: "Prime Diagnostics", when: "13 Aug" },
        { event: "Lab record added", detail: "Full blood count", when: "13 Aug" },
        { event: "Authorised access recorded", detail: "Central Pharmacy / dispensing", when: "14 Aug" },
      ],
    },
    narrativeTitle: "A patient shouldn’t become a different person in every hospital.",
    narrativeBody: [
      "Facilities create a new record every time someone walks through a different door. The result is duplicate identities, fragmented records and incomplete histories.",
      "Health ID Identity creates a persistent identity layer around the patient instead of around the institution.",
    ],
    workflows: [
      { title: "One patient, one Health ID", body: "Encounters, laboratory results, prescriptions, and uploaded records are connected to a single persistent patient identity; that connection does not itself permit record access." },
      { title: "Duplicate prevention", body: "Match personal details, phone numbers, and existing Health ID identities before creating a new patient record." },
      { title: "Identity verification", body: "Verify patient identity and contact details, with verification status visible to authorised providers within their permitted organisation workflow." },
      { title: "Merge requests", body: "Allow authorised administrators to review and merge duplicate patient identities when multiple records belong to the same person." },
      { title: "Identity, not access", body: "A patient's Health ID identifies them but does not open their records. Access is separately determined by the applicable consent or access mechanism, organisation, professional role, permissions and care purpose." },
      { title: "Portability", body: "The patient's identity remains consistent across participating healthcare providers, wherever they receive care." },
    ],
    integrations: [
      { name: "Health ID EHR", body: "Verify the patient before a clinical record is written." },
      { name: "Health ID Migrate", body: "Match digitised historical files to the right person." },
      { name: "Health ID API", body: "Expose identity verification to your existing systems." },
    ],
    closingTitle: "Connect every healthcare interaction to the right patient.",
    closingBody: "The layer everything else in HID is built on.",
  },
  {
    slug: "migrate",
    name: "Health ID Migrate",
    eyebrow: "Legacy digitisation",
    title: "Don’t leave decades of patient history in filing cabinets.",
    sub: "Create OCR jobs for clinical documents, review extracted information, confirm the patient and publish validated information under applicable access controls.",
    cta: "Setup Your Facility",
    dash: "Migration dashboard",
    metrics: [
      { label: "OCR jobs", value: "12", footLabel: "Processed", footValue: "8", tone: "neutral" },
      { label: "Extractions", value: "8", footLabel: "Validated", footValue: "5", tone: "neutral" },
      { label: "Awaiting review", value: "3", footLabel: "Job-level", footValue: "Queue", tone: "caution" },
      { label: "Patient confirmation", value: "2", footLabel: "Needs", footValue: "Review", tone: "critical" },
    ],
    table: {
      title: "Document jobs",
      columns: ["Document", "Status"],
      rows: [
        { primary: "Clinical note", secondary: "Document 01", detail: "Validated", tone: "ok" },
        { primary: "Referral letter", secondary: "Document 02", detail: "In review", tone: "pending" },
        { primary: "Prescription image", secondary: "Document 03", detail: "Extracted", tone: "active" },
        { primary: "Historical note", secondary: "Document 04", detail: "Needs review", tone: "alert" },
      ],
    },
    progress: {
      title: "Example job progress",
      total: "12 document jobs",
      segments: [
        { label: "Processed", value: 7, tone: "ok" },
        { label: "Awaiting validation", value: 3, tone: "pending" },
        { label: "Remaining", value: 2, tone: "active" },
      ],
    },
    narrativeTitle: "Scanning documents alone just creates digital paper.",
    narrativeBody: [
      "A folder of photographed pages is not a medical record. It cannot be searched, matched to a patient, or read by an authorised clinician in a hurry.",
      "The current workflow validates and publishes extracted information one document job at a time, with patient confirmation and access controls.",
    ],
    workflows: [
      { title: "Capture", body: "Rapidly capture existing patient files using a mobile device or scanning station." },
      { title: "Organise", body: "Create a document job and keep its source document linked to that job." },
      { title: "Extract", body: "OCR-assisted technology identifies and structures relevant clinical information from each document." },
      { title: "Validate", body: "Human reviewers verify extracted information, resolve exceptions, and confirm the record before finalisation." },
      { title: "Confirm patient", body: "Confirm the patient for a validated document through the supported patient-confirmation workflow." },
      { title: "Import", body: "Validated information becomes part of the patient's digital history, available only to authorised healthcare professionals under the applicable organisation, role, permission, purpose and consent requirements." },
    ],
    integrations: [
      { name: "Health ID Identity", body: "Match each digitised file to the right person." },
      { name: "Health ID EHR", body: "Deliver historical context into authorised clinical workflows." },
      { name: "Health ID API", body: "Bring migrated history into systems your team already runs through the applicable access controls." },
    ],
    closingTitle: "Don’t leave your medical history behind when your facility goes digital.",
    closingBody: "Begin with supported document-level extraction, validation and publication.",
  },
  {
    slug: "api",
    name: "Health ID API",
    eyebrow: "Integration layer",
    title: "Keep your software and add connected patient identity.",
    sub: "Explore gateway endpoints for patient identity, authorisation checks, supported clinical records and audit. Integration requires an approved facility context, staff permissions and a defined care purpose.",
    cta: "Connect your stack",
    dash: "Developer console",
    metrics: [
      { label: "Identity", value: "API", footLabel: "Patient", footValue: "Lookup", tone: "neutral" },
      { label: "Authorisation", value: "API", footLabel: "Purpose", footValue: "Required", tone: "neutral" },
      { label: "Clinical records", value: "API", footLabel: "Scope", footValue: "Controlled", tone: "caution" },
      { label: "Audit", value: "API", footLabel: "Events", footValue: "Recorded", tone: "neutral" },
    ],
    table: {
      title: "Supported route examples",
      columns: ["Route", "Purpose"],
      rows: [
        { primary: "/identity/patient-lookup", secondary: "POST", detail: "Identity", tone: "ok" },
        { primary: "/identity/authorization/check", secondary: "POST", detail: "Access check", tone: "ok" },
        { primary: "/ehr/me/records", secondary: "GET", detail: "Patient view", tone: "ok" },
      ],
    },
    lists: [
      {
        title: "Route families",
        items: [
          { label: "Identity", value: "Available", tone: "ok" },
          { label: "EHR and laboratory", value: "Available", tone: "ok" },
          { label: "Pharmacy and OCR", value: "Available", tone: "ok" },
        ],
      },
      {
        title: "Request controls",
        items: [
          { label: "Session", value: "Required", tone: "ok" },
          { label: "Facility", value: "Selected", tone: "ok" },
          { label: "Purpose of use", value: "Required", tone: "active" },
          { label: "CSRF for changes", value: "Required", tone: "active" },
        ],
      },
    ],
    narrativeTitle: "You don’t need another dashboard just to use HID.",
    narrativeBody: [
      "If your organisation already runs an EHR, hospital management system, laboratory platform or custom infrastructure, HID can work behind it.",
      "Approved integrations can use the supported gateway routes with facility-scoped sessions and permissions.",
    ],
    workflows: [
      { title: "Patient identity", body: "Create, verify and retrieve Health ID identities." },
      { title: "Patient lookup", body: "Look up a Health ID in an authorised facility context." },
      { title: "Consent", body: "Initiate and manage supported patient access flows." },
      { title: "Health records", body: "Retrieve patient information only when the applicable consent or access mechanism, organisation, professional role, permissions and purpose allow it." },
      { title: "Record contribution", body: "Use supported EHR, laboratory and pharmacy write routes within the authorised workflow." },
      { title: "Access logs", body: "Record and retrieve access activity for audit." },
    ],
    integrations: [
      { name: "Hospital networks", body: "Standardise identity across every branch." },
      { name: "EMR companies", body: "Add interoperability without building it." },
      { name: "Migration teams", body: "Publish validated historical information through supported OCR workflows." },
      { name: "Outreach teams", body: "Link a registration case to an existing patient identity after review." },
    ],
    closingTitle: "Add connected health identity to your existing infrastructure.",
    closingBody: "Discuss supported integration routes for hospital networks, EHR vendors, laboratories and pharmacy systems.",
  },
  {
    slug: "outreach",
    name: "Health ID Outreach",
    eyebrow: "Field registration",
    title: "Organise registration cases outside the facility.",
    sub: "Manage campaigns, members and registration cases for outreach teams. Resolve a case to an existing patient identity through the supported review workflow.",
    cta: "Run an outreach campaign",
    dash: "Outreach dashboard",
    metrics: [
      { label: "Registration cases", value: "12", footLabel: "Resolved", footValue: "8", tone: "neutral" },
      { label: "Awaiting resolution", value: "4", footLabel: "Review", footValue: "Needed", tone: "caution" },
      { label: "Campaign members", value: "9", footLabel: "Campaigns", footValue: "2", tone: "neutral" },
      { label: "Cases to review", value: "3", footLabel: "Existing link", footValue: "Pending", tone: "critical" },
    ],
    table: {
      title: "Campaign registrations",
      columns: ["Patient", "Campaign"],
      rows: [
        { primary: "Fatima Abubakar", secondary: "Case 01 · Market outreach", detail: "Resolved", tone: "ok" },
        { primary: "Emeka Obi", secondary: "Case 02 · Market outreach", detail: "Awaiting review", tone: "pending" },
        { primary: "Zainab Musa", secondary: "Case 03 · School screening", detail: "Resolved", tone: "ok" },
        { primary: "Peter Adamu", secondary: "Case 04 · School screening", detail: "Review needed", tone: "alert" },
      ],
    },
    lists: [
      {
        title: "Today's campaigns",
        items: [
          { label: "Market outreach", value: "Active", tone: "active" },
          { label: "School screening", value: "Active", tone: "ok" },
          { label: "Identity review", value: "4 waiting", tone: "pending" },
        ],
      },
    ],
    narrativeTitle: "A registration made in the field should count everywhere.",
    narrativeBody: [
      "Outreach registration usually ends up in its own book or spreadsheet, and the facility the patient visits next has no idea it happened.",
      "Health ID Outreach keeps campaign registration cases attributable to a facility and its members. A reviewed case can be linked to an existing patient identity; a Health ID alone never grants record access.",
    ],
    workflows: [
      { title: "Plan a campaign", body: "Register a campaign so registrations can be accounted for by programme, place and date." },
      { title: "Add campaign members", body: "Assign staff accounts to the campaign so registration activity is attributable." },
      { title: "Capture a case", body: "Record the temporary patient details needed for a campaign registration case." },
      { title: "Review identity", body: "Check whether the registration corresponds to an existing patient before resolving the case." },
      { title: "Link an existing patient", body: "Reconcile a case to an authorised existing patient identity when confirmed." },
      { title: "Track progress", body: "Review campaign members, case status and the registrations awaiting identity resolution." },
    ],
    integrations: [
      { name: "Health ID Identity", body: "Resolve a registration case to an existing identity through authorised review." },
      { name: "Health ID EHR", body: "The linked identity can be used for separate, authorised clinical workflows." },
      { name: "Health ID API", body: "Read campaigns and registration cases through supported gateway routes." },
    ],
    closingTitle: "Take registration where the patients are.",
    closingBody: "For public health programmes, screening campaigns and community registration drives.",
  },
]

export function findProductDetail(slug: string): ProductDetail | undefined {
  return PRODUCT_DETAILS.find(product => product.slug === slug)
}
