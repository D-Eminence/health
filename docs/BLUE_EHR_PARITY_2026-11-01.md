# Clinical parity: classic staff portal and the blue Hospital EHR

**Re-checked on 20 Nov 2026** against D-Eminence/health `main` at a4aee1ae, the code the live sites are built from. Nothing was run against production. The 1 Nov list follows below, unchanged, because its "copy from" references to the classic pages are still useful.

How the re-check was done: every row was re-rated by reading today's code. Then a second reader tried to prove each changed rating wrong, and a third settled any disagreement. A wording difference counts as done only when the words match classic, or when a recorded decision chose the new words. The coordinator's 2 Nov review is one such decision: it put back the plain words for the chart, the encounter, emergency access and documents (commits a1c93d13, 098b6a77, db9967ae).

## Totals

| Status now | Rows |
|---|---|
| Done | 148 |
| Done, with the words the coordinator chose on 2 Nov | 17 |
| Partly done: only the words differ | 39 |
| Partly done: works differently | 53 |
| Missing | 0 |
| Removed by owner decision (the classic EHR) | 1 |

On 1 Nov the totals were: live 92, partial 151, sample 3, missing 6. Row counts here are lines of the tables below. The 1 Nov "partial" items with several points ("Also:") are now counted one line per point, so these totals add up to 258, not 252.

Nothing is sample or missing for real staff any more. Every sample page now opens only at the four demo facilities.

## Fix first (2.1 to 2.5)

| Row | Status now | Where |
|---|---|---|
| 2.1 Nursing "Vitals" saved a note | Done. The category is gone; old "Vitals" notes carry a line saying they are not in the vitals chart, and the consultation lists nursing notes. | `ehr-blue/clinical/nursing/observations.ts`, `ehr-blue/clinical/consult/Notes.tsx` |
| 2.2 Start menu "Request record access" | Done. It reads "Ask a patient for access", and the page says "A pending request never grants record access." | `ehr-blue/frame/BlueFrame.tsx`, `ehr-blue/clinical/consent/ConsentWorkspace.tsx` |
| 2.3 No way back to classic | Removed by the owner's decision; the stale comments now say so. | `ehr-blue/blueFacilities.ts` |
| 2.4 The pharmacy. loop | Done, with the first fix this list proposed: a role that can open neither Sell nor Prescriptions lands on "Pharmacy unavailable". Tests cover the site. | `ehr-blue/departments/pharmacy/page.tsx`, `__tests__/ehr-blue/frame/ProductSiteHome.test.tsx` |
| 2.5 Registration hand-off | Done. A saved record has "Open in Patients", which carries the Health ID over. | `ehr-blue/departments/registration/RegistrationRecord.tsx` |

## Every other row

### 3.1 Partial rows with real impact, items 1 to 14

| Row | What | Status now | What is left |
|---|---|---|---|
| 1 | Prescription needs a dose and a unit | Done |  |
| 1a | Create offered with write alone; saved order fails to load for a role without read | Done |  |
| 1b | Success says "Saved."; no-access words changed | Partly done: words differ | Change NO_CHANGES (and triage/records.ts NO_WRITE) to 'Your access doesn’t allow changes to this patient’s records.', and point the comment at Clinical.tsx:1492/:1676. |
| 2 | Vitals: fine values refused (steps) | Done |  |
| 2a | Failure text "This could not be saved." | Done |  |
| 2b | Visit picker shows only first 50 visits, no pager | Done |  |
| 3 | No vitals on the consultation page | Partly done: works differently | Make the empty-line wording match classic, or record a decision for 'consultation'. Correcting a vital needs a click through to its Triage page; classic has an inline 'Correct these vitals'. |
| 3a | Linked: vitals older than newest 50 of one visit cannot be listed or corrected | Done |  |
| 3b | Empty text "Nothing recorded yet." | Partly done: words differ | The Consultation Vitals card's empty text says 'consultation' where classic says 'encounter', and no decision is recorded for the change. Either record the decision (owner/coordinator, Q-number or QA item) in a comment or use classic's words 'No vitals for this encounter.' |
| 4 | Nursing notes hidden from the doctor's Notes card | Done |  |
| 5 | Sent orders: where they stand is not in the list | Partly done: works differently | The row still has no detail line (frequency, time, priority, code), no guidance, no couldn't-complete reason, no wrong-patient or late notice and no in-row actions. No owner decision is recorded for leaving them on the order page. |
| 5a | Empty text "No prescriptions yet." | Partly done: words differ | The Pharmacy and Laboratory empty texts say 'consultation' where classic says 'encounter', and no decision is recorded for the change. Either record the decision in a comment or use classic's words. The comment at orders.ts:22 also calls these 'today's' sentence, which they are not. |
| 6 | Stand-alone pharmacy lands on Sell; incoming out of sight | Done |  |
| 6a | Count of incoming orders on the Overview | Partly done: works differently | Pharmacists on pharmacy. never see the Overview's incoming-orders count. Impact is low because the landing page is the incoming list itself. |
| 7 | Patients and Access requests not in the menu on product sites | Done |  |
| 8 | Patient page shows only allergies; history behind "Open chart" | Done |  |
| 8a | Imported history and imported attachments only in Consultation (needs ehr.encounter.read) | Done |  |
| 8b | Profile read twice and logged twice (patient page then chart) | Partly done: works differently | Opening the patient and then the chart sends two logged profile reads (three on a backend without the allergies route). Classic sent one. |
| 9 | PIN offered only after a refused lookup | Done |  |
| 9a | "Use an Access PIN" on Access requests needs identity.consent.write | Done |  |
| 9b | Back link says "Back to access requests" from Find a patient | Done |  |
| 9c | PIN words changed | Partly done: words differ | Fallback error, error title, button and busy words, field label and action sentence differ from classic, with no recorded owner decision for them. |
| 9d | PIN success opens the patient page, not the chart | Partly done: works differently | After a PIN, clinicians land on the patient page instead of the chart and need one more click. There is no recorded decision for this. |
| 10 | Lab: verify and release in one press, one reason | Partly done: words differ | The release success and confirm wording ('the patient and the ordering clinic' instead of 'authorized readers') and the new refusal and offline sentences (VERIFY_REFUSED, DECISION_UNANSWERED) differ from classic with no recorded owner decision, Q-number or QA item. |
| 11 | Pharmacy: dispensing reason pre-filled | Done |  |
| 11a | Tick-every-step checklist and confirm sheet added | Partly done: works differently | The tick-every-step checklist is an extra blocking step that classic does not have, and no owner decision is recorded for it. The confirm sheet also has no recorded decision, though it is wrong-patient prevention. |
| 11b | Fallback error "That didn’t work. Please try again." | Partly done: works differently | Most failure messages (no connection, signed out, Health ID unavailable, too many tries, conflict, PlainError on reversal) read differently from classic, and the new retry note has no recorded decision. |
| 11c | Pay-first and out-of-stock checks read fields the backend does not send | Done |  |
| 12 | Lab: preparing a sample needs collect permission; specimens handled together | Partly done: works differently | The reason is filled in from the request or prefilled, collecting has an extra confirm step, and the step words and messages differ from classic with no recorded decision. |
| 12a | Reject before collection (rare) | Partly done: words differ | It uses the same request and permission, but the label, the empty-reason message and the success message differ from classic with no recorded decision. |
| 13 | Refused lookup not announced; focus drops | Done |  |
| 13a | Not-granted sentence never shown | Partly done: words differ | Classic's not-granted sentence is never shown, and 'Choose how to get it.' replaces it with no recorded decision. |
| 13b | 404 (mistyped Health ID) reads as "no access yet" | Partly done: works differently | For real staff today, a mistyped Health ID still reads as 'You don't have access to {hid} yet' and offers the ways in. This stays until the identity-api Q100 B change (404 PATIENT_NOT_FOUND) is released. The front end is ready and only the mock gateway returns the new code. |
| 13c | "Open" on Shared with you behaves the same | Partly done: works differently | Same as Find: (1) the not-granted sentence is replaced by 'Choose how to get it.' with no recorded decision, (2) a success lands on the patient page, not the chart (13d), and (3) the not-found panel needs the Q100 B backend release. |
| 13d | Success opens the patient page, one click before the chart | Partly done: works differently | A successful Find or shared Open lands on the patient page, one click before the chart. No owner decision is recorded. |
| 14 | Sharing cards need identity.patient.read | Done |  |
| 14a | Empty and "not eligible" texts gone | Partly done: works differently | The not-eligible explanation is missing. The empty texts are reworded and merged into one line with no recorded decision on the words. |
| 14b | "sent {date}" gone; accept message shorter | Partly done: works differently | The sent date and the "To {inviteeName}" line are missing. The accept message wording also differs, and nothing records a decision for it, so it is not fine under the rules. |

### 3.1 Partial rows with real impact, items 15 to 28

| Row | What | Status now | What is left |
|---|---|---|---|
| 15 | Lab, outreach and migrate sites land on a refusal | Done |  |
| 15a | Pharmacy site (was a loop) | Partly done: works differently | On pharmacy., a role without pharmacy.work-item.read lands on the "Pharmacy unavailable" refusal instead of Home. Fix: base ownPageOpen on pageUsable. |
| 15b | Overview cards missing on product sites | Partly done: works differently | The bell count shows only after the drawer is opened (classic showed it on landing). The words differ from classic's access-requests card with no recorded decision. Classic's Active facility card and Workspaces list have no counterpart on product sites. |
| 15c | Facility subscription not in the product sites' menu | Partly done: works differently | Facility subscription is not in the menu on lab, pharmacy, outreach or migrate sites; add billing to SHARED or record the decision |
| 16 | Raw role codes under the facility name | Done |  |
| 16a | "Access is limited to your active facility and server permissions." gone | Partly done: works differently | Sentence still absent in blue; add it or record that it was dropped on purpose |
| 17 | Emergency access: same requests and 30 minutes | Done |  |
| 17a | "Switched off" words | Done (words chosen by the coordinator, 2 Nov) |  |
| 17b | 400 refusal drops code and administrator | Done (words chosen by the coordinator, 2 Nov) |  |
| 17c | Reason check words | Done (words chosen by the coordinator, 2 Nov) |  |
| 17d | Emergency-contacts notice drops "while alerts are on" and "verified" | Done (words chosen by the coordinator, 2 Nov) |  |
| 17e | "Shows no vital signs and opens no files" missing | Done |  |
| 17f | Tick box claims "the patient is told" | Done |  |
| 17g | Fallback "Something went wrong. Please try again." | Done (words chosen by the coordinator, 2 Nov) |  |
| 17h | File claims its words are "word for word" | Partly done: words differ | This is only a code comment. Change it to say these are the redesign's plain words based on Patients.tsx, not copied word for word. |
| 17i | Emergency alone under folded "Wards & units" | Done |  |
| 18 | Shortened order warning, on every status action | Done (words chosen by the coordinator, 2 Nov) |  |
| 18a | Shortened cancel or entered-in-error refusal | Done (words chosen by the coordinator, 2 Nov) |  |
| 18b | Success "Consultation updated." | Done (words chosen by the coordinator, 2 Nov) |  |
| 18c | Confirm step for Cancel and entered in error | Done |  |
| 19 | Lab result history shown without its permission | Done |  |
| 20 | Point-of-care pages call unserved addresses | Done |  |
| 20a | Lab and pharmacy lists read payment settings on every open | Done |  |
| 20b | Labelled "live" | Partly done: words differ | Label the four Finance pages partial (or sample) until Health ID serves their routes. They show only at demo facilities, so only the labels are affected. |
| 21 | Unknown address goes Home with no message | Partly done: words differ | Use classic's description 'This provider page is unavailable.' and matching link wording, or record a decision for the new words. Fix the NotFoundPage.tsx:5 comment and the LOG.md:3168 note, which both wrongly say these are today's words. |
| 21a | "What's left" claims an unknown address "says so" | Done |  |
| 21b | "Live" too strong for named pages | Done |  |
| 21c | "What's left" is demo-only | Done |  |
| 22 | Access request length can be changed | Partly done: works differently | Remove the duration field and always send 60, or record an owner decision for it. |
| 22a | Request words differ | Partly done: words differ | Use classic's success, failure, lede and refusal words, or record owner decisions for them. Remove the scope hints or record a decision for them. |
| 22b | From Patients only after a refused Find | Done |  |
| 22c | Request number not printed; opens the request page | Partly done: works differently | Record an owner decision for opening the request page after a send, or keep the person on the form with the notice, as classic does. |
| 23 | Closing a grant only from the request's page | Partly done: works differently | Remove the 'Access to this patient ended' alert and the 'Couldn't close access' title, or record decisions for them. Move focus as classic does, or record why not. |
| 23a | Success "Your access has ended." | Done (words chosen by the coordinator, 2 Nov) |  |
| 23b | "Close my grant" became "End my access" on the patient page | Partly done: works differently | Button label, failure text, alert title and unavailable reason differ from classic with no recorded decision, and blue adds an 'already ended' refusal state. Either restore the classic words or record the decision in a code comment. |
| 24 | "Visits here": first page only, no dates | Done |  |
| 25 | Opening a visit sends about ten requests | Partly done: works differently | Every record list is still read when a visit opens; read on demand, or record a decision accepting the load. |
| 25a | New states "Record not found" and "could not be loaded" | Done |  |
| 26 | Lab "We can't complete this order" closes the request | Done |  |
| 27 | Wrong-patient panel points to a button not on the row | Done |  |
| 28 | Home says staff must act on access requests | Partly done: works differently | Count words differ from classic 'N pending request(s)', the 'Access requests' heading and the 'Review requests →' link are gone, and at zero blue hides the count where classic shows '0 pending requests'. Restore the classic words or record the decision in a code comment. |
| 28a | Bell "for roles that answer them" | Done |  |
| 28b | "All clear" for a role that read nothing | Done |  |

