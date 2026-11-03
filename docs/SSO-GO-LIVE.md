# Single sign-on: when VITE_HID_SSO may be switched on

Owner's decision, 2 November 2026.

`VITE_HID_SSO` is the website build setting that turns on single sign-on across
the Health ID sites (Ola's health#100, the sign-in hand-off, and health#102, the
site switch-back). Both ship dark: a build without the setting, or with it unset,
empty, `0` or `false`, keeps today's sign-in pages on every site.

Switch it on only when both of these are true:

1. Identity single sign-on is live in production. Ola's hid-system#142 is ported
   to the production backend with the next free migration number, the owner has
   signed its declaration, and the backend release is deployed and checked.
2. Sign-in and sign-out have been confirmed across the sites on production:
   app., ehr., lab., pharmacy., migrate. and outreach. Signing in on one site is
   recognised on the others, and signing out on one ends the sign-in on all of
   them.

Then turn it on in a website release of its own, with nothing else in it, so it
can be turned off again by releasing the build before it.

Until then, no build for production or staging sets `VITE_HID_SSO`.
