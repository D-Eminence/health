/**
 * Provider-workspace features built against routes that hid-system main does
 * not serve. They came with Health-id #61 from hid-system's staging branches:
 *
 * - imported medical history: GET /ehr/patients/:patientId/imported-records and
 *   GET /ehr/patients/:patientId/imported-attachments/:fileId/download
 *   (hid-system `staging`);
 * - "Ask about this patient"'s source viewer: GET
 *   /ehr/patients/:patientId/chat/sources/:kind/:sourceId (hid-system
 *   `staging-novu-ci-20261005` only; main does not serve it).
 *
 * "Ask about this patient" itself is served by main since ADR-069 (0101):
 * POST /ehr/patients/:patientId/chat, GET .../chat/availability and GET and
 * DELETE .../chat/history, for staff holding ehr.record-chat.use, for direct
 * care, off by default in hid-system. Its screen (StaffRecordChat) stays off
 * unless the build sets VITE_HID_STAFF_PATIENT_CHAT_ENABLED to "true", which is
 * set only for a backend that has turned the feature on.
 *
 * On main, ehr-api answers each with 404 NOT_FOUND, which reached every chart
 * as "Cannot GET /api/v1/ehr/patients/…" in an alert. hid-system main 221ddbf
 * (#94, 0099, ADR-067) now serves imported history under a different contract:
 * GET /ehr/patients/:patientId/imported-history (ehr.imported-history.read;
 * 503 IMPORTED_HISTORY_DISABLED until EHR_STAFF_IMPORTED_HISTORY_ENABLED;
 * answer { shared, records, healthProfile, limits, truncated, nextCursor,
 * provenance }). The chart still calls the staging branch's /imported-records,
 * so its flag stays off against main until the chart moves to that route. Each stays off unless the
 * build sets its variable to exactly "true"; set it only for a backend that
 * serves the routes. No launch build does. Read by name, so Vite inlines only
 * these (buildConfig.test.ts).
 */
export function importedRecordsEnabled(): boolean {
  // New release builds use HISTORY to avoid the public guard's RDS_ fragment match.
  return import.meta.env.VITE_HID_IMPORTED_HISTORY_ENABLED === 'true'
    || import.meta.env.VITE_HID_IMPORTED_RECORDS_ENABLED === 'true'
}

export function staffPatientChatEnabled(): boolean {
  return import.meta.env.VITE_HID_STAFF_PATIENT_CHAT_ENABLED === 'true'
}