### 3.2 Rare but misleading

| Row | What | Status now | What is left |
|---|---|---|---|
| 3.2-1 | Facility sign-up agreement boxes | Done |  |
| 3.2-2 | Sample workspaces (shortcuts, "Saved record") | Done |  |
| 3.2-3 | Facility settings and Reports | Done |  |
| 3.2-4 | HR & Credentials sample half | Done |  |
| 3.2-5 | Facility setup wizard sample steps | Done |  |
| 3.2-6 | "My profile" drawer | Done |  |

### 3.3 Wording and small changes

| Row | What | Status now | What is left |
|---|---|---|---|
| 3.3-1 | "Current authorized record" card | Partly done: works differently | The heading differs ("Open now" instead of "Current authorized record" or "Current emergency summary"), Open goes to the patient page instead of the chart, and Close my grant is only on the patient page. No recorded decision covers these. |
| 3.3-2 | "Close my grant" | Partly done: works differently | The button, refusal and failure words differ from classic, and no code comment records a decision for them. Blue also adds an "already ended" message and goes back to Find a patient after closing. |
| 3.3-3 | Record with no patient open | Done (words chosen by the coordinator, 2 Nov) |  |
| 3.3-4 | Patient record header | Done (words chosen by the coordinator, 2 Nov) |  |
| 3.3-5 | Write-access check and read-only notice | Partly done: works differently | consentStatus asked again in each workspace; read-only and could-not-check words differ with no decision recorded in a code comment. |
| 3.3-6 | Access re-check | Partly done: works differently | One extra patient lookup each time a visit opens; ACCESS_ENDED words differ without a decision recorded in a code comment. |
| 3.3-7 | "Refresh encounters" | Done (words chosen by the coordinator, 2 Nov) |  |
| 3.3-8 | Emergency summary from the record | Partly done: words differ | The link label differs from classic ("Open read-only emergency summary →"), with no decision recorded in a code comment. The navigation itself now matches classic. |
| 3.3-9 | Access requests list | Done |  |
| 3.3-10 | Access requests without permission | Done |  |
| 3.3-11 | Status filter | Done |  |
| 3.3-12 | Request row details | Done |  |
| 3.3-13 | 100-row cap notice | Done |  |
| 3.3-14 | Read-only emergency summary | Done (words chosen by the coordinator, 2 Nov) |  |
| 3.3-15 | Emergency summary refresh | Done (words chosen by the coordinator, 2 Nov) |  |
| 3.3-16 | Released results in the summary | Done (words chosen by the coordinator, 2 Nov) |  |
| 3.3-17 | Ending a PIN, request or emergency grant | Partly done: words differ | Record the decision for the end-access wording in a code comment, or copy classic's words back. |
| 3.3-18 | In-person check: no permission | Partly done: words differ | Copy the classic refusal title and message. |
| 3.3-19 | In-person check: the page | Partly done: works differently | Heading, description, step labels and attestation words; drop the read-only Method choice. |
| 3.3-20 | In-person check: field checks | Partly done: words differ | All field messages and per-field result words. |
| 3.3-21 | In-person check: submit | Partly done: words differ | Button label 'Check details'. |
| 3.3-22 | In-person check: checked | Partly done: words differ | Verified title and next-step wording. |
| 3.3-23 | In-person check: details don't match | Partly done: words differ | Mismatch title and note; drop the extra daily-limit sentence. |
| 3.3-24 | In-person check: already has a Health ID | Partly done: words differ | Title and next-step wording. |
| 3.3-25 | In-person check: Identity's refusals | Partly done: words differ | Wording of every refusal and retry message ('Health ID support', 'your administrator', and the others). |
| 3.3-26 | In-person check: retry | Partly done: words differ | Copy the current classic RETRY and RETRY_PROOF sentences (InPersonCheck.tsx:112-113) into inPersonRules.ts:121-122. |
| 3.3-27 | Facility check card | Partly done: works differently | On lab, pharmacy and outreach sites the pending 'Facility check' card never appears; only the banner says the check is pending. Either show the pending card there, or add a code comment citing a recorded owner decision. |
| 3.3-28 | Record with no patient, re-check, write check | Partly done: works differently | The extra access lookup each time a visit opens (EncounterPage.tsx:70) and the write check run again in each workspace. The chart wording differs, and the coordinator decision is recorded only in commit messages, not in a code comment. |
| 3.3-29 | Clinical page under emergency access | Partly done: works differently | One extra click to reach the emergency summary. |
| 3.3-30 | List the visits | Partly done: works differently | No visit opens by default; staff must choose one. The list wording differs, and no code comment records a decision for it. |
| 3.3-31 | Start a visit | Partly done: works differently | The note saved in the same press still needs only ehr.note.write; it should also need ehr.note.read. The messages differ, and no code comment records a decision for them. |
| 3.3-32 | Visit changed by someone else | Done (words chosen by the coordinator, 2 Nov) |  |
| 3.3-33 | Record sections by permission | Done (words chosen by the coordinator, 2 Nov) |  |
| 3.3-34 | Add a note | Partly done: words differ | Restore the classic draft hint or record a decision for the new words. Record a decision for "Complete this field." |
| 3.3-35 | Sign a note | Partly done: works differently | The typed SIGN confirmation step is added in both the Notes card and the top Sign note action, with no recorded decision. |
| 3.3-36 | Mark a note entered in error | Partly done: works differently | A confirm step is added before marking a note entered in error, with no recorded owner decision. |
| 3.3-37 | Add a note revision | Done |  |
| 3.3-38 | List diagnoses | Done |  |
| 3.3-39 | Add a diagnosis | Partly done: words differ | The submit button says "Add diagnosis" instead of "Save record", and the required-field message is not classic wording. Neither has a recorded decision. |
| 3.3-40 | List documents | Partly done: words differ | The plain-word file type, the size wording, the scan status, "consultation" in the empty list and the extra status badge all lack a decision recorded in the code. |
| 3.3-41 | Upload a document | Partly done: words differ | The refusal, success and note wording differ from classic with no decision recorded in the code. The refusal also says MB, not MiB. |
| 3.3-42 | Staff sign-in | Partly done: works differently | The lede reads "Sign in to your hospital workspace." where classic says "Sign in with your work account." The recovery link reads "Forgot password?" where classic says "Forgot your password?". Classic's header link "Set up your facility" is gone, and blue adds "New to Health ID?" and "Joining your team? Accept invitation" lines plus a you@hospital.org placeholder. The refusal shows in a boxed Alert above the form, where classic puts it below Turnstile. |
| 3.3-43 | Sign-in on app. | Done |  |
| 3.3-44 | Authenticator first set-up | Partly done: words differ | Last button label: "Continue to the Hospital EHR" (or "Continue to <product>") where classic says "Continue". |
| 3.3-45 | Password recovery | Done |  |
| 3.3-46 | Staff invitation | Partly done: words differ | The title and tab words differ from classic's "Join your facility." |
| 3.3-47 | Choose a facility | Partly done: works differently | The heading adds "today". The second sentence is still not classic's. There is no radio choice with a Continue step, and no "Choose a facility to continue." message. |
| 3.3-48 | Facility lost mid-session | Partly done: words differ | The heading is "Where are you working today?" where classic says "Where are you working?". The sentence after the reason differs from classic's "Choose where you are working before you continue. Patient access, records and requests use the facility you choose, and you can switch later from “Working at”." |
| 3.3-49 | Switch facility | Partly done: works differently | Blue goes through a separate page, or a one-tap switch from the facility list. Classic's in-place confirmation ("You are working at X. Switch to Y?" with Cancel) is missing, and the sentences are new. |
| 3.3-50 | Page opened without permission | Partly done: works differently | Pages without their own refusal still send people Home with the generic notice instead of each page's classic refusal. Registration and In-person check refusal words still need checking against 3.3-58 and 3.3-18. |
| 3.3-51 | Browser tab title | Partly done: works differently | Product names differ from classic 'Health ID Provider'. On blue pages outside Workspace, moving between addresses that share the same frame label lets ProviderTitle overwrite the blue title (for example with 'Page not found · Health ID Provider'). The overwrite is confirmed in code, not just possible. |
| 3.3-52 | A page crashes | Partly done: words differ | Copy the classic sentence and link words ('Reload it to try again.' / 'Go to your overview'), or record a decision for 'or go back to Home.' / 'Go to Home'. Fix the comment that says the words are the same. |
| 3.3-53 | Overview greeting | Partly done: works differently | Greeting and description words differ. There is no Home on product sites. Note (24 Nov 2026): the greeting is classic's since website release C. The Home on product sites stays out by owner decision: "i need migrate to work smoothly as it has before". Health ID Migrate, Lab, Pharmacy and Outreach open their own page at /provider, however it is reached (sign-in, facility switch, the brand, a page the product does not open), for a role that can use that page, and list no Home for it, as before release C. The full EHR site keeps Home. |
| 3.3-54 | "Active facility" card | Partly done: works differently | There is no 'Active facility' card or role badge on Home, and no recorded decision for that. Role wording differs for unnamed codes ('Doctor' against 'Doctor, Staff'). The objection's phone point is weaker than stated, because the Home header names the facility at every width. |
| 3.3-55 | "Current patient" card | Partly done: works differently | Words differ ('Current patient', 'Open clinical record'). The row also shows where clinical is not offered, linking to patients/open. |
| 3.3-56 | Workspaces grid | Partly done: works differently | The workspaces grid is gone. The no-clinical-module notice is reworded. The other-sites and no-workspace-here notes are replaced by a sidebar group and a separate page, in different words. |
| 3.3-57 | "Health ID Migrate" card | Partly done: works differently | Only the Home card ('Health ID Migrate' and its words and link) is missing, with no recorded decision. The sidebar rename is covered by QA P1-10. The real-world effect is nil for now, because no role holds ocr.job.read. |
| 3.3-58 | Registration refusal | Partly done: words differ | Change the blue heading to 'You can’t register patients here' to match classic, or record an owner or coordinator decision for 'Registration unavailable' and fix the outdated comment at registrationText.ts:53. |
| 3.3-59 | NIN check availability | Partly done: works differently | Copy the classic words for the off state, the error and the loading state. Hide the card while NIN checks are working, as classic does. |
| 3.3-60 | Continue a case by its number | Partly done: words differ | Wording: field label, button, load error and invalid-ID message. |
| 3.3-61 | Check a NIN | Partly done: words differ | Wording for the heading, labels, button, success and error messages. |
| 3.3-62 | Link or approve a Health ID | Partly done: words differ | Wording and status labels. |
| 3.3-63 | Create the patient's account | Partly done: words differ | Wording for the button, the success and error messages, and the labels. |
| 3.3-64 | Plan and invoices | Partly done: works differently | Wording for the unavailable state. Billing is still not in the menu on product sites. |
| 3.3-65 | Pay now | Partly done: works differently | Add 'Card details never pass through Health ID.' |
| 3.3-66 | Lab work list | Partly done: works differently | Stage tabs and their empty words differ from the classic single list. Work in another stage needs a tab change. |
| 3.3-67 | Lab: start and finish a test | Partly done: words differ | Success and failure words differ from classic, and no recorded decision covers them. |
| 3.3-68 | Lab: enter or correct a result | Partly done: words differ | Failure and success words differ from classic. |
| 3.3-69 | Pharmacy prescriptions list | Partly done: works differently | The list tabs, search and paging are new compared with classic. The empty, error, heading and refresh words differ from classic ('No accepted prescriptions', the PageHead text, 'Refresh work'). No recorded decision covers these differences. |
| 3.3-70 | Pharmacy: reverse dispensing | Partly done: works differently | Confirm dialog added. Extra error sentences and the retry note are new. The busy word is "Saving…" where classic says "Recording…". |
| 3.3-71 | Document OCR (3 rows) | Partly done: words differ | Word differences remain. Whether real roles hold ocr.job.read is unconfirmed. |
| 3.3-72 | Outreach (4 rows) | Partly done: words differ | Empty, error and success words still differ from the classic Outreach section. |
| 3.3-73 | Staff (4 rows) | Partly done: works differently | Licence save drops "Health ID support checks it when it reviews <facility>." A delivered invite shows the generic toast "Invitation created" instead of classic's delivery sentence. |
| 3.3-74 | Audit: read, page, filter | Partly done: words differ | Either make the wording match classic or record an owner, coordinator or QA decision for each difference. The differences are: the page title, including the no-facility state; the intro; the Refresh, Newer and Older button labels; the search and outcome labels, placeholder and hint; the empty-state titles and messages ('No audit events yet', the extra 'No older events', 'No matching events'); the load-failure sentence, which adds 'Try again.' and uses errorText instead of plainErrorText; the time format and its unavailable text; and the outcome badge colours. Then change the status in ehr-blue/departments/audit/page.tsx to live. |

