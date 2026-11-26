import { Route, Routes } from 'react-router-dom'
import { isDemoFacility } from '../../blueFacilities'
import { useSampleCan } from '../../frame/sampleAccess'
import { Banner } from '../parts/Notices'
import { ChartProvider } from '../parts/chart'
import { Workspace, useClinical } from '../parts/Workspace'
import { SampleWorkspace } from '../sample/SampleWorkspace'
import { DentalHome } from './DentalHome'
import { DentalVisitPage } from './DentalVisit'
import { DENTISTS_ONLY, NOT_AVAILABLE, NOT_AVAILABLE_DETAIL, TITLE, canReadDental, useDentalServed } from './dentalRules'
import './dental.css'

/**
 * The Dental page (hid-system DEN-1): two pages at one address, decided by the member's own codes.
 *
 * - A dentist (ehr.dental.read, 0194; Q-DEN-1 A: no one else) gets the live dental clinic: today's dental visits and the
 *   open patient's visit (DentalHome), and one visit's dental record (DentalVisitPage, `:encounterId`, a UUID; never a
 *   Health ID in the address).
 * - Anyone else gets today's sample at the four demo facilities, under its banner, sending nothing, for the design roles
 *   that opened it before (sampleAccess.ts), until the dental clinic ships; elsewhere the page says who uses it.
 *
 * While the dental clinic is switched off (DENTAL_ENABLED, or an ehr-api before DEN-1: a read answers 503
 * DENTAL_NOT_AVAILABLE or 404), a dentist is told so, in place of the page, and at a demo facility sees the sample
 * below it: never a broken screen.
 */
export function DentalWorkspace() {
  const { permissions, facility } = useClinical()
  const served = useDentalServed()
  const sampleCan = useSampleCan()
  const demo = isDemoFacility(facility?.id)
  if (!canReadDental(permissions)) {
    return demo && sampleCan('dental') ? <SampleWorkspace id="dental" /> : <DentalRefusal />
  }
  if (served === false) {
    return demo ? (
      <>
        <div className="hid-ehr-clinical-page hid-ehr-dental-off"><DentalNotSwitchedOn /></div>
        <SampleWorkspace id="dental" />
      </>
    ) : <Workspace path="dental" title={TITLE}><DentalNotSwitchedOn /></Workspace>
  }
  return (
    <Workspace path="dental" title={TITLE}>
      <ChartProvider>
        <Routes>
          <Route index element={<DentalHome />} />
          <Route path=":encounterId" element={<DentalVisitPage />} />
        </Routes>
      </ChartProvider>
    </Workspace>
  )
}

/** The dental clinic is switched off here: said once, plainly, with what to do instead. Reads nothing. */
export function DentalNotSwitchedOn() {
  return <Banner title={NOT_AVAILABLE}>{NOT_AVAILABLE_DETAIL}</Banner>
}

/** The page's own words where it is not open to this member (Q-DEN-1 A: dentists only). Reads nothing. */
export function DentalRefusal() {
  return (
    <div className="hid-ehr-clinical-page hid-ehr-dental-refusal">
      <Banner title="Dental">{DENTISTS_ONLY} Doctors and nurses still see a dental visit’s notes, diagnoses and prescriptions in Consultation.</Banner>
    </div>
  )
}
