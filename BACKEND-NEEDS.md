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