### 4 Live on 1 Nov

All 92 rows were checked again. 91 are still done. One now works differently:

| Row | What | Status now | What is left |
|---|---|---|---|
| 4-34 | Lab request as a draft | Partly done: works differently | For a role that may send, blue starts on "Create active request and send to this facility's Lab" where classic starts on draft. QA N-7 records this, but it is a change of starting state, not just wording, so it still differs. The draft option reads "Save as a draft" instead of classic's "Save EHR draft", with no recorded decision. The draft warning is hidden unless draft is chosen (QA N-8). |

---

# The 1 Nov list (unchanged)

Status note (1 Nov 2026, later): the 5 "Fix first" items 2.1, 2.2 (Start menu), 2.4 (pharmacy loop), 3.1 #1 (dose and unit) and 3.1 #2 (vitals precision) are fixed in the urgent-fixes PR; 2.3 (classic EHR) stays removed by owner decision. Owner rules since: within the EHR, department staff see only their own module's part of a record and EHR clinical staff see the whole record (patient permission still required); patient registration stays in the EHR only.

For Ola (clinical owner) and the owner.
Checked against D-Eminence/health at f2c08fc, the live production main. Nothing was run, edited or pushed.

How to read the paths: they are under `apps/patient-web/src/` unless they start with `packages/`, `config/`, `scripts/` or `docs/`. `staff/...` is the classic portal. `ehr-blue/...` is the blue EHR.

How the rows were rated:

- **live**: real staff can do it in blue with the same request to Health ID, the same permission check, the same states and the same words.
- **partial**: it can be done in blue, but something is missing or different.
- **sample**: the blue page exists but shows made-up data or saves nothing at a real facility.
- **missing**: no blue page does it.

| Status | Rows |
|---|---|
| live | 92 |
| partial | 151 |
| sample | 3 |
| missing | 6 |
| **total** | **252** |

7 rows are marked misleading: a real user could believe they did something they did not. Some actions are counted in two areas, for example emergency access (Patients and Access) and the classic escape (Patients and Frame). So the counts are counts of rows, not of unique actions.

---

## 1. What real clinics see today

Every real facility now opens the blue Hospital EHR. `BLUE_FOR_ALL` is true (`ehr-blue/clinicSwitch.ts:9`). The switch ignores the facility, the site and the role (`ehr-blue/blueFacilities.ts:31-52`; `staff/App.tsx:670-674`). That covers all five product sites (ehr., lab., pharmacy., outreach., migrate.) and `/provider` on the main site. Sign-in, password recovery, staff invitations and facility sign-up are blue too (`App.tsx:28-30, 103-109`; `staff/App.tsx:758-760`). "Use the classic EHR" is not a usable stopgap, because it is no longer there. The function behind it, `chooseClassicEhr` (`ehr-blue/blueFacilities.ts:61`), has no caller. Commit 20af2f7 removed the menu items and the error-page button, and tests now check that the button is absent (`__tests__/ehr-blue/frame/EhrBlueSwitchFixes.test.tsx:36-41`). A direct link to a classic address, such as `/provider/patients` or `/provider/clinical`, opens the blue page at that address. Even when the switch existed, it lived in memory only, so a reload went back to blue (`ehr-blue/blueFacilities.ts:54-56`). The classic portal now shows in one edge case only: a signed-in staff member with no current facility (`blueFacilities.ts:40-52`). So every gap below is a hard gap with no workaround. The good news is that most of blue is real: it sends the same requests to Health ID as classic, with the same permission checks, and most differences are wording. No sample page is listed in the menu for real staff. **The single biggest risk is a safety one.** Blue will not save a prescription without a dose and a unit (`ehr-blue/clinical/consult/orders/CreateOrder.tsx:40-43`). Classic let both be left blank, for items such as a cream or "as directed" (`staff/routes/Clinical.tsx:509`). Prescribers now have to make up a dose, and that dose goes to the pharmacy. Close behind are two vitals problems. Blue refuses fine values such as a 3.25 kg baby (`ehr-blue/clinical/triage/vitals.ts:33-35`). And a nurse who records vitals under the "Vitals" nursing category saves a plain note that the doctor does not see in the consultation.

---

## 2. Fix first

These are the rows that staff hit daily or weekly and that are missing, sample or misleading. Misleading rows come first.

### 2.1 Nursing "Vitals" saves a note, not vitals (misleading, daily)

- **What staff try to do:** a nurse records BP, pulse or temperature in Nursing observations and picks the category "Vitals".
- **What happens in blue today:** it saves a draft clinical note with the type "Nursing observation" and the title "Vitals" (`ehr-blue/clinical/nursing/NewObservation.tsx:51`; `ehr-blue/clinical/nursing/observations.ts:16-17`). The nurse sees "Saved." It is not a vitals record. It does not show in Triage & Vitals and is not range-checked. The doctor's Notes card in the consultation hides every nursing note (`ehr-blue/clinical/consult/Notes.tsx:58`). If a visit has only nursing notes, that card says "No notes for this encounter." (`Notes.tsx:65-66`).
- **What is missing:** the vitals request. Classic records vitals with the vitals form and `POST …/vitals` (recorded now, source manual, eight fields). Classic also listed every note, nursing ones included, in one Notes tab.
- **Classic to copy from:** `staff/routes/Clinical.tsx:39-48` (fields), `495-503` and `563-565` (form), `1453-1505` (save), `1323` and `1805-1817` (one notes list).
- **Blue to change:** `ehr-blue/clinical/nursing/observations.ts:17` (drop "Vitals", or send it to the vitals form in `ehr-blue/clinical/triage/NewTriage.tsx`), `ehr-blue/clinical/nursing/NewObservation.tsx`, and `ehr-blue/clinical/consult/Notes.tsx:58, 65-66` (show nursing notes, or say they exist).

### 2.2 Start menu "Request record access: From another facility" (misleading, weekly)

- **What staff try to do:** get another hospital's records for a patient.
- **What happens in blue today:** the Start menu item says "Request record access", with the hint "From another facility" (`ehr-blue/frame/BlueFrame.tsx:217`). It opens Access requests, which asks the patient for access at this facility. Once the patient says yes, only this facility's records open ("Visits here", `ehr-blue/clinical/patients/PatientPage.tsx:283`; "This facility’s finished visits…", `ehr-blue/clinical/emergency/EmergencySummary.tsx:17`). Nothing is sent to another facility. A clinician can believe they asked another hospital for records.
- **What is missing:** the right words. Classic called this page "Access requests", under "Patient consent", and said "A pending request never grants record access."
- **Classic to copy from:** `staff/routes/AccessRequests.tsx:108`; `staff/navigation.ts:20`.
- **Blue to change:** `ehr-blue/frame/BlueFrame.tsx:217` (for example "Ask a patient for access here"), and `ehr-blue/clinical/consent/ConsentWorkspace.tsx:64` (bring back "A pending request never grants record access.").

### 2.3 No way back to the classic EHR (missing, daily)

- **What staff try to do:** use "Use the classic EHR", or a classic link, when a blue page falls short.
- **What happens in blue today:** there is no such control. `chooseClassicEhr()` (`ehr-blue/blueFacilities.ts:61`) has no caller anywhere. The account menu says there is "no classic EHR here" and is never shown anyway (`ehr-blue/frame/TopBarParts.tsx:181-185`). The error screen offers only Reload and Go to Home (`ehr-blue/frame/BluePageBoundary.tsx:27-42`). Tests assert the button is gone (`__tests__/ehr-blue/frame/EhrBlueSwitchFixes.test.tsx:36-41`; `EhrBlueMinorFixes.test.tsx:25-29`; `EhrBlueMount.test.tsx:173-178`). Comments still promise it: `ehr-blue/blueFacilities.ts:54-56`, `staff/App.tsx:41`, `ehr-blue/frame/pages.ts:131`, `ehr-blue/frame/BlueFrame.tsx:234`, `ehr-blue/frame/BluePageBoundary.tsx:7, 14-15`.
- **What is missing:** a button that sets the flag. The flag and its reset on sign-out still exist (`ehr-blue/blueFacilities.ts:54-84`; `staff/App.tsx:398-399`). Even when restored, it is memory only: a reload returns to blue.
- **Classic to copy from:** the removed items in commit 20af2f7 (`git show 20af2f7`).
- **Blue to change:** this needs an owner decision. Either put "Use the classic EHR" back in the facility menu (`ehr-blue/frame/BlueFrame.tsx:191-205`) and on the error page (pass `onClassic` at `BlueFrame.tsx:235`) until the PRs below land, and update the three tests. Or keep it gone, accept that every gap is hard, and delete the stale comments.

### 2.4 The pharmacy. site can loop forever (missing, daily)

- **What staff try to do:** sign in on pharmacy.healthidentitydirectory.com without `pharmacy.work-item.read` and without `pharmacy.walk-in.create`. This includes a self-signed-up pharmacy's administrator, who is told to sign in there and whose Pharmacy workspace stays locked until Health ID's check (`ehr-blue/signup/AfterSubmit.tsx:141-149`; `staff/routes/ReviewBanner.tsx:19, 24-27`). It also includes any non-pharmacist who signs in on that site.
- **What happens in blue today:** `/provider` goes to `/provider/pharmacy` (`ehr-blue/frame/BlueFrame.tsx:123`). That page sends the person to Sell (`ehr-blue/departments/pharmacy/page.tsx:30-41`, rule at `:38`). Sell needs `pharmacy.walk-in.create` and has no refusal (`page.tsx:46`). So the frame sends them back to `/provider` (`BlueFrame.tsx:148-149`), and round it goes. No page settles. This was found by reading the code, not by running it. There is no test for this site. Typing another address, such as `/provider/staff`, is the only way out.
- **What is missing:** classic's fallback to the Overview when the person cannot open the product page (`staff/navigation.ts:52-57`), or a refusal page.
- **Classic to copy from:** `staff/navigation.ts:52-57`; the refusal words "Pharmacy unavailable / This facility membership needs pharmacy work-item read permission." (`staff/routes/Operations.tsx:1077`).
- **Blue to change:** `ehr-blue/departments/pharmacy/page.tsx:38` and `:46` (go to Prescriptions, whose refusal then shows, or give Sell a refusal), or `ehr-blue/frame/BlueFrame.tsx:123` (do not force `/provider` to a page the person cannot open). Add a test for the pharmacy. site.

### 2.5 Registration lost "Find {hid} and open their chart" (missing, daily)

