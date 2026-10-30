/**
 * The blue EHR's own page addresses a staff sign-in may return to (staff/session.ts staffReturnPath), matched exactly as
 * today's are: a page's address, never a record below it, and never a query. The addresses of today's pages (the live
 * stand-ins, the Overview, Novu's Staff pages) are today's list's to name. Kept outside the blue EHR's lazy chunk:
 * the sign-in page reads it before the blue EHR loads. A test keeps it equal to the pages the blue EHR serves.
 */
export const BLUE_RETURN_PATHS: readonly string[] = [
  '/provider/appointments', '/provider/journey', '/provider/triage', '/provider/inpatient', '/provider/wards',
  '/provider/nursing', '/provider/emergency', '/provider/maternity', '/provider/surgery', '/provider/icu',
  '/provider/dental', '/provider/nursing-tasks', '/provider/radiology', '/provider/patient-billing',
  '/provider/insurance', '/provider/policies', '/provider/referrals', '/provider/ambulance', '/provider/bloodbank',
  '/provider/telemedicine', '/provider/shifts', '/provider/hr', '/provider/quality', '/provider/platform',
  '/provider/services', '/provider/ward-config', '/provider/vehicles', '/provider/facility', '/provider/setup',
  '/provider/supply', '/provider/procurement', '/provider/reports', '/provider/institutions', '/provider/whats-left',
  '/provider/tour', '/provider/tour/register-and-launch', '/provider/tour/sign-in', '/provider/tour/forgot-password',
  '/provider/tour/staff-invitation', '/provider/tour/subscription',
]
