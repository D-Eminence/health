# Backend contract copies for the EHR screens

These files are copies of parts of the backend contract, for frontend developers who cannot open the backend repository (D-Eminence/hid-system).

**The backend repository is the source of truth.** If a copy here and the backend repository ever disagree, the backend repository is right. Do not edit these copies by hand to change the contract; ask for the change instead.

## Where the copies come from

- Backend repository: D-Eminence/hid-system
- Branch: `staging-novu-ci-20261005`
- Commit: `092cd248566aaedee897910ded783c7826c79b98`
- Copied on: 19 November 2026
- Except: in [EHR_LIVE_CONTRACT.md](EHR_LIVE_CONTRACT.md), section EHR-C8b (vitals marked entered in error) and the EHR-C3 rule that names it, copied on 25 November 2026 from commit `d519e5d1cb40fdae4598251387989879aff415bb` (backend release C), which the website's services are pinned to

## What each file holds

| File | What it holds |
| --- | --- |
| [EHR_LIVE_CONTRACT.md](EHR_LIVE_CONTRACT.md) | The live contract sections the EHR screens use today, copied from `docs/INTERFACE_CONTRACT.md`, and the numbered live sections the planned contract cites for what the EHR, laboratory and pharmacy screens call or show (sections 8, 9, 13, 21-24, 29, 43, 44, 46 and 54). It starts with a table that shows where each section reference in the EHR message (for example [FR-1, Q105] or [Wave 0]), and each of those cited sections, points. It describes what is live today; a few lines marked **Planned** are not built yet. |
| [EHR_PLANNED_CONTRACT.md](EHR_PLANNED_CONTRACT.md) | The planned contract for the rest of the EHR list (Release B, Release C and later), copied from `docs/EHR_PLANNED_CONTRACT.md`. Nothing in it is live yet. Each section gives the request and answer shapes to build against, and what to show until it ships. |
| [codes/hid-lab-codes.json](codes/hid-lab-codes.json) | An exact copy of `docs/codes/hid-lab-codes.json`: the HID-LAB codes for the 13 lab tests with no LOINC code. |

## How the copies were made

- Section text is copied word for word, with its original headings and in its original order.
- Some backend details are not shared outside the backend team: database internals, audit internals, security limits and infrastructure details. Where one was removed, the text reads "[backend detail omitted]". The removed details are backend-side ones; if something you need seems to be missing, ask the coordinator.
- Some paragraphs and subsections are omitted whole, so a "below" or "above" in the kept text can point at an omitted part.
- Only the EHR sections of the live contract are copied, with the numbered live sections the planned contract cites for behaviour the EHR, laboratory and pharmacy screens call or show. In the planned contract, each mention of one of those sections links to its heading in [EHR_LIVE_CONTRACT.md](EHR_LIVE_CONTRACT.md). Sections it cites only for the Outreach site (40, 48, 49 and section 8's "Outreach registration boundary"), the platform administration console (19) or the sealed QA tenant (52), and the patient portal's "Current browser and notification boundary", are not copied; the coordinator can send them.
- File paths in the text, such as `services/...` or `docs/...`, are paths in the backend repository.

## Keeping them up to date

The coordinator refreshes these copies whenever the contract changes, and updates the commit above each time.

## Questions

Send any question about these sections to the coordinator. Answers go into the contract itself, and the next refresh brings them here.
