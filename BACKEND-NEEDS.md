# Backend needs from the UI/UX redesign

The redesign changes the frontend only. Where a screen needs something the backend doesn't serve yet, it's
listed here instead. The UI calls the proposed endpoint and says plainly when it isn't served.

## 1. Patient-added records — `POST /api/v1/ehr/me/patient-entries` (proposed)

Patients record their own care: a visit, test result, medicine, diagnosis or vaccine from any hospital, clinic,
lab or pharmacy, with photos or PDFs of the paper.

Request (patient session):

```json
{
  "kind": "visit | test | medicine | diagnosis | vaccination | other",
  "title": "Malaria test",
  "facilityName": "Lagos General Hospital",
  "occurredOn": "2026-10-20",
  "notes": "Positive, given ACT",
  "attachments": [{ "fileName": "slip.jpg", "mediaType": "image/jpeg", "sizeBytes": 812345, "contentBase64": "…" }]
}
```

Response: `201 { "id": "…" }`. Limits the UI enforces: up to 5 files, 10 MB each, images or PDF, title 2–160
characters, date not in the future.

The records answer (`GET /ehr/me/records`) should then return these entries marked as patient-entered (for
example `source: "patient"`), so the UI can label them "Added by you" and clinicians can tell them apart.

Registered as `ehr.myPatientEntries` (status `proposed`) in `packages/contracts/src/registry.ts`.
