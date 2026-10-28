/**
 * hid-1.0 served its patient pages on the public site's host (healthidentitydirectory.com/patient and the rest):
 * those bookmarks and links open the patient portal's page that replaces each. The portal maps the same paths
 * for links to its own host (apps/patient-web/src/legacyPaths.ts), where its pages already answer /records.
 */
export const LEGACY_PATIENT_PATHS = Object.freeze({
  '/patient': '/',
  '/patient/profile': '/profile',
  '/patient/biodata': '/profile',
  '/patient/records': '/records',
  // hid-1.0's short link to /patient/records, which the public host would otherwise answer with its 404.
  '/records': '/records',
  '/patient/history': '/access',
  '/logs': '/access',
  '/patient/notifications': '/notifications',
  '/patient/auth': '/sign-in',
  '/login': '/sign-in',
  '/signin': '/sign-in',
  '/signup': '/enroll',
  '/register': '/enroll',
})

/** The portal path for one of hid-1.0's addresses, in any case and with or without a trailing slash; null otherwise. */
export function legacyPatientPath(pathname) {
  const path = (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname).toLowerCase()
  return Object.hasOwn(LEGACY_PATIENT_PATHS, path) ? LEGACY_PATIENT_PATHS[path] : null
}