- **What staff try to do:** after registering a patient, go straight to them.
- **What happens in blue today:** the blue registration page has no button or link to Patients (`ehr-blue/departments/registration/*.tsx`). Staff open Patients or the top-bar search (Ctrl K) and type the Health ID shown in "Pending account created for {hid}. …" (`ehr-blue/departments/registration/registrationText.ts:133`; `ehr-blue/frame/TopBarParts.tsx:59-66`).
- **What is missing:** the hand-off to `/provider/patients` with the Health ID. Blue Patients already reads a handed-over Health ID (`ehr-blue/clinical/patients/PatientsWorkspace.tsx:55-59, 74`), so blue would beat classic here, which ignored it (`staff/routes/Patients.tsx:93`).
- **Classic to copy from:** `staff/routes/Registration.tsx:207-208, 264-268`.
- **Blue to change:** `ehr-blue/departments/registration/Registration.tsx` (the completed-case state, around `267-295`).
- **Note:** impact is low, because staff typed the Health ID in classic too. The Frame review rated this partial because the search box works around it.

---

## 3. Partial

### 3.1 Partial rows with real impact

These come first because they change what clinicians do, or put patients or the audit trail at risk.

**1. A prescription needs a dose and a unit** (Orders, daily, every prescriber)
- Staff try: save a prescription with no dose, such as a cream or "as directed".
- Blue today: Dose and Unit are required (`ehr-blue/clinical/consult/orders/CreateOrder.tsx:40-43`), refused with "Complete this field." (`ehr-blue/clinical/parts/RecordForm.tsx:66-68`). The unit comes from a fixed list or "Other…".
- Also: Create is offered with write permission alone (`ehr-blue/clinical/consult/orders/index.tsx:181`). For a role without `ehr.prescription.read`, the saved order then fails to load and the "Saved." note is lost, so a real save can look like a failure (`OrderPage.tsx:80, 131-132`). Success says "Saved." instead of "Clinical record saved.", and the no-access words changed (`orders/words.ts:63-64`).
- Missing: classic's "both or neither" rule, "Enter both dose quantity and dose unit, or leave both blank.", and create only inside the read tab.
- Copy from: `staff/routes/Clinical.tsx:505-513, 567-569, 1455, 1502, 1802-1855`.
- Change: `ehr-blue/clinical/consult/orders/CreateOrder.tsx:40-43`, `orders/index.tsx:181`, `orders/words.ts:63-64`.

**2. Vitals: fine values are refused** (Consultation, daily to record, weekly to correct)
- Staff try: record SpO2 97.5, a weight of 3.25 kg or a height of 50.25 cm.
- Blue today: the steps are SpO2 1, weight 0.1, height 0.1 (`ehr-blue/clinical/triage/vitals.ts:33-35`). Finer values get "Enter a whole number." or "Enter a value with at most 1 decimal place." (`triage/VitalsForm.tsx:34-43, 98-103`). Correcting a reading that classic saved more precisely pre-fills it and blocks the save until it is rounded or blanked (`VitalsForm.tsx:20-27`). Rounding slips an unintended change into the correction. Blanking drops that reading.
- Also: the failure text is "This could not be saved." (`triage/records.ts:19`). The visit picker shows only the first 50 visits, with no pager (`triage/NewTriage.tsx:44, 89`).
- Missing: classic's steps, which match the EHR: SpO2 0.01, weight 0.001, height 0.01, temperature 0.1.
- Copy from: `staff/routes/Clinical.tsx:39-48, 704-750`.
- Change: `ehr-blue/clinical/triage/vitals.ts:33-35`, `triage/records.ts:19`, `triage/NewTriage.tsx:44`.

**3. No vitals on the consultation page** (Consultation, daily)
- Staff try: see today's BP and temperature while writing up a visit.
- Blue today: the visit page reads vitals (`ehr-blue/clinical/consult/EncounterPage.tsx:173`) but shows only links such as "Vitals · <short id>", with no values (`:527`). The values are on Triage & Vitals, mixed across all visits (`triage/TriageList.tsx:47-82`). The empty text is "Nothing recorded yet." (`triage/records.ts:28`).
- Linked missing row (rare): vitals older than the newest 50 of one visit cannot be listed or corrected (`triage/records.ts:34, 166-182`; `triage/ListCard.tsx:46`). Classic paged them.
- Missing: classic's Vitals tab for the visit, with the entered-in-error warning, and paging.
- Copy from: `staff/routes/Clinical.tsx:760-796, 1413-1441, 1807-1812`.
- Change: `ehr-blue/clinical/consult/EncounterPage.tsx:466-477` (add a Vitals card), `triage/records.ts:166-182` (pager).

**4. Nursing notes hidden from the doctor's Notes card** (Consultation, daily)
- See 2.1. The filter is at `ehr-blue/clinical/consult/Notes.tsx:58`. Classic: `staff/routes/Clinical.tsx:1323, 1805-1817`. Fix both in the same PR.

**5. Sent orders: where they stand is not in the list** (Orders, daily)
- Staff try: scan a visit's orders to spot a declined or "couldn't complete" prescription or test.
- Blue today: each row shows only "Pharmacy · {medicine}" or "Laboratory · {test}" and the record status (`ehr-blue/clinical/consult/orders/index.tsx:213-216`). There is no frequency, time, code, priority, route state or action. The route state is only on each order's page (`orders/Routing.tsx:346-358`; `OrderPage.tsx:417-428`). Home covers wrong-patient endings only (`ehr-blue/home/liveCards.tsx:147-202`). The empty text is "No prescriptions yet." / "No lab requests yet." (`orders/orders.ts:29, 33`).
- Missing: classic's route panel under each row (status, guidance, "couldn't complete", wrong-patient and late notices), the detail line, and the actions in the row.
- Copy from: `staff/routes/Clinical.tsx:431-432, 1808, 1813, 1818-1852`; `staff/routes/OrderRoutes.tsx:384-393`.
- Change: `ehr-blue/clinical/consult/orders/index.tsx:210-219`.

**6. A stand-alone pharmacy lands on Sell, and incoming prescriptions are out of sight** (Orders, daily)
- Staff try: sign in at pharmacy. and see prescriptions sent from clinics.
- Blue today: in the pharmacy workspace, `/provider/pharmacy` goes to Sell for anyone with `pharmacy.walk-in.create` (`ehr-blue/departments/pharmacy/page.tsx:38-39`). Sell says nothing about incoming orders. Incoming is only on Prescriptions (`departments/pharmacy/Pharmacy.tsx:210-212`). Home, and its "Incoming orders" count, never show on lab. or pharmacy. (`ehr-blue/frame/BlueFrame.tsx:108-109, 123`; `ehr-blue/home/liveCards.tsx:67-109`).
- Missing: classic opened the Pharmacy page with Incoming at the top, and showed a count on the Overview.
- Copy from: `staff/routes/Operations.tsx:1086-1090`; `staff/routes/Dashboard.tsx:47-90`; `productHostname.ts:4`.
- Change: `ehr-blue/departments/pharmacy/page.tsx:38`, or show the incoming count on Sell.
- Note: `pharmacy.walk-in.create` is a new, proposed permission (`docs/POINT_OF_CARE_SPEC.md:181-186`). If no real role holds it yet, this does not bite yet. A stand-alone lab is fine: its first page has Incoming on top (`departments/laboratory/page.tsx:28-31`).

**7. Patients and Access requests are not in the menu on the lab., pharmacy., outreach. and migrate. sites** (Patients, Access, Frame; daily for those staff)
- Staff try: find a patient or send an access request while signed in on a product site.
- Blue today: the menu, tabs, Start menu and search show only that product's pages plus staff, audit, facility, HR and institutions (`ehr-blue/frame/product.ts:32, 48-67`; `ehr-blue/frame/BlueFrame.tsx:106-110, 210-214`; `ehr-blue/frame/TopBarParts.tsx:58-60`). Patients, Access requests, In-person check, Emergency, Consultation, Registration and Facility subscription drop out. They still open if the address is typed (`BlueFrame.tsx:145-151`).
- Who it hits: lab scientists and pharmacists, whose only way to a record is a patient-approved request (`docs/BACKEND_OWNER_HANDOFF.md:659-661`, B2 "still open"), and hospital clinicians who sign in on the wrong site.
- Missing: classic listed each page by permission on every site.
- Copy from: `staff/navigation.ts:14-40`.
- Change: `ehr-blue/frame/product.ts:32, 61-67` (keep Patients and Access requests on every product).

**8. The patient page shows only allergies; history and chat sit behind "Open chart"** (Patients, daily)
- Staff try: open a patient and read what they reported: medicines, conditions, blood group.
- Blue today: the patient page shows only "{allergies or Not stated} (patient-reported)" (`ehr-blue/clinical/patients/PatientPage.tsx:57-100, 192-195`). A patient who listed medicines but no allergies shows only "Allergies: Not stated". The full card, imported history, imported attachments and "Ask about this patient" are only in Consultation (`ehr-blue/clinical/consult/TodaySections.tsx:27-49`), which needs `ehr.encounter.read` (`ehr-blue/clinical/pages.ts:27`). A role with `ehr.note.read` but not `ehr.encounter.read` loses all four. Opening the patient and then the chart reads the profile twice, and each read is logged as a view of the record (`staff/api.ts:1873-1874`).
- Missing: classic showed the full card where every lookup landed, on a page with no page-level permission.
- Copy from: `staff/routes/PatientReportedHealth.tsx:25-58` (reuse the component); `staff/routes/Clinical.tsx:1779-1791`; `staff/App.tsx:769`.
- Change: `ehr-blue/clinical/patients/PatientPage.tsx:57-100, 192-195`.

**9. PIN access is offered only after a refused lookup** (Patients, Access; daily)
- Staff try: a nurse with the patient in front of them uses the patient's PIN.
- Blue today: on Patients, the PIN tile appears only after a Find is refused (`ehr-blue/clinical/patients/PatientsWorkspace.tsx:144-147, 189`). That first sends a lookup that is denied and logged. The other way in, "Use an Access PIN" on Access requests, also needs `identity.consent.write` (`ehr-blue/clinical/consent/ConsentWorkspace.tsx:65-66`; `ehr-blue/clinical/pages.ts:36`). The Back link says "Back to access requests" even when it goes to Find a patient (`consent/PinAccess.tsx:82`). Words changed: "use a patient’s Access PIN" (`consent/access.ts:30-31`), "Couldn’t open the record", "Something went wrong. Please try again." (`PinAccess.tsx:72, 98`). Success opens the patient page, not the chart (`:70`).
- Missing: classic's PIN tab on Patients, with no lookup first, and its words.
- Copy from: `staff/routes/Patients.tsx:34-35, 142, 166-168, 179-182, 209, 238-245`.
- Change: `ehr-blue/clinical/patients/PatientsWorkspace.tsx` (offer request, PIN and emergency without a lookup), `consent/PinAccess.tsx:72-101`, `consent/access.ts:30-31`.

**10. Lab: verify and release in one press, with one reason** (Lab, daily)
- Blue today: "Check & release" sends both steps with the same note as both reasons (`ehr-blue/departments/laboratory/labSteps.tsx:384-412`, at `399-405`). The message says "…released. The patient can see it on their Health ID." and never says the ordering clinic sees it too (`:403`).
- Missing: classic's two separate actions, each with its own reason and words.
- Copy from: `staff/routes/Operations.tsx:358-388, 451-452`.
- Change: `ehr-blue/departments/laboratory/labSteps.tsx:384-412`.

**11. Pharmacy: the dispensing reason is filled in for the pharmacist** (Pharmacy, daily)
- Blue today: the reason starts as "Dispensed as prescribed." (`ehr-blue/departments/pharmacy/PharmacyRecord.tsx:331`), so the audit reason can be a stock phrase nobody typed. A tick-every-step checklist and a confirm sheet are added (`:131, 143-144, 157-161`). The fallback error is "That didn’t work. Please try again." (`:33, 191`). The pay-first and out-of-stock checks read fields today's backend does not send, so they never trigger yet (`departments/pharmacy/pocFields.ts:4-6, 15-28`).
- Missing: classic's empty reason box (at least 8 characters, typed by the pharmacist) and "Pharmacy action could not be recorded."
- Copy from: `staff/routes/Operations.tsx:989-1028`.
- Change: `ehr-blue/departments/pharmacy/PharmacyRecord.tsx:33, 331`.

