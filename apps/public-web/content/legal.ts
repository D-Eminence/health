/**
 * The Health ID Terms of Service and Privacy Policy, from hid-1.0's LegalDocumentsModal (one agreement of 36 sections
 * there), split into the two documents the patient sign-up links to: /terms and /privacy. The wording is the owner's;
 * change it here only with their say-so.
 *
 * Two changes from hid-1.0's text, both the owner's (2 Nov 2026): the Privacy Policy opens with a short plain-language
 * privacy notice, and its Data Protection Officer section names the DPO instead of saying HID "may appoint" one.
 * Every other section is still hid-1.0's word for word; the owner will update the rest later. Text in [owner to add:
 * ...] is a fact only the owner can supply and must not be guessed.
 */
export interface LegalSection {
  readonly title: string
  readonly paragraphs?: readonly string[]
  readonly bullets?: readonly string[]
}

/** A short plain-language summary shown above a document's numbered sections. */
export interface LegalNotice {
  readonly title: string
  readonly paragraphs: readonly string[]
  readonly sections: readonly LegalSection[]
  /** The last part of the notice: who to contact, with the DPO's email and phone as links, and how to complain. */
  readonly contact: {
    readonly title: string
    readonly paragraphs: readonly string[]
  }
}

export interface LegalDocument {
  readonly id: 'terms' | 'privacy'
  readonly title: string
  readonly lede: string
  readonly notice?: LegalNotice
  readonly sections: readonly LegalSection[]
}

/** Health ID's Data Protection Officer, as the owner gave them for publication (2 Nov 2026). */
export const DATA_PROTECTION_OFFICER = {
  name: 'Ibrahim Umar',
  email: 'ibrahim@healthidentitydirectory.com',
  phone: '+2347026717252',
} as const

const DPO = DATA_PROTECTION_OFFICER

/**
 * The privacy notice: what the live product does today, in plain words. Keep it true to the product: consent before
 * any facility sees a record, the Access PIN, emergency access (a reason is required, the patient is told, it is in
 * the audit log, it ends by itself after the 30 minutes the website asks for; no review process exists yet, so the
 * notice does not promise one, and it does not list what staff see), ending access under Access & sharing, data held
 * in AWS eu-west-1 (Ireland), the chat assistant's service provider, the profile photo (re-drawn in the browser so
 * nothing hidden in the file is sent, photoImage.ts), and no uploads of health documents or paper records yet.
 */
