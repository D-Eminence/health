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