**12. Lab: preparing a sample needs a second permission, and specimens are handled together** (Lab, daily)
- Blue today: creating an accession also needs `lab.specimen.collect` ("Your role can’t collect samples", `ehr-blue/departments/laboratory/labSteps.tsx:59-60, 76`). One press creates the accession and collects every waiting specimen with one note (`:89-104`). A specimen can be rejected only after collection (`:150-151`). Rejecting before collection is a missing row (rare).
- Missing: classic's accession with `lab.accession.create` alone, and collect or reject per specimen with its own note.
- Copy from: `staff/routes/Operations.tsx:170, 221-245, 249-275`.
- Change: `ehr-blue/departments/laboratory/labSteps.tsx:57-104, 150-190`.

**13. Screen-reader users are not told a lookup was refused; a mistyped Health ID reads as "no access yet"** (Patients, Access; daily)
- Blue today: a refused Find shows a panel "You don’t have access to {hid} yet" / "Choose how to get it." (`ehr-blue/clinical/patients/PatientsWorkspace.tsx:177-193`). It is not announced and gets no focus. Find is disabled while busy, so focus drops (`kasuwa/ui.tsx:93`). The not-granted sentence is never shown here. A 404 (unknown or mistyped Health ID) gets the same panel, with offers to ask the patient. "Open" on Shared with you behaves the same (`PatientsWorkspace.tsx:123-127`). Success opens the patient page, one click before the chart (`:95`).
- Missing: classic's alert region, its not-granted sentence, and a busy state that keeps focus.
- Copy from: `staff/routes/Patients.tsx:142, 156, 254`.
- Change: `ehr-blue/clinical/patients/PatientsWorkspace.tsx:177-194`.

**14. Sharing cards now need `identity.patient.read`, and their empty states are gone** (Patients; weekly and rare)
- Blue today: "Shared with you" and "Invitations" (with Accept) are only on Patients (`ehr-blue/clinical/patients/PatientsWorkspace.tsx:216-217`), which needs `identity.patient.read` (`ehr-blue/clinical/pages.ts:23`). A role with `identity.consent.write` but not `identity.patient.read` loses both cards and Accept, and is sent Home with a generic notice (`ehr-blue/frame/BlueFrame.tsx:142-150`; `frame/RedirectNotice.tsx:6`). With no shares the card disappears (`patients/SharingCards.tsx:57`). The "not eligible" and empty texts are gone (`:132-133`), and so is "sent {date}" (`:142`). The accept message is shorter (`:120`).
- Missing: classic's cards on a page with no page-level permission, and their texts.
- Copy from: `staff/routes/Patients.tsx:250-252`; `staff/routes/SharedPatients.tsx:70-91, 107-163` (texts at `78, 146-148, 153`).
- Change: `ehr-blue/clinical/patients/SharingCards.tsx:57, 120, 132-142`, and mount the cards where a consent-only role can reach them.

**15. Product sites land on a refusal instead of the Overview** (Frame, daily)
- Blue today: on lab., outreach. and migrate., `/provider` is forced to the product page (`ehr-blue/frame/BlueFrame.tsx:123`). Without that page's permission, the person lands on its refusal (for example `ehr-blue/departments/laboratory/page.tsx:21`). The pharmacy. site loops instead (2.4). These sites have no Home, so there is no access-request count, no "Facility check: Done" card and no incoming-orders card, and Facility subscription is not in the menu (`ehr-blue/frame/product.ts:32, 61-67`). Self-signed-up labs and pharmacies are told to work on these sites (`ehr-blue/signup/AfterSubmit.tsx:141-149`; `productHostname.ts:216-237`).
- Copy from: `staff/navigation.ts:52-57`; `staff/routes/Dashboard.tsx:233-264`.
- Change: `ehr-blue/frame/BlueFrame.tsx:123`.

**16. Raw role codes under the facility name** (Frame, daily, every staff member)
- Blue today: `facility.roles.join(', ')` shows codes such as "org_admin, doctor" (`ehr-blue/frame/BlueFrame.tsx:154, 193, 203`). The sentence "Access is limited to your active facility and server permissions." is gone.
- Copy from: `staff/staffAccess.ts:24-26`; `staff/App.tsx:743`. Blue already uses `roleLabels` in `ehr-blue/frame/ChooseWorkspace.tsx:85`.
- Change: `ehr-blue/frame/BlueFrame.tsx:154`.

**17. Emergency access: refusal and warning words changed** (Patients, Access; rare but high stakes)
- Blue today: same requests, same 30 minutes (`ehr-blue/clinical/emergency/BreakGlass.tsx:120-133`). But: "switched off" now says "Ask Health ID support." (`emergency/access.ts:52-53`). The 400 refusal drops the code and the administrator: "Emergency access isn’t set up for your facility, so the record was not opened. Contact support." (`:59-60`). The reason check says "Say why in at least 8 characters." (`:21`). The emergency-contacts notice drops "while alerts are on" and "verified" (`:29`). The sentence that the summary "shows no vital signs and opens no files" has no blue version (`:30-34` is unused). A new required tick box says "the patient is told" (`BreakGlass.tsx:24, 91, 163-171`); that claim was not checked. The fallback is "Something went wrong. Please try again." (`access.ts:38`). The file says its words are copied "word for word" (`access.ts:4-7`); they are not. The Emergency page sits alone under "Wards & units", which starts folded (`ehr-blue/frame/BlueFrame.tsx:34, 165-170`; `kasuwa/AppShell.tsx:90-91`).
- Copy from: `staff/routes/Patients.tsx:36-38, 46, 169, 185-209, 243-245`.
- Change: `ehr-blue/clinical/emergency/access.ts:21-60`; `emergency/BreakGlass.tsx:149-151`.

**18. Shortened order warning on every visit status change; shortened cancel refusal** (Consultation; daily for Complete)
- Blue today: the warning about orders sent elsewhere drops "or cancelled if that facility had accepted it" (`ehr-blue/clinical/consult/encounters.ts:45`), and it shows on every status action (`EncounterPage.tsx:364`). The cancel and entered-in-error refusal is shortened (`encounters.ts:52-54`). Success says "Consultation updated." (`:116`). Blue adds a confirm step for Cancel and entered-in-error, which is safer.
- Copy from: `staff/routes/Clinical.tsx:85, 92-94, 1507-1546`.
- Change: `ehr-blue/clinical/consult/encounters.ts:45, 52-54, 116`; `EncounterPage.tsx:304`.

**19. Lab result history shows without its permission** (Lab, weekly)
- Blue shows history with no `lab.result.released.read` check (`ehr-blue/departments/laboratory/LabRequest.tsx:194`; `labSteps.tsx:448-470`). The server still refuses. Copy the gate from `staff/routes/Operations.tsx:453`.

**20. Point-of-care pages call addresses Health ID does not serve** (Frame; rare to use, but an extra failing request on every lab and pharmacy open)
- Payments, Price list, End of day, Payment setup, the lab's Tests & prices, Till, Settings and New request, and the pharmacy's Sell, Sales & receipts, Stock, Products & prices, Till and Settings are all labelled "live" (`ehr-blue/departments/commerce/page.tsx:30-35`; `departments/laboratory/page.tsx:47-62`; `departments/pharmacy/page.tsx:45-55`). Their addresses are proposed, not served (`departments/commerce/api.ts:7-11, 266-343`). Staff learn "This isn’t set up for your facility, so nothing was saved. Contact support." only after they act (`commerce/NotSwitchedOn.tsx:4-10`). The lab and pharmacy work lists read payment settings on every open, and that request fails (`laboratory/Laboratory.tsx:89`; `pharmacy/Pharmacy.tsx:97`). They need new permissions (`docs/POINT_OF_CARE_SPEC.md:181-186`).
- Change: label them sample, or hide them, until the addresses exist; drop the payment-settings read.

**21. Status labels and "What's left" overstate parity** (Frame)
- An unknown address now goes Home with no message (`ehr-blue/frame/BlueFrame.tsx:151`). Classic said "Page not found / This provider page is unavailable." (`staff/App.tsx:778`). "What's left" claims an unknown address "says so" (`ehr-blue/frame/WhatsLeft.tsx:26`). The "live" label is too strong for Registration, In-person check, Audit, Facility subscription, Outreach, Document OCR, Staff & access, the lab pages and `pharmacy/*`. "What's left" is demo-only (`ehr-blue/frame/pages.ts:116`), so real clinics never see any of these labels.
- Change: `ehr-blue/frame/WhatsLeft.tsx:15-27`, each `pages.ts` status, and add a not-found page.

**22. Access request: the length can be changed, and the words differ** (Patients, Access; daily)
- Blue today: a new "How long (minutes)" field, 1 to 60, default 60 (`ehr-blue/clinical/consent/RequestAccess.tsx:15-17, 34-35, 129-133`). Classic always sent 60. Whether Identity accepts every value from 1 to 60 is unknown. From Patients it can start only after a refused Find (`patients/PatientsWorkspace.tsx:149-151`). Words: "Say why in at least 8 characters." (`RequestAccess.tsx:18`), "See their records" / "See and add to their records" (`:43-46`), "Couldn’t send the request" / "Something went wrong. Please try again." (`:96, 141`), "ask patients for access" (`consent/access.ts:29`). Success opens the request's own page, which shows its status; the request number is no longer printed (`:92-94`).
- Copy from: `staff/routes/Patients.tsx:33, 160-178, 209, 241-245`.
- Change: `ehr-blue/clinical/consent/RequestAccess.tsx`.

**23. Closing a grant takes an extra step** (Access, daily)
- Close is only on each request's page (`ehr-blue/clinical/consent/RequestDetail.tsx:76-105, 141-148`), not in the list. Success says "Your access has ended." (`consent/access.ts:20`) instead of "Access was closed.". The Patients card's "Close my grant" moved to the patient page as "End my access" (`patients/PatientPage.tsx:143-157`). Staff may now leave grants to expire on their own.
- Copy from: `staff/routes/AccessRequests.tsx:82-98, 126-128`.
- Change: `ehr-blue/clinical/consent/ConsentWorkspace.tsx:87-89`.

**24. "Visits here" on the patient page: first page only, no dates** (Patients, daily)
- Rows read "Consultation · {short id}" and a status, with no date, type or complaint, and no hint that more exist (`ehr-blue/clinical/patients/PatientPage.tsx:253-254, 268-269`). Staff may think a patient has fewer visits. The full dated list is one click away.
- Copy from: `staff/routes/Clinical.tsx:1270-1309, 1792-1797`.
- Change: `ehr-blue/clinical/patients/PatientPage.tsx:238-271`.

**25. Opening a visit sends about ten requests** (Consultation, daily)
- Blue sends a lookup, the visit, the visit list, all six record lists, note revisions, reported health and imported records, and again on each move (`ehr-blue/clinical/consult/EncounterPage.tsx:67-70, 171-181, 478`). Classic read only the open tab (`staff/routes/Clinical.tsx:1317-1335`). Opens are slower. New states "Record not found" and "This consultation could not be loaded." appear (`EncounterPage.tsx:73-86`).
- Change: `ehr-blue/clinical/consult/EncounterPage.tsx:171-181`.

**26. Lab "We can't complete this order" closes the request** (Lab, rare)
- Blue always closes the open request (`ehr-blue/departments/laboratory/Laboratory.tsx:148-153`). Classic kept it open when reads are kept (`staff/routes/Operations.tsx:938-943`). Copy the check from `ehr-blue/departments/pharmacy/Pharmacy.tsx:155-161`.

**27. The wrong-patient panel points to a button that is not on the row** (Lab, Pharmacy; rare)
- The text says to use "We can’t complete this order" "on its row in the work list below" (`staff/routes/WrongPatient.tsx:32-38`). In blue the button is only inside the opened request or record (`ehr-blue/departments/laboratory/LabRequest.tsx:224-235`; `ehr-blue/departments/pharmacy/PharmacyRecord.tsx:358-368`). Add the button to the work-list card (`Laboratory.tsx:194-201`; `Pharmacy.tsx:255-266`) or change the words.

