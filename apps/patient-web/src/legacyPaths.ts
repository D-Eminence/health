/**
 * hid-1.0's patient addresses (its src/App.tsx routes), bookmarked and linked to while it ran, and the portal page
 * that replaces each. hid-1.0 served them on the public site's host, whose edge sends them here
 * (infra/cloudflare/src/legacy-patient-redirects.mjs); this is for the same links to the portal's own host.
 */
export const LEGACY_PATIENT_PATHS: Readonly<Record<string, string>> = Object.freeze({
  '/patient': '/',
  '/patient/profile': '/profile',
  '/patient/biodata': '/profile',
  '/patient/records': '/records',
  '/patient/history': '/access',
  '/logs': '/access',
  '/patient/notifications': '/notifications',
  '/patient/auth': '/sign-in',
  '/login': '/sign-in',
  '/signin': '/sign-in',
  '/signup': '/enroll',
  '/register': '/enroll',
})
