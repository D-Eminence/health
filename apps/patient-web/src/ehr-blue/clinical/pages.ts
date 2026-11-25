import { createElement } from 'react'
import { ConsentRefusal } from './consent/ConsentRefusal'
import { ConsentWorkspace, consentStatus } from './consent/ConsentWorkspace'
import { ConsultWorkspace, consultStatus } from './consult/ConsultWorkspace'
import { EmergencyWorkspace, emergencyStatus } from './emergency/EmergencyWorkspace'
import { OrderedByMe, OrderedByMeUnavailable } from './mine/OrderedByMe'
import { LAB_READ, PRESCRIPTION_READ, TITLE as ORDERED_BY_ME } from './mine/myOrders'
import { NursingWorkspace, nursingStatus } from './nursing/NursingWorkspace'
import { ClinicalIcon, type ClinicalIconName } from './parts/icons'
import { PatientsWorkspace, patientsStatus } from './patients/PatientsWorkspace'
import { SampleWorkspace } from './sample/SampleWorkspace'
import { TriageWorkspace, triageStatus } from './triage/TriageWorkspace'
import type { EhrBluePage } from './types'

const icon = (name: ClinicalIconName) => createElement(ClinicalIcon, { name, size: 18 })
const sample = (id: string) => createElement(SampleWorkspace, { id })

/**
 * The clinical pages of the blue Health ID Hospital EHR, in the design's sidebar order. Each path is the frame's own
 * stand-in path for the workspace (under /provider, taking every address below it), so each page replaces its stand-in
 * in place; Consultation and External record access keep today's addresses (clinical, requests). Groups and labels are
 * the design's; a permission is the one today's page for the same work checks. Sample pages have no permission: they
 * call nothing and save nothing. Access requests opened without its permission says why in today's words (ConsentRefusal).
 */
export const pages: EhrBluePage[] = [
  { path: 'patients/*', group: 'Clinical', label: 'Patients', icon: icon('user'), permission: 'identity.patient.read', status: patientsStatus, element: createElement(PatientsWorkspace) },
  { path: 'appointments/*', group: 'Clinical', label: 'Appointments', icon: icon('calendar'), status: 'sample', element: sample('appointments') },
  { path: 'journey/*', group: 'Clinical', label: 'Patient visits', icon: icon('route'), status: 'sample', element: sample('journey') },
  { path: 'triage/*', group: 'Clinical', label: 'Triage & Vitals', icon: icon('activity'), permission: 'ehr.vital.read', status: triageStatus, element: createElement(TriageWorkspace) },
  { path: 'clinical/*', group: 'Clinical', label: 'Consultation', icon: icon('stethoscope'), permission: 'ehr.encounter.read', status: consultStatus, element: createElement(ConsultWorkspace) },
  // "Ordered by me" (hid-system 0143, MY-1) under Care, beside Consultation: either kind's read permission opens it, as
  // the backend lists whichever kinds the member holds. Live since Release C (d519e5d1).
  { path: 'ordered-by-me', group: 'Clinical', label: ORDERED_BY_ME, icon: icon('clipboard'), permission: LAB_READ, orPermissions: [PRESCRIPTION_READ],
    status: 'live', element: createElement(OrderedByMe), refusal: createElement(OrderedByMeUnavailable) },
  { path: 'inpatient/*', group: 'Clinical', label: 'Inpatient / Wards', icon: icon('bed'), status: 'sample', element: sample('inpatient') },
  { path: 'wards/*', group: 'Clinical', label: 'Wards & Beds', icon: icon('ward'), status: 'sample', element: sample('wards') },
  { path: 'nursing/*', group: 'Clinical', label: 'Nursing observations', icon: icon('notes'), permission: 'ehr.note.read', status: nursingStatus, element: createElement(NursingWorkspace) },
  { path: 'maternity/*', group: 'Clinical', label: 'Maternity', icon: icon('heart'), status: 'sample', element: sample('maternity') },
  { path: 'surgery/*', group: 'Clinical', label: 'Theatre & Procedures', icon: icon('scissors'), status: 'sample', element: sample('surgery') },
  { path: 'icu/*', group: 'Clinical', label: 'ICU', icon: icon('monitor'), status: 'sample', element: sample('icu') },
  { path: 'dental/*', group: 'Clinical', label: 'Dental', icon: icon('tooth'), status: 'sample', element: sample('dental') },
  { path: 'requests/*', group: 'Clinical', label: 'Access requests', icon: icon('lock'), permission: 'identity.consent.write', status: consentStatus, element: createElement(ConsentWorkspace),
    refusal: createElement(ConsentRefusal) },
  // Emergency access is about opening a record without consent, so it sits beside Access requests (QA P1-3), not under wards.
  { path: 'emergency/*', group: 'Clinical', label: 'Emergency access', icon: icon('alert'), permission: 'identity.break-glass.write', status: emergencyStatus, element: createElement(EmergencyWorkspace) },
  { path: 'nursing-tasks/*', group: 'Clinical', label: 'Nursing tasks', icon: icon('check'), status: 'sample', element: sample('nursing-tasks') },
  { path: 'radiology/*', group: 'Diagnostics', label: 'Radiology', icon: icon('scan'), status: 'sample', element: sample('radiology') },
  { path: 'referrals/*', group: 'Network & Services', label: 'Referral Network', icon: icon('share'), status: 'sample', element: sample('referrals') },
  { path: 'telemedicine/*', group: 'Network & Services', label: 'Telemedicine', icon: icon('video'), status: 'sample', element: sample('telemedicine') },
  { path: 'bloodbank/*', group: 'Network & Services', label: 'Blood Bank', icon: icon('droplet'), status: 'sample', element: sample('bloodbank') },
  { path: 'ward-config/*', group: 'Settings', label: 'Ward configuration', icon: icon('wardSettings'), status: 'sample', element: sample('ward-config') },
]
