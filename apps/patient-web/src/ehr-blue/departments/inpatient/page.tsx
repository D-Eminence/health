import { ClinicalIcon } from '../../clinical/parts/icons'
import type { EhrBluePage } from '../types'
import { InpatientPage, InpatientUnavailable } from './Inpatient'
import {
  ICU_TITLE, INPATIENT_TITLE, WARDS_TITLE, WARD_CONFIG_TITLE, WARD_MANAGE, WARD_READ, inpatientServed, subscribeInpatientServed,
} from './inpatientRules'
import { WardConfig, WardConfigUnavailable } from './WardConfig'
import { WardsAndBeds, WardsAndBedsUnavailable } from './WardsAndBeds'

/*
 * Inpatient admission, wards and beds (hid-system ADT-1, 0170-0173), in place of Akos's four samples at the same
 * addresses (clinical/pages.ts "inpatient", "wards", "icu" and "ward-config"), under "Wards & units" and Settings as the
 * design draws them. The backend's codes decide who sees each (0173): nurses, clinicians and doctors hold ehr.ward.read
 * (Inpatient / Wards, Wards & Beds and ICU); admins and owners hold ehr.ward.manage (Ward configuration). A member
 * without the code is told who can use the page (`refusal`), which reads nothing.
 *
 * Partial, not live: the routes are proposed (built on hid-system claude/sprint-inpatient-backend, hid-system#343), and
 * production keeps them switched off (INPATIENT_ENABLED) until the clinical lead's checklist and the owner's go-live
 * (Q160 A). Once a read answers 404 (an ehr-api before 0170) or 503 INPATIENT_NOT_AVAILABLE, the sidebar stops listing
 * them for the page's life; their addresses still open and say "Inpatient care is not switched on yet."
 */
const listed = () => inpatientServed() !== false

export const inpatientPages: EhrBluePage[] = [
  {
    path: 'inpatient/*', group: 'Clinical', label: INPATIENT_TITLE, permission: WARD_READ, status: 'partial', keepsState: true,
    icon: <ClinicalIcon name="bed" size={18} />, element: <InpatientPage />, refusal: <InpatientUnavailable />,
    listed, listedChanges: subscribeInpatientServed,
  },
  {
    path: 'wards/*', group: 'Clinical', label: WARDS_TITLE, permission: WARD_READ, status: 'partial', keepsState: true,
    icon: <ClinicalIcon name="ward" size={18} />, element: <WardsAndBeds />, refusal: <WardsAndBedsUnavailable />,
    listed, listedChanges: subscribeInpatientServed,
  },
  {
    // ICU is a ward type inside Inpatient (Q201 A): the same admissions and drawers, for ICU wards only.
    path: 'icu/*', group: 'Clinical', label: ICU_TITLE, permission: WARD_READ, status: 'partial', keepsState: true,
    icon: <ClinicalIcon name="monitor" size={18} />, element: <InpatientPage icu />, refusal: <InpatientUnavailable icu />,
    listed, listedChanges: subscribeInpatientServed,
  },
  {
    path: 'ward-config/*', group: 'Settings', label: WARD_CONFIG_TITLE, permission: WARD_MANAGE, status: 'partial',
    icon: <ClinicalIcon name="wardSettings" size={18} />, element: <WardConfig />, refusal: <WardConfigUnavailable />,
    listed, listedChanges: subscribeInpatientServed,
  },
]