**28. Home and the bell suggest staff must act on access requests** (Access, Frame; daily)
- Home says "N access requests waiting" / "Review and send them on" (`ehr-blue/home/BlueHome.tsx:79`). The bell says "Access requests show here for roles that answer them." (`ehr-blue/frame/TopBarParts.tsx:137`). These requests are waiting for the patient. With none pending, Home says "All clear", even for a role that read nothing (`BlueHome.tsx:111-114`).
- Copy from: "N pending request(s)", `staff/routes/Dashboard.tsx:233-239, 255`.
- Change: `ehr-blue/home/BlueHome.tsx:79, 111-114`; `ehr-blue/frame/TopBarParts.tsx:137`.

### 3.2 Rare but misleading (including the three sample rows)

These are rare, so they are not in "Fix first". Each can make a real user believe something was saved.

| What | What happens | Evidence | Change |
|---|---|---|---|
| Facility sign-up agreement boxes (partial) | Four required boxes ("I have read the Terms of Service", "…Privacy Policy", "I acknowledge data protection and patient consent responsibilities", "I am authorised to register this facility") block Submit, but nothing records them. | `ehr-blue/signup/Registration.tsx:16-24, 170, 282`; `ehr-blue/signup/BlueProviderEnrollment.tsx:47-57` | Record them, or remove them until Health ID can. |
| Sample workspaces (sample) | Hidden from the menu, but opened by typed address and by Home's "Edit shortcuts" ("· Sample"). The banner says "Nothing you do here is saved.", yet record pages say "Saved record" and "Saved <date>". | `ehr-blue/home/BlueHome.tsx:60-61, 177-186`; `packages/ui/src/ehr/EhrSampleBanner.tsx:9`; `ehr-blue/departments/parts/sample/SampleDetail.tsx:37, 82, 86`; `ehr-blue/frame/sample/SampleWorkspace.tsx:434, 497`; `ehr-blue/clinical/parts/Detail.tsx:21, 33, 150` | Take samples out of shortcuts at real facilities, and drop "Saved" from sample pages. |
| Facility settings and Reports (sample) | Open to real administrators by address. "Fictional Cedar Hospital" forms with "Save and continue". Nothing is sent. | `ehr-blue/frame/admin/AdminSamples.tsx:242-370, 393-400`; `ehr-blue/frame/pages.ts:106, 112`; `ehr-blue/frame/sampleAccess.ts:33-34, 89` | Gate on demo facilities. |
| HR & Credentials (partial) | The sample half lets a real administrator create credential records kept in memory only. | `ehr-blue/departments/hr/HrCredentials.tsx:20-26, 48, 74-76, 109-115` | Hide the sample half at real facilities. |
| Facility setup wizard (partial) | The Type, Departments, Branches and Billing steps are samples; what a new facility types is never sent. | `ehr-blue/onboarding/SampleSteps.tsx:7-10`; `ehr-blue/onboarding/FacilitySetup.tsx:101`; `ehr-blue/onboarding/access.ts:40-46` | Hide those steps at real facilities. |
| "My profile" drawer (sample, not misleading) | Read-only, with a banner. Nothing can be typed. | `ehr-blue/frame/BlueFrame.tsx:199, 239`; `ehr-blue/frame/TopBarParts.tsx:235-250` | Low priority. |

Not rows, but worth knowing: a real doctor can open the sample Radiology and Referral pages by typing `/provider/radiology/new` or `/provider/referrals/new` (`ehr-blue/frame/pageAccess.ts:14`; `ehr-blue/frame/sampleAccess.ts:37-40, 88-107`), and the sample "Patient visits" page (`ehr-blue/clinical/sample/definitions.ts:99-114`). Each carries the sample banner and saves nothing.

### 3.3 The rest of the partial rows: wording and small changes

These work. The request and the permission check are the same. What differs is listed. In these tables, the classic column is under `staff/routes/` unless a folder is shown, and the blue column is under `ehr-blue/`. Ola's rule applies: copy the classic sentence back.

**Patients**

| Classic action | What differs in blue | Classic to copy from | Blue to change | How often |
|---|---|---|---|---|
| "Current authorized record" card | Heading words; adds expiry; "Open" goes to the patient page, not the chart; "Close my grant" moved to the patient page. | `Patients.tsx:235` | `clinical/patients/PatientsWorkspace.tsx:199-213` | daily |
| "Close my grant" | Now "End my access" on the patient page. Refusal says "end your access"; success "Your access has ended."; failure "Couldn’t end your access. Please try again."; button disabled while busy. | `Patients.tsx:48, 65-78, 222-231` | `clinical/patients/PatientPage.tsx:143-157, 196-200, 213`; `clinical/consent/access.ts:20, 36` | weekly |
| Record with no patient open | "Open a patient with an approved request, the patient’s PIN, or emergency access."; "No authorized patient" title gone; "Find a patient" sends a role without `identity.patient.read` Home. Also an Encounter row. | `Clinical.tsx:1375` | `clinical/parts/chart.tsx:16, 19, 193-198` | daily |
| Patient record header | New layout; adds expiry, date of birth and sex; banner says "Read only" for a read-only grant. | `Clinical.tsx:1767-1768` | `clinical/patients/PatientPage.tsx:118-230`; `clinical/parts/chart.tsx:162-171` | daily |
| Write-access check and read-only notice | Same request. New words for read-only and for "couldn't check"; asked again in every workspace. Also an Encounter row. | `Clinical.tsx:1362-1373, 1769-1771` | `clinical/parts/chart.tsx:14-15, 213`; `copy.ts:34`; `clinical/patients/PatientPage.tsx:211` | daily |
| Access re-check | Same request. "Your access to this patient has ended. Open the patient again to keep working."; a clearer "Access to this patient ended" state; one extra lookup each time a visit opens. Also an Encounter row. | `Clinical.tsx:1244-1262` | `clinical/parts/chart.tsx:12-13, 107-123, 186-191`; `clinical/consult/EncounterPage.tsx:67` | daily |
| "Refresh encounters" | Label "Refresh"; failure "Consultations could not be loaded."; no refresh on "Visits here". | `Clinical.tsx:1306, 1768` | `clinical/consult/EncounterList.tsx:101, 145` | weekly |
| Emergency summary from the record | Now under the Emergency page (needs `identity.break-glass.write`, which whoever opened emergency access already holds); one extra click. Also an Encounter row. | `Clinical.tsx:1376-1378` | `clinical/parts/chart.tsx:199-208`; `clinical/emergency/EmergencyWorkspace.tsx:57` | rare |

**Access**

| Classic action | What differs in blue | Classic to copy from | Blue to change | How often |
|---|---|---|---|---|
| Access requests list | Same request and error words. Loading is a skeleton; "No access requests yet"; "A pending request never grants record access." gone; adds a search box. | `AccessRequests.tsx:68-80, 108, 118-121` | `clinical/consent/ConsentWorkspace.tsx:47-67`; `clinical/consent/requests.ts:109-142` | daily |
| Access requests without permission | No request sent. Generic Home notice instead of the role sentence; silent on lab. and pharmacy. | `AccessRequests.tsx:35-37` | `frame/BlueFrame.tsx:123, 141-151`; `clinical/pages.ts:36` | rare |
| Status filter | "Ended by the patient" instead of "Revoked"; "No requests: <filter>". | `AccessRequests.tsx:20-23, 121` | `clinical/consent/requests.ts:13`; `ConsentWorkspace.tsx:58` | weekly |
| Request row details | Method, expiry and denied reason only on the request page; "updated" time instead of requested time; new scope labels. | `AccessRequests.tsx:25-30, 122-125` | `ConsentWorkspace.tsx:87-89`; `clinical/consent/requests.ts:22-25, 77-81` | daily |
| 100-row cap notice | "Showing the 100 most recent." | `AccessRequests.tsx:129` | `ConsentWorkspace.tsx:92` | rare |
| Read-only emergency summary | New words for withheld, cut-off and error; drops the diagnosis code system, the lab test code and priority, the note status and the file type. | `Clinical.tsx:1063, 1072, 1087-1169` | `clinical/emergency/EmergencySummary.tsx:17-19, 101, 113, 145-198` | rare |
| Emergency summary refresh | Label "Refresh". | `Clinical.tsx:1113-1114` | `EmergencySummary.tsx:274-275` | rare |
| Released results in the summary | "Show results" / "No results released yet."; test code dropped. | `Clinical.tsx:909-945` | `clinical/emergency/ReleasedResults.tsx:85-100` | rare |
| Ending a PIN, request or emergency grant | Same request and reason. "Your access has ended."; "Couldn’t end your access. Please try again." | `Patients.tsx:222-231` | `clinical/patients/PatientPage.tsx:143-160`; `clinical/emergency/EmergencySummary.tsx:247-263`; `clinical/emergency/access.ts:41, 77` | daily |
| In-person check: no permission (also a Frame row) | Older words, pointing to "a platform administrator". | `InPersonCheck.tsx:135-144` | `departments/inperson/inPersonRules.ts:15-16` | rare |
| In-person check: the page | Older heading and labels; a read-only "Method" choice; not in the menu on product sites. | `InPersonCheck.tsx:269, 289-351` | `inPersonRules.ts:19-21`; `departments/inperson/InPersonCheck.tsx:227-233` | weekly |
| In-person check: field checks | Every message is the older long wording. | `InPersonCheck.tsx:39-45, 109-110, 168-182` | `inPersonRules.ts:38-44, 118-128` | weekly |
| In-person check: submit | Button "Check the details". | `InPersonCheck.tsx:350` | `inPersonRules.ts:154` | weekly |
| In-person check: checked | "Checked. The patient can continue on their phone."; adds facts and "Open patients". | `InPersonCheck.tsx:271-278` | `inPersonRules.ts:141-142` | weekly |
| In-person check: details don't match | "The details do not match the NIN record"; adds a daily-limit note. | `InPersonCheck.tsx:96-107, 338-345` | `inPersonRules.ts:98-110, 149-150` | weekly |
| In-person check: already has a Health ID | Longer older words; an empty detail line is shown. | `InPersonCheck.tsx:280-287` | `inPersonRules.ts:145-146`; `InPersonCheck.tsx:207` | rare |
| In-person check: Identity's refusals | Older long sentences; "platform administrator" instead of Health ID support or "your administrator". | `InPersonCheck.tsx:223-257` | `inPersonRules.ts:118-138` | rare |
| In-person check: retry | Longer retry sentence. | `InPersonCheck.tsx:112` | `inPersonRules.ts:121` | rare |
| Facility check card (also a Frame row) | Only on the EHR site's Home. Self-signed-up labs and pharmacies never see "Done". | `ReviewBanner.tsx:87-100`; `Dashboard.tsx:254` | `home/BlueHome.tsx:137`; `frame/BlueFrame.tsx:123` | rare to weekly |

The in-person words come from an older copy of the classic page (commit a4f5704, `inPersonRules.ts:5`). The classic page was reworded on the redesign branch afterwards. Copy the current classic words.

**Consultation (encounter)**

| Classic action | What differs in blue | Classic to copy from | Blue to change | How often |
|---|---|---|---|---|
| Record with no patient, re-check, write check | Same as the Patients rows above. | `Clinical.tsx:1244-1262, 1362-1375` | `clinical/parts/chart.tsx:12-19` | daily |
| Clinical page under emergency access | One extra click to the summary. | `Clinical.tsx:1376-1378` | `clinical/parts/chart.tsx:199-208` | rare |
| List the visits | "Loading consultations…" (heard only by screen readers), "No consultations for this patient here yet.", "Consultations could not be loaded.", "No complaint recorded"; nothing is picked by default. | `Clinical.tsx:1270-1316` | `clinical/consult/EncounterList.tsx:101, 161`; `clinical/consult/encounters.ts:111-112` | daily |
| Start a visit | "Consultation started." / "The consultation could not be started."; new labels; an optional note and diagnosis in the same press, needing only write permissions. | `Clinical.tsx:435-456, 1396-1403` | `clinical/consult/NewConsultation.tsx:36-37, 70-72`; `encounters.ts:113, 129` | daily |
| Visit changed by someone else | Reworded. | `Clinical.tsx:1525-1532` | `encounters.ts:120` | rare |
| Record sections by permission | "Your role here can’t see these records."; no Vitals card. | `Clinical.tsx:25-32, 1232` | `clinical/triage/records.ts:21`; `EncounterPage.tsx:414` | daily |
| Add a note | "Saved."; "Complete this field." | `Clinical.tsx:1502` | `encounters.ts:114`; `clinical/parts/RecordForm.tsx:43, 68` | daily |
| Sign a note | Typed "SIGN" step; "Note updated."; the top Sign button signs only the newest note. | `Clinical.tsx:872-875, 1548-1567` | `clinical/consult/Notes.tsx:121-136`; `EncounterPage.tsx:346-349`; `encounters.ts:115, 187-192` | daily |
| Mark a note entered in error | Confirm step added; "Note updated." | `Clinical.tsx:122-126` | `Notes.tsx:124-133` | rare |
| Add a note revision | "Note changes saved." | `Clinical.tsx:826-853` | `encounters.ts:117` | weekly |
| List diagnoses | "No diagnoses yet." | `Clinical.tsx:1808-1809` | `clinical/consult/Diagnoses.tsx:126` | daily |
| Add a diagnosis | "Saved."; "Complete this field." | `Clinical.tsx:504, 566` | `encounters.ts:114` | daily |
| List documents | New words for type, size and virus check; an unfinished upload drops "only the person who started it can finish it". | `Clinical.tsx:950-961, 995` | `clinical/consult/Documents.tsx:112-115, 153-162` | daily |
| Upload a document | "Use a PDF, JPEG, PNG or TIFF file up to 50 MB."; "Uploaded. It can be opened once the virus check is done." | `Clinical.tsx:962-978` | `Documents.tsx:79, 88` | weekly |

