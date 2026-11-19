# Backend contract copies for the EHR screens

These files are copies of parts of the backend contract, for frontend developers who cannot open the backend repository (D-Eminence/hid-system).

**The backend repository is the source of truth.** If a copy here and the backend repository ever disagree, the backend repository is right. Do not edit these copies by hand to change the contract; ask for the change instead.

## Where the copies come from

- Backend repository: D-Eminence/hid-system
- Branch: `staging-novu-ci-20261005`
- Commit: `092cd248566aaedee897910ded783c7826c79b98`
- Copied on: 19 November 2026

## What each file holds

| File | What it holds |
| --- | --- |
| [EHR_LIVE_CONTRACT.md](EHR_LIVE_CONTRACT.md) | The live contract sections the EHR screens use today, copied from `docs/INTERFACE_CONTRACT.md`. It starts with a table that shows where each section reference in the EHR message (for example [FR-1, Q105] or [Wave 0]) points. It describes what is live today; a few lines marked **Planned** are not built yet. |
| [EHR_PLANNED_CONTRACT.md](EHR_PLANNED_CONTRACT.md) | The planned contract for the rest of the EHR list (Release B, Release C and later), copied from `docs/EHR_PLANNED_CONTRACT.md`. Nothing in it is live yet. Each section gives the request and answer shapes to build against, and what to show until it ships. |
| [codes/hid-lab-codes.json](codes/hid-lab-codes.json) | An exact copy of `docs/codes/hid-lab-codes.json`: the HID-LAB codes for the 13 lab tests with no LOINC code. |

## How the copies were made

- Section text is copied word for word, with its original headings and in its original order.
- Some backend details are not shared outside the backend team: database internals, audit internals, security limits and infrastructure details. Where one was removed, the text reads "[backend detail omitted]". The removed details are backend-side ones; if something you need seems to be missing, ask the coordinator.
- File paths in the text, such as `services/...` or `docs/...`, are paths in the backend repository.

## Keeping them up to date

The coordinator refreshes these copies whenever the contract changes, and updates the commit above each time.

## Questions

Send any question about these sections to the coordinator. Answers go into the contract itself, and the next refresh brings them here.
