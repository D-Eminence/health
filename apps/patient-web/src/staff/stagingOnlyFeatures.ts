/**
 * Provider-workspace features built against routes that hid-system main does
 * not serve. They came with Health-id #61 from hid-system's staging branches:
 *
 * - imported medical history: GET /ehr/patients/:patientId/imported-records and
 *   GET /ehr/patients/:patientId/imported-attachments/:fileId/download
 *   (hid-system `staging`);
 * - "Ask about this patient": POST /ehr/patients/:patientId/chat, GET and
 *   DELETE .../chat/history, GET .../chat/sources/:kind/:sourceId (hid-system
 *   `staging-novu-ci-20261005` only).
 *
 * On main, ehr-api answers each with 404 NOT_FOUND, which reached every chart
 * as "Cannot GET /api/v1/ehr/patients/…" in an alert. Each stays off unless the
 * build sets its variable to exactly "true"; set it only for a backend that
 * serves the routes. No launch build does. Read by name, so Vite inlines only
 * these (buildConfig.test.ts).
 */
export function importedRecordsEnabled(): boolean {
  return import.meta.env.VITE_HID_IMPORTED_RECORDS_ENABLED === 'true'
}

export function staffPatientChatEnabled(): boolean {
  return import.meta.env.VITE_HID_STAFF_PATIENT_CHAT_ENABLED === 'true'
}
