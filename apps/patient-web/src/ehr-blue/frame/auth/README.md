# Blue sign-in pages (drafts, not wired in)

The design's staff sign-in, password recovery and invitation pages
(`design/ehr-target` `screens/2-sign-in`, `3-forgot-password` and
`4-staff-invitation`), drawn in the blue EHR's look and working as today's
pages do. Nothing imports them yet: today's pages still serve every address.

| Draft | Today's page it would replace | Address |
|---|---|---|
| `BlueSignIn.tsx` | `staff/routes/SignIn.tsx` | `/provider/sign-in` |
| `BlueRecovery.tsx` | `routes/PrincipalRecovery.tsx` (`audience="staff"`) | `/provider/recover` |
| `BlueStaffInvitation.tsx` | `staff/routes/StaffInvitation.tsx` | `/provider/invitation` |

## What stays today's

- **Calls and steps.** `useStaff()`'s `login`, `verifyMfa`, the enrolment
  calls and `completeSignIn`; `createPrincipalRecoveryApi('staff')`; and
  `staffInvitationApi`. No new endpoint and no new storage: the recovery
  challenge lives in component memory, and the invitation link is kept in
  the history entry, as today.
- **Turnstile.** The sign-in's own widget with `staffLoginAction(hostname)`,
  and the shared `Turnstile` with `staff-reset` and `staff-invitation`. A token
  is used once and the widget renews after every attempt.
- **MFA and recovery codes.** `StaffMfaSteps` itself, given a blue `look`.
- **Refusals.** Identity's message, and the portal's own words where it has
  them: `STAFF_MFA_FACTOR_UNPROVEN`, `STAFF_MFA_UNAVAILABLE`, the clinician
  application note, `joinProblemText`, the code-budget hint, the password
  mismatch.
- **Hosts.** Each page sends people where today's does: staff sign in on the
  EHR site, reset on the main site, and accept existing staff invitations on
  their own site.

## How they would replace today's pages

1. **When.** Once `blueForAll()` is true (both `clinical/pages.ts` and
   `departments/pages.ts` merged). The rule must be that one, not the
   facility: nobody is signed in on these pages yet.
2. **Share the private rules first.** `SignIn.tsx` keeps `TurnstileChallenge`,
   `passwordRefusal` and `getStaffLandingPath` inside the page, and
   `StaffInvitation.tsx` keeps its link, support and date helpers. The drafts
   copy them word for word (`signInParts.tsx`, the top of
   `BlueStaffInvitation.tsx`). Move each into one shared module that both
   pages import, together with the offline work, which owns `SignIn.tsx`.
   Then delete the copies.
3. **Route.** In `App.tsx`, where the three paths are routed, lazy-load the
   blue page when `blueForAll()` holds and today's page otherwise. The
   addresses, the product-host rules and the Turnstile actions stay the same.
4. **MFA fields.** `StaffMfaSteps` draws its code fields with `@hid/ui`'s
   `Field` and `Input`. Give `StaffMfaLook` a field slot so the blue look can
   pass `EhrField`/`EhrInput`. Until then the codes keep today's inputs inside
   the blue page.
5. **Tests.** Today's tests for the three pages run against the blue pages
   too (same calls, same words). The drafts' own tests are in
   `__tests__/ehr-blue/frame/auth/`.

## Where they differ from the screenshots, and why

- **No photograph.** The story panel is drawn in the brand's blues. The
  design's photo has no known licence.
- **Today's sign-in steps.** These are password, Turnstile, then the
  authenticator or its set-up. The design signs in with an emailed code from a
  simulated inbox, which Health ID does not do.
- **Work email.** The recovery page asks for a work email, not "Email or
  phone", and its button says "Send recovery code", not "Generate recovery
  code". Identity resets staff accounts by work email, and sends a code.
- **No demo footer.** The "Local demonstration · fictional records only" line
  is left out: these are live pages.
- **Live notes the design lacks** are drawn in its style: the MFA notice,
  the clinician application entry, the main-site and EHR-site pointers.
