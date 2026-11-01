import { fireEvent, screen } from '@testing-library/react'

/** The two required boxes of a patient's last sign-up step (agreements/patientConsent.tsx); email updates is left as it is. */
export const REQUIRED_CONSENTS = ['I agree to the Terms of use',
  'I agree to Health ID keeping my health records and sharing them only as I choose'] as const

/** Ticks the required boxes that are not ticked yet, as a patient does before creating their Health ID. */
export function agreeToTerms() {
  for (const name of REQUIRED_CONSENTS) {
    const box = screen.getByRole('checkbox', { name }) as HTMLInputElement
    if (!box.checked) fireEvent.click(box)
  }
}
