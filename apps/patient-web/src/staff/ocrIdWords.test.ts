import { describe, expect, it } from 'vitest'
import { notAnOcrId } from './ocrIdWords'

describe('what Document OCR says about an ID that is not one', () => {
  it('answers a Health ID on its own, whatever its case and spacing', () => {
    for (const value of ['HID-ABCDEF23', 'hid-zdemaaa2', '  HID-ABCDEF ']) {
      expect(notAnOcrId('patient', value)).toBe('This needs the patient ID, not their Health ID.')
      expect(notAnOcrId('document', value)).toBe('This needs the document ID, not a Health ID.')
    }
  })

  it('says anything else is not that kind of ID', () => {
    for (const value of ['patient-1', 'DOC-2024-0001', 'D0000000-0000-1000-8000-000000000001', 'HID ABCDEF']) {
      expect(notAnOcrId('patient', value)).toBe('That isn’t a patient ID. Check it and try again.')
      expect(notAnOcrId('document', value)).toBe('That isn’t a document ID. Check it and try again.')
    }
  })

  it('never names the form an ID takes', () => {
    for (const what of ['patient', 'document'] as const)
      for (const value of ['HID-ABCDEF23', 'x'])
        expect(notAnOcrId(what, value)).not.toMatch(/uuid|canonical|valid/i)
  })
})
