# Blue sign-in pages

The Hospital EHR's staff sign-in, password recovery and invitation pages,
drawn in the redesign's auth look (the shared `AuthLayout`, Kasuwa buttons and
alerts, light and dark) and working as today's pages do. The redesign is the
final design, so the EHR design's own look (`design/ehr-target` screens 2–4)
is not drawn; `hid-ehr-blue-auth` only marks the pages.

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
- **Hosts.** Each product site keeps every way in on itself: sign in, register,
  recover access and accept an invitation. The production patient portal and
  the admin sites open the same page on the EHR site at once; existing staff
  accept an invitation signed in on their own site. Identity opens no
  invitation for a browser signed in on the site, so someone signed in there
  is offered the signed-in join page with the link, or to sign out first.

`SignIn.tsx` keeps `TurnstileChallenge`, `passwordRefusal` and
`getStaffLandingPath` inside the page, and `StaffInvitation.tsx` keeps its link,
support and date helpers; `signInParts.tsx` and the top of
`BlueStaffInvitation.tsx` copy them word for word. Moving each into one shared
module is for the offline work, which owns `SignIn.tsx`.

## Where they differ from today's pages

- **Today's sign-in steps.** Password, Turnstile, then the authenticator or
  its set-up, drawn exactly as the redesign's provider sign-in draws them.
- **Ways in.** The pages link to each other: register a hospital, sign in,
  recover access, accept an invitation.
- **Refusals are boxed.** Every refusal is a Kasuwa `Alert`; one about the
  field focus is moving to is not announced twice.
