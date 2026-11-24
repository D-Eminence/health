import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EhrPrintHeader } from '@hid/ui/ehr'
import { PrintHeader } from '../../ehr-blue/frame/PrintHeader'
import { DischargeSummaryPaper, LabResultPaper, PrescriptionPaper, shown } from '../../ehr-blue/clinical/parts/clinicalPrint'
import { OutreachSlip } from '../../ehr-blue/departments/outreach/OutreachSlip'
import { Labels, ResultSlip } from '../../ehr-blue/departments/laboratory/labPrint'
import { Receipt } from '../../ehr-blue/departments/commerce/Receipt'
import type { Bill } from '../../ehr-blue/departments/commerce/api'
import { MadeHealthIdPanel } from '../../ehr-blue/departments/pharmacy/newHealthId'

/*
 * Every printed paper carries one shared header: the Health ID logo and the name of the facility it is printed at
 * (owner, 23 Nov 2026), and no web address. Every person, facility and value here is fictional.
 */

vi.mock('../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('./departments/harness')
  return { useStaff: () => staffContext(fakeFacility(['pharmacy.walk-in.create'], { name: 'Demo Pharmacy' })) }
})
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))

const PATIENT = { name: 'Patient One', hid: 'HID-ZDEMAAA2', ageSex: '36 years · Female' }
const DRUG = { key: 'rx-1', medicine: 'Amoxicillin', dose: '500 mg', route: 'By mouth', frequency: 'Three times a day', duration: '7 days', instructions: '' }
/** A web address of any kind: a full URL, www., a path of the site, or a bare domain (app.healthidentitydirectory.com). */
const URL_LIKE = /https?:|www\.|\/provider|\/ehr|localhost|healthidentitydirectory|\.com\b/i

/** The paper's one print header, checked for the logo and the facility's name. */
function expectHeader(root: ParentNode, facility: string) {
  const headers = root.querySelectorAll('[data-print-header]')
  expect(headers).toHaveLength(1)
  const header = headers[0]!
  expect(header.classList).toContain('hid-ehr')
  expect(header.classList).toContain('hid-ehr-print-header')
  const logo = header.querySelector('img')
  expect(logo?.getAttribute('alt')).toBe('Health ID')
  expect(logo?.getAttribute('src')).toMatch(/logo/)
  expect(logo?.classList).toContain('hid-ehr-print-header-mark')
  expect(header.querySelector('.hid-ehr-print-header-facility')?.textContent).toBe(facility)
  return header
}

describe('the shared print header', () => {
  it('draws the logo it is given and the facility, and leaves the name out when it is not known', () => {
    const { container, rerender } = render(<EhrPrintHeader logo={<img className="hid-ehr-print-header-mark" alt="Health ID" src="/logo.png" />} facility="  Demo Hospital " />)
    expectHeader(container, 'Demo Hospital')
    rerender(<EhrPrintHeader logo={<img className="hid-ehr-print-header-mark" alt="Health ID" src="/logo.png" />} facility={null} />)
    expect(container.querySelector('.hid-ehr-print-header-facility')).toBeNull()
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('Health ID')
  })

  it('is off the screen only when asked (a page printed as it is), and stacks for a narrow slip', () => {
    const { container, rerender } = render(<PrintHeader facility="Demo Hospital" />)
    expect(expectHeader(container, 'Demo Hospital').classList).not.toContain('hid-ehr-print-only')
    rerender(<PrintHeader facility="Demo Hospital" printOnly stacked />)
    const header = expectHeader(container, 'Demo Hospital')
    expect(header.classList).toContain('hid-ehr-print-only')
    expect(header.classList).toContain('hid-ehr-print-header-stacked')
  })

  it('uses the same Health ID logo as the sidebar', () => {
    const { container } = render(<PrintHeader facility="Demo Hospital" />)
    expect(container.querySelector('img')?.getAttribute('width')).toBe('890')
  })
})