**Orders**: every partial Orders row is in 3.1 (items 1, 5, 6, 10, 11, 26 and 27).

**Frame and departments**

| Classic action | What differs in blue | Classic to copy from | Blue to change | How often |
|---|---|---|---|---|
| Staff sign-in | "Email" instead of "Work email"; "Sign in to your hospital workspace." on every site, lab and pharmacy included; "Need a staff account? Ask your facility administrator." gone. | `SignIn.tsx:173-209` | `frame/auth/BlueSignIn.tsx:100-135` | daily |
| Sign-in on app. | Title and button words. | `SignIn.tsx:126-132` | `BlueSignIn.tsx:54-62` | rare |
| Authenticator first set-up | Last button "Continue to the Hospital EHR". | `SignIn.tsx:181` | `BlueSignIn.tsx:104` | rare |
| Password recovery | Title and lede words. | `routes/PrincipalRecovery.tsx:49-50, 137-144` | `frame/auth/BlueRecovery.tsx:45, 129` | rare |
| Staff invitation | Title words. | `StaffInvitation.tsx:87, 160` | `frame/auth/BlueStaffInvitation.tsx:84, 155` | rare |
| Choose a facility | One tap on "Work here", no Continue; "Where are you working today?"; second sentence changed. | `staff/App.tsx:523-592` | `frame/ChooseWorkspace.tsx:52-63, 76-109` | daily |
| Facility lost mid-session | Heading and second sentence. | `staff/App.tsx:510, 575-576` | `ChooseWorkspace.tsx:76, 79` | rare |
| Switch facility | Two steps through a page; new words. | `staff/App.tsx:682-702` | `frame/BlueFrame.tsx:191-201`; `ChooseWorkspace.tsx:20, 76` | weekly |
| Page opened without permission | Registration and In-person check refusal words differ; pages without a refusal send the person Home with a generic notice, lost on product sites. | `Registration.tsx:205`; `InPersonCheck.tsx:139-140` | `frame/BlueFrame.tsx:141-151`; `departments/registration/registrationText.ts:50-51` | rare |
| Browser tab title | Product names change; the old title effect can overwrite it. | `staff/App.tsx:596-624` | `frame/BlueFrame.tsx:114-118`; `clinical/parts/Workspace.tsx:30-35` | daily |
| A page crashes | No way back to classic; the comment still promises one. | (whole-app error screen) | `frame/BluePageBoundary.tsx:7, 14-15, 27-42` | rare |
| Overview greeting | New words; no Home on product sites. | `Dashboard.tsx:250` | `home/BlueHome.tsx:99-100` | daily |
| "Active facility" card | Gone; roles shown as codes in the switcher. | `Dashboard.tsx:253` | `frame/BlueFrame.tsx:154, 192-193` | daily |
| "Current patient" card | New words. | `Dashboard.tsx:260` | `home/BlueHome.tsx:80-82` | daily |
| Workspaces grid | Gone; the "no clinical module" notice reworded. | `Dashboard.tsx:20-32, 262` | `home/BlueHome.tsx:145-157` | daily |
| "Health ID Migrate" card | Gone; no role can see it anyway. | `Dashboard.tsx:263-264` | (none) | rare |
| Registration refusal | Older words. | `Registration.tsx:205` | `departments/registration/registrationText.ts:49-51` | rare |
| NIN check availability | Older words. | `Registration.tsx:81-97, 219-221` | `registrationText.ts:63-67` | daily |
| Continue a case by its number | "The registration case could not be loaded." | `Registration.tsx:100-117` | `registrationText.ts:97-98` | weekly |
| Check a NIN | Older words; design-only fields shown greyed out. | `Registration.tsx:119-151` | `registrationText.ts:82-88` | daily |
| Link or approve a Health ID | Older words and status labels. | `Registration.tsx:153-180` | `registrationText.ts:28-37, 120-122` | daily |
| Create the patient's account | Older words. | `Registration.tsx:182-203` | `registrationText.ts:124-133` | weekly |
| Plan and invoices | "Billing isn't available yet"; not in the menu on product sites. | `Billing.tsx:76-80, 156-158` | `frame/BlueSubscription.tsx:72-80, 178-180` | rare |
| Pay now | "Card details never pass through Health ID." dropped. | `Billing.tsx:148` | `BlueSubscription.tsx:158` | rare |
| Lab work list | Stage tabs; an extra request that fails. | `Operations.tsx:892-972` | `departments/laboratory/Laboratory.tsx:89` | daily |
| Lab: start and finish a test | "Test started." / "Test finished. Enter the result." | `Operations.tsx:436, 579` | `departments/laboratory/labSteps.tsx:203-237` | daily |
| Lab: enter or correct a result | "The result could not be saved. Refresh before trying again." | `Operations.tsx:336` | `labSteps.tsx:307` | daily |
| Pharmacy prescriptions list | An extra request that fails; refusal words on the page. | `Operations.tsx:1056-1117` | `departments/pharmacy/Pharmacy.tsx:97, 136` | daily |
| Pharmacy: reverse dispensing | Fallback words; confirm added. | `Operations.tsx:1004-1008, 1020` | `departments/pharmacy/PharmacyRecord.tsx:33, 191` | rare |
| Document OCR: find, create, retry; validate and confirm; publish (3 rows) | Small word changes. No real role can open these pages. | `Operations.tsx:1133-1633` | `departments/migrate/Migrate.tsx`; `departments/migrate/ocrSteps.tsx` | rare |
| Outreach: campaigns, cases, create, link (4 rows) | Empty, error and success words. | `Operations.tsx:1634-1746` | `departments/outreach/outreachParts.tsx:33-35`; `Outreach.tsx:184-187`; `OutreachCaseView.tsx:91, 119` | weekly |
| Staff: invite, change role or remove, resend or revoke, own licence (4 rows) | Full sentences replaced by short pop-ups, losing facts such as "Its link and code no longer work." and "Health ID support checks it…". | `Staff.tsx:307-313, 408-411, 462-466, 510-521, 584-586` | `departments/staff/InviteCard.tsx:99-106, 173-176`; `Memberships.tsx:129-150`; `Invitations.tsx:179-193` | rare |
| Audit: read, page, filter | New 403 and empty words; times shown in UTC code form. | `Audit.tsx:45-90` | `departments/audit/AuditCompliance.tsx:40-43, 77, 174-187` | weekly |

---

## 4. Live and checked

Same request, same check, same states and same words. Classic column under `staff/routes/` unless a folder is shown; blue column under `ehr-blue/`.

**Patients**

| Classic | Blue | Verified |
|---|---|---|
| "Change patient →" (`Clinical.tsx:1768`) | Patients tab, Start > Find a patient, "Back to find a patient" (`frame/BlueFrame.tsx:211, 214`; `clinical/patients/PatientPage.tsx:205`) | Navigation only. |
| Pick a visit to document (`Clinical.tsx:1796`) | Visit row and Consultation row (`PatientPage.tsx:268`; `clinical/consult/EncounterList.tsx:166`) | Opens the visit. Documenting it is in the Consultation rows. |
| Staff imported history, main-v1 (`Clinical.tsx:1776-1778`) | `clinical/consult/TodaySections.tsx:27-28` | Same gate and component. Off in production for both (`config/production.json:22`). |

**Access**

| Classic | Blue | Verified |
|---|---|---|
| Access requests Refresh (`AccessRequests.tsx:116`) | `clinical/consent/ConsentWorkspace.tsx:80` | Same request, label and busy guard. |
| In-person "Check another patient" (`InPersonCheck.tsx:260-265`) | `departments/inperson/InPersonCheck.tsx:185-190` | Same reset and label. |
| Facility review banner (`ReviewBanner.tsx:62-74`) | `frame/BlueFrame.tsx:223` | Same component, on every site. |
| Banner licence hint (`ReviewBanner.tsx:40-55`) | Same component | Same read and words; the link lands on Staff & access. |
| Banner "Check again" (`ReviewBanner.tsx:72`) | Same component | Same. |

**Consultation (encounter)**

| Classic | Blue | Verified |
|---|---|---|
| Visit pager (`Clinical.tsx:360-374`) | `clinical/consult/EncounterList.tsx:152-159` | Same reads, restart rule and words. |
| Refresh visits (`Clinical.tsx:1768`) | `EncounterList.tsx:145` | Same request; label only. |
| "Change patient →" | Patients tab (`frame/BlueFrame.tsx:211`) | Navigation only. |
| Review note content (`Clinical.tsx:815-869`) | `clinical/consult/Notes.tsx:104, 174-189` | Same read on open, same words. |
| Corrected vital values (`Clinical.tsx:770-790`) | `clinical/triage/vitals.ts:146-183` | Same read and words (on Triage pages). |
| Change a diagnosis (`Clinical.tsx:655-700`) | `clinical/consult/Diagnoses.tsx:87-119` | Same request, changed fields only, same words. |
| Remove a diagnosis (`Clinical.tsx:690`) | `Diagnoses.tsx:28, 143` | Same. |
| Pages of notes and diagnoses (`Clinical.tsx:1413-1441`) | `Notes.tsx:29-39`; `clinical/consult/records.ts:72-146` | Same reads and words. |
| A list fails, or the re-read after a save fails (`Clinical.tsx:1332, 1437`) | `records.ts:113-115`; `clinical/consult/encounters.ts:97` | Same words. |
| Open a document (`Clinical.tsx:979-994`) | `clinical/consult/Documents.tsx:53-68` | Same steps and words. |
| "Extract with OCR" link (`Clinical.tsx:995`) | `Documents.tsx:124-128` | Same link and state. |
| Patient-reported card, inside Consultation (`Clinical.tsx:1785-1787`) | `clinical/consult/TodaySections.tsx:39` | Same component. See 3.1 item 8 for the patient page. |
| Imported medical history, inside Consultation (`Clinical.tsx:1788-1791`) | `TodaySections.tsx:40-49` | Same component and switch. |
| Staff imported history, main-v1 | `TodaySections.tsx:27-28` | Same; off in production. |
| "Ask about this patient": open and close | `TodaySections.tsx:29-38` | Same component (it closes when you move between pages). |
| Assistant: ask a question | Same | Same component. |
| Assistant: load the saved chat | Same | Same component. |
| Assistant: new chat | Same | Same component. |
| Assistant: open a cited record | Same | Same component. |
| Assistant: access ended while chatting | Same | Same component and words. |
| Record chat, main-v1: availability | Same | Same; not used in production. |
| Record chat, main-v1: accept the notice | Same | Same; not used in production. |
| Record chat, main-v1: ask | Same | Same; not used in production. |
| Record chat, main-v1: load or retry | Same | Same; not used in production. |
| Record chat, main-v1: new chat | Same | Same; not used in production. |

**Orders**

