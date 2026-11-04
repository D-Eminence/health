/**
 * The blue EHR's own page addresses a staff sign-in may return to (staff/session.ts staffReturnPath), matched exactly as
 * today's are: a page's address, never a record below it, and never a query. The addresses of today's pages (the live
 * stand-ins, the Overview, Novu's Staff pages) are today's list's to name. Every sample workspace opens only at the demo
 * facilities (frame/pageAccess.ts pageShownHere), yet the sample workspaces stay on this list on purpose: a demo
 * facility returns to them, and a real facility signing in again gets the same demo-only words on the page it left. The
 * pages marked demoOnly in frame/pages.ts (the design review pages, the sample Facility settings and Reports &
 * Analytics) are left out. Kept outside the blue EHR's lazy chunk: the sign-in page reads it before the blue EHR loads.
 * A test keeps it equal to the pages the blue EHR serves.
 */
export const BLUE_RETURN_PATHS: readonly string[] = [
  '/provider/appointments', '/provider/journey', '/provider/triage', '/provider/inpatient', '/provider/wards',
  '/provider/nursing', '/provider/emergency', '/provider/maternity', '/provider/surgery', '/provider/icu',
  '/provider/dental', '/provider/nursing-tasks', '/provider/radiology', '/provider/pharmacy/sell',
  '/provider/pharmacy/prescriptions', '/provider/pharmacy/sales', '/provider/pharmacy/stock',
  '/provider/pharmacy/products', '/provider/pharmacy/till', '/provider/pharmacy/settings', '/provider/patient-billing',
  '/provider/insurance', '/provider/policies', '/provider/payments', '/provider/price-list', '/provider/end-of-day',
  '/provider/payment-setup', '/provider/referrals', '/provider/ambulance', '/provider/bloodbank',
  '/provider/telemedicine', '/provider/shifts', '/provider/hr', '/provider/quality', '/provider/services',
  '/provider/ward-config', '/provider/vehicles', '/provider/facility', '/provider/onboarding',
  '/provider/supply', '/provider/procurement', '/provider/institutions',
  '/provider/laboratory/new', '/provider/laboratory/work', '/provider/laboratory/results',
  '/provider/laboratory/tests', '/provider/laboratory/till', '/provider/laboratory/settings',
  '/provider/laboratory/new-walk-in',
]
