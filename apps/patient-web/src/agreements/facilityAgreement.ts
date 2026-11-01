import type { AgreementDocument } from './types'

/*
 * LEGAL REVIEW REQUIRED BEFORE RELEASE. Drafted with the owner in plain words; the team's review with a lawyer is
 * pending. Legal must approve this text before any facility signs it. Any change to the words after release is a new
 * `version` (and `date`), which asks every facility administrator to agree again.
 */
export const FACILITY_AGREEMENT: AgreementDocument = {
  id: 'facility-agreement',
  version: '1.0',
  date: '2026-11-01',
  title: 'Health ID facility agreement',
  lead: 'Patients trust you with their records. You promise to:',
  short: [
    'Open a patient’s records only to care for them, and only with their yes, or in a real emergency.',
    'Give each staff member their own sign-in, and remove it the day they leave.',
    'Keep patient information private and safe, and tell us at once if something goes wrong.',
    'Only register a facility you are allowed to act for.',
  ],
  sections: [
    { heading: '1. Who this is between', paragraphs: [
      'This agreement is between Health Identity Directory, which runs Health ID, and the facility you register. The person who signs it must be allowed to act for that facility.',
    ] },
    { heading: '2. What Health ID gives you', paragraphs: [
      'A way to find a patient by their Health ID, ask to see their records, add to them, and send orders to other places, for as long as your facility uses Health ID.',
    ] },
    { heading: '3. Patient consent comes first', bullets: [
      'Open a patient’s records only to care for them.',
      'Ask the patient first, and see only what they said yes to, for as long as they allow.',
      'In a real emergency you may open emergency information without asking. You must give the reason, and the patient is told.',
      'Never refuse care because a patient says no.',
    ] },
    { heading: '4. Your staff', bullets: [
      'Each staff member has their own sign-in. Never share one.',
      'Give each person only the access their job needs.',
      'Keep sign-in codes on for everyone.',
      'Remove a person’s access the day they leave.',
      'You are responsible for what your staff do in Health ID.',
    ] },
    { heading: '5. Keeping information safe', paragraphs: [
      'Keep patient information private and safe, on screen, on paper and on your devices. If something goes wrong, or you think it might have, tell us at once.',
    ] },
    { heading: '6. Records you add', paragraphs: [
      'Make sure what you add is accurate. A correction keeps the earlier version, so anyone can see what changed and when.',
    ] },
    { heading: '7. Payments', paragraphs: [
      'Health ID records payments you take. It does not move money.',
    ] },
    { heading: '8. Checks and audit', paragraphs: [
      'We check that your facility is real before it gets full access. We record every time someone opens a patient’s records, and we may review how your facility uses Health ID.',
    ] },
    { heading: '9. Your subscription', paragraphs: [
      'Your plan and its price are shown before you pay. You can see your bills in Health ID.',
    ] },
    { heading: '10. Stopping or suspending access', paragraphs: [
      'You can stop using Health ID at any time. We may suspend or stop your access if patients’ records are at risk or this agreement is broken. Patients keep their records either way.',
    ] },
    { heading: '11. Changes', paragraphs: [
      'If we change this agreement, we tell you what changed in plain words and ask you to agree again.',
    ] },
    { heading: '12. Law and contact', paragraphs: [
      'This agreement follows the laws of Nigeria, including the Nigeria Data Protection Act 2023. You can reach us through Help in Health ID.',
    ] },
  ],
}

/** The one box a facility ticks, naming the facility once it is known. */
export const facilityAgreeLabel = (facilityName: string | null | undefined) =>
  `I agree to this for ${facilityName?.trim() || 'this facility'}, and I’m allowed to sign for it`
