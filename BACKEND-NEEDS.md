# Backend needs from the UI/UX redesign

The redesign changes the frontend only. Where a screen needs something the backend doesn't serve yet, it's
listed here instead. The UI calls the proposed endpoint and says plainly when it isn't served.

## 1. Patient-added records, with photos and files (proposed)

Patients record their own care: a visit, test result, medicine, diagnosis or vaccine from any hospital, clinic, lab
or pharmacy, with photos or PDFs of the paper. The entry is saved first, with no file bytes in it. Then each file goes
up under it in turn, in the three steps staff uploads take: ask for an upload link, PUT the exact bytes, confirm. A
file's bytes never pass through the API, so production's edge limit on a request body (8000 bytes) never applies to
them. Every route takes a patient session only, with no facility. A 404 on a served route carries its own code, never
`NOT_FOUND`.

**Limits (the owner's).** JPG, PNG or PDF (`image/jpeg`, `image/png`, `application/pdf`), each 1 byte to 10 MB
(10485760 bytes), at most 5 files per entry, and at most 10 files per patient per Lagos calendar day (step 2). The UI
checks the type, size and 5 per entry before anything is sent. It also reads each file's first 8 bytes as it is picked,
and they must be its type's: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, PDF `25 50 44 46 2D` (`%PDF-`). A file
whose bytes aren't (a program renamed `scan.png`, say) is refused in the browser ("This file isn't a JPEG, PNG or
PDF."), never listed and never sent. Only the server can count the day, so it enforces the 10 a day (step 2), and
enforces the type (step 4), size and 5 per entry again.

**Patients only: staff uploads have no daily limit.** The 10 a day and the 5 per entry are for a patient's own uploads
in Add a record only. Staff document uploads have no daily limit: EHR encounter documents, Lab and Pharmacy work-item
documents, and Migrate / Document OCR, including the bulk migration of a facility's history. None of them counts toward
a patient's 10 a day, and none is ever refused for it.

**1. Save the entry.** `POST /api/v1/ehr/me/patient-entries`, with an `Idempotency-Key` header, one per Save and
reused when that Save is retried. The body is at most 8000 bytes of JSON:

```json
{
  "kind": "visit | test | medicine | diagnosis | vaccination | other",
  "title": "Malaria test",
  "facilityName": "Lagos General Hospital",
  "occurredOn": "2026-10-20",
  "notes": "Positive, given ACT"
}
```

`title` 2–160 characters; `facilityName` up to 160 characters or null, free text that gives that facility no access;
`occurredOn` not after today in Lagos; `notes` ("Anything else to note?") up to 2000 characters or null. Answers
`201 { entry }`; the same key with the same body replays the 201.

**2. Ask for an upload link.** `POST /api/v1/ehr/me/patient-entries/:entryId/documents/upload-intents`, with an
`Idempotency-Key` header, one per file. Body `{ fileName, mediaType, sizeBytes, sha256Hex }`: `mediaType` is
`application/pdf`, `image/jpeg` or `image/png`; `sizeBytes` 1 to 10485760; at most 5 files per entry. The server
sets the patient, the classification and the retention; the browser sends none of them. Answers
`201 { document: { id, status: 'initiated', scanStatus: 'pending' }, upload: { method: 'PUT', url, requiredHeaders, expiresInSeconds } }`,
the staff shape. The UI's Try again sends the same key with the same body for a file that didn't upload: before that
file is confirmed, it answers `201` again for the same document, with a link that is still valid (the first may have
expired). The same key asked again once that file is confirmed (a confirm that went through though its answer
was lost) answers `409 PATIENT_DOCUMENT_ALREADY_UPLOADED` with `document: { id, status, scanStatus }`: the UI counts
that file as uploaded and sends no PUT and no confirm for it. The UI goes by the 409 and its `code` alone and does not
read `document`. Any other 409 (but `409 PATIENT_DOCUMENT_TYPE_MISMATCH`, step 4), or that code with another status, is
a failed upload.

*The day's limit.* At most 10 files per patient per calendar day in Lagos (`Africa/Lagos`), across all the patient's
entries. What counts: each new upload-intent key answered `201` counts once, whether or not its file is then confirmed,
and a removed entry's files still count. An upload intent with a new key, once 10 have been counted that day, answers
`429` with `code: 'PATIENT_DOCUMENT_DAILY_LIMIT'` (the usual problem shape) and opens no document. A replayed key is
never refused for the limit: it answers its `201` or `409` as above. The server sends `Retry-After` with the seconds
until the next Lagos midnight; the UI does not depend on it. The UI reads the status and `code` alone: it says "You can
add up to 10 photos or files a day. Your record is saved; add the rest tomorrow.", sends nothing more for that file and
offers no Try again for it, and closing the drawer keeps the saved entry without it. It still asks for each of that
Save's other files, and goes by each answer. A `429` with any other code (the edge's rate limit, for one) is an
ordinary failed upload, which Try again may send again with the same key.
Only these patient upload intents are counted and limited: a staff document upload (an EHR encounter document, a Lab or
Pharmacy work-item document, Migrate / Document OCR, a facility's bulk migration of its history included) has no daily
limit, never counts toward the patient's 10 and is never answered `429 PATIENT_DOCUMENT_DAILY_LIMIT`.

*Photos arrive without their metadata.* Before a JPEG or PNG is hashed, the browser takes out its metadata without
re-encoding it (`apps/patient-web/src/photoMetadata.ts`), so the picture's own bytes are unchanged. From a JPEG it
drops APP1 (EXIF, with the GPS position, the camera's make and model and the EXIF thumbnail; XMP), APP13 (IPTC), COM,
every other APPn (the APP2 MPF index among them) and everything after the primary image's end of image (the further
pictures phones append, each with its own EXIF and GPS); it keeps APP0 JFIF (without a thumbnail), APP2
`ICC_PROFILE`, APP14 Adobe (its 12 bytes, nothing after them), the tables, the one frame and each scan byte for byte.
From a PNG it keeps the critical chunks (IHDR, PLTE, IDAT, IEND) and the ancillary chunks display needs (tRNS; cHRM,
gAMA, iCCP, sBIT, sRGB, cICP, mDCV, cLLI; bKGD, hIST, pHYs; APNG's acTL, fcTL, fdAT), each byte for byte, and drops
every other chunk: eXIf (and its earlier spellings exIf and zxIf), tEXt, zTXt, iTXt, tIME, C2PA's caBX (which can
carry the place), private chunks (Apple's iDOT among them), and anything after IEND. Of the EXIF, orientation alone is
kept, so a photo a phone took upright doesn't show on its side: when the first APP1 EXIF before the first scan (or a
PNG's first eXIf before IDAT) says an Orientation (tag 0x0112) other than 1, the browser writes a new APP1 (or eXIf,
with its CRC) holding only that: a TIFF header in the original's byte order and an IFD0 with that one entry, no other
tag, no next IFD (so no thumbnail), no EXIF, GPS or interoperability IFD pointer and no MakerNote. The APP1 goes
straight after the start of image, or after APP0 JFIF; the eXIf where the original was, before IDAT. Orientation 1, no
Orientation, or an EXIF that can't be read with certainty (a bad TIFF header, an offset outside it, a second
Orientation, one that isn't a single SHORT of 1 to 8) leaves none, and the photo is still sent. `sizeBytes`,
`sha256Hex` and the PUT body are all of the stripped bytes, and the same file always strips to the same bytes (the
orientation's included), so Try again sends the same body. A photo that can't be walked cleanly is refused in the browser and never sent: among others, a JPEG table,
frame or scan header whose length says more than its fields, a second frame, a PNG chunk whose CRC is wrong, and a
critical chunk other than IHDR, PLTE, IDAT and IEND (or a second IHDR). PDFs are sent as they are, once their first
bytes are `%PDF-` (above): a photo or a phone's video under a PDF's name, which would go up with its metadata, is
refused, as is anything else that isn't a PDF. The server must not rely on any of this (an older page or another client
may send a photo as taken): it may strip again, after the confirm has checked the stored object against `sizeBytes`,
`sha256Hex` and `mediaType`.

**3. PUT the file** to `upload.url` with `requiredHeaders`: the exact bytes that were hashed (for a photo, its stripped
bytes), no cookies. The document bucket's CORS must allow this PUT from the patient host (app.) and its staging and
development hosts.

**4. Confirm.** `POST /api/v1/ehr/me/patient-entries/:entryId/documents/:documentId/complete`, no body; only the
account that asked for the link may confirm. The server checks the stored object's size and SHA-256 against `sizeBytes`
and `sha256Hex`, and its leading bytes against `mediaType` (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, PDF
`%PDF-`), not the request's `Content-Type`. Answers `200 { document: { id, status, scanStatus } }`. A missing object,
or one whose size or SHA-256 doesn't match, answers `409 PATIENT_DOCUMENT_UPLOAD_INCOMPLETE`: the UI counts it as a
failed upload, which Try again sends again. One whose leading bytes aren't `mediaType`'s answers
`409 PATIENT_DOCUMENT_TYPE_MISMATCH`: the UI says "This file isn't a JPEG, PNG or PDF." beside it and offers no Try
again for it, since the same bytes would be refused again.

**List.** No route of its own: the records answer the Records page already reads, `GET /api/v1/ehr/me/records`,
carries a new key
`patientEntries: [{ id, source: 'patient', kind, title, facilityName, occurredOn, notes, createdAt, documents: [{ id, fileName, mediaType, sizeBytes, status, scanStatus, createdAt }] }]`,
newest first. Only confirmed documents are listed, and removed entries are left out. The UI lists these as "Added by
you" on the Records page from that answer, and reads the records again after a Save or a removal. An entry or file
missing what it needs is left out, and a status the UI does not know never reads as clean. Each file shows its name,
type, size and virus check ("Checking for viruses" while `scanStatus` is `pending`; "This file couldn't be added" when
rejected, with no word of a virus); no file can be opened there yet, since this contract has no patient download.

**Remove.** `POST /api/v1/ehr/me/patient-entries/:entryId/withdraw`, no body, answers
`200 { entry: { id, status: 'withdrawn', withdrawnAt } }`, and a replay answers the same. From then on the entry and
its files are gone from `patientEntries`, the patient chat and every staff read. Nothing is erased, so the UI says "Removed
from your records", never "deleted". An id that is not one of the patient's entries answers `404 PATIENT_ENTRY_NOT_FOUND`:
the UI says "This record has already been removed." and reads the records again.

**What the UI says of a refusal.** Its own fixed words, chosen by the status and `code` alone. It never shows the
server's `detail`, `title` or any other text from an answer to any of these routes. The Save: `404 NOT_FOUND`,
"Adding your own records isn't available yet. What you entered is still here."; `413`, or the UI's own
`PATIENT_ENTRY_TOO_LARGE` (a body over 8000 bytes, refused before it is sent), "It's too long to send. Shorten the
notes, then save again. What you entered is still here."; anything else, "Your record couldn't be saved. Please try
again." A file's upload link, PUT and confirm: `429 PATIENT_DOCUMENT_DAILY_LIMIT`,
`409 PATIENT_DOCUMENT_ALREADY_UPLOADED`, `409 PATIENT_DOCUMENT_TYPE_MISMATCH` and
`409 PATIENT_DOCUMENT_UPLOAD_INCOMPLETE` as above; anything else is a file that didn't upload (counted in "2 of your
photos or files didn't upload."), which Try again sends again. Remove: `404 PATIENT_ENTRY_NOT_FOUND` as above; anything
else, "This record couldn't be removed. Please try again."

**Who reads.** The patient, always. Staff only as they read the patient's imported history: at a facility whose own
membership holds an active consent grant for the patient (a share at any level, an approved access request, the desk
PIN, or emergency access); a deny overrides it, and revoking or expiry ends it. The facility name the patient types
gives that facility nothing. Every staff read is logged and raises "Your records were opened". Nobody but the patient
writes, at any share level.

**The patient chat** reads each live, confirmed, scan-clean patient document as it reads other documents, labelled
"Patient provided file; machine extracted, not clinician verified", and each entry's kind, title, place, date and notes
as patient-reported.

**Served or not.** Two separate signals, both kept in memory only, for the page's life
(`apps/patient-web/src/patientEntriesServed.ts`); nothing is kept in the browser.

*Entries.* The records answer carrying `patientEntries` (a list, empty or not), or a Save answering 201, means
served. A records answer without the key (today's), or a Save's 404 `NOT_FOUND` (an unrouted path), means not served,
but only while nothing has said otherwise; a `patientEntries` that is not a list is left out and says neither. Once
served, it stays served. Served turns on "Added by you" on the Records page and the "Add a record" drawer with its text
fields (kind, name, place, date, notes). Without the key the Records page sends exactly today's requests and looks
exactly as today. Until served, the drawer's Save gets that 404 and says "Adding your own records isn't available yet.
What you entered is still here."

*Photos and files* (the coordinator's decision, 4 Nov 2026). Uploads are offered only once a records answer
(`GET /api/v1/ehr/me/records`) has carried the top-level key `patientEntryFiles` with the value `true`, exactly. Any
other value (`false`, `"true"`, `1`) or no key says nothing; nothing turns it off again for the page's life, and a
Save's 201 says nothing of it. So:

- `patientEntries` with no `patientEntryFiles: true`: text entries work and are listed. The drawer shows no "Take a
  photo" or "Upload a file", no file can be picked, and Save sends the entry alone: no upload link is asked for, no PUT
  and no confirm are sent.
- `patientEntries` and `patientEntryFiles: true`: the drawer also offers the photo and file pickers, and each picked
  file goes up after the Save as steps 2 to 4 describe.
- `patientEntryFiles: true` without `patientEntries`: the flag is remembered, but nothing is offered, since the drawer
  only opens once entries are served.

No file leaves the device until the Save and that file's upload link have both been answered.

*Switched off.* While patient entries are off (before migration 0110), the records answer leaves out `patientEntries`,
and every patient-entry route answers exactly as if it were not built (`404 NOT_FOUND`). While patient uploads are off
(before NDPA sign-off), the records answer leaves out `patientEntryFiles` (or sends `false`), and the upload-link and
confirm routes (steps 2 and 4) answer `404 NOT_FOUND`; the Save, the list and the removal may already be served. Off
must look the same as not built, never a code of its own (a `404 PATIENT_ENTRIES_DISABLED`, say, would only read "Your
record couldn't be saved. Please try again."). The backend must not send `patientEntryFiles: true` until uploads are
cleared under the NDPA. It may send `patientEntries` before then: that turns on text entries only.

Registered as `ehr.myPatientEntries` (POST), `ehr.myPatientEntryUploadIntent`, `ehr.myPatientEntryDocumentComplete`
and `ehr.myPatientEntryWithdraw` (status `proposed`) in `packages/contracts/src/registry.ts`; the list is part of
`ehr.myRecords`.

## 2. Sharing by card: the email and the link it carries

The product decision (30 Oct 2026): when a patient shares, the provider receives the patient's **Health ID card by email**,
in full (photo, name, Health ID, blood group, genotype, allergies). The **Open records** link under it opens the records the
share allows, **with no sign-in or code**. This works whether or not the provider is on Health ID.

**What the backend needs to do**

1. On `POST /identity/me/shares` (and on a confirmed invitation), email the recipient using `docs/email/share-card.html`.
   - Render the card as an image (PNG, 1200 × 756), because email clients drop CSS gradients.
   - Fill the template's placeholders.
   - Include a link `https://<patient host>/card/<token>`.
2. `GET /api/v1/identity/shared-cards/:token` (public, proposed; registered as `identity.sharedCard`) answers:
   `{ card: { fullName, hid, ninVerified, bloodGroup, genotype, allergies, photoUrl }, sharedBy, recipientEmail, level, duration, expiresAt, records }`,
   where `records` has the `GET /ehr/me/records` shape, limited to what `level` allows.

**Safeguards that stand in for a sign-in**

- The token is random and single-share. It works only while the grant is active, and answers 404 once the grant expires
  or the patient revokes it.
- Every successful read is written to the patient's access log as "Opened by <recipientEmail>", and notifies the patient.
- The answer carries `Cache-Control: no-store`, the page is read-only, and the page shows the recipient's email.
- Rate limit per token, and alert on opens from many networks (a sign of forwarding).

**Risk the product owner accepted:** anyone the email reaches can read the card and open the records, including on
forwarding or misdelivery. Health data is sensitive personal data under the NDPA 2023, so legal or compliance sign-off is
recommended before launch.

## Lab and pharmacy queues need the patient's name and date of birth for sample matching

The Laboratory and Pharmacy queues show who each piece of work is for, so staff can match a sample or a medicine to
the person in front of them. Today `GET …/lab/work-items` and `GET …/pharmacy/work-items` send the patient's
`fullName`, `dateOfBirth`, `sex` and `healthIdLast4` (`patient`) **only on work another facility sent here**. This
facility's own work carries just `patientId`, so the queue can only show a masked reference ("Patient ••••000001"),
which no one can match to a sample tube or a person at the counter.

**What the backend needs to do**

1. Send `patient: { fullName, dateOfBirth, sex, healthIdLast4 }` on every lab and pharmacy work item the member may read
   (`lab.work-item.read`, `pharmacy.work-item.read`), not only routed ones. The UI already shows it when present
   (`departments/parts/WorkQueue.tsx` `QueuePatient`), and uses it in the "confirm the patient" sheet before an
   accession, a result or a dispensing is saved.
2. Pharmacy work items: also send the prescription's `priority` (as lab work items do), so urgent and stat prescriptions
   can be sorted first and badged. The lab queue already does this.

Until then the queue shows the masked reference, and the confirm sheet says "Health ID not sent".

## Pharmacy items need an optional drug image/cover URL, and the fields a fast pick needs

The Pharmacy queue is now a set of large cards that lead with the drug, and opening one gives a picking view (checklist,
label in plain words, one Dispense button). `GET /api/v1/pharmacy/work-items` (`PharmacyWorkItem`) sends only
`medication.display`, `doseQuantity`, `doseUnit`, `routeCode`, `frequency` and `instructions`, so the UI has to work out
the rest from text. What it needs, all optional and additive:

1. **`medication.imageUrl`** (or `coverUrl`): a picture of the pack or product, from the formulary. Until it exists the
   card draws a plain tile for the form (tablet, capsule, liquid, injection, cream, inhaler, drops), guessed from the
   name, unit and route (`departments/pharmacy/drugForm.ts`).
2. **`medication.strength`** and **`medication.doseForm`** as fields: today the strength is split out of the display
   name ("Amoxicillin 500 mg capsules") and the form guessed from words. A coded form also makes the tile exact.
3. **`duration`** (for example `{ value: 7, unit: 'day' }`) and **`quantityToDispense`** with its unit: the prescriber's
   total. Today the card shows only dose and how often; the duration is only there if the prescriber typed it into the
   instructions, and the dispenser works out and types the quantity themselves.
4. **`priority`** (already asked above under "Lab and pharmacy queues need…"): the queue sorts oldest first because it
   can't put urgent prescriptions first.
5. A dispensing's **`Idempotency-Key` per attempt is generated in `staff/api.ts`**; a key kept per prescription across
   retries (as Outreach does with `localCommandId`) would make a resend after a lost answer safe. Frontend-side change,
   noted here so it isn't lost.

## Outreach: what the registration screens can't do yet

The Outreach screens now show registrations as cards with a next step, a three-step "New registration" form, and a case
view that ends in a done state. These are not in the API (`/api/v1/outreach/registration-cases…`), so the UI says
"not available yet" or leaves them out:

1. **Follow-up visits** for a registration: no endpoint records a visit, a referral or a follow-up date. The case view
   shows a "Follow-up visits: not available yet" card. Needed: `POST/GET …/registration-cases/:caseId/visits`.
2. **Phone and notes back on the case**: `createOutreachCase` sends `phone` and `operationalNotes`, but `OutreachCase`
   doesn't return them, so the team can't see how to reach the person after saving. Send them (masked phone is fine).
3. **Link by Health ID, not by internal patient ID**: `link-existing` takes `canonicalPatientId`, which field staff don't
   have. Accept a Health ID (HID-…) and answer with the matched patient's name and date of birth so the confirm step can
   show who is being linked.
4. **Who registered the case** (`createdBy` name) and **where** (campaign site) on each case, for the team list.
5. **Campaign writes**: the contract lists `POST …/campaigns`, `…/campaigns/:id/status` and `…/campaigns/:id/members`,
   but `staff/api.ts` has no calls for them and campaign governance isn't decided, so campaigns stay read only.
6. **Member names**: `GET …/campaigns/:id/members` returns membership IDs only; the campaign view can only show
   "Membership abc12345". Send the member's display name.

## Outreach campaigns (owner decisions 13 Nov 2026)

Outreach is for **medical** outreach. An organisation creates a campaign for a purpose (hepatitis B, HIV, diabetes,
high blood pressure, breast, cervical or prostate cancer, malaria, eye health, or a general check), invites its team,
registers people, screens them at one or several stations, decides an outcome, refers and follows up, and sees counts.
These decisions replace older notes where they conflict: in particular **every person registered gets their own Health
ID medical record at once** (the older rule was that an outreach group can't link and the person links later).

The website is built against the routes below; all are `proposed` in `packages/contracts/src/registry.ts` (names
`outreach.campaignPlan` … `outreach.campaignReport`) and answer 404 until served, which the website takes as "not
available yet" (`campaignApi.ts` `isNotOffered`: a 404 whose code doesn't start `OUTREACH_`). Types are in
`apps/patient-web/src/ehr-blue/departments/outreach/campaignTypes.ts`; calls in `campaignApi.ts`; default screening
packages and the outcome suggestion in `screeningTemplates.ts`; the offline queue in `offlineQueue.ts`.

### Routes

All under `/api/v1/outreach/registration-cases/`, with `X-Facility-ID`. Every POST takes an `Idempotency-Key` (the
device's `localCommandId`, see *Offline*); PUT, PATCH and DELETE take `If-Match: "<rowVersion>"` (412
`VERSION_CONFLICT` when stale). Permissions: existing `outreach.campaign.read/write` and `outreach.registration.read/write`,
plus two new ones: **`outreach.screening.write`** (station writes, outcome, referral, follow-up) and
**`outreach.sensitive.read`** (sensitive results, with a counsellor or clinician campaign role).

| Route | Method | Permission | What |
| --- | --- | --- | --- |
| `campaigns/:campaignId/plan` | GET, PUT | campaign.read / campaign.write | The plan (`OutreachPlan`). 404 `OUTREACH_PLAN_NOT_FOUND` before the first save; PUT with `If-Match: "0"` creates it. Coordinators only (403 `OUTREACH_COORDINATOR_REQUIRED`); 422 `OUTREACH_PLAN_INVALID`. |
| `campaigns/:campaignId/team` | GET, POST | campaign.read / campaign.write | GET `{ members: CampaignTeamMember[], you }` with each member's `registered` and `screened` counts. POST `{ name?, phone? \| email?, roles[], siteId?, station? }` invites by SMS or email; the same phone or email again answers the existing member (200), never a second invitation. 400 `OUTREACH_TEAM_CONTACT_INVALID`. |
| `campaigns/:campaignId/team/:memberId` | PATCH, DELETE | campaign.write | Change `roles`, `siteId`, `station` (null clears); DELETE removes (status `removed`; their counts stay). 409 `OUTREACH_TEAM_LAST_COORDINATOR`. |
| `campaigns/:campaignId/participants/search` | POST | registration.read | Body `{ phone?, healthId? }` (exactly one): personal data never goes in the address, so it stays out of gateway logs. Before registering. Minimal matches only (`ParticipantMatch`): initials, age, sex, masked phone, `hasHealthId`, and `caseId` + `visitCode` when already in this campaign. Never a record, name, date of birth or full phone. 400 `OUTREACH_SEARCH_INVALID` unless exactly one is given. Audited without the value. A read: no Idempotency-Key needed. |
| `campaigns/:campaignId/visits/by-code/:visitCode` | GET | registration.read | The visit (`OutreachVisit`) with that code in this campaign; 404 `OUTREACH_VISIT_NOT_FOUND`. |
| `:caseId/vitals` | POST | screening.write | `VitalsInput { siteId?, readings: { bp_systolic, bp_diastolic, pulse, temperature, weight, height, spo2, blood_sugar }, fasting?, takenAt }`. The server works out BMI. Answers the visit. |
| `:caseId/tests` | POST | screening.write (+ sensitive.read for HIV/hepatitis B) | `TestsInput { siteId?, results: [{ testId, result? \| value?, kitId?, kitLot?, attempt: 1\|2, takenAt }], consent? }`. Attempt 2 only after an invalid attempt 1 (422 `OUTREACH_RETEST_NOT_ALLOWED`). Each kit test (invalid ones too) counts against the site's kit lot; 422 `OUTREACH_KIT_UNKNOWN`/`OUTREACH_KIT_EXPIRED`. HIV needs `consent` (see *Consent*), else 422 `OUTREACH_HIV_CONSENT_REQUIRED`. |
| `:caseId/answers` | POST | screening.write | `{ answers: [{ questionId, value }] }`, merged by question. |
| `:caseId/outcome` | POST | screening.write | `OutcomeInput { kind: normal\|follow_up\|refer, urgency? (urgent\|routine, required for refer), reason, suggestedKind?, suggestedUrgency? }`. Counsellor or clinician role only (403 `OUTREACH_OUTCOME_ROLE_REQUIRED`). Stores `confirmedBy` (member, name, roles) and `confirmedAt`; keeps the suggestion so overrides can be counted. |
| `:caseId/referral` | POST, PATCH | screening.write | POST `{ partnerId, urgency, reason }` to a partner in the plan (422 `OUTREACH_PARTNER_UNKNOWN`); PATCH `{ status: made\|arrived\|not_arrived\|closed, notes? }`. |
| `:caseId/follow-up` | POST, PATCH | screening.write | POST `{ dueOn, reason }`; PATCH `{ status: due\|reached\|not_reached\|closed, notes?, dueOn? }`; `attempts` counts reached/not reached. |
| `:caseId/consent-code` | POST | registration.write | `{ purpose: registration\|hiv, language, version, guardianName? }` sends a 6-digit code by SMS to the case's phone; `{ challengeId, sentTo (masked), expiresAt, resendAfterSeconds }`. 422 `OUTREACH_PHONE_REQUIRED`. |
| `:caseId/consent-code/verify` | POST | registration.write | `{ challengeId, code }` → `ConsentRecord`. 400 `OTP_INVALID`, 410 `OTP_EXPIRED`, 429 `OTP_ATTEMPTS_EXHAUSTED`. |
| `:caseId/slip-sms` | POST | registration.write | `{ kind: visit_code\|results, language? }` → `{ sentTo, deliveryOutcome }`. Never carries a sensitive result: "results" for a person with one says "Your results are ready. Please see the counsellor." |
| `campaigns/:campaignId/dashboard` | GET | campaign.read | `CampaignDashboard` (see *Dashboard*). |
| `campaigns/:campaignId/follow-ups` | GET | registration.read | `{ items: CampaignFollowUpRow[] }`: name, full phone (the team calls them), visit code, site, follow-up, referral with the partner's name; `sensitive: true` rows carry a generic reason unless the caller may see sensitive results. |
| `campaigns/:campaignId/report` | GET | campaign.read | `CampaignReport`: counts only (see *Report*). |

### Registration makes the person's Health ID record

Registration stays on the served `POST /api/v1/outreach/registration-cases` with the **same request**. What changes is
the answer and what happens behind it:

- Outreach asks Identity to create a patient record with a Health ID for the person at once, marked **identity not yet
  checked** (`identityChecked: false`; a NIN can be added later, which checks it). The answer adds `healthId`,
  `patientId`, `visitCode` and `identityChecked`; `status` stays `identity_resolution_pending` until the identity is
  checked, so today's screens keep working.
- **Dedupe** before creating: the same phone number (normalised to its last 10 digits) or the same Health ID already
  known to Identity reuses that person's record instead of making a second (the answer then carries their existing
  `healthId`, and `possibleDuplicate: true` when the match was by phone only). A person found by the search who is
  already in this campaign is not registered again: the station opens their visit. *Open:* someone found by Health ID
  whose phone differs can only be tied to their record by the phone dedupe, since the request carries no Health ID; the
  served `link-existing` (by Health ID once it takes one, see the section above) or a later merge covers that.
- **Merge later**: two records later found to be the same person (a NIN added to both) are merged by Identity's
  existing merge, keeping both visits' history; the website shows nothing until then.
- The person can claim their record later (with their phone, or a NIN) and see their results, sensitive ones included.

### Visit codes

Short (`K7-4F2`: two characters, a dash, three), made by Outreach, random, **unique per campaign** while it runs, and
carrying no personal data (never derived from name, phone, date or Health ID). Alphabet without easily mixed-up
characters: `234679ACDEFGHJKMNPQRTWXY` (no 0/O, 1/I/L, 5/S, 8/B, U/V, Z). Case-insensitive on lookup. A code is never
reused within the campaign. Printed on the slip and sent by SMS (`slip-sms` `visit_code`).

*Open:* a registration made **offline** gets its code only when it reaches Outreach, so an offline device can't give a
code on the spot. Today that device carries on with the person itself (its station writes wait in the queue, tied to the
queued registration). If the owner wants codes offline, Outreach would need to accept a device-proposed code (from a
block reserved per device) — a request change, so not built.

### Consent

Stored per visit: **who** recorded it (member), **when**, **method** (`code` — the person read back the SMS code — or
`witnessed` — with the witness's name; today's `verbal_read_aloud`/`self_ticked`/`guardian` on registration count as
witnessed), **language**, **notice version**, and the guardian's name for anyone under 18. **HIV testing has its own,
separate consent** (`purpose: hiv`, the plan's `consent.hivText`/`hivVersion`), required on any `tests` POST with an HIV
test: `consent: { method: 'code', consentId }` or `{ method: 'witnessed', witnessName, language, version, guardianName? }`.

### Sensitive results

HIV and hepatitis B results (tests with `sensitive: true` in the package), and outcome, referral and follow-up reasons
that reveal them, are returned only to members whose campaign roles include **counsellor or clinician** and who hold
`outreach.sensitive.read`, and to the person themselves through their own record. Everyone else gets the visit without
those tests and with `sensitiveHidden: true`, and generic reasons. Dashboard and report give counts, never people. SMS
never carries a sensitive result. Testers may record a sensitive test (they do it) but read it back only with the role.

### Offline and idempotency

The device makes a `localCommandId` (UUID) for every write; it is the `Idempotency-Key` and the key in the device's
queue (IndexedDB, at most 14 days, wiped at sign-out). Outreach must answer a repeated key with the **same** result
(the same case, the same entry), for at least 14 days. A station write for a person registered offline waits until
the registration is sent, then goes with the real `caseId` (the device swaps its temporary reference before removing
the registration from the queue, so a crash in between only resends the registration, which replays). Writes are
independent: one refused doesn't stop the others. Writes carry `takenAt`, the time on the device, which the server
keeps beside its own received time.

### Dashboard aggregation

Worked out by the server from the visits, for the campaign: `registered`; `screened` (vitals or tests done);
`waiting` per station (previous station done, this one not, in the plan's station order); outcomes (normal, follow up,
refer urgent/routine, pending); per focus `screened`, `positive` (an abnormal result for that focus — a positive test,
or blood pressure ≥140/90 for hypertension, blood sugar over the threshold for diabetes) and `referred`; per member
`registered` and `screened`; per site and per hour (registrations); kits (`count`, `used` including invalids, `left`);
alerts (kit low under 25%, kit expiring within 30 days, more than 5 waiting at a station, invalid tests, urgent
referrals not yet seen, overdue follow-ups). Fresh within a minute is enough.

### Report

Counts only, nothing about any one person: totals, per site, by sex and age band, per focus, outcomes, referrals
(made, arrived, not arrived, waiting), follow-ups, kits used and invalid tests. `smallCountThreshold` (5): the website
shows a count under it as "fewer than 5"; the backend may also suppress them itself.

### Retention

The person's record and results are theirs and follow Health ID's normal retention. The campaign's operational data
(visit codes, team counts, kit use, follow-up notes) is kept for the campaign's life plus the period the owner sets for
outreach groups; visit codes stop resolving when the campaign closes. Deletion on the person's request uses the existing
`admin.outreachRegistrationRedact`. Nothing personal is kept on devices beyond the 14-day queue.
