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
`application/pdf`, `image/jpeg` or `image/png`; up to 10 MB each, at most 5 files per entry. The server sets the
patient, the classification and the retention; the browser sends none of them. Answers
`201 { document: { id, status: 'initiated', scanStatus: 'pending' }, upload: { method: 'PUT', url, requiredHeaders, expiresInSeconds } }`,
the staff shape. The same key asked again once that file is confirmed (a confirm that went through though its answer
was lost) answers `409 PATIENT_DOCUMENT_ALREADY_UPLOADED` with `document: { id, status, scanStatus }`: the UI counts
that file as uploaded and sends no PUT and no confirm for it. The UI goes by the 409 and its `code` alone and does not
read `document`. Any other 409, or that code with another status, is a failed upload.

**3. PUT the file** to `upload.url` with `requiredHeaders`: the exact bytes that were hashed, no cookies. The document
bucket's CORS must allow this PUT from the patient host (app.) and its staging and development hosts.

**4. Confirm.** `POST /api/v1/ehr/me/patient-entries/:entryId/documents/:documentId/complete`, no body; only the
account that asked for the link may confirm. The server checks the stored object's size, SHA-256 and type. Answers
`200 { document: { id, status, scanStatus } }`; a missing or mismatched object answers `409 PATIENT_DOCUMENT_UPLOAD_INCOMPLETE`.

**List.** No route of its own: the records answer the Records page already reads, `GET /api/v1/ehr/me/records`,
carries a new key
`patientEntries: [{ id, source: 'patient', kind, title, facilityName, occurredOn, notes, createdAt, documents: [{ id, fileName, mediaType, sizeBytes, status, scanStatus, createdAt }] }]`,
newest first. Only confirmed documents are listed, and removed entries are left out. The UI lists these as "Added by
you" on the Records page from that answer, and reads the records again after a Save or a removal. An entry or file
missing what it needs is left out, and a status the UI does not know never reads as clean. Each file shows its name,
type, size and virus check ("Checking for viruses" while `scanStatus` is `pending`, "Couldn't be checked" when
rejected); no file can be opened there yet, since this contract has no patient download.

**Remove.** `POST /api/v1/ehr/me/patient-entries/:entryId/withdraw`, no body, answers
`200 { entry: { id, status: 'withdrawn', withdrawnAt } }`, and a replay answers the same. From then on the entry and
its files are gone from `patientEntries`, the patient chat and every staff read. Nothing is erased, so the UI says "Removed
from your records", never "deleted".

**Who reads.** The patient, always. Staff only as they read the patient's imported history: at a facility whose own
membership holds an active consent grant for the patient (a share at any level, an approved access request, the desk
PIN, or emergency access); a deny overrides it, and revoking or expiry ends it. The facility name the patient types
gives that facility nothing. Every staff read is logged and raises "Your records were opened". Nobody but the patient
writes, at any share level.

**The patient chat** reads each live, confirmed, scan-clean patient document as it reads other documents, labelled
"Patient provided file; machine extracted, not clinician verified", and each entry's kind, title, place, date and notes
as patient-reported.

**Served or not.** The records answer carrying `patientEntries` (a list, empty or not), or a Save answering 201, means
served. A records answer without the key (today's), or a Save's 404 `NOT_FOUND` (an unrouted path), means not served,
but only while nothing has said otherwise; a `patientEntries` that is not a list is left out and says neither. The UI
keeps this in memory only (`apps/patient-web/src/patientEntriesServed.ts`). Without the key the Records page sends
exactly today's requests and looks exactly as today. Until served, the drawer's Save gets that 404 and says "This
isn't set up for your account"; no file leaves the device until the Save and that file's upload link have both been
answered.

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
