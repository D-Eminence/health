import { PATIENT_TERMS } from './patientTerms'
import type { AgreementDocument } from './types'

/*
 * LEGAL REVIEW REQUIRED BEFORE RELEASE. The consent to keep and share health records, recorded on its own (health
 * information is special personal data under the NDPA 2023, so it is asked separately from the terms of use). Its text
 * is the terms' own sections about health records, kept in one place (patientTerms.ts) so each thing is said once.
 * Legal must approve it before it is shown to the public; a change of words is a new `version`.
 */
const about = (prefix: string) => PATIENT_TERMS.sections.find(section => section.heading.startsWith(prefix))!

export const HEALTH_DATA: AgreementDocument = {
  id: 'health-data',
  version: '1.0',
  date: '2026-11-01',
  title: 'Keeping and sharing your health records',
  lead: 'Health ID keeps your health records and shares them only as you choose.',
  short: PATIENT_TERMS.short.slice(1, 4),
  sections: ['2.', '3.', '4.', '5.', '6.', '9.'].map(about),
}
