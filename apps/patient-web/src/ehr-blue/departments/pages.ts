import type { EhrBluePage } from './types'
import { labWalkInPage, laboratoryPage } from './laboratory/page'
import { newSalePage, pharmacyPage, stockPage } from './pharmacy/page'
import { migratePage } from './migrate/page'
import { outreachPage } from './outreach/page'
import { staffAccessPage } from './staff/page'
import { auditPage } from './audit/page'
import { facilityPage } from './facility/page'
import { hrPage } from './hr/page'
import { commercePages } from './commerce/page'
import { samplePages } from './sample/pages'
import './departments.css'

// The blue Hospital EHR's department and admin pages, for the frame's sidebar and router (it finds this module by
// globbing each ehr-blue folder for pages.ts). Each page says whether it is live on today's API, partly sample, or
// sample only, so the frame can list what is left.
export const pages: EhrBluePage[] = [
  laboratoryPage,
  labWalkInPage,
  pharmacyPage,
  newSalePage,
  stockPage,
  migratePage,
  outreachPage,
  staffAccessPage,
  auditPage,
  facilityPage,
  hrPage,
  ...commercePages,
  ...samplePages,
]
