# Health ID Hospital EHR: target design (read-only reference)

This branch holds the owner's target design for the rebuilt Health ID Hospital EHR (the blue design). It exists so Claude Code sessions can read it. **It is a reference only: never merge it into `main` or any other branch, and never change it in a pull request.** It shares no history with `main`.

What is here:
- `src/`: the React and TypeScript source of the target prototype (`model.ts`, `storage.ts`, `service.ts`, `catalog.ts` and the screens). It is a front-end simulation: all accounts, codes and patients are fictional and stay in the browser.
- `public/`: the unhashed stylesheets (`base.css`, `brand.css`, `redesign.css`, `application.css`, `feedback.css`), fonts, brand images and `index.html`. Built bundles were left out; run `npm install && npm run build` to rebuild them, then `npm start` (serves http://127.0.0.1:4173).
- `artifacts/`: screenshots of the target screens (desktop and mobile).
- `tests/`: the prototype's Playwright journeys.
- The specifications: `PRD.MD`, `HOSPITAL-EHR-SPEC.md`, `UI-RULES.md`, `UI-PATTERNS.md`, `UI-SCREEN-MAP.md`, `UI-MODULE-AUDIT.md`, `UI-SIMPLIFICATION-SPEC.md`, `UI-SIMPLIFICATION-AUDIT.md`, `OVERLAY-SPEC.md`, `PROFILE-PRESENCE-SPEC.md`, `FACILITY-ONBOARDING-SPEC.md`, `ROLE-PROVIDER-MATRIX.md` and `.csv`, `ACCEPTANCE.md`, `BACKEND-HANDOVER.md`, `CONFLICT-REVIEW.md`, `OFFLINE-SPEC.md`, `LOG.MD`.

Left out: `node_modules/`, third-party inspiration (`references/`), an older purple draft (`original/` and the top-level PNG screenshots), test results and built bundles.

Target design tokens (blue): brand `#086dd9`, brand dark `#075fbe`, tint `#eaf4ff`, ink `#0b1b2e`, body text `#484f58`, muted `#5b6b80`, line `#e3e9f0`, positive `#12805c`, critical `#b3261e`; headings in Playfair Display, text in Geist.

Where the live product differs from this prototype, the live rules win until the owner decides otherwise: consent, audit, no patient data stored in the browser except the encrypted offline vault, and facility self sign-up keeps the live CAC (QoreID) verification.
