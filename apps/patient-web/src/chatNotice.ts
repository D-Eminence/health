/**
 * The notice a patient accepts before record chat answers a question. hid-system takes the notice's
 * version with every question (`noticeVersion`, from availability; 428 CHAT_NOTICE_REQUIRED if it
 * changed) and treats the acceptance as the patient's consent until the DPO rules whether explicit
 * opt-in consent is required (ADR-068, P39 (4)).
 *
 * This text states what hid-system sends (DPIA action A5): the patient-chat policy and redactIdentifiers
 * (patient-evidence.policy.ts) remove the listed identifiers but not web links or other people's names,
 * Anthropic runs in the United States (claude-ai.service.ts `inference_geo: 'us'`), Amazon Web Services
 * search and document reading run in eu-west-1 (Ireland), and saved history is deleted after 30 days
 * (patient-chat-history.service.ts). Keep it true when the backend changes.
 */
export const CHAT_NOTICE_TITLE = 'Before you ask'

export const CHAT_NOTICE_PARAGRAPHS = (historyLimit: number): string[] => [
  'To answer a question, Health ID sends your question, up to 4 earlier questions and answers, and the records released '
    + 'to you. This includes notes from finished visits, confirmed diagnoses, medicines, test results, vital signs, '
    + 'imported history, the text of your documents, and your age and sex.',
  'Anthropic, an outside company, writes the answer. It handles the data in the United States. Amazon Web Services '
    + 'searches your records and reads the text of your documents. It does this in Ireland.',
  'Before anything is sent, your name, date of birth, Health ID, email addresses, phone numbers, NIN, BVN, and '
    + 'hospital, folder and card numbers are removed. Web links and the names of other people, such as staff, are not removed. Other '
    + 'details written in a note or document can still be included.',
  'Records about sensitive conditions, such as HIV, pregnancy, cancer and mental health, are not used.',
  'Answers can be wrong and are not medical advice. Check the record references, and speak with your care team about medical decisions.',
  `Your questions and answers are saved for you, up to ${historyLimit} exchanges. They are deleted after 30 days, `
    + 'or sooner when you start a New conversation.',
]

export const CHAT_NOTICE_ACCEPT = 'I understand, and I want to ask about my records.'
