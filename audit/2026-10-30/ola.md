Design audit of health main a4f5704 against screens/ (2026-10-30, 21:30 UTC). Owner decisions applied: (1) encounter lifecycle actions move to a "More actions" menu; (2) sample workspaces follow the design role mapping, live pages keep their live permission; (3) fictional history rows on sample pages are wanted, on sample pages only; (4) labels are written properly ("Date of birth", "Health ID", "Blood pressure", "SpO2"), not copied raw. Accepted differences are not listed (sample notice, no sync/offline notes, no export or files, live names and statuses, today's refusal wording).

OLA: clinical

Coordinator: design audit of main a4f5704 against design/ehr-target screens/.
Paths starting ehr-blue/ are under apps/patient-web/src/ehr-blue/. "Design" means branch design/ehr-target (src/workflows.tsx and src/catalog.ts).

1. [major] Patients has no "Create record"; creating a patient means today's unstyled Registration page
   Screens: workspaces/patients-1-list.png, patients-2-new.png. Live: /provider/patients (creation is at /provider/registration today).
   Where: ehr-blue/clinical/patients/PatientsWorkspace.tsx:147 (heading with no action) and :33-38 (no `new` route); apps/patient-web/src/staff/routes/Registration.tsx:218-236
   Fix:
   - Heading: `<EhrPageHeading title="Patients" primaryAction={can('identity.registration.write') ? <EhrButton onClick={() => navigate(href('new'))}>Create record</EhrButton> : undefined} />`.
   - Add `<Route path="new" element={<NewPatient />} />`.
   - NewPatient: `<RecordHeading title="New patients" backHref={href()} />`, then one EhrCard holding a two-column RecordForm.
   - The form drives today's calls (staffApi.registrationCapabilities, resolveNin, registrationCase, approveNewRegistration / linkExistingRegistration). Fields: NIN*, First name*, Last name*, Date of birth*, Sex. Save button: auto-width primary "Save record".
   - No eyebrow, no trailing full stop, no intro paragraph, no availability card (show NIN availability as a field hint), no full-width button.
   - After save, open the patient's page.
   - Rahman (item 1) unlists Patient registration and In-person check in the same change.

2. [major] The Patients list has extra "Shared with you" and "Invitations" cards
   Screen: workspaces/patients-1-list.png. Live: /provider/patients.
   Where: ehr-blue/clinical/patients/PatientsWorkspace.tsx:192-195 (SharingCards.tsx)
   Fix: delete :192-195 and build these as RecordTable rows in the existing `rows` useMemo (:126-142).
   - Each share becomes a row: Record = patient name, reference = Health ID, Status = scope badge (for example "Clinical Review"), statusNote "until 5 Nov 2026", Open → openShared(hid).
   - Each invitation becomes a row with status "invited"; its Quick view holds the Accept button.

3. [major] The patient page meta line is a patient header; the design has "[status] Saved …"
   Screen: workspaces/patients-3-detail.png. Live: /provider/patients/open.
   Where: ehr-blue/clinical/patients/PatientPage.tsx:84
   Fix: `<DetailMeta status={accessLabel(chart.patient)}>{chart.writeNotice !== null ? <StatusBadge status="Read only" /> : null}</DetailMeta>`. Name, date of birth, sex and Health ID stay in Saved record. Keep PatientHeader for EmergencySummary.

4. [major] Patient page Next steps has an extra "Open clinical record"
   Screen: workspaces/patients-3-detail.png. Live: /provider/patients/open.
   Where: ehr-blue/clinical/patients/PatientPage.tsx:124
   Fix: delete the line. The design's Next steps are Open appointments, Register walk-in visit and Open consent (design src/workflows.tsx:591-601).

5. [major] The External record access list has an extra "Verify patient PIN" button, a "Status" select and "Refresh"
   Screen: workspaces/consent-1-list.png. Live: /provider/requests.
   Where: ehr-blue/clinical/consent/ConsentWorkspace.tsx:55-63, :68-77
   Fix:
   - primaryAction = `can('identity.consent.write') ? <EhrButton onClick={() => navigate(href('new'))}>Create record</EhrButton> : undefined` only.
   - Delete :68-77 and the `status` state; call `useAccessRequests('')`. The search already matches status.
   - The PIN stays reachable from the Patients "No access to this patient yet" banner (PatientsWorkspace.tsx ~:173).

6. [major] The request page lacks the "Cross-institution history" card
   Screen: workspaces/consent-3-detail.png. Live: /provider/requests/ar-0001 and ar-0002.
   Where: ehr-blue/clinical/consent/RequestDetail.tsx:118 (StateBanner link), :140-147 (Next steps and break-glass inside Available actions), :149 (</DetailGrid>). Design: src/workflows.tsx:658-740.
   Fix:
   - Delete :140-147.
   - After `</DetailGrid>`, add `<EhrCard title="Cross-institution history">` with the text "Local hospital care does not require an external access grant. External content is removed immediately on expiry or revocation." and then one action row:
     - primary "View authorized category", shown only when the request is approved or active: offerHealthId + navigate(href.to('patients')).
     - secondary "Emergency break-glass access", shown when emergencyUnavailable === null: it expands the BreakGlass form inline in this card.
   - Keep the StateBanner text but drop its link.

7. [major] The Emergency list has an extra break-glass card above the list
   Screen: workspaces/emergency-1-list.png. Live: /provider/emergency.
   Where: ehr-blue/clinical/emergency/EmergencyWorkspace.tsx:31 (`<BreakGlassCard />`); clinical/emergency/BreakGlass.tsx:55
   Fix:
   - Remove it, so the page is the heading plus the one list card.
   - Add `<Route path="break-glass">` for the Patients refused-lookup button (PatientsWorkspace.tsx:174 → `navigate(href.to('emergency', 'break-glass'))`). The request page uses the inline form from item 6.
   - At a non-demo facility, give the empty state an emptyAction "Emergency break-glass access" that opens that route.

8. [major] The Consultation heading has an extra "Refresh encounters" button
   Screen: workspaces/consult-1-list.png. Live: /provider/clinical.
   Where: ehr-blue/clinical/consult/EncounterList.tsx:100-109 (:106)
   Fix: delete :106 and pass Create record as `primaryAction={canCreate ? <EhrButton onClick={() => navigate(href('new'))}>Create record</EhrButton> : undefined}`.

9. [major] The encounter page has three extra cards: "Reported by the patient", "Diagnoses" and "Documents"
   Screens: workspaces/consult-3-detail1.png, consult-3-detail2.png. Live: /provider/clinical/<encounterId>.
   Where: ehr-blue/clinical/consult/EncounterPage.tsx:359 (TodaySections), :364-366 (DiagnosesCard), :367-369 (DocumentsCard)
   Fix: remove all three. The page then reads: meta, Saved record | Available actions, Connected hospital history, Preserved versions.
   - Patient-reported allergies move to the patient page's Saved record as "Allergies", value + " (patient-reported)".
   - The diagnosis fields from New consultation go into the "Edit unsigned draft" and "Amend signed note" forms.
   - The "Documents · <file>" history row becomes the link that opens the file.

10. [major] Encounter Saved record rows and meta line (this merges one major and one minor)
   Screens: workspaces/consult-3-detail1.png, consult-3-detail2.png. Live: /provider/clinical/<encounterId>.
   Differs: live rows are Encounter type, Complaint, Started, Diagnosis, Note status, Note; the design has Visit, Complaint, History, Examination, Diagnosis, Note. The live meta line ends "Started {time}"; the design ends "Saved {time}".
   Where: ehr-blue/clinical/consult/EncounterPage.tsx:291-299, :308-310
   Fix:
   - Rows: Visit = shortId(encounter.id); Complaint; History and Examination split from latest.content by the "History:", "Examination:", "Clinical note:" and "Follow-up:" sections that NewConsultation.tsx:172-178 composes; Diagnosis; Note = the "Clinical note" section (the whole content when it is not sectioned).
   - Drop Encounter type, Started and Note status.
   - Meta: `<DetailMeta status={encounter.status} patient={patientLine(chart.facts)} saved={field(encounter, 'updatedAt') || encounter.startedAt} />` and delete the Started span.

11. [major, OWNER DECIDED: move them to a menu] Available actions list more actions than the design
   Screens: workspaces/consult-3-detail1.png, consult-3-detail2.png, nursing-3-detail.png. Live: /provider/clinical/<id>, /provider/nursing/<enc>~<note>.
   Differs: the consultation draft adds "Mark note entered in error", "Put encounter on hold", "Complete encounter", "Cancel encounter" and "Mark encounter entered in error". The signed note adds "Mark note entered in error". Nursing adds "Mark entered in error".
   Where: ehr-blue/clinical/consult/EncounterPage.tsx:263-265, :270-277; clinical/nursing/ObservationRecord.tsx:203-205
   Fix (owner's decision):
   - The Available actions card shows only the design's actions: "Sign encounter", "Amend signed note" and write-note (encounter); "Amend observation" and, for a draft, "Sign note" (nursing).
   - Every other live action stays, with its reason field, today's API call and audit, behind one "More actions" menu button at the end of that card: Put encounter on hold, Complete encounter, Cancel encounter, Mark encounter entered in error, Mark note entered in error (encounter); Mark entered in error (nursing).
   - The menu is a real button with aria-haspopup and keyboard support; each item opens the same confirmation form as today.

12. [major] The Available actions card repeats the encounter's orders as rows
   Screens: workspaces/consult-3-detail1.png, consult-3-detail2.png. Live: /provider/clinical/<encounterId>.
   Where: ehr-blue/clinical/consult/orders/index.tsx:125 (`<ul aria-label="Orders from this encounter">`, rendered from EncounterPage.tsx:356)
   Fix: delete that list and the empty-state lines above it. The card ends with the four Create … record buttons and the "Patient and encounter carry into each order…" note. The orders stay in Connected hospital history.

13. [major] The encounter's Connected hospital history has extra rows and the wrong order
   Screens: workspaces/consult-3-detail1.png, consult-3-detail2.png. Live: /provider/clinical/<encounterId>.
   Where: ehr-blue/clinical/consult/EncounterPage.tsx:405-416. Design rule (src/workflows.tsx:604-628): only records from other workspaces, every row a link, in sidebar order.
   Fix:
   - Drop :408 (same-workspace encounters), :409 (this encounter's own note) and :411 (its diagnoses).
   - Order the rest Triage & Vitals → Laboratory → Pharmacy → Nursing observations → Documents.
   - Give the Documents row an href that opens the file, or drop the row.

14. [major] A signed consultation has no "Preserved versions & amendments" card
   Screen: workspaces/consult-3-detail1.png. Live: /provider/clinical/8b2d4e66-2222-4e3b-9f00-00000000e002.
   Where: ehr-blue/clinical/consult/EncounterPage.tsx:420-427
   Fix:
   - When `field(note, 'signedAt')` is set, add `{ key: 'signed', summary: `${signedAt} · draft · Sign encounter`, items: [{ label: 'Content', value: <content before signing> }] }`.
   - Revision summaries: `${revision.createdAt} · ${statusLabel(recordStatus(note,'unknown'))} · ${revision.changeReason}`, as ObservationRecord.tsx:274 does, in place of "· Revision n ·".

15. [major] Triage and nursing history list their own workspace's siblings and miss the other workspace's records
   Screens: workspaces/triage-3-detail.png, nursing-3-detail.png. Live: /provider/triage/<enc>~<vital>, /provider/nursing/<enc>~<note>.
   Where: ehr-blue/clinical/triage/TriageRecord.tsx:217-232; clinical/nursing/ObservationRecord.tsx:247-262
   Fix: replace the `siblings` rows.
   - Triage: when chart.can('ehr.note.read'), add `Nursing observations · ${shortId(id)}` rows for the encounter's notes where isObservation(note) → href.to('nursing', recordKey(encounter.id, id)).
   - Nursing: when chart.can('ehr.vital.read'), add `Triage & Vitals · ${shortId(id)}` rows for the encounter's vitals → href.to('triage', recordKey(encounter.id, id)).
   - Add the encounter's Laboratory and Pharmacy rows as EncounterPage does. Keep Consultation first.

16. [major] Sample record pages ignore the viewer's role (2 groups)
   Screens: workspaces/appointments-3-detail.png, journey-3-detail.png, referrals-3-detail.png, nursing-tasks-3-detail.png, radiology-1-list.png, radiology-3-detail1.png, radiology-3-detail2.png. Live: for example /provider/referrals/f30d1e68-5e1d-4c2a-8b3f-000000000065 with roles [doctor].
   Differs:
   - A Doctor sees "Simulate recipient acceptance"; the design says "No further actions for your permission and this record state."
   - A Receptionist sees "Create triage & vitals" and "Create consultation" under Continue care, and history rows for Radiology, Inpatient, Dental and Nursing tasks.
   - A Radiology Reporter sees Create record.
   Where: ehr-blue/clinical/sample/definitions.ts:62 (action() has no permission), SampleDetail.tsx:61 (`available` filters by status only), :99-118 (Continue care), :63 plus store.ts:198-211 (historyFor), SampleWorkspace.tsx:45 (createHref always passed)
   Fix: use Rahman's useSampleCan() (Rahman item 2).
   - Add a 6th `permission` argument to action() and copy each verb from design catalog.ts. Examples: referrals send 'create', accept 'approve', complete 'edit'; telemedicine wait/start 'edit', end 'sign'; bloodbank screen 'approve', reserve 'assign', issue 'publish', dispose 'edit'; radiology correct 'approve'.
   - `available` also requires `!a.permission || sampleCan(id, a.permission)`. NoActions shows when nothing is left.
   - Continue care: show a target only if `sampleDefinition(w) ? sampleCan(w, 'create') : can({triage:'ehr.vital.write', consult:'ehr.encounter.write', nursing:'ehr.note.write'}[w])`. Keep the "Continue care" sub-heading even when the list is empty.
   - historyFor gets a `canOpen(workspaceId)` parameter and skips workspaces the viewer cannot view.
   - Pass createHref only when sampleCan(id, 'create').

17. [major, OWNER CONFIRMED: show them, on sample pages only] Sample record history leaves out rows from the live modules
   Screens: workspaces/dental-3-detail.png, nursing-tasks-3-detail.png, referrals-3-detail.png, telemedicine-3-detail.png. Live: for example /provider/dental/503fafd8-5e1d-4c2a-8b3f-000000000054.
   Differs:
   - Taylor's dental record is missing Triage & Vitals · 329417b6, Consultation · fd276688, Laboratory · Malaria parasite test and · Blood culture, Pharmacy · fe7be2ce, and Nursing observations · 637d9f70 and · 76354f18.
   - Jordan's records are missing Triage & Vitals · cbcf4b88, Consultation · 5f459730, Laboratory · Full blood count and Pharmacy · 71785d4b.
   Where: ehr-blue/clinical/sample/seed.ts (~:211), definitions.ts:273-275 (HISTORY_ORDER), store.ts:198-211, SampleDetail.tsx:123-130
   Fix:
   - Add `SEED_CONNECTED` fictional, history-only rows (workspace, title, name, status, patientId) for the rows listed above.
   - HISTORY_ORDER = ['appointments','journey','triage','clinical','laboratory','radiology','pharmacy','inpatient','wards','nursing','emergency','maternity','surgery','icu','dental','referrals','bloodbank','telemedicine','ward-config','nursing-tasks'].
   - historyFor pushes the SEED_CONNECTED rows for ids that have no sample definition.
   - Label each `${title} · ${name}` with its status badge; href = href.to(workspace) (the list, since these ids do not exist live).
   - These rows are fictional data on a sample page. The owner should confirm they are wanted.

18. [minor] The new external record access card opens with an extra sentence
   Screen: workspaces/consent-2-new.png. Live: /provider/requests/new.
   Differs: "Ask the patient to approve access. A pending request does not expose their record."
   Where: ehr-blue/clinical/consent/RequestAccess.tsx:76
   Fix: delete that `<p>`.

19. [minor] Request Saved record labels
   Screen: workspaces/consent-3-detail.png. Live: /provider/requests/ar-0001.
   Differs: "Purpose of access" and "Duration (minutes)"; the design has "Reason" and "Duration".
   Where: ehr-blue/clinical/consent/requests.ts:56, :58
   Fix: `{ label: 'Reason', value: request.reason }` and `{ label: 'Duration', value: String(request.requestedDurationMinutes) }`.

Left out: 0 minors. The encounter "Started" vs "Saved" minor is merged into item 10.

---