describe('every printed paper carries it, and no web address', () => {
  it('a prescription', () => {
    const { container } = render(<PrescriptionPaper facility="Demo Hospital" patient={PATIENT} drugs={[DRUG]} prescriber={null} printedAt="23 Nov 2026, 09:00" />)
    expectHeader(container, 'Demo Hospital')
    expect(container.textContent).toContain('Prescription')
    expect(container.textContent).not.toMatch(URL_LIKE)
  })

  it('a discharge summary', () => {
    const { container } = render(<DischargeSummaryPaper summary={{
      facility: 'Demo Hospital', patient: PATIENT, visitType: 'Outpatient', startedAt: '2026-11-22T08:00:00.000Z', status: 'Completed',
      complaint: 'Fever', diagnoses: shown(['Malaria (fictional)']), note: shown(null), tests: shown([]), drugs: shown([DRUG]), held: [],
      clinician: null, printedAt: '23 Nov 2026, 09:00',
    }} />)
    expectHeader(container, 'Demo Hospital')
    expect(container.textContent).toContain('Discharge summary')
    expect(container.textContent).not.toMatch(URL_LIKE)
  })

  it('a lab result from the consultation', () => {
    const { container } = render(<LabResultPaper facility="Demo Hospital" patient={PATIENT} test="Haemoglobin" printedAt="23 Nov 2026, 09:00"
      lines={[{ key: 'r-1', value: '9.8 g/dL', range: '12.0-15.5', flag: 'Low', released: '22 Nov 2026' }]} />)
    expectHeader(container, 'Demo Hospital')
    expect(container.textContent).not.toMatch(URL_LIKE)
  })

  it('the laboratory’s result slip', () => {
    const { container } = render(<ResultSlip facility="Demo Laboratory" name="Patient One" ageSex="36 years · Female" hid="HID-ZDEMAAA2"
      requestNumber="LAB-0001" released="22 Nov 2026" lines={[{ key: 'r-1', test: 'Haemoglobin', value: '9.8', unit: 'g/dL', range: '12.0-15.5', flag: 'low' }]} />)
    expectHeader(container, 'Demo Laboratory')
    expect(container.textContent).not.toMatch(URL_LIKE)
  })

  it('an outreach registration slip', () => {
    const { container } = render(<OutreachSlip groupName="Demo Outreach" item={{
      id: 'case-1', campaignId: 'campaign-1', status: 'completed', fullName: 'Patient One', ageYears: 30, sex: 'female',
      createdAt: '2026-11-14T08:30:00.000Z', rowVersion: 1, healthId: 'HID-ZDEMAAA2', hasScreening: false,
    } as never} campaign={{ name: 'Demo screening day', startsAt: '2026-11-14T07:00:00.000Z', endsAt: '2026-11-14T15:00:00.000Z' }} healthId="HID-ZDEMAAA2" />)
    expectHeader(container, 'Demo Outreach')
    expect(container.textContent).not.toMatch(URL_LIKE)
  })

  it('an outreach registration slip for someone with no Health ID yet: where to get one, with no web address', () => {
    for (const ageYears of [30, 15]) {
      const { container, unmount } = render(<OutreachSlip groupName="Demo Outreach" item={{
        id: 'case-1', campaignId: 'campaign-1', status: 'completed', fullName: 'Patient One', ageYears, sex: 'female',
        createdAt: '2026-11-14T08:30:00.000Z', rowVersion: 1, healthId: null, hasScreening: false,
      } as never} campaign={{ name: 'Demo screening day', startsAt: '2026-11-14T07:00:00.000Z', endsAt: '2026-11-14T15:00:00.000Z' }} healthId={null} />)
      expectHeader(container, 'Demo Outreach')
      expect(container.textContent).toMatch(/Health ID later at any Health ID facility or on the Health ID app\./)
      expect(container.textContent).not.toMatch(URL_LIKE)
      unmount()
    }
  })

  it('a receipt: the header on paper only, the facility’s name on the screen as before', () => {
    const bill: Bill = {
      id: 'bill-1', number: 'B-0001', source: 'pharmacy', status: 'paid', patient: { patientId: 'p-1', displayName: 'Patient One', healthId: 'HID-ZDEMAAA2' },
      lines: [{ id: 'line-1', catalogueItemId: 'item-1', name: 'Paracetamol 500 mg', quantity: 2, unitKobo: 5000, totalKobo: 10000 }],
      totalKobo: 10000, paidKobo: 10000, dueKobo: 0, receiptNumber: 'R-0001', createdAt: '2026-11-23T09:00:00.000Z', version: 1,
      payments: [{ id: 'pay-1', method: 'cash', amountKobo: 10000, receivedBy: 'staff-1', receivedAt: '2026-11-23T09:01:00.000Z', voided: false }],
    }
    const { container } = render(<Receipt bill={bill} facilityName="Demo Pharmacy" />)
    const receipt = container.querySelector('[data-receipt-print]')!
    const header = expectHeader(receipt, 'Demo Pharmacy')
    expect(header.classList).toContain('hid-ehr-print-only')
    expect(header.classList).toContain('hid-ehr-print-header-stacked')
    const onScreen = [...receipt.querySelectorAll('p')].filter(line => line.textContent === 'Demo Pharmacy' && !header.contains(line))
    expect(onScreen).toHaveLength(1)
    expect(onScreen[0]!.className).toContain('print:hidden')
    expect(receipt.textContent).not.toMatch(URL_LIKE)
  })

  it('the slip for a new Health ID, with the signed-in facility', () => {
    const { container } = render(<MadeHealthIdPanel idBase="test" made={{ hid: 'HID-ZDEMAAA2', name: 'Patient One', email: null }} />)
    const slip = container.querySelector('[data-receipt-print]')!
    expectHeader(slip, 'Demo Pharmacy')
    expect(slip.textContent).not.toMatch(URL_LIKE)
  })

  it('but not a sample label: a sticker for a sample tube keeps to who, what and the request number', () => {
    const { container } = render(<Labels labels={[{ key: 'l-1', name: 'Patient One', ageSex: '36 years · Female', test: 'Haemoglobin', requestNumber: 'LAB-0001', date: '23 Nov 2026' }]} />)
    expect(container.querySelector('[data-print-header]')).toBeNull()
  })
})
