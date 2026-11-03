/*
 * Plain words for the permissions a member holds at a facility (Facility profile, "Your permissions here"). A screen
 * never shows a permission's code: a code with no words here is counted under "Other access", never printed.
 */
const PERMISSION_WORDS: Readonly<Record<string, string>> = {
  'identity.patient.read': 'See patients who gave access',
  'identity.patient.lookup': 'Find a patient',
  'identity.registration.read': 'See patient registrations',
  'identity.registration.write': 'Register patients',
  'identity.registration.approve': 'Approve patient registrations',
  'identity.patient.assisted_registration': 'Check a patient in person',
  'identity.consent.read': 'See access requests',
  'identity.consent.write': 'Ask patients for access',
  'identity.break-glass.write': 'Open a record in an emergency',
  'identity.patient-access-pin.verify': 'Check a patient’s access PIN',
  'identity.nin.verify': 'Check a patient’s NIN',
  'identity.authorization.check': 'Check access to a patient’s record',
  'audit.read': 'See the facility audit',
  'workforce.manage': 'Manage staff and access',
  'organization.manage': 'Manage the facility',
  'ehr.record.read': 'See patient records',
  'ehr.encounter.read': 'See visits',
  'ehr.encounter.list': 'See visits',
  'ehr.encounter.create': 'Start visits',
  'ehr.encounter.write': 'Record visits',
  'ehr.note.read': 'See clinical notes',
  'ehr.note.write': 'Write clinical notes',
  'ehr.vital.read': 'See vital signs',
  'ehr.vital.write': 'Record vital signs',
  'ehr.diagnosis.read': 'See diagnoses',
  'ehr.diagnosis.write': 'Record diagnoses',
  'ehr.prescription.read': 'See prescriptions',
  'ehr.prescription.write': 'Write prescriptions',
  'ehr.lab-request.read': 'See lab requests',
  'ehr.lab-request.write': 'Request lab tests',
  'ehr.document.read': 'See documents',
  'ehr.document.write': 'Add documents',
  'ehr.imported-history.read': 'See imported history',
  'ehr.order-route.send': 'Send orders to other facilities',
  'ehr.record-chat.use': 'Ask questions about a record',
  'lab.work-item.read': 'See laboratory work',
  'lab.work-item.accept': 'Accept laboratory work',
  'lab.walk-in.create': 'Add laboratory walk-ins',
  'lab.accession.read': 'See laboratory samples',
  'lab.accession.create': 'Log laboratory samples',
  'lab.specimen.collect': 'Collect samples',
  'lab.specimen.receive': 'Receive samples',
  'lab.specimen.reject': 'Reject samples',
  'lab.execution.read': 'See tests in progress',
  'lab.execution.start': 'Start tests',
  'lab.execution.complete': 'Finish tests',
  'lab.result.enter': 'Enter results',
  'lab.result.verify': 'Check results',
  'lab.result.release': 'Release results',
  'lab.result.correct': 'Correct results',
  'lab.result.revise-released': 'Correct released results',
  'lab.result.released.read': 'See released results',
  'lab.result.share': 'Share results',
  'lab.order-route.receive': 'Receive lab orders from other facilities',
  'lab.import.read': 'See imported laboratory records',
  'lab.import.write': 'Import laboratory records',
  'lab.document.read': 'See laboratory documents',
  'lab.document.write': 'Add laboratory documents',
  'lab.sample-batch.create': 'Add sample batches',
  'pharmacy.work-item.read': 'See pharmacy work',
  'pharmacy.work-item.accept': 'Accept pharmacy work',
  'pharmacy.walk-in.create': 'Add pharmacy walk-ins',
  'pharmacy.dispensing.read': 'See dispensing',
  'pharmacy.dispensing.create': 'Dispense medicines',
  'pharmacy.dispensing.reverse': 'Reverse a dispensing',
  'pharmacy.order-route.receive': 'Receive prescriptions from other facilities',
  'pharmacy.stock.read': 'See stock',
  'pharmacy.stock.manage': 'Manage stock',
  'pharmacy.import.read': 'See imported pharmacy records',
  'pharmacy.document.read': 'See pharmacy documents',
  'pharmacy.document.write': 'Add pharmacy documents',
  'ocr.job.read': 'See scanned documents',
  'ocr.job.write': 'Scan documents',
  'ocr.validation.write': 'Check scanned documents',
  'ocr.patient.confirm': 'Match scanned documents to patients',
  'ocr.publication.write': 'Add scanned documents to records',
  'outreach.registration.read': 'See outreach registrations',
  'outreach.registration.write': 'Register people at outreach',
  'outreach.campaign.read': 'See outreach campaigns',
  'outreach.campaign.write': 'Run outreach campaigns',
  'billing.subscription.read': 'See the plan and billing',
  'billing.subscription.manage': 'Change the plan',
  'billing.settings.manage': 'Set up payments',
  'billing.catalogue.read': 'See the price list',
  'billing.catalogue.manage': 'Change the price list',
  'billing.bill.read': 'See bills',
  'billing.bill.create': 'Create bills',
  'billing.bill.defer': 'Let a patient pay later',
  'billing.payment.record': 'Take payments',
  'billing.payment.confirm': 'Confirm payments',
  'billing.payment.void': 'Cancel payments',
  'billing.payment.waive': 'Waive payments',
  'billing.shift.own': 'Run your own till',
  'billing.shift.manage': 'Manage tills',
}

/** Own keys only: a code such as "constructor" is not a permission. */
function wordsFor(code: string): string | undefined {
  return Object.hasOwn(PERMISSION_WORDS, code) ? PERMISSION_WORDS[code] : undefined
}

export const OTHER_ACCESS = 'Other access'

/**
 * The permissions in plain words, each once, in the order held; any with no words here read "Other access", once, at
 * the end.
 */
export function permissionWords(codes: readonly string[]): readonly string[] {
  const named = codes.flatMap(code => wordsFor(code) ?? [])
  const other = codes.some(code => wordsFor(code) === undefined)
  return [...new Set(named), ...(other ? [OTHER_ACCESS] : [])]
}
