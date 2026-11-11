import { getEnvironment } from './env'

/** Health ID support's address, as published on the sign-in page: used where the build names none. */
export const SUPPORT_EMAIL = 'support@healthidentitydirectory.com'

/**
 * Where a patient contacts Health ID support from a page (a `mailto:` or web address): the build's own contact
 * (VITE_HID_SUPPORT_CONTACT), else the published support address.
 */
export function supportHref(): string {
  try {
    const contact = getEnvironment().supportContact
    if (contact) return contact
  } catch { /* a configuration problem is reported where the API is used */ }
  return `mailto:${SUPPORT_EMAIL}`
}
