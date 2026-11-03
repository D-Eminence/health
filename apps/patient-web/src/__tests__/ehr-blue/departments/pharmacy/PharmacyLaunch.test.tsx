import { describe, expect, it } from 'vitest'
import { drugOf } from '../../../../ehr-blue/departments/pharmacy/drugForm'

/**
 * Pharmacy launch readiness: what the pharmacist picks from is never misread. Kept apart from Pharmacy.test.tsx and
 * PharmacyDetails.test.tsx, which other open work changes. Every medicine, person and facility here is fictional.
 */

describe('a medicine with more than one strength', () => {
  it('is never split, so each strength stays beside the part it belongs to', () => {
    for (const display of ['Amoxicillin/Clavulanic acid 875 mg/125 mg film-coated tablets', 'Co-trimoxazole 800 mg/160 mg tablets',
      'Lisinopril 10 mg and hydrochlorothiazide 12.5 mg tablets', 'Ferrous sulphate 200 mg + folic acid 0.4 mg tablets'])
      expect(drugOf({ medication: { display }, doseUnit: 'tablet', routeCode: 'oral' })).toMatchObject({ name: display, strength: null })
    // One strength, with or without a volume, is still split as before.
    expect(drugOf({ medication: { display: 'Paracetamol 120 mg/5 ml syrup' }, doseUnit: 'ml', routeCode: 'oral' }))
      .toMatchObject({ name: 'Paracetamol syrup', strength: '120 mg/5 ml' })
    expect(drugOf({ medication: { display: 'Artemether/Lumefantrine 80/480 mg' }, doseUnit: 'tablet', routeCode: 'oral' }))
      .toMatchObject({ name: 'Artemether/Lumefantrine', strength: '80/480 mg' })
  })
})
