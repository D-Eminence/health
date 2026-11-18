import { BookOpen, MessageCircle, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, CardHeader, PageHeader } from '../../kasuwa/ui'
import { useStaff } from '../../staff/App'
import { SupportChatDrawer, supportChatOffered } from './support/BlueSupportChat'

/** One short how-to: who it is for (the permission that does the work), its title and its steps, in the app's own words. */
interface Guide {
  readonly id: string
  readonly title: string
  readonly permission: string
  readonly steps: readonly string[]
  readonly note?: string
}

/**
 * The guides, in the order a patient meets the hospital. Each names the buttons as the screens say them. A guide shows
 * only to someone whose role can take its steps, so a lab scientist is not taught to prescribe.
 */
export const GUIDES: readonly Guide[] = [
  { id: 'register', title: 'Register a new patient', permission: 'identity.registration.write', steps: [
    'Open Patient registration and select Create record.',
    'Check the patient’s NIN, then fill in their details.',
    'Finish the steps. The patient gets a Health ID.',
  ], note: 'If NIN checks are unavailable, new registrations can’t be started yet. Try again later.' },
  { id: 'find', title: 'Find a patient and get access', permission: 'identity.patient.read', steps: [
    'Open Patients and paste or type the patient’s Health ID (it starts with HID-). It’s checked as soon as it’s complete.',
    'If you can see the patient, their page opens at once.',
    'If not, choose Use their Access PIN (if they’re with you) or Ask the patient (they approve on their phone).',
    'If no patient has that Health ID, select Register a new patient.',
  ], note: 'Use Emergency access only when the patient can’t consent and care can’t wait.' },
  { id: 'vitals', title: 'Record vitals', permission: 'ehr.vital.write', steps: [
    'Open the patient, then select Record vitals.',
    'Choose the visit, then enter the readings. Values outside the normal adult range are flagged as you type.',
    'Select Save record. Back to consultation takes you to the visit.',
  ] },
  { id: 'consult', title: 'Run a consultation', permission: 'ehr.encounter.write', steps: [
    'Open the patient, then select Start a consultation.',
    'Write the complaint, history, examination and diagnosis.',
    'Select Start consultation, then Sign note when you’re done.',
  ], note: 'The latest vitals show at the top of the consultation. Ask about this patient sits in the patient banner on every page.' },
  { id: 'lab-order', title: 'Order a lab test', permission: 'ehr.lab-request.write', steps: [
    'In the consultation, open Orders and select New lab request.',
    'Enter the test. Request handling is set to send it to this facility’s lab.',
    'Select Create lab request, then confirm the patient and select Send lab request.',
  ] },
  { id: 'prescribe', title: 'Prescribe a medicine', permission: 'ehr.prescription.write', steps: [
    'In the consultation, open Orders and select New prescription.',
    'Enter the medicine, dose, unit, route, how often and instructions, then select Save draft.',
    'On the saved prescription, activate it so the pharmacy receives it.',
  ] },
  { id: 'lab', title: 'Process lab work', permission: 'lab.work-item.read', steps: [
    'Open Laboratory. Waiting for sample lists new requests.',
    'Check two identifiers, register the sample, then enter the results.',
    'Release the results when they are checked.',
  ] },
  { id: 'dispense', title: 'Dispense a prescription', permission: 'pharmacy.work-item.read', steps: [
    'Open Prescriptions. To dispense lists what is waiting.',
    'Open the prescription and check the patient, medicine and dose.',
    'Tick each step of Pick and hand over, enter the quantity, and select Dispense.',
  ] },
  { id: 'emergency', title: 'Use emergency access', permission: 'identity.break-glass.write', steps: [
    'Open Emergency access (under Care, beside Access requests).',
    'Enter the Health ID and why care can’t wait, then tick the box.',
    'The record opens read-only, with the emergency summary, and closes by itself.',
  ] },
]

/** What changed in this release, newest first: one line each. */
export const WHATS_NEW: readonly string[] = [
  'Find a patient (from a button), a new registration, New consultation, Record vitals, new prescriptions and lab requests, and Ask for access open in a side panel over the page you’re on. Close it, or press Esc, to carry on where you were.',
  'Typing a diagnosis suggests matches and fills its ICD-10 code. Lab tests, medicines, routes and how often are suggested too.',
  'Common complaints are one tap under the complaint box.',
  'Guide, in the top bar of every page, explains that page. Press ? to open it.',
  'Find a patient checks a Health ID as soon as it’s pasted, and offers Register a new patient when no one has it.',
  'Back takes you to where you came from: a consultation started from a patient’s page returns to the patient.',
  'Today’s work on Home opens each test or prescription itself.',
  'Ask about this patient is in the patient banner on every chart page.',
  'The latest vitals show at the top of each consultation.',
  'After saving vitals, Back to consultation takes you straight back.',
  'Emergency access sits beside Access requests, with a shorter notice.',
  'Facility settings show only to the people who manage the facility.',
]

/**
 * Help (QA P1-7): short how-to guides for the work this person's role does, what changed lately, and the support chat
 * where this build offers it. Nothing is read or sent; the guides are the app's own words.
 */
export function HelpPage() {
  const { state } = useStaff()
  const [chatOpen, setChatOpen] = useState(false)
  const permissions = state.status === 'ready' ? state.session.actor.facility?.permissions ?? [] : []
  const guides = GUIDES.filter(guide => permissions.includes(guide.permission))
  const chat = supportChatOffered()
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader title="Help" description="Short guides for your work, and what’s new."
        actions={chat ? <Button variant="primary" icon={MessageCircle} onClick={() => setChatOpen(true)}>Chat with support</Button> : undefined} />
      <Card>
        <CardHeader as="h2" title="Guides for your role" icon={BookOpen} iconTone="brand" />
        {guides.length === 0 ? <p className="m-0 px-5 pb-5 text-sm text-ink-2">There are no guides for your role yet.</p> : (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {guides.map(guide => (
              <li key={guide.id}>
                <details className="group px-5 py-3">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink">{guide.title}</summary>
                  <ol className="m-0 mt-1 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
                    {guide.steps.map(step => <li key={step}>{step}</li>)}
                  </ol>
                  {guide.note ? <p className="m-0 mt-2 text-[13px] text-ink-3">{guide.note}</p> : null}
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader as="h2" title="What’s new" icon={Sparkles} iconTone="brand" />
        <ul className="m-0 list-disc space-y-1.5 px-5 pb-5 pl-10 text-sm text-ink-2">
          {WHATS_NEW.map(line => <li key={line}>{line}</li>)}
        </ul>
      </Card>
      {chat ? <SupportChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} /> : null}
    </div>
  )
}
