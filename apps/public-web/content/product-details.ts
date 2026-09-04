/**
 * Product dashboards and detail copy.
 *
 * Transcribed from the approved design's product pages. Each module shows a
 * different arrangement of panels because each one does a different job — a
 * laboratory has a pipeline, a pharmacy has stock lists, an identity service
 * has a profile — so panels are optional rather than forced into one shape.
 *
 * Every figure, name and Health ID here is invented for the marketing site. No
 * real patient data appears on the public site and none is fetched: this
 * application has no access to a clinical service.
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
    sub: "Give your team one connected workspace to manage patient records, clinical workflows, and care from one place.",
    cta: "Modernise your patient health records",
    dash: "Clinical dashboard",
    metrics: [
      { label: "My patients today", value: "18", footLabel: "Seen", footValue: "9", tone: "neutral" },
      { label: "Ready for doctor", value: "9", footLabel: "Longest wait", footValue: "24 min", tone: "caution" },
      { label: "Results to review", value: "6", footLabel: "Urgent", footValue: "2", tone: "critical" },
      { label: "Pending sign-offs", value: "3", footLabel: "From", footValue: "Residents", tone: "neutral" },
    ],
    table: {
      title: "Ready for doctor",
      columns: ["Patient", "Detail"],
      rows: [
        { primary: "Ngozi Bello", secondary: "HID-71-2204 · ANC 34w", detail: "PIN verified", tone: "ok" },
        { primary: "Samuel Okoro", secondary: "HID-44-8810 · 45M", detail: "Awaiting PIN", tone: "pending" },
        { primary: "Aisha Mohammed", secondary: "HID-20-5517 · 28F", detail: "In triage", tone: "active" },
      ],
    },
    alerts: {
      title: "Needs attention",
      items: [
        { tone: "alert", text: "ICU bed capacity at 90% — 1 bed free." },
        { tone: "pending", text: "3 drugs below reorder level in Pharmacy." },
        { tone: "active", text: "2 urgent lab results awaiting clinician review." },
      ],
    },
    narrativeTitle: "Built around the patient, not the file number.",
    narrativeBody: [
      "Traditional hospital systems identify a patient only within that facility. A new folder, a new number, a history that starts again.",
      "Health ID EHR connects the clinical record to a persistent health identity, so the same patient stays connected as their journey expands beyond your walls.",
    ],
    workflows: [
      { title: "Registration", body: "Find an existing patient by their Health ID before creating a new record, helping prevent duplicate patient identities." },
      { title: "Consultation", body: "Record presenting complaints, examination findings, diagnoses, and treatment plans, all linked to the patient encounter." },
      { title: "Prescriptions", body: "Create and send prescriptions to a connected pharmacy while keeping the patient's medication history up to date." },
      { title: "Laboratory tests", body: "Order laboratory tests and receive verified results directly in the patient's record." },
      { title: "Admissions", body: "Manage ward and bed assignments, with inpatient notes connected to the patient's longitudinal health record." },
      { title: "Roles and audit", body: "Give doctors, nurses, receptionists, and administrators access based on their roles, with activities recorded for accountability." },
    ],
    integrations: [
      { name: "Health ID Identity", body: "Verify the correct patient before anything is written." },
      { name: "Health ID Laboratory", body: "Send investigations and receive results." },
      { name: "Health ID Pharmacy", body: "Send prescriptions and maintain medication history." },
      { name: "Health ID Connect", body: "Access relevant records from participating providers." },
      { name: "Health ID Migrate", body: "Bring historical patient files into the EHR." },
    ],
    closingTitle: "Move your clinical operations beyond paper and fragmented records.",
    closingBody: "Give your team one connected workspace for managing patient care.",
  },
  {
    slug: "laboratory",
    name: "Health ID Laboratory",
    eyebrow: "Diagnostics",
    title: "One connected workspace for your entire laboratory.",
    sub: "Order laboratory tests and receive verified results directly in the patient record. From test requests and sample collection to result verification and patient records, manage your laboratory workflow in one secure, connected system.",
    cta: "Digitise your laboratory",
    dash: "Laboratory dashboard",
    metrics: [
      { label: "Tests today", value: "84", footLabel: "Completed", footValue: "51", tone: "neutral" },
      { label: "Awaiting collection", value: "12", footLabel: "Oldest", footValue: "38 min", tone: "caution" },
      { label: "Awaiting verification", value: "9", footLabel: "Senior review", footValue: "Required", tone: "neutral" },
      { label: "Critical results", value: "2", footLabel: "Clinician", footValue: "Alerted", tone: "critical" },
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
    narrativeTitle: "A result should not become another PDF on someone\\u2019s phone.",
    narrativeBody: [
      "Between the request slip, the sample book and the printed report, a laboratory result passes through several systems that do not know each other.",
      "With HID, an approved result becomes part of the patient\\u2019s longitudinal medical history — available to the clinician who ordered it, and to the next one who needs it.",
    ],
    workflows: [
      { title: "Receive requests", body: "Receive test requests from Health ID EHR or create new requests for walk-in patients." },
      { title: "Verify the patient", body: "Verify the patient's Health ID and prevent duplicate laboratory records." },
      { title: "Sample collection", body: "Track sample type, collection time, collector, status and notes." },
      { title: "Processing", body: "Track every test from request and sample collection through processing, review, and completion." },
      { title: "Result entry", body: "Enter, review, and manage structured test results in one place." },
      { title: "Verification and release", body: "Authorised staff approve results before they reach the ordering provider." },
    ],
    integrations: [
      { name: "Health ID EHR", body: "Receive investigation requests and return verified results." },
      { name: "Health ID Identity", body: "Attach every result to the right patient." },
      { name: "Health ID Connect", body: "Make results visible to authorised providers elsewhere." },
      { name: "Health ID API", body: "Connect an existing laboratory information system." },
    ],
    closingTitle: "Turn your laboratory into a connected part of the patient\\u2019s journey.",
    closingBody: "From hospital laboratories to multi-branch diagnostic networks and screening programmes.",
  },
  {
    slug: "pharmacy",
    name: "Health ID Pharmacy",
    eyebrow: "Dispensing and inventory",
    title: "Manage your pharmacy. Keep every medication connected.",
    sub: "From prescriptions and dispensing to inventory and sales, manage your pharmacy operations while maintaining a complete medication history for every verified patient.",
    cta: "Bring your pharmacy online",
    dash: "Pharmacy dashboard",
    metrics: [
      { label: "Prescriptions today", value: "46", footLabel: "Dispensed", footValue: "31", tone: "neutral" },
      { label: "Awaiting dispensing", value: "15", footLabel: "Oldest", footValue: "19 min", tone: "caution" },
      { label: "Low stock items", value: "3", footLabel: "Reorder", footValue: "Due", tone: "caution" },
      { label: "Today's sales", value: "₦248k", footLabel: "Transactions", footValue: "62", tone: "neutral" },
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
        title: "Low stock",
        items: [
          { label: "Amoxicillin 500mg", value: "8 left", tone: "alert" },
          { label: "Metformin 850mg", value: "14 left", tone: "pending" },
          { label: "Paracetamol 1g", value: "21 left", tone: "pending" },
        ],
      },
      {
        title: "Expiring soon",
        items: [
          { label: "Ceftriaxone 1g", value: "18 days", tone: "alert" },
          { label: "Artemether inj.", value: "34 days", tone: "pending" },
          { label: "Hydrocortisone", value: "52 days", tone: "active" },
        ],
      },
    ],
    narrativeTitle: "Medication history is health history.",
    narrativeBody: [
      "What a patient has been prescribed and what they actually collected is clinical information — but it usually stays locked inside one pharmacy\\u2019s books.",
      "Health ID Pharmacy connects dispensing activity to the patient\\u2019s persistent identity, so the next clinician can see what came before.",
    ],
    workflows: [
      { title: "Prescription management", body: "Receive prescriptions from Health ID EHR or create new prescriptions for walk-in patients." },
      { title: "Patient verification", body: "Verify the patient's Health ID identity before dispensing medication." },
      { title: "Dispensing", body: "Record medications dispensed, quantities, dosage instructions, and dispensing details." },
      { title: "Medication history", body: "Keep prescription and dispensing records connected to the patient's longitudinal medication history." },
      { title: "Inventory management", body: "Track medication stock, monitor quantities, and identify items that need replenishment." },
      { title: "Sales and payments", body: "Record daily pharmacy sales and maintain an accurate transaction history." },
      { title: "Roles and audit", body: "Give pharmacists, technicians, cashiers, and administrators access based on their roles, with actions recorded for accountability." },
    ],
    integrations: [
      { name: "Health ID EHR", body: "Receive prescriptions the moment a clinician issues them." },
      { name: "Health ID Identity", body: "Dispense against a verified patient, not a name on a slip." },
      { name: "Health ID Connect", body: "Contribute medication history to the patient record." },
      { name: "Health ID API", body: "Connect existing pharmacy or POS software." },
    ],
    closingTitle: "Manage your pharmacy and build a more complete medication history.",
    closingBody: "For single counters, hospital pharmacies and multi-branch chains.",
  },
  {
    slug: "identity",
    name: "Health ID Identity",
    eyebrow: "The foundation",
    title: "Connect every patient to one trusted health identity.",
    sub: "Create and verify persistent patient identities that help healthcare providers reduce duplicate records, improve identification, and connect information across the patient journey.",
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
      id: "HID-38291",
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
        { event: "Access granted", detail: "Central Pharmacy", when: "14 Aug" },
      ],
    },
    narrativeTitle: "A patient shouldn\\u2019t become a different person in every hospital.",
    narrativeBody: [
      "Facilities create a new record every time someone walks through a different door. The result is duplicate identities, fragmented records and incomplete histories.",
      "Health ID Identity creates a persistent identity layer around the patient instead of around the institution.",
    ],
    workflows: [
      { title: "One patient, one Health ID", body: "Encounters, laboratory results, prescriptions, and uploaded records are connected to a single persistent patient identity." },
      { title: "Duplicate prevention", body: "Match personal details, phone numbers, and existing Health ID identities before creating a new patient record." },
      { title: "Identity verification", body: "Verify patient identity and contact details, with verification status clearly visible to authorised providers." },
      { title: "Merge requests", body: "Allow authorised administrators to review and merge duplicate patient identities when multiple records belong to the same person." },
      { title: "Identity, not access", body: "A patient's Health ID identifies them but does not grant access to their records. Identity and access remain separate layers." },
      { title: "Portability", body: "The patient's identity remains consistent across participating healthcare providers, wherever they receive care." },
    ],
    integrations: [
      { name: "Health ID EHR", body: "Verify the patient before a clinical record is written." },
      { name: "Health ID Connect", body: "Serve as the key that connects records across providers." },
      { name: "Health ID Migrate", body: "Match digitised historical files to the right person." },
      { name: "Health ID API", body: "Expose identity verification to your existing systems." },
    ],
    closingTitle: "Connect every healthcare interaction to the right patient.",
    closingBody: "The layer everything else in HID is built on.",
  },
  {
    slug: "connect",
    name: "Health ID Connect",
    eyebrow: "Interoperability",
    title: "Know the patient's journey, not just today's visit.",
    sub: "Authorised healthcare professionals can securely access relevant patient information contributed by participating providers, with patient consent, role-based permissions, and complete auditability.",
    cta: "Connect your facility",
    dash: "Access session",
    metrics: [
      { label: "Active sessions", value: "6", footLabel: "Standard", footValue: "5", tone: "neutral" },
      { label: "Access requests today", value: "38", footLabel: "Authorised", footValue: "34", tone: "neutral" },
      { label: "Emergency access", value: "1", footLabel: "Reason", footValue: "Logged", tone: "critical" },
      { label: "Connected providers", value: "12", footLabel: "Contributing", footValue: "9", tone: "neutral" },
    ],
    alerts: {
      title: "Patient overview",
      items: [
        { tone: "alert", text: "Allergy: sulfa drugs — documented 12 Aug." },
        { tone: "pending", text: "2 active medications from an external provider." },
        { tone: "active", text: "Latest investigation available from HealthLab." },
      ],
    },
    lists: [
      {
        title: "Access status",
        items: [
          { label: "Access type", value: "Standard", tone: "ok" },
          { label: "Authorised", value: "10:42", tone: "ok" },
          { label: "Expires", value: "12:42", tone: "pending" },
          { label: "Scope", value: "Clinical only", tone: "active" },
        ],
      },
    ],
    timeline: {
      title: "Connected history — Amina Yusuf · HID-38291",
      items: [
        { event: "Consultation", detail: "Prime Hospital", when: "12 Aug" },
        { event: "Full blood count", detail: "HealthLab Diagnostics", when: "13 Aug" },
        { event: "Medication dispensed", detail: "WellCare Pharmacy", when: "13 Aug" },
        { event: "Discharge summary", detail: "Prime Hospital", when: "14 Aug" },
      ],
    },
    narrativeTitle: "Healthcare history shouldn\\u2019t stop at your facility\\u2019s door.",
    narrativeBody: [
      "Your system knows everything that happened inside your hospital. It usually knows almost nothing about what happened anywhere else.",
      "Health ID Connect bridges that gap without handing anyone a master key.",
    ],
    workflows: [
      { title: "Identify", body: "Find the patient using their Health ID." },
      { title: "Request access", body: "The healthcare professional initiates an access request." },
      { title: "Patient authorises", body: "The patient provides their Access PIN or another approved consent mechanism." },
      { title: "Access", body: "View records appropriate to the professional's role, organisation, purpose, permissions, and patient consent." },
      { title: "Close the session", body: "Access ends explicitly rather than remaining open indefinitely." },
      { title: "Emergency access", body: "Use break-glass access when necessary for patients who cannot provide consent, with a stated reason and elevated audit logging." },
    ],
    integrations: [
      { name: "Health ID Identity", body: "Resolve which patient is being requested." },
      { name: "Health ID EHR", body: "Surface external context inside the clinical workspace." },
      { name: "Health ID Laboratory", body: "Pull investigations performed elsewhere." },
      { name: "Health ID API", body: "Bring connected records into your existing system." },
    ],
    closingTitle: "See more than today\\u2019s visit.",
    closingBody: "Connect your facility to a more continuous patient history.",
  },
  {
    slug: "migrate",
    name: "Health ID Migrate",
    eyebrow: "Legacy digitisation",
    title: "Don’t leave decades of patient history in filing cabinets.",
    sub: "Bring legacy records into Health ID through rapid document capture, OCR-assisted extraction, patient matching, and human validation. Turn paper history into structured, accessible patient information while preserving the record behind it.",
    cta: "Start your migration",
    dash: "Migration dashboard",
    metrics: [
      { label: "Files assigned", value: "15,000", footLabel: "Scanned", footValue: "10,060", tone: "neutral" },
      { label: "Files processed", value: "8,720", footLabel: "Rate", footValue: "58.1%", tone: "neutral" },
      { label: "Awaiting review", value: "1,340", footLabel: "Validators", footValue: "6", tone: "caution" },
      { label: "Unmatched patients", value: "212", footLabel: "Needs attention", footValue: "41", tone: "critical" },
    ],
    table: {
      title: "Enumerator performance",
      columns: ["Enumerator", "Assigned"],
      rows: [
        { primary: "Aisha", secondary: "300", detail: "5 errors", tone: "ok" },
        { primary: "Ibrahim", secondary: "300", detail: "8 errors", tone: "pending" },
        { primary: "Chioma", secondary: "300", detail: "2 errors", tone: "ok" },
        { primary: "Yakubu", secondary: "300", detail: "17 errors", tone: "alert" },
      ],
    },
    progress: {
      title: "Migration progress",
      total: "15,000 files",
      segments: [
        { label: "Processed", value: 8720, tone: "ok" },
        { label: "Awaiting validation", value: 1340, tone: "pending" },
        { label: "Remaining", value: 4940, tone: "active" },
      ],
    },
    narrativeTitle: "Scanning documents alone just creates digital paper.",
    narrativeBody: [
      "A folder of photographed pages is not a medical record. It cannot be searched, matched to a patient, or read by a clinician in a hurry.",
      "Health ID Migrate turns historical documents into structured information that becomes part of a usable patient record. That distinction is the entire point.",
    ],
    workflows: [
      { title: "Capture", body: "Rapidly capture existing patient files using a mobile device or scanning station." },
      { title: "Organise", body: "Group scanned pages into the correct patient file, keeping documents and historical records together." },
      { title: "Extract", body: "OCR-assisted technology identifies and structures relevant clinical information from each document." },
      { title: "Validate", body: "Human reviewers verify extracted information, resolve exceptions, and confirm the record before finalisation." },
      { title: "Match", body: "Link the validated record to the correct patient using their Health ID and supported identity-matching methods." },
      { title: "Import", body: "Validated information becomes part of the patient's digital history, ready for authorised healthcare professionals to access and use." },
    ],
    integrations: [
      { name: "Health ID Identity", body: "Match each digitised file to the right person." },
      { name: "Health ID EHR", body: "Deliver historical context into the clinical workspace." },
      { name: "Health ID Connect", body: "Make migrated history available across providers." },
    ],
    closingTitle: "Don\\u2019t leave your medical history behind when your facility goes digital.",
    closingBody: "Migration teams, quality monitoring and progress reporting included.",
  },
  {
    slug: "api",
    name: "Health ID API",
    eyebrow: "Integration layer",
    title: "Keep your software and add connected patient identity.",
    sub: "Connect Health ID to the healthcare systems your team already uses, from EHRs and laboratory platforms to pharmacy software and other healthcare technology. Give your existing systems access to persistent patient identity and connected health records without replacing the tools your organisation already depends on.",
    cta: "Connect your stack",
    dash: "Developer console",
    metrics: [
      { label: "API requests today", value: "24,964", footLabel: "Success rate", footValue: "99.6%", tone: "neutral" },
      { label: "Active integrations", value: "9", footLabel: "Facilities", footValue: "12", tone: "neutral" },
      { label: "Errors", value: "104", footLabel: "Rate", footValue: "0.4%", tone: "caution" },
      { label: "Webhook events", value: "6,318", footLabel: "Delivered", footValue: "99.9%", tone: "neutral" },
    ],
    table: {
      title: "Endpoint usage",
      columns: ["Endpoint", "Requests"],
      rows: [
        { primary: "/patients/verify", secondary: "12,430", detail: "Healthy", tone: "ok" },
        { primary: "/records", secondary: "8,214", detail: "Healthy", tone: "ok" },
        { primary: "/access", secondary: "4,320", detail: "Healthy", tone: "ok" },
      ],
    },
    lists: [
      {
        title: "Integration status",
        items: [
          { label: "Hospital EHR", value: "Connected", tone: "ok" },
          { label: "Laboratory system", value: "Connected", tone: "ok" },
          { label: "Pharmacy platform", value: "Setup required", tone: "pending" },
        ],
      },
      {
        title: "Developer tools",
        items: [
          { label: "API keys", value: "3 active", tone: "ok" },
          { label: "Sandbox", value: "Enabled", tone: "ok" },
          { label: "Webhooks", value: "4 endpoints", tone: "active" },
          { label: "Environment", value: "Production", tone: "active" },
        ],
      },
    ],
    narrativeTitle: "You don\\u2019t need another dashboard just to use HID.",
    narrativeBody: [
      "If your organisation already runs an EHR, hospital management system, laboratory platform or custom infrastructure, HID can work behind it.",
      "Your staff keep the systems they already know. HID provides the connectivity layer underneath.",
    ],
    workflows: [
      { title: "Patient identity", body: "Create, verify and retrieve Health ID identities." },
      { title: "Patient matching", body: "Connect internal patient identifiers with Health ID." },
      { title: "Consent", body: "Initiate and manage supported patient access flows." },
      { title: "Health records", body: "Retrieve authorised patient information." },
      { title: "Record contribution", body: "Send structured records back into connected history." },
      { title: "Access logs", body: "Record and retrieve access activity for audit." },
    ],
    integrations: [
      { name: "Hospital networks", body: "Standardise identity across every branch." },
      { name: "EMR companies", body: "Add interoperability without building it." },
      { name: "HMOs and insurers", body: "Verify members against a persistent identity." },
      { name: "Telemedicine", body: "Bring prior history into a remote consultation." },
    ],
    closingTitle: "Add connected health identity to your existing infrastructure.",
    closingBody: "Built for hospital networks, EHR vendors, laboratory and pharmacy platforms, HMOs and health-tech teams.",
  },
]

export function findProductDetail(slug: string): ProductDetail | undefined {
  return PRODUCT_DETAILS.find(product => product.slug === slug)
}
