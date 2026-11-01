import { createElement } from 'react'
import { EhrIcon, type EhrIconName } from '@hid/ui/ehr'
import { isDemoFacility } from '../blueFacilities'
import type { StaffSession } from '../../staff/api'
import type { EhrBluePage, EhrBluePageStatus } from './types'
import { LivePage, StaffAccessPage } from './LivePages'
import { SampleWorkspace } from './sample/SampleWorkspace'
import { FacilityProfileSample, FacilitySetupSample, PlatformReviewSample, ReportsSample } from './admin/AdminSamples'
import { WhatsLeft } from './WhatsLeft'
import { FacilitySubscriptionPage } from './BlueSubscription'
import { ChooseWorkspacePage } from './ChooseWorkspace'
import { DesignTourIndex, JourneyTour } from './tour/DesignTour'
import { JOURNEYS } from './tour/journeys'

/**
 * The design's whole registry (design/ehr-target src/navigation.ts and screens/), in its sidebar order and groups, with
 * what each workspace is today:
 * - a workspace today's provider portal serves shows today's page (`live`), under the facility permission that page
 *   needs, at today's address, so each product host still opens its own page;
 * - every other workspace is a sample built from the design's definition.
 * Pages in other folders (clinical/, departments/, home/) replace these stand-ins by exporting the same path.
 */

const icon = (name: EhrIconName) => createElement(EhrIcon, { name })

const todayPaths: string[] = []
const todayPages = new Set<EhrBluePage>()

/** A stand-in for today's page at its address: today's page itself, unless `element` draws it in the design. */
function live(path: string, group: string, label: string, iconName: EhrIconName, permission: string,
  element: EhrBluePage['element'] = createElement(LivePage)): EhrBluePage {
  todayPaths.push(path)
  const entry: EhrBluePage = { path, group, label, icon: icon(iconName), permission, status: 'live', element }
  todayPages.add(entry)
  return entry
}

function sample(id: string, group: string, label: string, iconName: EhrIconName, path = `${id}/*`): EhrBluePage {
  return { path, group, label, icon: icon(iconName), status: 'sample', element: createElement(SampleWorkspace, { moduleId: id }) }
}

function page(path: string, group: string, label: string, iconName: EhrIconName, status: EhrBluePageStatus,
  element: EhrBluePage['element'], permission?: string): EhrBluePage {
  return { path, group, label, icon: icon(iconName), status, element, ...(permission ? { permission } : {}) }
}

/**
 * A page for reviewing the design (the checklist, the tour, Health ID's own facility review): only at the four demo
 * facilities. A clinic switches facility from the account menu, as today.
 */
function demoOnly(entry: EhrBluePage): EhrBluePage {
  return { ...entry, visible: atDemoFacility }
}

const atDemoFacility = (session: StaffSession) => isDemoFacility(session.actor.facility?.id)

