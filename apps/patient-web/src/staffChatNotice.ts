/**
 * The notice a clinician accepts before staff record chat answers a question about a patient. hid-system takes
 * the notice's version with every question (`noticeVersion`, from availability; 428 CHAT_NOTICE_REQUIRED if it
 * changed), as for the patient's chat (ADR-069, ADR-068). Whether a clinician's acknowledgement stands in for the
 * facility's lawful basis is the DPO's ruling (P40 (3)).
 *
 * The owner, who is the DPO, accepted on 2026-11-04 (DPIA Q33 B, actions A4/A5) that the staff chat sends
 * identifiers and the full record by design. This text states what hid-system sends: the staff chat gets no
 * patient-chat policy and no identifier removal (staff-evidence.service.ts, patient-chat.service.ts), Anthropic
 * runs in the United States (claude-ai.service.ts `inference_geo: 'us'`), and Amazon Web Services search and
 * document reading run in the service's region, eu-west-1 (Ireland). Saved history is deleted after 30 days
 * (staff-chat-history.service.ts). Keep it true when the backend changes.
 */
export const STAFF_CHAT_NOTICE_TITLE = 'Before you ask'

export const STAFF_CHAT_NOTICE_PARAGRAPHS = (historyLimit: number): string[] => [
  'To answer a question, Health ID sends your question, up to 4 earlier questions and answers, and the records you '
    + 'are allowed to read for this patient. This includes the patient’s name, date of birth and sex; notes; diagnoses, '
    + 'including ones ruled out, with their notes; medicines, including cancelled ones, with their instructions; lab '
    + 'requests and their reasons; lab results; vital signs; imported history; and the text and file names of documents, '
    + 'including restricted ones.',
  'Records about sensitive conditions, such as HIV, pregnancy, cancer and mental health, are included. Nothing is '
    + 'removed first: names, Health IDs, phone numbers and other details stay in.',
  'Anthropic, an outside company, writes the answer. It handles the data in the United States. Amazon Web Services '
    + 'handles the records, the patient’s name, date of birth and sex, and your question to search the record, and '
    + 'reads the text of documents. It does this in Ireland.',
  'Use this only for the direct care of the patient you have open. You and your facility are responsible for that.',
  'Answers can be wrong and are not clinical advice. Check the record references against the record before you rely on one.',
  `Your questions and answers about this patient are saved for you alone, up to ${historyLimit} exchanges. `
    + 'They are deleted after 30 days, or sooner if you delete them. The patient and your colleagues cannot read them.',
]

export const STAFF_CHAT_NOTICE_ACCEPT = 'I understand, and I am asking about this patient for their direct care.'
