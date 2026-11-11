/**
 * What Document OCR says, on the blue page and today's, when the document or patient ID it was given is not one.
 * OCR takes each only in the form Health ID gives it (a version 4 UUID: hid-system ocr-api, @IsUUID('4')), and no
 * screen names that form. A Health ID (HID-…) is the likeliest thing typed instead, so it gets its own answer.
 */
export function notAnOcrId(what: 'document' | 'patient', value: string): string {
  if (/^\s*HID-/i.test(value)) return what === 'patient' ? 'This needs the patient ID, not their Health ID.' : 'This needs the document ID, not a Health ID.'
  return `That isn’t a ${what} ID. Check it and try again.`
}
