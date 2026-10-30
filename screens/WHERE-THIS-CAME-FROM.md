# Where these files came from

- `screens/`: the owner's screenshot pack of every page in the target Hospital EHR (217 files, 1440 px desktop captures, fictional data). Its own README lists every file, screen and route.
- `zip-extras/`: the parts of the owner's Dashboard.zip that were not on this branch yet: the root screenshots (`dashboard.png`, `login.png`, `mobile.png`, `mobile-menu.png`, `patients.png`), `original/` (the first redesign source) and `references/`.

This branch stays a read-only reference. Never merge it into main.

## Authority (owner decision, 30 October 2026)

These files (this branch: `screens/`, `zip-extras/`, the prototype in `src/` and `public/`) are the authoritative UI and UX design for the Health ID Hospital EHR: layout, colours, type, copy and flows. Live code decides only which data exists and which server rules apply (patient permission to open a chart, emergency access read-only, audit, nothing identifying stored in the browser, the QoreID CAC check at sign-up). Where live has a state the design does not show, draw it in the design's style.
