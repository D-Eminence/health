import type { AgreementDocument } from './types'

/*
 * LEGAL REVIEW REQUIRED BEFORE RELEASE. Drafted with the owner in plain words; the team's review with a lawyer is
 * pending. Legal must approve this text before it is shown to the public. Any change to the words after release is a
 * new `version` (and `date`), which asks every patient to agree again.
 */
export const PATIENT_TERMS: AgreementDocument = {
  id: 'patient-terms',
  version: '1.0',
  date: '2026-11-01',
  title: 'Health ID terms of use',
  lead: 'Your health records belong to you.',
  short: [
    'Health ID keeps your health records in one place, safely.',
    'No hospital, clinic, lab or pharmacy can see them unless you say yes.',
    'You choose what they see and for how long. You can stop it any time.',
    'In an emergency, a doctor may open your records to save your life. We tell you straight after.',
    'We never sell your information.',
  ],
  sections: [
    { heading: '1. Who we are', paragraphs: [
      'Health ID is run by Health Identity Directory. We keep your health records and help you share them with the places that care for you.',
    ] },
    { heading: '2. What we keep about you', bullets: [
      'Who you are: your name, date of birth, sex, phone number, email, photo and NIN.',
      'Your health records: visits, diagnoses, test results, medicines, allergies, blood group, genotype, vaccines and documents. They come from the places that treat you, and from you.',
      'Who looked at your records: who it was, where, when and why.',
    ], paragraphs: ['We only keep what we need.'] },
    { heading: '3. Why we keep it', bullets: [
      'To show you your records.',
      'To share them with the places you say yes to.',
      'To help you in an emergency.',
      'To keep your account safe.',
      'To do what the law asks of us.',
    ], paragraphs: ['We never sell your information or use it for adverts.'] },
    { heading: '4. You choose who sees your records', bullets: [
      'A hospital, clinic, lab or pharmacy must ask you first. Saying yes and saying no are equally easy.',
      'You choose what they see and for how long: this visit, 30 days, or until you stop it.',
      'You can see who has access and stop it any time from Access, with one tap.',
      'Saying no never stops you getting care.',
    ] },
    { heading: '5. Sharing your card by email', bullets: [
      'The link opens the records you chose, without signing in.',
      'Anyone the email reaches could open it.',
      'It stops when the time ends, or when you stop it.',
      'You see every time it is opened.',
    ] },
    { heading: '6. Emergencies', bullets: [
      'If your life is at risk, a doctor may open your emergency information without asking you.',
      'They must give a reason.',
      'We tell you straight after.',
      'If it was wrong, you can report it in one tap.',
    ] },
    { heading: '7. When staff help you', paragraphs: [
      'If a member of staff helps you sign up, they explain this agreement to you first. Where you can, you confirm with a code sent to your own phone. Where you can’t, they record that they read it to you.',
    ] },
    { heading: '8. Children', paragraphs: [
      'A parent or guardian manages Health ID for a child under 18. At 18 it becomes theirs, and we ask them to check who has access.',
    ] },
    { heading: '9. Your rights', bullets: [
      'See your information and get a copy.',
      'Correct it.',
      'Stop sharing.',
      'Take back your consent.',
      'Close your account.',
    ], paragraphs: [
      'Taking back your consent is as easy as giving it. It stops new sharing at once. It doesn’t undo care you have already had, and the law says some records must be kept.',
    ] },
    { heading: '10. Keeping it safe', paragraphs: [
      'We lock your information when it is stored and when it is sent. Only people you allow can see your records, each with their own sign-in, and we record every time someone opens them. If something goes wrong, we tell you.',
    ] },
    { heading: '11. How long we keep it', paragraphs: [
      'We keep your information while your account is open. When you close it, we delete what we can and keep only what the law requires.',
    ] },
    { heading: '12. Changes', paragraphs: [
      'If we change this agreement, we tell you what changed in plain words and ask you to agree again.',
    ] },
    { heading: '13. Contact and complaints', paragraphs: [
      'You can reach our data protection officer through Help in Health ID. If you are not happy with our answer, you can complain to the Nigeria Data Protection Commission.',
    ] },
  ],
}
