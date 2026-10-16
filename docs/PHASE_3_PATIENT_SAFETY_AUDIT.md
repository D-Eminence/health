# Phase 3 Patient Safety and Account Lifecycle Frontend Audit

Branch: `phase-3-patient-safety-audit`
Base: `phase-2-provider-reconciliation`

## Existing

- Patient self-service authentication/session integration exists.
- Patient profile and records surfaces exist.
- Patient notification inbox capability exists in the backend integration surface.
- Break-glass provider workflow is already represented by the provider portal capabilities.

## Missing

### Patient account deletion
No dedicated patient-facing flow was found for:
- deletion request;
- fresh identity/re-authentication confirmation;
- deletion verification;
- retention warning and acknowledgement;
- deletion status;
- completion / signed-out terminal state.

### Emergency contact management
No patient-facing emergency-contact management flow was found for:
- adding an emergency contact;
- verifying the contact channel;
- changing or revoking the contact;
- viewing notification status.

## Required implementation boundary

The frontend must consume authoritative backend lifecycle APIs. It must not directly mutate identity, account, clinical, consent, audit, or notification tables.

No merge or deployment is part of this audit.
