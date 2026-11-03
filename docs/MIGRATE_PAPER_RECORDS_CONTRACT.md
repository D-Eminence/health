# Migrate paper records: routes the website needs (proposal from Session D, 3 Nov 2026)

Status: **proposal**. The website builds against these shapes in the mock gateway (`dev/mock-gateway/paperRecords.mjs`)
until Sessions B and C ship the real routes. Any change agreed with B/C through the coordinator is made here first,
then in the mock and the website.

Every route is under `/api/v1`, with `X-Facility-ID`. Reads and writes about one patient send
`X-Purpose-Of-Use: direct-care` (the chart's access) unless marked `healthcare-operations` (records processing, 0104).
Errors keep today's `{ code, message }` body; the website never shows `message` or `code` to staff, only its own plain
sentence chosen by `code`. Times are ISO 8601 UTC. IDs are opaque strings and are never shown on screen.

## 1. Can this patient's paper records be brought in here? (Session C)

`GET /ocr/patients/:patientId/paper-records/availability` → `200`

```json
{
  "available": false,
  "reason": "under_18 | emergency_access | view_only | no_permission | not_enabled_here | allowance_used_up | null",
  "coveredUntil": "2026-11-04T10:14:00Z | null",
  "allowance": { "pagesUsed": 188, "pagesLimit": 500, "resetsOn": "2026-12-01", "paused": false }
}
```

- `coveredUntil` is the end of the 24-hour OK (first access request or Access PIN, decision 34-1). `null` means the
  patient has to be asked.
- `allowance_used_up` still lets staff check papers already read and add items by hand; only new reading is paused.

## 2. Upload a paper record without a visit (Session C, ehr-api)

Same three steps as today's document upload (`sendDocument`), with no `encounterId`:

`POST /ehr/documents/upload-intents` body (today's, `encounterId` left out)
`{ patientId, fileName, mediaType: "application/pdf", sizeBytes, sha256Hex, classification: "phi", retentionClass: "clinical-10y", documentType: "paper_record", paperRecord: { pageCount, flaggedPages: [2] } }`
→ `201 { document: { id }, upload: { method: "PUT", url, requiredHeaders, expiresInSeconds } }`; then the PUT; then
`POST /ehr/documents/:documentId/complete`.

- `flaggedPages` are the 1-based pages kept with "Use anyway" after the blur/dark/too-small warning.
- At most 20 pages, one PDF, 50 MiB. The website joins the photos into one PDF itself, without re-encoding them, and
  keeps only the orientation in each JPEG.
- Reading starts by itself once the virus check says clean (no "create job" call from the website).

## 3. The patient's paper records list (Session C)

`GET /ocr/patients/:patientId/paper-records` → `200 { items: PaperRecord[] }`, newest first.

```json
{
  "id": "opaque",
  "documentId": "opaque",
  "kind": "clinic_card | prescription | lab_result | discharge_letter | other | null",
  "pageCount": 3,
  "takenAt": "2026-11-03T10:14:00Z",
  "takenBy": { "name": "Nurse Ada Obi" },
  "status": "checking_for_viruses | reading | ready_to_check | published | couldnt_read | withdrawn",
  "checkBy": "2026-11-04T10:14:00Z | null",
  "failure": "unreadable | virus_found | reading_paused | other | null",
  "canRetry": true,
  "published": { "at": "...", "by": { "name": "..." }, "counts": { "medicine": 3, "diagnosis": 2, "allergy": 1, "note": 1, "lab_result": 0, "vital": 0 } } ,
  "version": 4
}
```

`POST /ocr/paper-records/:id/retry` body `{ expectedVersion, reason: "blurred | wrong_pages | other" }` → `200 PaperRecord`.

## 4. The check screen (Sessions B and C)

`GET /ocr/paper-records/:id/review` → `200`

```json
{
  "paperRecord": { "...PaperRecord" },
  "pages": [{ "number": 1, "imageUrl": "signed https URL", "width": 1240, "height": 1754, "flagged": false }],
  "identity": {
    "nameAsWritten": "AMINA BELLO | null",
    "dateOfBirthAsWritten": "12/03/1985 | null",
    "folderNumberAsWritten": "F-2231 | null",
    "match": "matches | differs | no_name | folder_number_only",
    "box": { "page": 1, "x": 0.1, "y": 0.05, "w": 0.4, "h": 0.04 }
  },
  "items": [{
    "id": "opaque",
    "kind": "medicine | diagnosis | allergy | note | lab_result | vital",
    "asWritten": "Amoxil 500mg tds x5/7",
    "plain": "Amoxicillin 500 mg, three times a day, for 5 days",
    "dateAsWritten": "2/10/26 | null",
    "box": { "page": 1, "x": 0.12, "y": 0.41, "w": 0.6, "h": 0.05 },
    "confidence": "clear | check_carefully",
    "checkReason": "handwriting | low_confidence | flagged_page | null",
    "fields": { "kind-specific values, see section 6" },
    "prescription": { "prescriberAsWritten": "Dr Bello", "dateAsWritten": "2 Oct 2026" }
  }],
  "draft": { "version": 3, "identityDecision": "yes | no | null", "folderConfirmedWithPatient": false, "decisions": { "<itemId>": { "decision": "accept | change | remove", "fields": {}, "removeReason": "not_on_paper | not_this_patient | listed_twice | other" } }, "added": [] },
  "choices": { "medicine": [{ "code": "...", "label": "Amoxicillin 500 mg capsule" }], "condition": [], "labTest": [], "unit": [] }
}
```

- `box` values are fractions of the page (0 to 1), so the website can draw the highlight and cut the snippet from
  `imageUrl` without any other data.
- `choices` are the short lists for Change (Essential Medicines List, common conditions, lab tests and units), already
  narrowed to what matches the page where that makes sense.

`PUT /ocr/paper-records/:id/review-draft` body `{ expectedVersion, identityDecision, folderConfirmedWithPatient, decisions, added }`
→ `200 { version }`. Saved as staff go (debounced), so nothing is lost on a phone.

`added` items: `{ clientId, kind, box, fields }` (staff tapped where it is on the page and picked values).

## 5. Publish (Session C)

`POST /ocr/paper-records/:id/publish` header `Idempotency-Key`, body `{ expectedDraftVersion }` → `200`

```json
{ "status": "published | partly_published", "counts": { "medicine": 3, "diagnosis": 2, "allergy": 1, "note": 1 },
  "failedItems": [{ "id": "opaque", "kind": "medicine" }] }
```

Refusals by `code`: `IDENTITY_NOT_CONFIRMED`, `WRONG_PATIENT`, `UNDECIDED_ITEMS`, `ACCEPT_ALL_NOT_ALLOWED`,
`DRAFT_CHANGED`, `UNDER_18`, `ACCESS_ENDED`. A failed item is retried with the same key (works from any device:
the server holds the per-item key).

## 6. Item fields (Session B produces, Session C stores)

| kind | fields |
| --- | --- |
| medicine | `name`, `code?`, `strength?`, `dose?`, `frequency?` (`once_daily, twice_daily, three_times_daily, four_times_daily, as_needed, other`), `duration?`, `status` (`still_taking, finished, stopped, not_known`), `writtenAsPrescription` |
| diagnosis | `name`, `code?`, `certainty` (`confirmed, possible, ruled_out`) |
| allergy | `substance`, `reaction?`, `severity?` (`mild, moderate, severe, not_known`) |
| note | `text` |
| lab_result | `test`, `code?`, `value`, `unit?`, `flag?` |
| vital | `type` (`blood_pressure, temperature, pulse, weight, height, oxygen`), `value`, `unit` |

## 7. In the chart: "From paper records" (Session C)

`GET /ehr/patients/:patientId/paper-record-items` → `200 { items: ChartPaperItem[] }`

```json
{ "id": "opaque", "kind": "medicine", "plain": "Amoxicillin 500 mg, three times a day", "dateAsWritten": "2/10/26",
  "paperRecordId": "opaque", "publishedAt": "...", "publishedBy": { "name": "Nurse Ada Obi" },
  "prescription": { "prescriberAsWritten": "Dr Bello", "dateAsWritten": "2 Oct 2026" } ,
  "enteredInError": { "at": "...", "by": { "name": "..." }, "reason": "wrong_item | wrong_patient | listed_twice | other" } ,
  "version": 1 }
```

- `POST /ehr/paper-record-items/:id/entered-in-error` body `{ expectedVersion, reason }` (permission
  `ehr.import.correct`, doctors and clinicians only).
- `POST /ocr/paper-records/:id/withdraw` body `{ expectedVersion, reason: "wrong_patient" }` (same permission; tells
  the facility; nothing deleted).
- "Prescribe from this scan" needs no new route: the website opens the usual prescription form filled from the item
  and sends `sourcePaperRecordItemId` with the prescription so the order links back to the scan (Session C adds that
  optional field to the prescription create body).
