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
"This isn't set up for your account. Contact support. What you entered is still here."; `413`, or the UI's own
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

**Served or not.** The records answer carrying `patientEntries` (a list, empty or not), or a Save answering 201, means
served. A records answer without the key (today's), or a Save's 404 `NOT_FOUND` (an unrouted path), means not served,
but only while nothing has said otherwise; a `patientEntries` that is not a list is left out and says neither. The UI
keeps this in memory only (`apps/patient-web/src/patientEntriesServed.ts`). Without the key the Records page sends
exactly today's requests and looks exactly as today. Until served, the drawer's Save gets that 404 and says "This
isn't set up for your account"; no file leaves the device until the Save and that file's upload link have both been
answered. While patient uploads are off (before NDPA sign-off or migration 0110), the records answer leaves out
`patientEntries`, and every patient-entry route answers exactly as if it were not built (`404 NOT_FOUND`): off must
look the same as not built, never a code of its own (a `404 PATIENT_ENTRIES_DISABLED`, say, would only read "Your
record couldn't be saved. Please try again."). The backend must not send `patientEntries` until uploads are cleared
under the NDPA, because that one served signal turns on both the entries list and uploads.

Registered as `ehr.myPatientEntries` (POST), `ehr.myPatientEntryUploadIntent`, `ehr.myPatientEntryDocumentComplete`
and `ehr.myPatientEntryWithdraw` (status `proposed`) in `packages/contracts/src/registry.ts`; the list is part of
`ehr.myRecords`.

## 2. Send my card by email, opened with a one-time code (step 8, hid-system 0118; proposed)

**Status:** the website is built and **switched off** (`VITE_HID_CARD_SHARES`, false in `config/staging.json` and
`config/production.json`; production's release refuses `true`). Every route below must answer a plain `404 NOT_FOUND`
(as if unrouted) while the backend's `CARD_LINKS_ENABLED` (identity-api, ehr-api and notification-api) is off. Turning either on needs legal sign-off (D13, NDPA).
Design: Akos step 8 design and critique (4 Nov 2026), with the owner's answers to all 13 questions (the recommended
options) and every critique fix. The backend that serves it is hid-system `claude/card-links-0118` (its
`docs/INTERFACE_CONTRACT.md` §33); this section was reconciled with it after review (findings F1 to F6). This replaces the old open link (`GET /identity/shared-cards/:token`, registered as
`identity.sharedCard`), which carried the secret in its path and is retired.

**What the website does.** The patient sends their card to any email address from Access and sharing ("Send my card"):
the address, an optional private label (only the patient sees it), **Card only** or **Card and records**, and **24
hours** or **7 days** (no 30 days in v1). The check step is the consent record; it says what is shared, that records
added while the link is open are included, that the person can keep a copy of what they see, that anyone who can read
that inbox can open it, and that an earlier link to the same address ends. Email only: the website never shows a link to
copy. The person who receives it opens `/card#<token>`, presses **Email me a code**, enters the 6 digits and sees the card
(and the records, if allowed), read only.

### Patient routes (identity-api, patient session, CSRF)

| Route | Body and answer |
|---|---|
| `GET /api/v1/identity/me/card-shares` | 200 `{ items: CardShare[], createdToday, dailyLimit, liveCount, liveLimit }`: live links and those ended in the last 30 days. Also the website's check that the feature is served. |
| `POST /api/v1/identity/me/card-shares` | `Idempotency-Key` required; recent sign-in. Body `{ email, label?, scope: 'card' \| 'card_and_records', duration: '24h' \| '7d' }` and **no other field**: the backend refuses unknown fields (400), and records the check step's version itself (`card-share-v1`, the website's `CARD_SHARE_CONSENT_VERSION`; a new wording needs a new version on both sides). 201 `{ share, delivery, replacedId, replayed: false }`; 200 with `replayed: true` for the same key and body. A live link to the same address ends (`replaced`). The website makes a new key for each send (kept only to retry one that failed), and says "Your card was already sent" for a replay. |
| `POST /api/v1/identity/me/card-shares/:id/end` | No body. 200 `{ share }`, the same when it had already ended. The person it was sent to is not told. |

`CardShare = { id, reference, recipientEmail (null once ended), label (null once ended), recipientHint, scope, duration,
createdAt, expiresAt, status: 'active' | 'locked' | 'ended' | 'expired', endedAt, endedReason, lockedUntil, delivery:
'sent' | 'not_sent' | 'pending', openCount, lastOpenedAt }`. `endedReason` is one of `patient_ended`, `replaced`,
`expired`, `account_deleted`, `patient_inactive`, `address_blocked`, `too_many_wrong_codes`.

Refusals the website words: 400 `CARD_SHARE_EMAIL_INVALID`, `CARD_SHARE_OWN_EMAIL`, `CARD_SHARE_DURATION_INVALID`,
`CARD_SHARE_SCOPE_INVALID`, `CARD_SHARE_LABEL_INVALID`; 403 `PATIENT_RECENT_AUTH_REQUIRED`, `PATIENT_RECENT_RECOVERY_HOLD`;
409 `IDEMPOTENCY_KEY_REUSED`, `CARD_SHARE_LIVE_LIMIT` (20 live); 429 `CARD_SHARE_CREATE_LIMITED` (5 a day),
`CARD_SHARE_ADDRESS_LIMITED` (2 a day to one address, owner answer 10); 404 `CARD_SHARE_NOT_FOUND` on end.

- **Limits per address across all patients** are a high cap with an ops alert, not a silent refusal, so a clinic inbox
  is never blocked (critique 14). A blocked address, a capped one and a failed send all answer `delivery: 'not_sent'`
  alike (critique 15); the list says "We couldn't email this one. Try again tomorrow."
- **Email the patient on every new link** (E8, owner answer 9): a security notice with no health data. The done step says
  so.

### Receiver routes: one gateway prefix, `/api/v1/card-share/` (critique fix 2)

All public, `Cache-Control: no-store`, **never 401** (a patient's session in the same browser is never read, refreshed
or ended), and the token only ever in a POST body. Cookies are scoped `Path=/api/v1/card-share`. The website calls
them with its own client outside the patient session, sends no `X-CSRF-Token`, and never retries.

| Route | Body and answer |
|---|---|
| `GET availability` | 204 while on. 404 keeps the page dormant. |
| `POST code` | `{ token (43 chars, base64url), turnstileToken }`, Turnstile action **`card-share-code`**. 202 `{ sentTo, expiresInSeconds: 600, resendAfterSeconds: 60 }`, plus an HttpOnly session cookie binding the code to this browser (critique 6). |
| `POST verify` | `{ token, code }`. 200 `CardView` and the view cookie (HttpOnly, Secure, SameSite=Strict, **no Max-Age**: a session cookie; the server ends the view after 30 minutes). |
| `GET view` | `X-Card-View: <viewId>`. 200 `CardView`. The page asks every 30 seconds while the card is shown (critique 4). |
| `GET records` (ehr-api) | `X-Card-View`. 200, every key present (below). |
| `POST end-view` | `X-Card-View`, no body. 204 and the cookie cleared; 204 too when already ended. |
| `POST stop` | `{ stopToken }`: the separate stop token from E5 and E6's `/card/stop#<stopToken>` (the link's id, a dot, 43 base64url characters), never the card's token. No security check. 204 for any well-formed token, known or not; a genuine one blocks card emails to the address, ends its live links and tells the patient (`SHARED_CARD_STOPPED`). 400 `CARD_SHARE_LINK_INVALID` for a malformed one. The website's `/card/stop` sends it only when the person presses **Stop these emails**; the card page itself has no stop button (it holds only the card's token) and points to the link in the email. |

`CardView = { viewId, card: { fullName, healthId, ninVerified }, scope, sharedByFirstName, recipientHint, reference,
expiresAt, viewExpiresAt }`. **No photo** is shared: the website promises none, and the receiver's card face and the
patient's preview show initials. One live view per link. **`viewId` is not a secret**: every later read names it in `X-Card-View`, and the
server answers **409 `CARD_SHARE_VIEW_CHANGED`** when it is not the view the cookie holds, so two links opened in one
browser can never show one patient's records under another's card (critique 1). Either one cookie per view
(`hid_card_view_<viewId>`) or a check of the header against the single cookie works for the website.

Records answer: `{ encounters, notes, importedRecords, importedHealthProfile, healthProfile: { bloodGroup, genotype,
allergies, chronicConditions, medications, notes } | null, patientEntries (active, first 50),
patientEntriesMore, diagnoses: [], prescriptions: [], labRequests: [], vitals: [], documents: [], limit }`. For a
**card-only** link every list is empty and `healthProfile` holds blood group, genotype and allergies only. File names
and types only: no download. `medications` and `notes` are ehr-api's names for the profile's `currentMedications` and
`medicalNotes`; the website reads either, and shows "Not available" (not "Not stated") for a field the answer leaves out.

Refusals the website words: 400 `CARD_SHARE_LINK_INVALID`, `TURNSTILE_*`, `CARD_SHARE_CODE_WRONG` (with `attemptsLeft`);
410 `CARD_SHARE_ENDED` (unknown, ended or expired alike: one constant answer), `CARD_SHARE_CODE_EXPIRED`,
`CARD_SHARE_VIEW_ENDED`; 409 `CARD_SHARE_VIEW_CHANGED` (the website clears the screen if it ever comes); 429
`CARD_SHARE_LOCKED { retryAfterSeconds }`, `CARD_SHARE_CODE_LIMITED { retryAfterSeconds }`, and the gateway's own 429. The
backend names the wait in the problem body only; the website reads a `Retry-After` header first and the body's
`retryAfterSeconds` otherwise. A right code entered in a browser other than the one that asked for it counts as
**wrong** (`CARD_SHARE_CODE_WRONG`, a try used), so the website's words for a wrong code say to enter it in the browser
where it was asked for. The website never shows a server's own words.

### Inbox and Activity

- Inbox codes, resource type `card-share`, metadata `{ recipientHint, reference }`: `SHARED_CARD_OPENED` ("Someone
  opened your card using the link sent to a•••"), `SHARED_CARD_LOCKED` (the first lock), **`SHARED_CARD_ENDED`** with
  `reason: 'too_many_wrong_codes'`, sent once when the second 1-hour lock ends the link (owner answer 11), and
  **`SHARED_CARD_STOPPED`** when the address asked to stop card emails.
- Activity (0093's access log): actions `card_opened` (actor kind `card_recipient`), `card_shared`, `card_ended` (actor
  `patient`), each with **`recipientHint`** on the event. The website words them "using the link sent to a•••". An older
  website drops unknown kinds.

### Emails, retention and the receiver's notice

- E5 (link) and E6 (code) carry nothing but the link, the code, the reference, the "Stop these emails" link
  (`<patient host>/card/stop#<stopToken>`, its own token) and the privacy notice link (`<patient host>/card/privacy`). Click and open
  tracking off (owner answer 13). E6 says who asked and that the code must never be given to anyone.
- Hosts: production `https://app.healthidentitydirectory.com/card`; staging `https://staging.healthidentitydirectory.com/card`
  (the `web` host in `config/staging.json`).
- Retention (owner answer 13): network data 30 days; hint and address hash 12 months after the link ends, then null;
  block list until removed; card-share rows anonymised when an account deletion completes. Processors named: Amazon SES,
  Brevo, Cloudflare Turnstile, Sentry. The website's notice at `/card/privacy` says exactly this.

### Not in the website (backend or later)

- The 30-day choice and its day-7 reminder (not offered in v1). The E8 email itself. The ops alerts.
- `docs/email/share-card.html` still shows the old card-face email; replacing it with E5 is W0's.

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