const PRIVACY_NOTICE: LegalNotice = {
  title: 'Privacy notice',
  paragraphs: [
    'This is a short, plain summary of how Health ID looks after your information. The full Privacy Policy below gives the detail.',
    'Health ID is run by Health Identity Directory (HID), 24001, Ahmadu Bello Way, G.R.A., Ilorin, Kwara, Nigeria. HID is certified by the Nigeria Data Protection Commission (NDPC). [owner to add: certificate number and date]',
  ],
  sections: [
    {
      title: 'What we collect',
      bullets: [
        'Your details: your name, phone number, email address, date of birth and gender.',
        'Your National Identification Number (NIN), if you add it to your profile. We check it with an identity verification service.',
        'What you add to your profile, such as your photo, contact details, health insurance (HMO), emergency contacts, and health information like your blood group and genotype.',
        'The health records that hospitals, clinics, laboratories and pharmacies make about you on Health ID when they care for you.',
        'Details that keep your account safe, such as when you sign in and the device and browser you use.',
      ],
    },
    {
      title: 'Why we use it',
      bullets: [
        'To give you a Health ID and keep your account safe.',
        'So that the health workers you allow can find you and see what they need to care for you.',
        'To send you messages about your account, and to tell you when your records are opened.',
        'To prevent fraud and misuse, and to meet our legal duties.',
        'We do not sell your information.',
      ],
    },
    {
      title: 'Who can see it, and how you stay in control',
      bullets: [
        'No facility sees your records until you say yes. You can share your records with a facility, approve or refuse a facility’s request, or give your Access PIN to the staff caring for you.',
        'In an emergency, when you can’t give permission and care can’t wait, a health worker can open your records without asking you first. They must give a reason. You are told each time, it is recorded in the audit log, and their access ends by itself after 30 minutes.',
        'Every time staff open your records, it is recorded in an audit log.',
        'You can see who has access, and end a facility’s access at any time, under Access & sharing in your Health ID account. If that facility knows your Access PIN, change your PIN too.',
        'Companies that help us run Health ID, such as cloud hosting, text message and email delivery, identity checks and the service behind the Health ID chat assistant, handle some of your information for us. They may use it only to provide the service, and only as we instruct.',
        'We give information to the authorities only when the law requires it.',
      ],
    },
    {
      title: 'Where we keep it, and for how long',
      bullets: [
        'Your information is stored on Amazon Web Services servers in Ireland, in the European Union, and is protected with encryption.',
        'Some of the companies that help us run Health ID may handle information in other countries, for example when you use the chat assistant. When they do, the rules in Cross-Border Data Transfers below apply.',
        'We keep your account details for as long as you have a Health ID.',
        'If you close your account, your health records are kept, because they are part of your medical history and the facilities that cared for you may need them. [owner to add: how long records are kept]',
        'If you add a profile photo, it is made smaller and its hidden details, such as where it was taken, are removed on your device before it is sent.',
        'You cannot add your own health documents, or photos or files of your paper records, to Health ID yet. When you can, this notice will say how they are handled.',
      ],
    },
    {
      title: 'Your rights',
      paragraphs: ['Under the Nigeria Data Protection Act 2023, you have the right to:'],
      bullets: [
        'Be told how your information is used, as this notice does.',
        'Get a copy of your information.',
        'Have information that is wrong corrected.',
        'Ask us to delete your information, where the law allows. Some health records may need to be kept.',
        'Ask us to limit how your information is used, or object to a use of it.',
        'Get your information in a form you can take to another service.',
        'Withdraw your consent at any time, for example by ending a facility’s access. This does not undo what was done before.',
        'Not be subject to a decision made only by a computer that seriously affects you.',
      ],
    },
  ],
  contact: {
    title: 'Questions and complaints',
    paragraphs: [
      `To use any of your rights, or if you have a question or concern, contact our Data Protection Officer, ${DPO.name}, or write to support@healthidentitydirectory.com.`,
      'If you are not happy with how we handle your information, you can complain to the Nigeria Data Protection Commission (NDPC) at ndpc.gov.ng.',
    ],
  },
}

