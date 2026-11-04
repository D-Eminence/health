/**
 * A paper reading as the OCR worker writes it (contract 'hid-paper-reading-v2'), for the Migrate tests. Fictional
 * patient and records only.
 */
const box = { left: 0.1, top: 0.1, width: 0.5, height: 0.05 }

function base(id: string, page: number, line: number) {
  return { id, dateAsWritten: null, page, lineIds: [`p${page}-l${line}`], box, confidence: 'clear', checkReasons: [] as string[],
    checkReason: null as string | null, readBy: 'first_pass', prescription: null as unknown }
}

const careful = (reason: string, code = 'handwriting') => ({ confidence: 'check_carefully', checkReasons: [code], checkReason: reason })

export function paperReading(overrides: Record<string, unknown> = {}) {
  const items = [
    { ...base('it-00000000000000a1', 1, 3), kind: 'medicine', asWritten: 'Amlodipine 5mg od x 30/7', plain: 'Amlodipine',
      fields: { name: 'Amlodipine', strength: '5 mg', form: 'tablet', route: 'by mouth', frequency: 'once a day', duration: '30 days', status: 'current' },
      prescription: { prescriberAsWritten: 'Dr Ade Fictional', dateAsWritten: '02/03/2025' } },
    { ...base('it-00000000000000a2', 1, 4), ...careful('The handwriting was hard to read.'), kind: 'medicine', asWritten: 'Metf?rmin 500 bd',
      plain: 'Metformin', fields: { name: 'Metformin', strength: '500 mg', form: null, route: null, frequency: 'twice a day', duration: null, status: 'new' } },
    { ...base('it-00000000000000b1', 1, 5), kind: 'diagnosis', asWritten: 'HTN', plain: 'High blood pressure',
      fields: { name: 'Hypertension', status: 'confirmed' } },
    { ...base('it-00000000000000c1', 2, 1), ...careful('A dose on the paper doesn\'t match what was read.', 'ai_unsure'), kind: 'allergy',
      asWritten: 'Allergic to penicillin - rash', plain: 'Penicillin allergy',
      fields: { substance: 'Penicillin', reaction: 'rash', severity: 'moderate', noKnownAllergies: false } },
    { ...base('it-00000000000000d1', 2, 2), kind: 'lab_result', asWritten: 'Hb 11.2 g/dL', plain: 'Haemoglobin',
      fields: { test: 'Haemoglobin', value: '11.2', unit: 'g/dL', referenceRange: '12-16', flag: 'low' }, dateAsWritten: '01/03/2025' },
    { ...base('it-00000000000000e1', 2, 3), kind: 'vital', asWritten: 'BP 150/95', plain: 'Blood pressure 150/95',
      fields: { measure: 'blood_pressure', value: '150/95', unit: 'mmHg' } },
    { ...base('it-00000000000000f1', 2, 4), kind: 'note', asWritten: 'Review in 2 weeks', plain: 'Come back in two weeks',
      fields: { text: 'Review in 2 weeks' } },
  ]
  return {
    contract: 'hid-paper-reading-v2',
    pages: [
      { page: 1, flagged: false, flagReasons: [], lines: [1, 2, 3, 4, 5].map(n => ({ id: `p1-l${n}`, text: `line ${n}`, box, confidence: 0.98, handwritten: false })) },
      { page: 2, flagged: false, flagReasons: [], lines: [1, 2, 3, 4].map(n => ({ id: `p2-l${n}`, text: `line ${n}`, box, confidence: 0.97, handwritten: false })) },
    ],
    identity: { nameAsWritten: 'Bisi Fictional', dateOfBirthAsWritten: '14/07/1980', folderNumberAsWritten: 'F-0042', sexAsWritten: 'F',
      lineIds: ['p1-l1', 'p1-l2'], box },
    items,
    reading: { status: 'read', firstPassModel: 'first', rereadModel: null, rereadPages: [], droppedUngrounded: 0, itemCount: items.length,
      promptVersion: 'p1', schemaVersion: 'hid-paper-reading-schema-2' },
    ...overrides,
  }
}

/** A reading whose items were not picked out, for each reason. */
export function unreadPaper(status: string) {
  const payload = paperReading()
  return { ...payload, items: [], reading: { ...payload.reading, status, itemCount: 0 } }
}
