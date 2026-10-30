Design audit of health main a4f5704 against screens/ (2026-10-30, 21:30 UTC). Owner decisions applied: (1) encounter lifecycle actions move to a "More actions" menu; (2) sample workspaces follow the design role mapping, live pages keep their live permission; (3) fictional history rows on sample pages are wanted, on sample pages only; (4) labels are written properly ("Date of birth", "Health ID", "Blood pressure", "SpO2"), not copied raw. Accepted differences are not listed (sample notice, no sync/offline notes, no export or files, live names and statuses, today's refusal wording).

LEKAN: departments

Coordinator: design audit of main a4f5704 against design/ehr-target screens/.
Paths starting ehr-blue/ are under apps/patient-web/src/ehr-blue/.

1. [major] On Lab and Pharmacy, the Incoming orders card sits above the list and pushes it about 670px down
   Screens: workspaces/lab-1-list.png, pharmacy-1-list.png. Live: /provider/laboratory, /provider/pharmacy.
   Where: ehr-blue/departments/laboratory/Laboratory.tsx:166-191 (DeptSearch at :183); departments/pharmacy/Pharmacy.tsx:174-201 (DeptSearch at :187)
   Fix: make the DeptSearch list card the first child under the heading. Move StandaloneWorkNote, the IncomingOrders DeptEmbedded, SaidAboveTheList, CannotCompleteEndings, LateWrongPatient, RoutedWorkPaused and WorkListCap below `</DeptSearch>`.

2. [major] Extra "Refresh list" buttons
   Screens: workspaces/lab-1-list.png, pharmacy-1-list.png, pharmacy-3-detail1.png, pharmacy-3-detail2.png. Live: the Lab and Pharmacy lists, and a Pharmacy record.
   Where: departments/laboratory/Laboratory.tsx:165 (primaryAction RefreshButton); departments/pharmacy/Pharmacy.tsx:163, :168 (secondaryActions={refresh})
   Fix: drop the primaryAction in Laboratory.tsx:165. Drop `secondaryActions={refresh}` and `const refresh` in Pharmacy.tsx. Refresh stays on "Refresh incoming", on the empty state, and in the list.refresh() calls after each action.

3. [major] An accessioned lab record breaks into four or more cards with two "Available actions" cards
   Screen: workspaces/lab-3-detail1.png. Live: /provider/laboratory › Open Glucose, fasting (ACC-0002) or Malaria RDT (ACC-0001).
   Where: departments/laboratory/Laboratory.tsx:233-256; departments/laboratory/accession.tsx:548-585 (ExecutionPanel with its own DeptRecordLayout and a second LabActions), :682-706 (the "Accession" DeptSection with "Refresh accession")
   Fix:
   - Put AccessionView in the `main` column under the Saved record facts.
   - Add "Accession number" and "Samples" as DeptFacts rows. Render each specimen and its Processing facts as an `<h3>` sub-section inside Saved record.
   - Move Collect sample, Start processing, Verify result and Correct published result… into the single top LabActions card. Its "No further actions…" shows only when none exist.
   - Remove "Refresh accession" and "Refresh processing".

4. [major] Lab "Preserved versions & amendments" shows a sentence and a "View result history" button instead of the versions
   Screen: workspaces/lab-3-detail1.png. Live: the same record.
   Where: departments/laboratory/accession.tsx:322-360 (ResultHistory)
   Fix:
   - Remove the `open` state and the `if (!open) return` guard so the history loads on mount.
   - Drop the three buttons and the muted sentence.
   - Render each revision as a `details.hid-ehr-dept-history` entry with the summary `${dateText(entry.recordedAt)} · ${RELEASE_STATUS[entry.releaseStatus]} · Version ${entry.version}`.

5. [major] Lab and Pharmacy records lack the "Connected hospital history" card
   Screens: workspaces/lab-3-detail1.png, lab-3-detail2.png, pharmacy-3-detail1.png, pharmacy-3-detail2.png. Live: open any Lab or Pharmacy row.
   Where: departments/laboratory/Laboratory.tsx:233-256; departments/pharmacy/PharmacyRecord.tsx:215
   Fix: after the record layout, add `<DeptSection title="Connected hospital history"><p>Only records available to your current permissions are listed.</p>…</DeptSection>`.
   - List the other loaded items (list.items or items, passed in as a prop) with the same patientId, each as a DeptLinkButton plus its EhrBadge.
   - When there are none, show the sentence alone.

6. [major] Pharmacy records have no "Preserved versions & amendments" card
   Screens: workspaces/pharmacy-3-detail1.png, pharmacy-3-detail2.png. Live: open a Pharmacy row.
   Where: departments/pharmacy/PharmacyRecord.tsx:212-end
   Fix: after the history card, render `<DeptHistory entries={…} />`.
   - Always: `${dateText(item.acceptedAt)} · accepted · Accept prescription`.
   - When item.dispensing is set, add "· dispensed · Dispense quantity", or "· reversed · Reverse dispensing" when it has been reversed.

7. [major] HR & Credentials shows two list cards
   Screen: workspaces/hr-1-list.png. Live: /provider/hr.
   Differs: the live credentials list, then a sample banner and a second "Search sample records" table.
   Where: departments/hr/HrCredentials.tsx:105-112
   Fix:
   - Render one HrRecordList labelled "Search HR & Credentials", with rows = [...liveRows, ...sampleRows] and one search state filtering both.
   - Remove the in-list SampleBanner and the second list.
   - Mark sample rows with " · sample" on the reference. The SampleBanner stays on the sample record and the new form.

8. [major] Audit & Compliance adds a Refresh button and a Search + Outcome filter row
   Screen: admin/audit.png. Live: /provider/audit.
   Where: departments/audit/AuditCompliance.tsx:150, :153-162
   Fix:
   - Remove secondaryActions Refresh.
   - Replace DeptSearch with `<section className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-list-card">` holding the events. Drop the `search`, `outcome` and `visible` filtering and show page.items.
   - Keep the "Older events" pager.

9. [major] Facility profile has an extra "Facility details" card
   Screen: admin/facility.png. Live: /provider/facility.
   Where: departments/facility/FacilityProfile.tsx:136-152
   Fix: delete that DeptSection and the now-unused `roles`, `permissions`, ORGANIZATION_TYPES and countText. The page ends with the verification banner and "Verification history".

10. [major] Sample records show an extra "Edit record" button
   Screens: workspaces/billing-3-detail2.png, policies-3-detail.png, inventory-3-detail.png, procurement-3-detail2.png, services-3-detail.png. Live: /provider/patient-billing (DEMO-3), /provider/policies, /provider/supply, /provider/procurement, /provider/services.
   Where: departments/parts/sample/SampleDetail.tsx:60, :87-107; parts/sample/model.ts:102
   Fix: add `readonly editable?: boolean` to SampleDefinition and set `const editable = definition.editable === true && record.status === definition.initial`. Leave it unset in sample/finance.tsx, admin.ts and supply.tsx.

11. [major] Sample Available actions ignore the viewer's permission
   Screen: workspaces/billing-3-detail1.png. Live: /provider/patient-billing (DEMO-1), also while viewing as Billing Officer.
   Differs: live shows "Record simulated payment" and "Refund payment"; the design shows "No further actions for your permission and this record state."
   Where: departments/parts/sample/SampleDetail.tsx:63; parts/sample/model.ts:35-43; sample/finance.tsx:148, :150, :158, :161
   Fix: use Rahman's useSampleCan() (Rahman item 2; design module id for patient-billing is 'billing').
   - Add `readonly permission?: string` to SampleAction.
   - finance.tsx: issue and void 'approve', pay 'collect-payment', refund 'refund'. Copy every other definition's verb from design src/catalog.ts:753-786.
   - `available` also requires `!action.permission || sampleCan(designId, action.permission)`.

12. [minor] Fact values, the patient line, history summaries, staff names and audit titles are navy; the design uses #484f58 (2 groups)
   Screens: workspaces/lab-3-detail1.png, hr-3-detail.png, billing-3-detail1.png and every sample record, admin/staff.png, admin/audit.png.
   Where: departments/departments.css:216, :239-244, :315-317, :969-972, :1134-1136
   Fix: change `color: var(--ehr-ink)` to `color: var(--ehr-text)` in all five rules. Page and card titles are Rahman item 15.

13. [minor] List rows are 73px instead of 69px, and Quick view and Open are right-aligned with a gap (2 groups)
   Screens: every Lab, Pharmacy, HR and sample *-1-list.png.
   Where: departments/departments.css:96-104 (.hid-ehr-dept-reference), :119-126 (.hid-ehr-dept-link), :176-186 (.hid-ehr-dept-table-actions)
   Fix:
   - `.hid-ehr .hid-ehr-table .hid-ehr-dept-reference { margin-top: 0; font-size: 10px; }`
   - `.hid-ehr .hid-ehr-table .hid-ehr-dept-link { font-size: inherit; }`
   - Table actions: `justify-content: flex-start; gap: 0;`, and remove `margin-left: 4px` on `.hid-ehr-dept-table-actions .hid-ehr-dept-link`.

14. [minor] Create forms start 16px too high in their card (2 groups)
   Screens: workspaces/hr-2-new.png, inventory-2-new.png, procurement-2-new.png, quality-2-new.png, services-2-new.png, shifts-2-new.png, ambulance-2-new.png, vehicles-2-new.png.
   Where: departments/departments.css:269-274; HrCredentials.tsx:170-172; parts/sample/SampleCreate.tsx:25-36
   Fix: add `.hid-ehr .hid-ehr-dept-section > .hid-ehr-dept-form:first-child { margin-top: 16px; }`. Do not change `.hid-ehr-dept-form` globally: action forms, OCR and Outreach use it too.

15. [minor] The card after Saved record / Available actions sits 20px below; the design has 44px
   Screens: billing-3-detail1/2, insurance, policies, inventory, procurement-3-detail1, quality, shifts and ambulance record screens.
   Where: departments/departments.css:78-83 (.hid-ehr-dept-two-col)
   Fix: `margin: 0 0 24px;`

16. [minor] The first version entry sits 15px too close to its heading
   Screens: billing-3-detail1, insurance, inventory, procurement-3-detail1, quality, shifts and ambulance record screens.
   Where: departments/parts/DeptRecord.tsx:83-84; departments/departments.css:247
   Fix: add class `hid-ehr-dept-history-card` to the section at DeptRecord.tsx:83, and extend :247 to `.hid-ehr .hid-ehr-dept-actions-card .hid-ehr-card-title, .hid-ehr .hid-ehr-dept-history-card .hid-ehr-card-title { margin: 0 0 16px; }`.

17. [minor] The "No further actions…" line is small and muted
   Screens: billing-3-detail1.png, policies-3-detail.png, services-3-detail.png, vehicles-3-detail.png.
   Where: departments/parts/DeptRecord.tsx:63
   Fix: use `<p className="hid-ehr-dept-actions-empty">` with `.hid-ehr .hid-ehr-dept-actions-empty { margin: 8px 0 0; color: var(--ehr-text); font-size: 14px; }`.

18. [minor] The record context line lacks the reference after the patient
   Screens: workspaces/lab-3-detail1.png, lab-3-detail2.png, pharmacy-3-detail1.png, pharmacy-3-detail2.png.
   Where: departments/laboratory/Laboratory.tsx:230; departments/pharmacy/PharmacyRecord.tsx:212
   Fix:
   - Lab: `items={[`${patientLabel(item)} · ${item.accessionNumber ?? item.id.slice(0, 8)}`, `Accepted ${dateText(item.acceptedAt)}`]}`
   - Pharmacy: `items={[`${patientLabel(item)} · ${item.id.slice(0, 8)}`, `Accepted ${dateText(item.acceptedAt)}`]}`

19. [minor] Lab Saved record says "Priority: routine"; the design says "Urgency: Routine"
   Screens: workspaces/lab-3-detail1.png, lab-3-detail2.png.
   Where: departments/laboratory/Laboratory.tsx:53
   Fix: `{ label: 'Urgency', value: (w => w.charAt(0).toUpperCase() + w.slice(1))(statusWord(item.priority)) }`

20. [minor] The Pharmacy table's fourth column is headed "Accepted"; the design says "Updated"
   Screen: workspaces/pharmacy-1-list.png.
   Where: departments/pharmacy/Pharmacy.tsx:153
   Fix: `header: 'Updated'`. The cell value stays.

Left out: 7 minors.
- Facility profile copy: "bypass DND", and the history note (FacilityProfile.tsx:107, :132-133).
- Facility heading offset (departments.css:1166-1176).
- Staff eyebrow at 13px and Invite button alignment (departments.css:23-30; DeptPage.tsx:33-41).
- Staff invitation row spacing (departments.css:950-965).
- Connected history links at 15px and the missing last-row rule (departments.css:1344-1346, :349-351).
- Invoice totals margin (departments.css:1333-1335).
- Lab inline action form's context line and input width (accession.tsx:73; departments.css:264-268).

---