| Classic | Blue | Verified |
|---|---|---|
| Lab request as a draft (`Clinical.tsx:515-523`) | `clinical/consult/orders/CreateOrder.tsx:397-431` | Same body, key, warning and refusal; a confirm sheet added. |
| Active lab request to this facility's lab (`Clinical.tsx:213-239, 1453-1505`) | `CreateOrder.tsx:324-364`; `orders/words.ts:95-118` | Same outcomes and words; the note before sending is shorter. |
| Create and send to another lab (`Clinical.tsx:1637-1673`) | `CreateOrder.tsx:366-395` | Same requests, gates and words. |
| Activate or resume and send to Lab (`Clinical.tsx:142-149`) | `orders/OrderPage.tsx:146-148, 174-189` | Same request, gate and words. |
| Draft cancel or entered in error | `OrderPage.tsx:146-148` | Same; confirm for cancel. |
| Status change on an order sent elsewhere (`Clinical.tsx:116-121`) | `OrderPage.tsx:147-150` | Same choices and warning. |
| "Lab may already be working…" notes (`Clinical.tsx:156-166`) | `OrderPage.tsx:155-156` | Same conditions and words. |
| Send to Lab again (`Clinical.tsx:298-320`) | `OrderPage.tsx:214-233` | Same request, gate and words. |
| View released results (`Clinical.tsx:909-948`) | `orders/Results.tsx:38-84` | Same; one more click. |
| Prescription status (`Clinical.tsx:97-114`) | `OrderPage.tsx:148-150` | Same. |
| Send to Pharmacy (`Clinical.tsx:1738-1764`) | `OrderPage.tsx:191-212` | Same request, reason rule and words. |
| Send to another laboratory (`OrderRoutes.tsx:129-182`) | `orders/Routing.tsx:194-253` | Same. |
| Send to a pharmacy elsewhere (`OrderRoutes.tsx:107-116`) | `Routing.tsx:172-183` | Same. |
| Directory search (`staff/components/OrderDestinationPicker.tsx:26-85`) | `Routing.tsx:32-107` | Same request and words. |
| Patient-agreed confirmation (`OrderRoutes.tsx:43-120`) | `Routing.tsx:113-188` | Same. |
| Route card of a sent order (`OrderRoutes.tsx:332-393`) | `Routing.tsx:294-358` | Same, on the order page. |
| Details and results of a sent lab request (`OrderRoutes.tsx:360-417`) | `Routing.tsx:322-387`; `orders/routeLines.ts` | Same, checked line by line. |
| Withdrawn values of another person's results (`OrderRoutes.tsx:266-311`) | `Routing.tsx:256-285` | Same. |
| Details and dispensing of a sent prescription (`OrderRoutes.tsx:313-318`) | `Routing.tsx:374` | Same. |
| Withdraw a waiting order (`Clinical.tsx:1676-1693`) | `OrderPage.tsx:259-275` | Same. |
| Open the order from the wrong-patient card (`Clinical.tsx:1337-1358`) | `clinical/consult/EncounterList.tsx:42-60` | Same rule. |
| "Orders accepted for the wrong person" card (`Dashboard.tsx:170-230`) | `home/liveCards.tsx:147-202` | Word for word. |
| Incoming orders list (`IncomingOrders.tsx:74-198`) | `departments/laboratory/Laboratory.tsx:171-173`; `departments/pharmacy/Pharmacy.tsx:210-212` | Same component. |
| Find incoming by Health ID | Same component | Same. |
| Accept with the Health ID | Same component | Same. |
| Accept with the date of birth | Same component | Same. |
| Pharmacy's reason for accepting | Same component | Same. |
| Decline | Same component | Same. |
| Accepted panel | Same component | Same. |
| Incoming paused notices | Same component | Same. |
| Routed work lines (`Operations.tsx:139-155`) | `departments/parts/routedWork.tsx:36-49` | Same words; the pharmacy list card is shorter. |
| Lab: "This isn't the order's patient" (`Operations.tsx:182-190`) | `departments/laboratory/LabRequest.tsx:224-235` | Same component; one level deeper. |
| Pharmacy: "This isn't the order's patient" (`Operations.tsx:1044-1050`) | `departments/pharmacy/PharmacyRecord.tsx:358-368` | Same. |
| Pharmacy: "We can't complete this order" | `PharmacyRecord.tsx:358-368`; `Pharmacy.tsx:155-161` | Same. |
| Ending messages (`Operations.tsx:884-890`) | `departments/parts/routedWork.tsx:245-252` | Same components. |
| A refusal kept in its row (`Operations.tsx:808-841`) | `departments/parts/routedWork.tsx:175-207` | Same logic. |
| Work-list cap notice | `Laboratory.tsx:181`; `Pharmacy.tsx:218-220` | Same words. |
| "Work … is paused by Health ID" | `departments/parts/routedWork.tsx:80-92` | Same words. |
| Correct an ended order: find (`LateWrongPatient.tsx:247-313`) | Same component | Same. |
| Late withdraw | Same component | Same. |
| Lookup finds an open order: report wrong patient | Same component | Same. |
| Lookup finds an open, accepted order: can't complete | Same component | Same. |
| Identity check before sample or handover (`Operations.tsx:180, 1036`) | `departments/laboratory/labSteps.tsx:108`; `PharmacyRecord.tsx:334` | Same text. |

**Frame and departments**

| Classic | Blue | Verified |
|---|---|---|
| Authenticator code step (`StaffMfaSteps.tsx:248-300`) | `frame/auth/BlueSignIn.tsx:22-26, 101-104` | Same component. |
| "Authenticator required" notice (`SignIn.tsx:26-27`) | `BlueSignIn.tsx:51, 106` | Same text. |
| Join a facility while signed in (`StaffJoin.tsx`) | Classic page inside the frame (`routes.tsx:77-93`) | Same page. |
| Session check screens (`staff/App.tsx:418-488`) | Same code | Shared. |
| Sign out (`staff/App.tsx:704-711`) | `frame/BlueFrame.tsx:125-132` | Same request and words; now in the "⋯" menu. |
| Wrong-person orders card | `home/liveCards.tsx:147-170` | Same (also an Orders row). |
| "Select a facility" card | Classic shell still shows it | Unchanged. |
| Start the free trial (`Billing.tsx:82-93`) | `frame/BlueSubscription.tsx:82-93` | Same. |
| Billing banner (`Billing.tsx:180-211`) | `frame/BlueFrame.tsx:224` | Same component. |
| Lab incoming orders | `departments/laboratory/Laboratory.tsx:171-173` | Same component. |
| Wrong patient, can't complete, late correction | Same components (`LabRequest.tsx:224-225`; `PharmacyRecord.tsx:204, 358`) | Same. |
| Pharmacy incoming orders | `departments/pharmacy/Pharmacy.tsx:210` | Same component. |
| Migration page (`Operations.tsx:1752-1760`) | Classic page inside the frame | Same. |
| Staff list (`Staff.tsx:108-148`) | `departments/staff/StaffAccess.tsx:49-131` | Same request and messages. |
| Audit refusal (`Audit.tsx:56`) | `departments/audit/page.tsx:15` | Same words. |
| Clinician sign-up (`App.tsx:111-112`) | Unchanged classic pages | Same. |

---

## 5. Open questions

1. **Is removing "Use the classic EHR" final?** Commit 20af2f7 removed it, and `clinicSwitch.ts:7` records the owner's decision of 2026-10-31. If it is final, every gap here is hard until fixed. If not, putting it back is the cheapest stopgap. Even then, a reload returns to blue.
2. **Which real roles hold which permissions?** Roles are defined in hid-system, not here. These answers decide how many staff each gap hits:
   - `identity.consent.write` without `identity.patient.read` (these roles lose the sharing cards and Accept).
   - `ehr.note.read` without `ehr.encounter.read` (they lose the reported-health card, imported history and chat).
   - `ehr.prescription.write` without `ehr.prescription.read` (a real save looks like a failure).
   - `lab.accession.create` without `lab.specimen.collect` (they cannot prepare a sample).
   - `billing.*`, `pharmacy.walk-in.create`, `lab.walk-in.create`, `pharmacy.stock.*` (the point-of-care pages and the Sell landing).
3. **Do lab scientists and pharmacists still lack the PIN permission?** `docs/BACKEND_OWNER_HANDOFF.md` B2 was "still open" at bbc6e89. If so, the missing menu links on lab. and pharmacy. (3.1 item 7) hit them daily.
4. **The pharmacy. loop (2.4) was found by reading, not running.** Does a reviewed pharmacy's administrator get `pharmacy.work-item.read`? If so, the loop ends for them after the review. It still hits non-pharmacists on that site.
5. **Does Identity accept every access-request length from 1 to 60 minutes?** Classic only ever sent 60.
6. **Is the patient really "told" about emergency access?** The new tick box says so (`ehr-blue/clinical/emergency/BreakGlass.tsx:24`). The patient portal lists emergency grants (`routes/Portal.tsx:660-664`), but nothing here shows a notice on each use.
7. **Registration hand-off: missing or partial?** The Patients review says missing; the Frame review says partial because the top-bar search works around it. It is in "Fix first" either way, with low impact.
8. **Is reading the patient-reported profile twice acceptable?** Each read is logged as a view of the record (`staff/api.ts:1873-1874`), so opening a patient and then the chart logs two views.
9. **Do the failing payment-settings requests matter?** Every lab and pharmacy work-list open sends one to an address Health ID does not serve. Check whether these raise alerts or fill logs.
10. **Can the classic edge case happen in practice?** The classic shell still shows for a signed-in staff member with no current facility and no choice pending (`ehr-blue/blueFacilities.ts:40-52`).

Settled while writing:

- The pharmacy pay-first and out-of-stock checks do not trigger today. They read fields the backend does not send (`ehr-blue/departments/pharmacy/pocFields.ts:4-6`).
- "Open Pharmacy →" on Home cannot land on Sell. Home shows only in the EHR workspace, where readers go to Prescriptions (`ehr-blue/departments/pharmacy/page.tsx:38`).

---

## 6. Proposed build order

Draft PRs off main, one per area. Ola builds the clinical areas (2 to 5) and keeps the classic portal's requests, checks and words: copy the classic sentence, do not rewrite it. Each PR starts with its "Fix first" items, then the 3.1 items, then the 3.3 wording. Each PR also sets the page's status in `pages.ts` to what is true, and removes stale comments.

1. **Frame (owner).** Small and first, because it decides whether there is a fallback.
   - Decide on "Use the classic EHR" (2.3). Restore it or delete the stale promises.
   - Fix the pharmacy. loop (2.4) and add a test for that site.
   - Fix the Start-menu hint (2.2, one line in `BlueFrame.tsx:217`).
   - Keep Patients and Access requests in the menu on every site (3.1 #7). Fall back to the Overview, or a refusal, when the product page is refused (#15).
   - Show role names, not codes (#16). Add a not-found page and correct "What's left" (#21).
2. **Consultation (Ola).** The highest clinical risk.
   - Nursing "Vitals" (2.1) and nursing notes in the Notes card (#4).
   - Vitals steps back to classic (#2). A Vitals card on the visit page, and paging past 50 (#3).
   - The full order warning and the cancel refusal (#18). Fewer reads when opening a visit (#25).
   - The 3.3 Consultation wording.
3. **Orders (Ola).**
   - Dose and unit optional but paired; create only with read (#1).
   - Route state and the detail line in the order list (#5).
   - The incoming count where a stand-alone pharmacy lands (#6).
   - The wrong-patient button or words (#27). Keep the lab request open after "can't complete" (#26).
4. **Access (Ola).**
   - Offer request, PIN and emergency on Patients without a lookup first (#9).
   - Emergency words and notice back to classic (#17). Request length back to 60, unless Identity confirms the range (#22).
   - Close from the list (#23). Home and bell wording (#28).
   - In-person words from the current classic page (3.3).
5. **Patients (Ola).**
   - Announce refused lookups and word the 404 apart (#13).
   - The full patient-reported card on the patient page (#8).
   - Sharing cards reachable for consent-only roles, with their empty states (#14).
   - Dates and a "more" link on "Visits here" (#24).
   - The registration hand-off (2.5), which touches `departments/registration`.
   - The 3.3 Patients wording.
6. **Departments (owner, or whoever owns lab, pharmacy and admin pages).**
   - Separate verify and release (#10). An empty dispensing reason (#11).
   - Accession without the collect permission, and reject before collection (#12).
   - The result history gate (#19).
   - Point-of-care pages labelled sample until their addresses exist (#20).
   - Hide sample halves and the sample setup steps at real facilities. Record or remove the sign-up agreement boxes (3.2).
   - Registration, staff, outreach, OCR and audit wording (3.3).
