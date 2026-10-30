import type { EhrBluePage } from './types'
import { laboratoryPage } from './laboratory/page'
import { pharmacyPage } from './pharmacy/page'
import { migratePage } from './migrate/page'
import { outreachPage } from './outreach/page'
import { staffAccessPage } from './staff/page'
import { auditPage } from './audit/page'
import { facilityPage } from './facility/page'
import { hrPage } from './hr/page'
import { samplePages } from './sample/pages'
import './departments.css'

// The blue Hospital EHR's department and admin pages, for the frame's sidebar and router (it finds this module by
// globbing each ehr-blue folder for pages.ts). Each page says whether it is live on today's API, partly sample, or
// sample only, so the frame can list what is left.
export const pages: EhrBluePage[] = [
  laboratoryPage,
  pharmacyPage,
  migratePage,
  outreachPage,
  staffAccessPage,
  auditPage,
  facilityPage,
  hrPage,
  ...samplePages,
]
