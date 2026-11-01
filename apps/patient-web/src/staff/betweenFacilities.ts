/**
 * What a stand-alone laboratory's or pharmacy's workspace receives on Health ID (P4b, then P4c). Since P4c a Health ID
 * clinician at another facility can send a lab request or prescription to a laboratory or pharmacy that Health ID
 * support has checked, while orders between facilities are on (the platform control cross_facility_orders_enabled,
 * which Identity's sign-up availability and the Lab and Pharmacy lists report as `crossFacilityOrders`). Only doctors
 * and clinicians write prescriptions, and a stand-alone pharmacy has neither, so its own work comes only from other
 * facilities. One message per case, used wherever the portal says so (the sign-up page, the Laboratory and Pharmacy
 * pages): change them here, and only here.
 *
 * `ordersOn` is what the backend last said; when it said nothing (an earlier backend) orders are taken as off, so the
 * page never promises orders that cannot arrive. Even with orders on, a checked facility is found only while it is
 * listed and its product is active (support may record its check as "Other", or stop listing it). Since item 4
 * (hid-system 0089) the work list says so to a member holding the receive permission (`receives`): with it the workspace
 * says plainly whether clinicians at other facilities can send orders here now, without saying why (owner decision D2);
 * without it (an earlier backend, or a member without the permission) the copy says orders come while it is listed rather
 * than promise them.
 */
export const BETWEEN_FACILITIES = {
  laboratory: {
    /** On the sign-up page, for a laboratory. */
    signUp: (ordersOn: boolean) => ordersOn
      ? 'Once Health ID support has checked your facility, Health ID clinicians at other facilities can send you lab requests.'
      : 'Health ID is not sending test orders between facilities at the moment, so orders from hospitals and clinics '
        + 'can’t reach your Laboratory pages yet: it shows the tests ordered at your own laboratory.',
    /** On the Laboratory page of a laboratory that signed itself up. */
    workspace: (facility: string, ordersOn: boolean, receives?: boolean) => !ordersOn
      ? `Lab work arrives here from tests ordered at ${facility}: a receptionist opens the patient’s visit, and a laboratory `
        + 'scientist orders the test. Health ID is not sending test orders from other hospitals or clinics at the moment.'
      : receives === true
        ? `Lab work arrives from tests ordered at ${facility}, and from Health ID clinicians at other facilities: accept those `
          + 'under Incoming, with the patient in front of you.'
        : receives === false
          ? `Health ID clinicians at other facilities can’t send ${facility} lab requests at the moment. If you expect them, `
            + 'ask Health ID support.'
          : `Lab work arrives from tests ordered at ${facility}, and from Health ID clinicians at other facilities while Health ID `
            + `lists ${facility} for their orders: accept those under Incoming, with the patient in front of you. If none ever `
            + `arrive, ask Health ID support whether ${facility} is listed.`,
  },
  pharmacy: {
    /** On the sign-up page, for a pharmacy. */
    signUp: (ordersOn: boolean) => ordersOn
      ? 'Once Health ID support has checked your facility, Health ID clinicians at other facilities can send you prescriptions.'
      : 'Health ID is not sending prescriptions between facilities at the moment, so prescriptions from hospitals and '
        + 'clinics can’t reach your Pharmacy pages yet.',
    /** On the Pharmacy page of a pharmacy that signed itself up. */
    workspace: (facility: string, ordersOn: boolean, receives?: boolean) => !ordersOn
      ? `Prescriptions written at ${facility} appear here. Health ID is not sending prescriptions from hospitals and `
        + 'clinics to pharmacies at the moment, so this list stays empty for now.'
      : receives === true
        ? `Prescriptions that Health ID clinicians at other facilities send ${facility} appear under Incoming. Accept one when `
          + 'the patient is at your counter: it then moves to the list below for dispensing.'
        : receives === false
          ? `Health ID clinicians at other facilities can’t send ${facility} prescriptions at the moment. If you expect them, `
            + 'ask Health ID support.'
          : `Prescriptions that Health ID clinicians at other facilities send ${facility} appear under Incoming, while Health ID `
            + `lists ${facility} for their orders. Accept one when the patient is at your counter: it then moves to the list below `
            + `for dispensing. If none ever arrive, ask Health ID support whether ${facility} is listed.`,
  },
} as const
