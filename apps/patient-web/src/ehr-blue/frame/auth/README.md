# Blue sign-in pages

The design's staff sign-in, password recovery and invitation pages
(`design/ehr-target` `screens/2-sign-in`, `3-forgot-password` and
`4-staff-invitation`), drawn in the blue EHR's look and working as today's
pages do.

| Page | Today's page it replaces | Address | Routed in |
|---|---|---|---|
| `BlueSignIn.tsx` | `staff/routes/SignIn.tsx` | `/provider/sign-in` | `staff/App.tsx` |
| `BlueRecovery.tsx` | `routes/PrincipalRecovery.tsx` (`audience="staff"`) | `/provider/recover` | `App.tsx` |
| `BlueStaffInvitation.tsx` | `staff/routes/StaffInvitation.tsx` (Novu) | `/provider/invitation` | `App.tsx` |

## When they open

Only once the clinic switch is on: `blueForAll()` (`ehr-blue/clinicSwitch.ts`
`BLUE_FOR_ALL`, with both page sets merged). The rule is the switch, not the
facility: nobody is signed in on these pages yet. Until then today's pages serve
the same addresses and the blue ones are never downloaded (each is a lazy
import in the route file). The Design tour shows the design's journeys.

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

`SignIn.tsx` keeps `TurnstileChallenge`, `passwordRefusal` and
`getStaffLandingPath` inside the page, and `StaffInvitation.tsx` keeps its link,
support and date helpers; `signInParts.tsx` and the top of
`BlueStaffInvitation.tsx` copy them word for word. Moving each into one shared
module is for the offline work, which owns `SignIn.tsx`.

## Where they differ from the screenshots, and why

- **No photograph.** The story panel is drawn in the brand's blues. The
  design's photo has no known licence.
- **Today's sign-in steps.** These are password, Turnstile, then the
  authenticator or its set-up. The design signs in with an emailed code from a
  simulated inbox, which Health ID does not do.
- **Show, not an eye.** The password toggle says "Show" / "Hide": the design's
  eye icon is not in the EHR icon set.
- **Work email.** The recovery page asks for a work email, not "Email or
  phone", and its button says "Send recovery code", not "Generate recovery
  code". Identity resets staff accounts by work email, and sends a code.
- **The invitation opens on today's form** (email address and code). The
  design opens one already loaded from its link.
- **No demo footer.** The "Local demonstration · fictional records only" line
  is left out: these are live pages.
- **Live notes the design lacks** are drawn in its style: the MFA notice,
  the clinician application entry, the main-site and EHR-site pointers.
