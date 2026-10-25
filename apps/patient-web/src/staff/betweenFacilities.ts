/**
 * What a stand-alone laboratory's or pharmacy's workspace receives on Health ID today (P4b). Novu sends a lab request
 * or a prescription only to the facility where it was written, and only doctors and clinicians write prescriptions, so
 * a laboratory sees only the tests ordered at it, and a pharmacy's work list stays empty. One message per case, used
 * wherever the portal says so (the sign-up page, the Laboratory and Pharmacy pages): change them here, and only here,
 * when orders reach other facilities (cross-facility orders, P4c).
 */
export const BETWEEN_FACILITIES = {
  laboratory: {
    /** On the sign-up page, for a laboratory. */
    signUp: 'Health ID does not yet send test orders between facilities, so orders from hospitals and clinics can’t '
      + 'reach your Laboratory workspace yet: it shows the tests ordered at your own laboratory.',
    /** On the Laboratory page of a laboratory that signed itself up. */
    workspace: (facility: string) => `Lab work arrives here from tests ordered at ${facility}: a receptionist opens the `
      + 'patient’s visit, and a laboratory scientist orders the test. Health ID does not yet send test orders from other '
      + 'hospitals or clinics.',
  },
  pharmacy: {
    /** On the sign-up page, for a pharmacy. */
    signUp: 'Health ID does not yet send prescriptions between facilities, so prescriptions from hospitals and clinics '
      + 'can’t reach your Pharmacy workspace yet.',
    /** On the Pharmacy page of a pharmacy that signed itself up. */
    workspace: (facility: string) => `Prescriptions written at ${facility} appear here. Health ID does not yet send `
      + 'prescriptions from hospitals and clinics to pharmacies, so this list stays empty for now.',
  },
} as const
