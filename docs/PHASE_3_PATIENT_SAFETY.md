# Phase 3 Patient Safety — Patient Portal

Branch: `phase-3-patient-safety` (base `phase-2-provider-reconciliation`).
Backend contract: hid-system `phase-3-patient-safety` (`docs/PHASE_3_PATIENT_SAFETY.md`,
ADR-036, `docs/INTERFACE_CONTRACT.md`).

The portal is only an interface. Ownership, fresh sign-in, single-use
confirmation, retention/legal-hold checks, contact verification, and
emergency-recipient eligibility are enforced by the backend. The browser never
mutates identity, account, clinical, consent, audit, or notification data
directly, and the confirmation token is held in component memory only.

## Settings → Delete account

Explains, before any request: sign-in ends; every device is signed out; access
granted to providers and the Access PIN are withdrawn; the Health ID and the
medical records facilities hold are kept (emergency care rules still apply);
some security and audit records are kept; the configured cancellation window;
and that a legal hold blocks deletion. Flow: acknowledgement → request (requires
a sign-in within the last 10 minutes) → type `DELETE MY ACCOUNT` → scheduled
deletion with **Cancel deletion**, a plain-language block reason, or a terminal
"Your account has been deleted" state.

## Settings → Emergency contacts

Add (name, relationship, SMS or email, notification preference), send a
verification code, enter the code the contact reads back, edit name/relationship/
notification preference, and remove. Each contact shows
`Not verified · will not be notified`, `Verified · notifications off`, or
`Verified · will be notified in an emergency` from the backend
`eligibleForEmergencyNotification` field. The destination is shown only as the
backend's masked hint. While backend delivery is disabled, sending a code shows
that the contact stays unverified.

## Access page

- **Revoke access** uses the patient route
  `POST /api/v1/identity/me/consent-grants/:grantId/revoke` and is offered only
  when the backend marks a grant `patientRevocable`. The staff
  `consent-grants/:id/close` route is not granted to the patient portal.
- The previous button never sent a request: one state value was used both for
  "which form is open" and "request in progress". They are now separate.
- Emergency (break-glass) grants are labelled and explained; they are not
  patient-revocable.

## Contracts

New registry entries (`packages/contracts/src/registry.ts`) and patient grants
(`boundaries.ts`): `identity.accountDeletion`, `identity.accountDeletionConfirm`,
`identity.accountDeletionCancel`, `identity.emergencyContacts`,
`identity.emergencyContact`, `identity.emergencyContactDeactivate`,
`identity.emergencyContactVerification`,
`identity.emergencyContactVerificationConfirm`, `access.revokeMyGrant`.
`/api/v1/notifications/emergency-contact-alert` is a workload-only route.

## CI

`.github/workflows/ci.yml` now runs for pull requests targeting `main`,
`phase-1-patient-core`, `phase-2-provider-reconciliation`, and
`phase-3-patient-safety`. Required steps are unchanged.
