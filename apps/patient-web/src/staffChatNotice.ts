/**
 * The notice a clinician accepts before staff record chat answers a question about a patient. hid-system takes
 * the notice's version with every question (`noticeVersion`, from availability; 428 CHAT_NOTICE_REQUIRED if it
 * changed), as for the patient's chat (ADR-069, ADR-068). Whether a clinician's acknowledgement stands in for the
 * facility's lawful basis is the DPO's ruling (P40 (3)). The wording is Health ID's to settle: this is a draft that
 * states what ADR-069 says leaves the system, and the owner and the DPO should confirm it.
 */
export const STAFF_CHAT_NOTICE_TITLE = 'Before you ask'

export const STAFF_CHAT_NOTICE_PARAGRAPHS = (historyLimit: number): string[] => [
  'To answer a question, Health ID sends your question and the records you may already read for this patient at '
    + 'this facility (notes, diagnoses, medicines, vital signs and similar) to Anthropic, an outside company that runs the '
    + 'Claude service which writes the answer. Lab results and requests, other facilities’ records, imported history and '
    + 'the content of documents are not sent.',
  'Health IDs, email addresses, web links and long numbers are removed first. Names and other details written in '
    + 'free text, such as a clinical note, can still be included.',
  'Answers can be wrong and are not clinical advice. Check the record references against the record before you rely on one.',
  `Your questions and answers about this patient are saved for you alone, up to ${historyLimit} exchanges, until you delete them. `
    + 'The patient and your colleagues cannot read them.',
]

export const STAFF_CHAT_NOTICE_ACCEPT = 'I understand, and I am asking about this patient for their direct care.'