export const TERMS_OF_SERVICE: LegalDocument = {
  id: 'terms',
  title: 'Terms of Service',
  lede: 'The terms you agree to when you create and use a Health ID. Read them with the Privacy Policy, which forms part of the same agreement.',
  sections: [
  { title: "Introduction", paragraphs: ["Welcome to the HID (Health Identification) Platform (\"HID\", \"we\", \"our\", or \"us\"). HID provides a digital system for secure storage, management, and sharing of personal and health-related information.", "By accessing or using the HID Platform, you agree to be bound by these Terms of Service and Privacy Policy (\"Agreement\"). If you do not agree, you must not use the platform."] },
  { title: "Eligibility", paragraphs: ["To use HID, you must:"], bullets: ["Be at least 18 years old, or", "Be under the supervision or consent of a parent or legal guardian.", "By registering, you confirm that all information provided is accurate and truthful."] },
  { title: "Account Registration & Security", bullets: ["Users must provide accurate personal information including name, phone number, and other required details.", "You are responsible for maintaining the confidentiality of your login credentials.", "You agree to notify HID immediately of any unauthorized access to your account.", "HID is not liable for any loss resulting from unauthorized account use."] },
  { title: "Nature of Service", paragraphs: ["HID is a digital health identification and record management platform that:"], bullets: ["Stores personal and health-related data.", "Enables access and sharing of health records with authorized entities.", "Facilitates identity verification within healthcare systems.", "HID does not provide medical advice, diagnosis, or treatment. Always consult a licensed healthcare professional."] },
  { title: "User Responsibilities", paragraphs: ["By using HID, you agree:"], bullets: ["Not to provide false or misleading information.", "Not to misuse, hack, reverse engineer, or disrupt the platform.", "Not to use the platform for unlawful or fraudulent purposes.", "To use the platform only for its intended healthcare-related purposes."] },
  { title: "Account Suspension & Termination", paragraphs: ["HID reserves the right to:"], bullets: ["Suspend or terminate accounts that violate these terms.", "Remove content or restrict access where necessary.", "Users may also request account deletion at any time."] },
  { title: "Limitation of Liability", paragraphs: ["To the fullest extent permitted by law:"], bullets: ["HID shall not be liable for indirect, incidental, or consequential damages.", "HID does not guarantee uninterrupted or error-free service.", "HID is not responsible for decisions made based on stored data."] },
  { title: "Indemnification", paragraphs: ["You agree to indemnify and hold HID harmless from any claims, damages, or liabilities arising from:"], bullets: ["Your misuse of the platform.", "Violation of this Agreement."] },
  { title: "Third-Party Services", paragraphs: ["HID may integrate with third-party services. We are not responsible for their practices or policies."] },
  { title: "Compliance with Regulations", paragraphs: ["HID complies with applicable data protection laws, including:"], bullets: ["Nigeria Data Protection Regulation (NDPR).", "Other applicable international standards where relevant."] },
  { title: "Changes to This Agreement", paragraphs: ["We may update this Agreement from time to time. Users will be notified of significant changes. Continued use of HID constitutes acceptance of the updated terms."] },
  { title: "Governing Law", paragraphs: ["This Agreement shall be governed by the laws of the Federal Republic of Nigeria."] },
  { title: "Contact Information", paragraphs: ["For questions, complaints, or data requests:"], bullets: ["Email: support@healthidentitydirectory.com", "Phone: +2347026717252", "Address: 24001, Ahmadu Bello Way, G.R.A., Ilorin, Kwara, Nigeria"] },
  { title: "User Consent", paragraphs: ["By creating an account, you confirm that:"], bullets: ["You have read and understood this Agreement.", "You agree to the Terms of Service and Privacy Policy.", "You consent to the collection and processing of your data as described."] },
  { title: "Disclaimer on Regulatory Scope", paragraphs: ["While HID adopts NDPC, GDPR and HIPAA-aligned best practices, users acknowledge that HID operates primarily under Nigerian law (NDPC).", "Full HIPAA compliance applies only where explicitly required through partnerships with covered entities."] },
  ],
}

