/**
 * The notice a patient accepts before record chat answers a question. hid-system takes the notice's
 * version with every question (`noticeVersion`, from availability; 428 CHAT_NOTICE_REQUIRED if it
 * changed) and treats the acceptance as the patient's consent until the DPO rules whether explicit
 * opt-in consent is required (ADR-068, P39 (4)). The wording is Health ID's to settle: this is a
 * draft that states what ADR-068 says leaves the system, and the owner and the DPO should confirm it.
 */
export const CHAT_NOTICE_TITLE = 'Before you ask'

export const CHAT_NOTICE_PARAGRAPHS = (historyLimit: number): string[] => [
  'To answer a question, Health ID sends your question and the records released to you (notes, diagnoses, medicines, '
    + 'results and similar) to Anthropic, an outside company that runs the Claude service which writes the answer.',
  'Health IDs, email addresses, web links and long numbers are removed first. Names and other details written in '
    + 'free text, such as a clinical note, can still be included.',
  'Answers can be wrong and are not medical advice. Check the record references, and speak with your care team about medical decisions.',
  `Your questions and answers are saved for you, up to ${historyLimit} exchanges, until you delete them with New conversation.`,
]

export const CHAT_NOTICE_ACCEPT = 'I understand, and I want to ask about my records.'
