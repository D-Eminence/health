/**
 * The notice a patient accepts before record chat answers a question. hid-system takes the notice's
 * version with every question (`noticeVersion`, from availability; 428 CHAT_NOTICE_REQUIRED if it
 * changed) and treats the acceptance as the patient's consent until the DPO rules whether explicit
 * opt-in consent is required (ADR-068, P39 (4)).
 *
 * This text states what hid-system sends (DPIA action A5), checked against patient-evidence.query.ts and
 * patient-evidence.policy.ts:
 * - Sources: finished visits, their notes, confirmed diagnoses, prescriptions, test requests, lab results, vitals,
 *   imported records, the whole imported health profile (blood group, genotype, allergies, chronic conditions,
 *   current medications, medical notes), document text, and age and sex.
 * - Identifiers: redactIdentifiers recognises patterns (Nigerian or "+" phone numbers, labelled hospital/folder/card
 *   numbers, listed date-of-birth forms, the name as written in the profile) and runs only on notes, documents,
 *   imported records and the health profile's medical notes, not on lab results or other health profile fields.
 *   Web links and other people's names are left in.
 * - Sensitive conditions: `sensitive()` covers only diagnoses, prescriptions, test requests and lab results; notes,
 *   documents, imported records and the health profile are sent whatever they mention.
 * - Anthropic runs in the United States (claude-ai.service.ts `inference_geo: 'us'`); Amazon Web Services search and
 *   document reading run in eu-west-1 (Ireland).
 * - Saved history (patient-chat-history.service.ts): rows older than 30 days are hidden, and deleted only by prune()
 *   the next time the patient uses the chat. No scheduled job deletes them.
 * Keep it true when the backend changes.
 */
export const CHAT_NOTICE_TITLE = 'Before you ask'

export const CHAT_NOTICE_PARAGRAPHS = (historyLimit: number): string[] => [
  'To answer a question, Health ID sends your question, up to 4 earlier questions and answers, and the records released '
    + 'to you. This includes finished visits and their notes, confirmed diagnoses, medicines, tests ordered and their '
    + 'results, vital signs, imported history, the text of your documents, and your age and sex. It also includes your '
    + 'health profile: blood group, genotype, allergies, long-term conditions, medicines and notes.',
  'Anthropic, an outside company, writes the answer. It handles the data in the United States. Amazon Web Services '
    + 'searches your records and reads the text of your documents. It does this in Ireland.',
  'Before anything is sent, we try to remove your name, date of birth, Health ID, email addresses, phone numbers, NIN, '
    + 'BVN, and hospital, folder and card numbers. We remove them from notes, documents and imported history, and only '
    + 'where we recognise them. Some can still be sent, such as a nickname, a landline number, or a hospital number '
    + 'written without a label. Nothing is removed from test results, or from the allergies, conditions and medicines in '
    + 'your health profile. Web links and the names of other people, such as staff, are not removed.',
  'Diagnoses, medicines and tests for sensitive conditions, such as HIV, pregnancy, cancer and mental health, are left '
    + 'out. But notes, documents, imported history and your health profile are still sent, even when they mention these '
    + 'conditions.',
  'Answers can be wrong and are not medical advice. Check the record references, and speak with your care team about medical decisions.',
  `Your questions and answers are saved for you, up to ${historyLimit} exchanges. After 30 days they are no longer `
    + 'shown. They are deleted the next time you open the chat, or when you start a New conversation. Until then they '
    + 'stay stored.',
]

export const CHAT_NOTICE_ACCEPT = 'I understand, and I want to ask about my records.'