export const PRIVACY_POLICY: LegalDocument = {
  id: 'privacy',
  title: 'Privacy Policy',
  lede: 'How Health ID collects, uses, shares and protects your personal and health information. Read it with the Terms of Service, which form part of the same agreement.',
  notice: PRIVACY_NOTICE,
  sections: [
  { title: "Data Ownership", paragraphs: ["You retain ownership of your personal and health data.", "By using HID, you grant us a limited license to store, process, and transmit your data solely for service delivery."] },
  { title: "Data Collection", paragraphs: ["We may collect the following information:"], bullets: ["Personal Information: Name, phone number, gender, date of birth.", "Health Information: Medical records, history, and related data.", "Technical Data: Device information, IP address, usage logs."] },
  { title: "Use of Data", paragraphs: ["Your data is used to:"], bullets: ["Create and manage your HID account.", "Facilitate healthcare access and identity verification.", "Improve platform performance and user experience.", "Ensure security and prevent fraud."] },
  { title: "Data Sharing", paragraphs: ["We may share your data only under the following conditions:"], bullets: ["With authorized healthcare providers, hospitals, or laboratories.", "With trusted third-party service providers supporting platform operations.", "When required by law or regulatory authorities.", "With your explicit consent.", "We do not sell user data."] },
  { title: "Data Security", paragraphs: ["HID implements industry-standard security measures including:"], bullets: ["Encryption of sensitive data.", "Secure authentication systems.", "Controlled access to user information.", "Despite these measures, no system is 100% secure. Users acknowledge this risk."] },
  { title: "User Rights", paragraphs: ["You have the right to:"], bullets: ["Access your personal data.", "Request correction of inaccurate data.", "Request deletion of your data (subject to legal obligations).", "Withdraw consent for data processing.", "Requests can be made via: support@healthidentitydirectory.com"] },
  { title: "Data Retention", paragraphs: ["We retain user data only as long as necessary to provide services, comply with legal obligations, and resolve disputes."] },
  { title: "Special Category Data (Health Information)", paragraphs: ["HID processes sensitive personal data, including health-related information, which is classified as Special Category Data.", "By using the platform, you provide explicit consent for the collection and processing of such data strictly for:"], bullets: ["Healthcare identification and record management.", "Medical support services and integrations.", "Platform functionality and security.", "Processing is limited to what is necessary and proportionate."] },
  { title: "Lawful Basis for Processing (GDPR, HIPAA, NDPC Alignment)", paragraphs: ["We process personal data under the following lawful bases:"], bullets: ["Consent - where you have given clear permission.", "Performance of a Contract - to provide HID services.", "Legal Obligation - where required by law.", "Vital Interests - where processing is necessary to protect life.", "Legitimate Interests - to improve and secure our platform."] },
  { title: "Data Subject Rights (Expanded GDPR Rights)", paragraphs: ["In addition to previously stated rights, users have the right to:"], bullets: ["Data Portability - Receive your data in a structured, machine-readable format.", "Right to Restrict Processing - Limit how your data is used.", "Right to Object - Object to certain types of data processing.", "Right to Withdraw Consent - At any time without affecting prior lawful processing.", "Requests must be honored within a reasonable timeframe in accordance with applicable laws."] },
  { title: "Data Protection Officer (DPO)", paragraphs: [`HID's Data Protection Officer (DPO) is ${DPO.name}. Email ${DPO.email} or call ${DPO.phone}.`, "The DPO is responsible for:"], bullets: ["Monitoring compliance with data protection laws.", "Advising on data privacy obligations.", "Serving as a point of contact for users and regulators."] },
  { title: "Data Breach Notification", paragraphs: ["In the event of a data breach involving personal or health data:"], bullets: ["HID will notify affected users without undue delay.", "Where required, regulatory authorities will be informed.", "Appropriate mitigation steps will be taken immediately."] },
  { title: "Cross-Border Data Transfers", paragraphs: ["Where user data is transferred outside Nigeria:"], bullets: ["Transfers will only occur to jurisdictions with adequate data protection laws, or", "Through approved safeguards such as contractual agreements and encryption.", "Users consent to such transfers where necessary for service delivery."] },
  { title: "Data Minimization & Purpose Limitation", paragraphs: ["HID adheres to strict principles of:"], bullets: ["Data Minimization - Only collecting data that is necessary.", "Purpose Limitation - Using data only for specified, legitimate purposes."] },
  { title: "HIPAA-Style Health Data Protection (Security Safeguards)", paragraphs: ["HID implements safeguards aligned with international health data protection standards, including:"], bullets: ["Administrative Safeguards - Access control policies, staff confidentiality agreements, data protection training.", "Technical Safeguards - End-to-end encryption where applicable, secure authentication (OTP and password protection), system monitoring, and audit logs.", "Physical Safeguards - Secure hosting infrastructure and controlled access to servers and systems."] },
  { title: "Role as Data Controller & Processor", bullets: ["HID acts as a Data Controller for user account data.", "HID may act as a Data Processor when handling data on behalf of healthcare providers."] },
  { title: "Third-Party Compliance", paragraphs: ["All third-party partners (for example cloud providers, APIs, and healthcare institutions) are required to:"], bullets: ["Comply with applicable data protection laws.", "Maintain confidentiality and security of user data.", "Process data only as instructed by HID."] },
  { title: "Health Data Access & Audit Trails", bullets: ["All access to sensitive health data is logged and monitored.", "Users may request a record of access to their data where applicable."] },
  { title: "Privacy by Design & Default", paragraphs: ["HID incorporates Privacy by Design principles, ensuring that:"], bullets: ["Data protection is embedded into system architecture.", "Default settings prioritize user privacy.", "Only necessary data is visible and accessible."] },
  { title: "Children's Data Protection", paragraphs: ["Where users are under 18:"], bullets: ["Parental or guardian consent is required.", "Additional safeguards are applied to protect minors data."] },
  { title: "Retention of Health Data", paragraphs: ["Health-related data may be retained longer than standard data where necessary for:"], bullets: ["Medical continuity.", "Legal and regulatory compliance.", "Such data will always be securely stored and protected."] },
  ],
}