export const pages: EhrBluePage[] = [
  // Replaced by home/pages.ts.
  page('', '', 'Home', 'home', 'sample', createElement(SampleWorkspace, { moduleId: 'patients' })),

  live('patients', 'Clinical', 'Patients', 'user', 'identity.patient.read'),
  live('registration', 'Clinical', 'Patient registration', 'registration', 'identity.registration.write'),
  live('in-person-check', 'Clinical', 'In-person check', 'badge', 'identity.patient.assisted_registration'),
  sample('appointments', 'Clinical', 'Appointments', 'calendar'),
  sample('journey', 'Clinical', 'Patient visits', 'route'),
  sample('triage', 'Clinical', 'Triage & Vitals', 'activity'),
  live('clinical', 'Clinical', 'Consultation', 'stethoscope', 'ehr.encounter.read'),
  sample('inpatient', 'Clinical', 'Inpatient / Wards', 'bed'),
  sample('wards', 'Clinical', 'Wards & Beds', 'ward'),
  sample('nursing', 'Clinical', 'Nursing observations', 'notes'),
  sample('emergency', 'Clinical', 'Emergency', 'alert'),
  sample('maternity', 'Clinical', 'Maternity', 'heart'),
  sample('surgery', 'Clinical', 'Theatre & Procedures', 'scissors'),
  sample('icu', 'Clinical', 'ICU', 'monitor'),
  sample('dental', 'Clinical', 'Dental', 'tooth'),
  live('requests', 'Clinical', 'Access requests', 'lock', 'identity.consent.write'),
  sample('nursing-tasks', 'Clinical', 'Nursing tasks', 'check'),

  live('laboratory', 'Diagnostics', 'Laboratory', 'flask', 'lab.work-item.read'),
  sample('radiology', 'Diagnostics', 'Radiology', 'scan'),
  live('pharmacy', 'Diagnostics', 'Pharmacy', 'pill', 'pharmacy.work-item.read'),

  sample('billing', 'Finance', 'Patient billing', 'receipt', 'patient-billing/*'),
  { ...sample('insurance', 'Finance', 'Insurance & Claims', 'shield'), tabLabel: 'Claims' },
  { ...sample('policies', 'Finance', 'Policies', 'shield'), tabOf: 'insurance' },

  sample('referrals', 'Network & Services', 'Referral Network', 'share'),
  sample('ambulance', 'Network & Services', 'Dispatch', 'truck'),
  sample('bloodbank', 'Network & Services', 'Blood Bank', 'droplet'),
  sample('telemedicine', 'Network & Services', 'Telemedicine', 'video'),
  live('ocr', 'Network & Services', 'Document OCR', 'document', 'ocr.job.read'),
  live('outreach', 'Network & Services', 'Outreach', 'outreach', 'outreach.registration.read'),

  sample('shifts', 'People', 'Shifts & Roster', 'clock'),
  sample('hr', 'People', 'HR & Credentials', 'badge'),
  page('staff', 'People', 'Staff & access', 'users', 'partial', createElement(StaffAccessPage), 'workforce.manage'),

  sample('quality', 'Administration', 'Quality & Safety', 'flag'),
  // A sample, so the design's roles decide (sampleAccess.ts): Platform Super Admin only.
  demoOnly(page('platform', 'Administration', 'Facility review', 'review', 'sample', createElement(PlatformReviewSample))),

  sample('services', 'Settings', 'Service catalogue', 'tag'),
  sample('ward-config', 'Settings', 'Ward configuration', 'wardSettings'),
  sample('vehicles', 'Settings', 'Vehicle configuration', 'vehicleSettings'),
  page('facility', 'Settings', 'Facility profile', 'building', 'sample', createElement(FacilityProfileSample)),
  page('setup', 'Settings', 'Facility settings', 'edit', 'sample', createElement(FacilitySetupSample)),
  live('billing', 'Settings', 'Facility subscription', 'subscription', 'billing.subscription.read', createElement(FacilitySubscriptionPage)),

  { ...sample('inventory', 'Supply', 'Supply', 'box', 'supply/*'), tabLabel: 'Stock' },
  { ...sample('procurement', 'Supply', 'Procurement', 'box'), tabOf: 'supply' },

  page('reports', 'Insight', 'Reports & Analytics', 'chart', 'sample', createElement(ReportsSample)),
  live('audit', 'Insight', 'Audit & Compliance', 'history', 'audit.read'),

  // Listed only at the demo facilities; everywhere, the account menu's Switch facility opens it.
  demoOnly(page('whats-left', 'Design review', 'What’s left', 'checklist', 'live', createElement(WhatsLeft))),

  // The live facility switch (the account menu's Switch facility), beside Home: listed for whoever has more than one
  // facility to choose from, as Switch facility is.
  { ...page('institutions', '', 'Choose workspace', 'building', 'live', createElement(ChooseWorkspacePage)),
    listed: session => session.actor.facilities.length > 1 },

  // The design's journeys, as an interactive tour: samples, asking for no password and sending nothing.
  demoOnly(page('tour', 'Design tour', 'Design tour', 'tour', 'sample', createElement(DesignTourIndex))),
  ...JOURNEYS.map(journey => demoOnly(page(`tour/${journey.id}/*`, 'Design tour', journey.title, 'route', 'sample',
    createElement(JourneyTour, { journeyId: journey.id })))),
]

/**
 * The addresses today's provider portal serves, where these live stand-ins show today's page (a clinical or department
 * page that replaces one keeps its address).
 */
export const TODAY_PATHS: ReadonlySet<string> = new Set(todayPaths)

/**
 * The frame's stand-ins for today's pages, as entries: one opened without its permission is left to refuse in today's
 * words. A page another folder exports in its place is not one of these.
 */
export const TODAY_PAGES: ReadonlySet<EhrBluePage> = todayPages
