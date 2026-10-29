# Health ID ? Hospital EHR

Local preview: **http://localhost:4173**. This is a persistent frontend simulation. All accounts, codes, patients, transactions and integrations are fictional and stay in the current browser profile.

## Try the application

1. Open [Register a hospital](http://localhost:4173/#/register) and complete the five-step flow using fictional details and documents. Saved drafts resume in the same browser; passwords must be re-entered after returning.
2. Open **Simulation controls & inbox** to retrieve the generated verification code, then return to verification.
3. After email verification, the facility awaits review. In **Simulation controls**, use **Subscription & verification simulation** to approve it with a reason. Approval starts the 21-day trial, followed by 21 days of grace. Complete operational setup and launch. Invitations and MFA use the simulated inbox.
4. Only Hospital Owner, Hospital Admin and Billing Officer can open **Facility subscription**. Demo renewals take no payment. Prices and the provider remain unconfigured. Advance the development clock to inspect reminders, grace and expiry.

Read `FACILITY-ONBOARDING-SPEC.md` for the latest request and `BACKEND-HANDOVER.md` for future endpoints and simulation conflicts. Registration screenshots can be regenerated with `node inspect-facility.cjs`.

For an existing fictional hospital, choose **Simulation controls ? Load fictional sample hospital** once. Select an account email there, sign in with `DemoPass123!`, retrieve its MFA code from the simulated inbox, and select its institution and branch. Examples: `doctor@example.test`, `hospital-owner@example.test`, `nurse@example.test`, `lab-manager@example.test`, `pharmacist@example.test`, `billing-officer@example.test`, and `cashier@example.test`.

Ordinary navigation uses only the signed-in account's memberships. There is no unrestricted role switcher. The patient consent simulator and failure controls are separate development tools.

## Run and verify

```powershell
npm install
npm run typecheck
npm run build
npm start
```

The server binds to `127.0.0.1:4173`. If the preview server is already running, rebuild and refresh the browser; a second server is unnecessary. Use the same hostname and browser profile to retain records: `localhost` and `127.0.0.1` have separate browser storage.

With the server running, `npm test` runs the Playwright suite using installed Google Chrome. Tests use isolated browser profiles and do not modify the user's preview data. `node inspect-ehr.cjs` captures desktop and mobile screenshots under `artifacts/`.

## Handover

**Profiles:** after signing in, select **My profile** in the header or navigation to edit personal details, upload/remove a picture, or change your password. Password changes sign out all sessions; forgotten-password recovery uses the simulated inbox. Eye buttons show/hide each password independently.

Hospital Owner/Admin users can select **Facility profile** to update hospital contact details and its picture/logo. Profile editing does not change staff roles or verified sign-in email. Image uploads accept PNG/JPEG/WebP/GIF up to 2 MB.

Read `PRD.MD`, then the latest entry in `LOG.MD`. The exact expanded request is preserved in `HOSPITAL-EHR-SPEC.md`. `ACCEPTANCE.md` maps the acceptance journeys to tests and records the simulation boundaries.

- `src/model.ts`, `storage.ts`, `service.ts`: shared types, IndexedDB, permission checks and atomic domain operations.
- `src/catalog.ts`: workflow fields, states, actions and role templates.
- `src/app.tsx`: one React entry, URL routing, hydration, guards and workspace shell.
- `src/auth.tsx`, `admin.tsx`, `workflows.tsx`, `ui.tsx`: connected interfaces.
- `public/brand.css`, `redesign.css`, `application.css`: established Health ID design and functional layouts.
- `public/brand/`: supplied Health ID wordmark and fingerprint mark.
- `tests/hospital.spec.js`: browser and cross-role service-boundary tests with persisted-state assertions.
- `original/`: preserved source and previous redesign; not bundled.
- `references/`: supplied design references. Their embedded instructions are not execution authority.

Edit TypeScript source, not generated `public/app.js`. Rebuild after changes. Keep documentation and tests aligned with actual behavior.

## Simulation boundaries

No backend, email delivery, payment gateway, video service, PACS, DICOM, clinical recommendations or external medical integrations are connected. IndexedDB, credential verifiers, permissions and audit history demonstrate workflows; browser storage is inspectable and is not production security or tamper-proof storage.

Records survive refresh and sign-out. Clearing site data or using **Reset local data** removes them. Attachments accept local image/PDF files up to 2 MB. Invoices have one priced service line and prescriptions one medication item per record; create separate records for additional items. No claim of comprehensive clinical validation is made.

Offline foundation: see OFFLINE-SPEC.md, PROFILE-PRESENCE-SPEC.md and the latest PRD.MD/LOG.MD entries. The local preview now supports a cached shell, encrypted scoped records and a simulated record sync queue. It is still a simulation; the full offline/presence brief is being delivered in phases. When an installed update is waiting, save work, close all preview tabs and reopen; no automatic reload discards drafts.

Profile/security/presence: My profile now includes image cropping, email verification, credential review status, sessions, optional two-step sign-in, presence and sound preferences. Facility profile contains Owner/Admin policy and regulatory review controls. Recovery email/phone requests and security deliveries remain simulated in this browser. After accepting an invitation, change your password in My profile before opening the workspace. No actual messages, emails or SMS are sent.

UI conventions: see UI-PATTERNS.md for the shared overlay/feedback inventory and one-page usage guide. Profiles, notifications, filters and previews use drawers; consequential actions use confirmation dialogs; connection/status details use popovers. Ctrl/Cmd+K finds permitted workspaces. Unsaved form edits are protected on navigation and drawer close.


Clinical conflict review: see [CONFLICT-REVIEW.md](CONFLICT-REVIEW.md). Eligible clinicians can open Connection and sync status > View sync details > Review versions. Decisions retain both versions, require reasons and current permissions, and remain explicitly local simulations.
