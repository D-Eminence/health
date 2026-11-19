# Audit & Compliance: plain-English labels for every audit action

Owner rule (1 Nov 2026): facility and patient screens never show internal codes, routes or IDs. Each audit row reads as a plain sentence: what was done, by whom, when, and Allowed / Refused / Failed. The action code itself is never printed; it stays searchable but off the main line.

Source: every action the production backend writes to audit.events (hid-system staging-novu-ci-20261005 at 82f52b9), catalogued and then checked label by label against the code that writes it. 333 actions below, 3 legacy (hid-1.0) actions, and the fallback rule for codes not in the list.

## How to show a row

- Label from the table below, by action code. Strip a trailing `.replay` first and add "(repeated)".
- Outcome: `success` -> no prefix; `denied` -> "Refused: "; `failure` -> "Failed: ".
- Request-log rows (`api.*` or resource `http-request`) stay hidden (health#70).
- Never print the code. Unknown code -> the fallback rule at the end.

## Labels

| Action code | Label | Basis in the code |
|---|---|---|
| `<hid-1.0 legacy action>` | Activity from the previous Health ID system | promote-legacy-identity.mjs:1176-1216 copies the action as written, with facility_id taken from metadata.facility_id. The vocabulary does exist, in /home/user/hid-1.0 (public.hid_log_audit_event and the edge functions), and only three of its codes carry metadata.facility_id; they are added under missing. Every other hid-1.0 code has no facility and cannot show at a facility. Keep this generic text for any unmapped legacy code. |
| `admin.account.active` | Support re-enabled an account | Matches admin.service.ts:338. |
| `admin.account.disabled` | Support disabled an account | Matches admin.service.ts:338. |
| `admin.account.sessions-revoked` | Support signed an account out everywhere | Matches admin.service.ts:367. |
| `admin.audit.list` | Support viewed the platform audit log | Matches admin.service.ts:416. |
| `admin.emergency-contact.opt-out` | Support opted out an emergency contact | Matches admin.service.ts:244. |
| `admin.facility.alert-phone.change` | Support changed facility alert phone | Matches admin.service.ts:214. |
| `admin.facility.rejected` | Support rejected a facility | Matches admin.service.ts:188. |
| `admin.facility.suspended` | Support suspended a facility | Matches admin.service.ts:188. |
| `admin.facility.verified` | Support verified a facility | Matches admin.service.ts:188. Shows at the support person's facility, not the verified one. |
| `admin.imported-configuration.read` | Support viewed imported settings | Matches admin.service.ts:85, 440-446. When the support person sends a facility, the row is a staff row at their own facility (not the facility acted on); otherwise a platform row that never shows. The same applies to every admin.* row written from TypeScript. |
| `admin.integration.configure` | Support changed integration settings | Matches integration-admin.service.ts:161. |
| `admin.integration.enable` | Support turned on an integration | Matches integration-admin.service.ts:161. |
| `admin.integration.fallback` | Support set a backup provider | Matches integration-admin.service.ts:170-190. |
| `admin.integration.pause` | Support paused an integration | Matches integration-admin.service.ts:161. |
| `admin.integration.select` | Support chose an integration provider | Matches integration-admin.service.ts:170-190. |
| `admin.integration.test` | Support tested an integration | Matches integration-admin.service.ts:239. |
| `admin.order-route-destination.set` | Support changed a facility's order receiving | Matches 0086:9292. |
| `admin.order-route.close` | Support closed an order between facilities | Matches 0086:9236. |
| `admin.platform-control.change` | Support changed a platform switch | Matches admin.service.ts:98. Facility rule as above. |
| `admin.platform-role.bootstrap` | First platform administrator set up | Matches bootstrap-platform-admin.mjs:98. |
| `admin.platform-role.grant` | Support granted a platform role | Matches admin.service.ts:353. |
| `admin.platform-role.legacy-restore` | Platform administrator restored | Matches restore-legacy-platform-admin.mjs:66. |
| `admin.platform-role.revoke` | Support removed a platform role | Matches admin.service.ts:353. |
| `admin.pricing.price.update` | Support updated a price | Matches pricing.service.ts:133. |
| `admin.pricing.product.update` | Support updated a product | Matches pricing.service.ts:96, 154-160. |
| `admin.principals.export` | Support exported the account list | Matches admin.service.ts:283. |
| `admin.self-service-application.refusal-waive` | Support lifted a sign-up block | Matches 0086:2977. |
| `admin.self-service-application.reject` | Support rejected a facility sign-up | Matches 0086:2898. |
| `admin.self-service-facility.administrator-role` | Support changed administrator's access | Matches 0086:5869. |
| `admin.self-service-facility.probation-end` | Support ended a facility's trial limits | Matches 0086:5942. |
| `admin.self-service-facility.release` | Support closed a fraudulent sign-up | Matches 0086:2721. |
| `admin.self-service-facility.release-order-routes` | Released facility's orders closed | Matches 0086:9807. |
| `admin.self-service-facility.review` | Support reviewed a new facility | Matches 0086:2481 (platform row, never at a facility). |
| `admin.wrong-patient-report.review` | Support reviewed a wrong-patient report | Matches 0088:1188, 0090:2254. |
| `api.<route action or method.path>` | Hidden (request log) | Every interceptor (identity, ehr, lab, ocr audit.interceptor.ts) adds the 'api.' prefix, so an @AuditAction value never appears without it (confirmed). Hide on action starting 'api.' only. Dropping the resourceType 'http-request' test lets the security.* refusals show. |
| `audit.events.list` | Viewed the audit log | Matches identity audit.service.ts:107-119. Each page read records itself. |
| `auth.authorization.denied` | Access refused before choosing a facility | Matches identity security.guard.ts:120-132 and ehr/ocr remote-security.guard.ts:96-115. Always denied, no facility, never shown at a facility. Takes no outcome prefix. |
| `auth.facility.select` | Switched to this facility | Matches auth.controller.ts:353-391. |
| `auth.google.auto-link` | Google account linked by email match | Matches 0093:554. |
| `auth.google.auto-link.revoke` | Automatic Google link removed | Matches 0094:920. |
| `auth.google.link` | Patient linked a Google account | Matches auth.controller.ts:212 and 0094:1416. |
| `auth.google.login` | Patient signed in with Google | Matches auth.controller.ts:151. |
| `auth.google.onboarding.link` | Google account linked during sign-up | Matches 0059:217. |
| `auth.login` | Signed in | Matches auth.controller.ts:229 and session-success-audit.ts:25-41. |
| `auth.logout` | Signed out | Matches auth.controller.ts:347. |
| `auth.otp.recovery.completed` | Account recovered with a one-time code | Matches 0029:85. |
| `auth.refresh` | Sign-in session renewed | Matches auth.controller.ts:276. |
| `auth.session.read` | Signed-in session checked | The owner's example is truthful, but more rows carry it than the catalogue said. Besides the app's GET auth/session, every EHR, Lab, Pharmacy and OCR request checks the sign-in through Identity's auth/service-session (packages/api-client identity.ts:117-121 calling auth.controller.ts:313-337, which runs session()). Expect many of these rows. |
| `commercial.demo-request.status` | Support updated a demo request | Matches demo-requests.service.ts:112, 123. Same facility rule as above. |
| `commercial.demo-request.submitted` | Website demo request received | Matches demo-requests.service.ts:58. |
| `commercial.demo-requests.list` | Support viewed demo requests | Matches demo-requests.service.ts:82, 123. Shows only at the support person's own facility, and only when they have one (note 8(iii) confirmed). |
| `ehr.diagnosis.create` | Added a diagnosis | Matches diagnoses.service.ts:74. |
| `ehr.diagnosis.list` | Viewed diagnoses for a visit | Matches diagnoses.service.ts:45. |
| `ehr.diagnosis.read` | Opened a diagnosis | Matches diagnoses.service.ts:64. |
| `ehr.diagnosis.update` | Updated a diagnosis | Matches diagnoses.service.ts:112. |
| `ehr.document.download` | Downloaded a document | Matches document.service.ts:238-253: download link issued for a clean, available document. |
| `ehr.document.list` | Viewed documents for a visit | Matches document.service.ts:135-158. |
| `ehr.document.ocr-source.read` | Sent a document for text reading | Matches document.service.ts:162-180: the text-reading service gets the document on the staff member's behalf after a read check. |
| `ehr.document.scan.clean` | Document passed the safety check | Same reason as scan_started. Outcome success. |
| `ehr.document.scan.failed` | Safety check on a document could not finish | 0009:207-208 records outcome failure. The label already says so: no prefix. |
| `ehr.document.scan.idempotent-replay` | Safety check result sent again (nothing changed) | 0009:142-170: the same scan result arrived again and was not re-applied. Uses the same 'safety check' wording. |
| `ehr.document.scan.rejected` | Document failed the safety check and was blocked | 0009:207-208 records outcome failure. The label already says it failed, so the page adds no outcome prefix. |
| `ehr.document.scan.scan_started` | Safety check started on an uploaded document | The scanner checks for malware and also for file content (permission text 'malware/content scan', migration 0006:38; a rejection carries a reason code). 'Virus check' understated it. Workload row at the document's facility (0009:200). |
| `ehr.document.upload-intent.create` | Started uploading a document | Matches document.service.ts:118. |
| `ehr.document.upload.complete` | Uploaded a document | Matches document.service.ts:206-226. |
| `ehr.emergency.records.read` | Viewed a patient's record summary using emergency access | patient-records.service.ts:44-48 and 59-72: reads completed visits and signed notes at this facility, plus earlier imported records. It is a summary, not the whole record. Refused unless the access is an emergency grant (breakGlassOnly). |
| `ehr.encounter.create` | Started a new visit | Matches encounters.service.ts:85-132. Inserts the visit. |
| `ehr.encounter.list` | Viewed a patient's visits | Matches encounters.service.ts:51-71: lists this facility's visits for one patient. Refused when Identity says no access. |
| `ehr.encounter.read` | Opened a patient's visit | Matches encounters.service.ts:74-83. |
| `ehr.encounter.update` | Updated a visit | Matches encounters.service.ts:134-160 (status, end time, chief complaint). |
| `ehr.imported.attachment.download` | Downloaded a file from a patient's previous Health ID records | imported-attachment.service.ts:44-49: download link for a file attached to an imported hid-1.0 record. Same wording fix as above. |
| `ehr.imported.records.read` | Viewed a patient's records from the previous Health ID system | patient-records.service.ts:50-54 reads records imported from hid-1.0. 'Earlier records' was ambiguous. |
| `ehr.lab-request.create` | Requested a lab test | Matches lab-requests.service.ts:164. |
| `ehr.lab-request.lab-handoff.eligibility-checked` | Checked a lab request could go to this facility's lab | lab-requests.service.ts:200-235: the EHR writes only this audit row, after confirming the request is active, current and not sent elsewhere. Lab is called after the commit and may refuse. Acceptance is the separate lab.work-item.accept row. 'Sent to the lab' overclaimed. |
| `ehr.lab-request.list` | Viewed lab requests for a visit | Matches lab-requests.service.ts:125. |
| `ehr.lab-request.read` | Opened a lab request | Matches lab-requests.service.ts:149. |
| `ehr.lab-request.update` | Updated a lab request | Matches lab-requests.service.ts:319. |
| `ehr.note-revision.create` | Changed the text of a clinical note (an amendment if it was already signed) | clinical-notes.service.ts:333-356 adds a new text version. Status becomes 'amended' only when the note was signed or amended; a draft stays a draft. 'Amended' overclaimed for drafts. |
| `ehr.note-revision.list` | Viewed a clinical note's history | Matches clinical-notes.service.ts:129 (lists earlier versions). |
| `ehr.note.create` | Wrote a clinical note | Matches clinical-notes.service.ts:156. |
| `ehr.note.import-ocr` | Added a draft clinical note from a reviewed scanned document | clinical-notes.service.ts:203-250 inserts the note with status 'draft' (its text came from a human-reviewed scan). The old label did not say the note is only a draft. |
| `ehr.note.list` | Viewed clinical notes for a visit | Matches clinical-notes.service.ts:92. |
| `ehr.note.read` | Opened a clinical note | Matches clinical-notes.service.ts:113. |
| `ehr.note.update` | Signed or updated a clinical note | clinical-notes.service.ts:254-300 and 422-435: changes a draft's title, signs it, or marks it entered in error. 'Updated' covers the title change and the error marking. |
| `ehr.offline.command.discarded` | Offline change was discarded | Matches audit-events.dto.ts:115-127. |
| `ehr.offline.escrow-key.issue` | Offline recovery key issued | Matches offline.service.ts:170-192. |
| `ehr.offline.receipts.lookup` | Checked offline changes were saved | Matches offline.service.ts:88-110. No patient data. |
| `ehr.offline.unlock` | Unlocked offline records on a device | Matches audit-events.dto.ts:9-11 and offline.service.ts:248-268 (resource 'offline-session'). |
| `ehr.offline.wipe` | Offline records erased from a device | Matches audit-events.dto.ts:20. The reason is in details, which the page does not keep. |
| `ehr.order-route.accept-locked` | Order this facility sent was locked: the receiver's patient details did not match too many times | 0086:8460-8468: the receiving facility used up its attempts to match the patient, so the order locked. Row at the ordering facility. The old label did not say whose details were wrong. |
| `ehr.order-route.accepted` | An order this facility sent was accepted | 0086:8562: row at the ordering facility. Replaces 'your'. |
| `ehr.order-route.attestation-text.read` | Viewed the patient-agreement wording before sending an order | order-routes.service.ts:217-243 loads the statement the clinician confirms (patient agreed) before sending. 'Consent statement for sending' was vague. |
| `ehr.order-route.cancelled` | An order this facility accepted was closed because the sender changed or cancelled it | 0086:9715-9722: for an accepted order, any change to a prescription (or a lab request no longer active or entered in error) closes it at the receiver. The sender may have changed it rather than cancelled it. |
| `ehr.order-route.closed` | Order closed by Health ID support | 0086:9244-9250 (support closed it) and 9795-9801 (support released a facility). Both are support actions. |
| `ehr.order-route.declined` | An order this facility sent was declined | 0086:8609: row at the ordering facility. Replaces 'your'. |
| `ehr.order-route.dispensing-returned` | Pharmacy recorded a dispensing for a prescription this facility sent | 0086:9950: row at the ordering facility when the receiving pharmacy records a dispensing. Replaces 'your'. |
| `ehr.order-route.dispensing-reversed` | Pharmacy reversed a dispensing | Matches 0086:9980. |
| `ehr.order-route.list` | Viewed where an order was sent | Matches order-routes.service.ts:152-166. |
| `ehr.order-route.not-completed` | Order could not be completed | Matches 0091:1148-1151. |
| `ehr.order-route.order-changed` | Sender changed an order this facility accepted or completed | 0086:9723-9738 covers accepted and completed orders, including 'entered in error' after completion. |
| `ehr.order-route.patient-list` | Patient viewed orders sent elsewhere | Matches order-routes.service.ts:298-306 (patient row, no facility). |
| `ehr.order-route.patient-withdraw` | Patient stopped an order sent elsewhere | Matches order-routes.service.ts:313-323. |
| `ehr.order-route.patient-withdrawn` | Patient stopped an order this facility sent | 0086:7964: row at the ordering facility. 'You' is ambiguous for whoever reviews the facility's audit log. |
| `ehr.order-route.received` | Order received from another facility | Matches 0086:7599 / 0098 send_order_route: system row at the receiver, no patient named. |
| `ehr.order-route.result-marked-in-error` | Returned lab result marked as error | Matches 0086:9910, 0088:890, 0090:1508. |
| `ehr.order-route.result-returned` | Lab result returned for an order this facility sent | 0090:1075: row at the ordering facility. Replaces 'your'. |
| `ehr.order-route.send` | Sent an order to another facility | Matches order-routes.service.ts:92-150: lab request or prescription, the clinician confirming the patient agreed. A replay writes the same row. |
| `ehr.order-route.withdraw` | Withdrew an order from another facility | Matches order-routes.service.ts:173-215. |
| `ehr.order-route.withdrawn` | Order between facilities was withdrawn | Matches 0086:7678, 7965, 8556, 9247, 9714, 9798 (sender, patient, support, order changed, already in work, or facility released). |
| `ehr.order-route.wrong-patient` | Order reported as the wrong patient | Matches 0088:961-964, 0090:1588-1592 (row at both facilities). |
| `ehr.order-route.wrong-patient-overview` | Viewed orders reported as the wrong patient | Matches order-routes.service.ts:262-293 (Overview card read; no patient). |
| `ehr.order-route.wrong-patient-overview.item` | Viewed a patient's order that was reported as the wrong patient | order-routes.service.ts:285-288 writes one row per order shown in full, naming its patient. 'Saw a wrong-patient order for a patient' was unclear. |
| `ehr.patient.chat.answer` | Record assistant answered a question about a patient // if failed: Record assistant could not give an answer backed by the record | patient-chat.service.ts:107-109 writes this after the answer is produced; outcome is failure when the answer had no valid citations. The patient or a staff member may have asked. 'Asked a question' described the wrong step, and 'Failed: Asked...' would read badly. |
| `ehr.patient.chat.context.read` | Record assistant read the patient's earlier conversation | Written for every question (patient-chat.service.ts:45 calls history.context each time), not only for follow-ups. |
| `ehr.patient.chat.evidence.read` | Assistant read the patient's record for them | Matches patient-evidence.service.ts:45. |
| `ehr.patient.chat.history.clear` | Patient cleared their assistant chat | Matches patient-chat-history.service.ts:152. |
| `ehr.patient.chat.history.read` | Patient viewed their assistant chat | Matches patient-chat-history.service.ts:101. |
| `ehr.patient.chat.history.save` | Patient's assistant chat saved | Matches patient-chat-history.service.ts:87. |
| `ehr.patient.self.health-profile.read` | Patient viewed their health information | Matches health-profile.service.ts:79-91. |
| `ehr.patient.self.health-profile.update` | Patient updated their health information | Matches migration 0094:1266. |
| `ehr.patient.self.records.read` | Patient viewed their own record | Matches patient-records.service.ts:29-41. Patient row, never at a facility. |
| `ehr.prescription.create` | Wrote a prescription | Matches prescriptions.service.ts:118. |
| `ehr.prescription.list` | Viewed prescriptions for a visit | Matches prescriptions.service.ts:76. |
| `ehr.prescription.pharmacy-handoff.eligibility-checked` | Checked a prescription could go to this facility's pharmacy | The route POST .../pharmacy-work-item needs pharmacy.work-item.accept, which is the pharmacist role (prescriptions.controller.ts:51-52, migration 0023:24), so the actor is usually the pharmacy, not the prescriber. The row (prescriptions.service.ts:184-231) is written once the prescription is confirmed active, current and not sent elsewhere, before pharmacy-api is called. Pharmacy-api can still refuse; its acceptance is the separate pharmacy.work-item.accept row. 'Sent to the pharmacy' overclaimed. |
| `ehr.prescription.read` | Opened a prescription | Matches prescriptions.service.ts:100. |
| `ehr.prescription.update` | Updated a prescription | Matches prescriptions.service.ts:158 (status, frequency, instructions, end date). |
| `ehr.record.read` | Viewed the health information a patient entered themself // if resource offline-chart-section: Viewed part of a patient's record on a device while offline | Online (health-profile.service.ts:124-132) this reads only the patient-reported health profile: blood group, genotype, allergies, medicines, conditions. Offline (offline.service.ts:248-268) resource_type is 'offline-chart-section'; the section sits in details, which the page does not keep. 'Opened a patient's record' (the owner's example) overclaims: in both cases only one part is read. Use resourceType to choose the text. |
| `ehr.staff.chat.context.read` | Record assistant read the earlier conversation about a patient | Runs for every question (staff-chat-history.service.ts:19-21), not only for follow-ups. |
| `ehr.staff.chat.evidence.read` | Record assistant read the parts of a patient's record this staff member may see | staff-evidence.service.ts:69-88 reads only the record kinds the staff member has permission for. 'Read the patient's record' overclaimed. |
| `ehr.staff.chat.history.bindings.read` | Record assistant rechecked its sources | Matches staff-chat-history.service.ts:77-80. |
| `ehr.staff.chat.history.clear` | Cleared a record assistant chat | Matches staff-chat-history.service.ts:70. |
| `ehr.staff.chat.history.read` | Viewed record assistant chat history | Matches staff-chat-history.service.ts:61-65. |
| `ehr.staff.chat.history.save` | Record assistant conversation saved | Saved automatically after each answer (patient-chat.service.ts:51, staff-chat-history.service.ts:30-52). The staff member did not choose to save. |
| `ehr.staff.chat.start` | Record assistant started on a question about a patient | start runs once per question (patient-chat.service.ts:44 via staff-chat-history.service.ts:18), not once per chat. |
| `ehr.vital-correction.create` | Corrected vital signs | Matches vitals.service.ts:167. |
| `ehr.vital-correction.list` | Viewed corrections to vital signs | Matches vitals.service.ts:105. |
| `ehr.vital.create` | Recorded vital signs | Matches vitals.service.ts:127. |
| `ehr.vital.list` | Viewed vital signs for a visit | Matches vitals.service.ts:77. |
| `ehr.vital.read` | Opened a vital signs entry | Matches vitals.service.ts:96. |
| `identity.access-request.approve` | Patient approved an access request | Matches 0072:101 (patient row at the requesting facility). |
| `identity.access-request.create` | Requested access to a patient's record | Matches 0098:1754. |
| `identity.access-request.deny` | Patient declined an access request | Matches 0072:186. |
| `identity.access-request.replay` | Repeated an access request | Matches 0098:1754. |
| `identity.authorization.check` | Checked access to a patient's record | Owner's example; matches identity.service.ts:93-125 (written before each clinical read or write; refused when denied). Lab reads also get a second copy from lab-api's own IdentityService. |
| `identity.break-glass.activate` | Started emergency access to a patient's record | 0098:1913 records the creation of the emergency grant. Reading the record is a separate row (ehr.emergency.records.read). 'Used emergency access to a record' implied a read. |
| `identity.break-glass.replay` | Repeated an emergency access request | Matches 0098:1913. |
| `identity.consent-grant.close` | Access to a patient's record ended | Matches 0093:1031, 0086:4732, 2676. |
| `identity.consent-grant.close.replay` | Repeated ending access to a record | Matches 0093:1031. |
| `identity.consent-grant.patient-revoke` | Patient ended this facility's access to their record | 0087:187: patient row at the facility. Replaces 'your'. |
| `identity.consent-grant.patient-share` | Patient shared their record with a staff member here | 0095:742: patient row at the staff member's facility. 'You' is ambiguous for whoever reviews the log. |
| `identity.consent.status.read` | Checked a patient's consent status | Matches identity.service.ts:127-145. |
| `identity.emergency-contact.changed` | Patient changed an emergency contact | Matches 0084:467. |
| `identity.emergency-contact.created` | Patient added an emergency contact | Matches 0084:407. |
| `identity.emergency-contact.deactivated` | Patient removed an emergency contact | Matches 0084:538. |
| `identity.emergency-contact.notification.delivered` | Emergency contact alert delivered | Matches 0084:910. |
| `identity.emergency-contact.notification.failed` | Emergency contact alert failed | Matches 0084:814-925. |
| `identity.emergency-contact.notification.intent-created` | Emergency contacts to be alerted | Matches 0084:299 (system row, no facility). |
| `identity.emergency-contact.notification.intent-failed` | Could not queue emergency contact alert | Matches 0084:277, 315. |
| `identity.emergency-contact.notification.no-eligible-contact` | No emergency contact to alert | Matches 0084:306. |
| `identity.emergency-contact.notification.retry-scheduled` | Emergency contact alert will be retried | Matches 0084:939. |
| `identity.emergency-contact.notification.suppressed` | Emergency contact alert not sent | Matches 0084:837. |
| `identity.emergency-contact.verification-expired` | Emergency contact code expired | Matches 0084:746. |
| `identity.emergency-contact.verification-failed` | Emergency contact verification failed | Matches 0084:746. |
| `identity.emergency-contact.verification-requested` | Emergency contact verification requested | Matches 0084:614. |
| `identity.emergency-contact.verification-sent` | Emergency contact code sent | Matches 0084:666. |
| `identity.emergency-contact.verification-succeeded` | Emergency contact verified | Matches 0084:746. |
| `identity.facility-access.change` | Administrator's access changed by support | Matches 0086:5882. |
| `identity.facility-access.unlock` | Facility administrator given full access after Health ID review | 0086:2496: the administrator's restricted role is replaced. The facility as a whole is not 'given' anything. |
| `identity.facility-administrator-licence.record` | Administrator recorded their licence | Matches 0086:4015. |
| `identity.facility-staff.end` | Removed a staff member | Matches 0086:4744. |
| `identity.facility-staff.role-change` | Changed a staff member's role | Matches 0086:4906. |
| `identity.imported.notification.list` | Viewed earlier notifications | Matches patient-self.service.ts:58-67 (no facility). |
| `identity.imported.notification.mark-read` | Marked an earlier notification read | Matches patient-self.service.ts:58-67. |
| `identity.nin.protect` | NIN check stopped by a system error | nin-registration.service.ts:100-106 and 150-157: an internal failure while protecting the NIN (always failure). 'Could not be secured' meant nothing to clinic staff. No prefix. |
| `identity.nin.resolve` | Verified a patient's NIN for registration | Matches nin-registration.service.ts:247-270. |
| `identity.nin.resolve.replay` | Repeated a NIN registration request | Matches nin-registration.service.ts:110, 164, 276. |
| `identity.nin.verify` | NIN could not be verified | Matches nin-registration.service.ts:94-148: written only when the NIN did not match (denied) or the check service failed (failure). The label covers both: no prefix. |
| `identity.order-destinations.search` | Searched for a facility to send to | Matches order-destinations.service.ts:99. |
| `identity.order-route-destination.set` | Health ID support changed whether this facility receives orders from other facilities | 0086:9298: system row at the facility, written alongside admin.order-route-destination.set. Replaces 'you'. |
| `identity.organization.application.approve` | Facility application approved | Matches 0048:339 (still called by organization-applications.service.ts:246). Same facility rule. |
| `identity.organization.application.cac-verify` | Facility application CAC checked | Matches 0056:370. |
| `identity.organization.application.profile-complete` | Facility application details completed | Matches 0056:726. |
| `identity.organization.application.reject` | Facility application rejected | Matches 0046:508. Staff row at the support person's own current facility, if any. |
| `identity.organization.application.submit` | Facility application submitted | Matches 0086:1841. |
| `identity.organization.cac-verification` | Checked the organization's CAC registration // if refused: CAC registration not confirmed // if failed: CAC check could not be completed | 0034:224-231: outcome is denied for not_verified/incomplete and failure for a provider failure. 'Refused: Checked...' would be wrong, so each outcome gets its own text. |
| `identity.organization.self-service.activate` | Facility account activated | Matches 0086:908 (system row at the new facility). |
| `identity.organization.self-service.cac-quota` | Used a CAC lookup for a facility sign-up // if refused: CAC lookup limit reached | 0086:2008: success means a lookup was counted; denied means the daily or per-applicant limit was hit. 'Limit checked' said neither. |
| `identity.organization.self-service.cac-verify` | Facility sign-up CAC checked | Matches 0086:698. |
| `identity.organization.self-service.close` | Facility sign-up closed | Matches 0086:1508. |
| `identity.organization.self-service.lapse` | Unfinished facility sign-up expired | Matches 0086:1008. |
| `identity.organization.self-service.submit` | Facility sign-up started | Matches 0086:1145. |
| `identity.organization.self-service.withdraw` | Facility sign-up withdrawn by applicant | Matches 0086:1670. |
| `identity.patient-access-pin.authorization-denied` | PIN access blocked by patient's restriction | Matches 0098:2180-2200. Always denied: no prefix. |
| `identity.patient-access-pin.replay` | Repeated a PIN access request | Matches 0098:2264-2276: the access already given is returned. |
| `identity.patient-access-pin.revoke` | Patient removed their access PIN | Matches 0033:233. |
| `identity.patient-access-pin.set` | Patient set their access PIN | Matches 0033:184. |
| `identity.patient-access-pin.verify` | Got time-limited access to a patient's record with their PIN | 0098:2240-2283: a correct PIN creates an approved access request and a read_records consent grant for the chosen minutes. Nothing is opened by this row, so 'Opened a patient's record' overclaimed. |
| `identity.patient-access-pin.verify-denied` | Patient PIN not accepted (wrong PIN, unknown patient or too many tries) | 0098:1992, 2027-2040, 2074, 2155-2165: also written when the staff member is locked out after too many tries (rate_limited true, no patient) or when the patient is not found. 'Wrong PIN entered' underclaimed. Always denied: no prefix. |
| `identity.patient-account-deletion.access-revoked` | Deleted account's access ended | Matches 0096:1015. |
| `identity.patient-account-deletion.blocked` | Account deletion blocked | Matches 0096:894, 1231. |
| `identity.patient-account-deletion.cancelled` | Patient cancelled account deletion | Matches 0096:1315. |
| `identity.patient-account-deletion.completed` | Patient account deleted | Matches 0096:1022. |
| `identity.patient-account-deletion.confirmation-rejected` | Account deletion confirmation refused | Matches 0096:1202. |
| `identity.patient-account-deletion.email.delivered` | Account deletion email sent | Matches 0096:1479. |
| `identity.patient-account-deletion.email.failed` | Account deletion email failed | Matches 0096:1403, 1479. |
| `identity.patient-account-deletion.email.retry-scheduled` | Account deletion email will be retried | Matches 0096:1479. |
| `identity.patient-account-deletion.email.suppressed` | Account deletion email not sent | Matches 0096:1418. |
| `identity.patient-account-deletion.requested` | Patient asked to delete their account | Matches 0096:1132. |
| `identity.patient-account-deletion.retention-evaluated` | Records to keep were checked | Matches 0096:1217. |
| `identity.patient-account-deletion.scheduled` | Account deletion scheduled | Matches 0096:1248. |
| `identity.patient-account-deletion.sessions-revoked` | Deleted account signed out everywhere | Matches 0096:1010. |
| `identity.patient-account-deletion.verified` | Patient confirmed account deletion | Matches 0096:1212. |
| `identity.patient.contact-change.complete` | Patient changed their email or phone | Matches 0094:936, 1036. |
| `identity.patient.contact-change.delivery` | Email change code could not be sent | Matches 0094:764. Always failure: no prefix. |
| `identity.patient.contact-change.start` | Patient started changing their email | Matches 0098:2813, 2825. |
| `identity.patient.contact-change.verify` | Email change not confirmed | Matches 0094:936. Only written as denied: no prefix. |
| `identity.patient.enroll` | Set up a patient's portal account | Matches 0032:139. |
| `identity.patient.enroll.replay` | Repeated a portal account setup | Matches 0032:84. |
| `identity.patient.lookup` | Looked up a patient by Health ID | Matches identity.service.ts:35-91. Refused when not found or no access. |
| `identity.patient.nin-verification` | Patient verified their NIN | Matches 0050:83, 0058:216. |
| `identity.patient.photo.remove` | Patient removed their profile photo | Matches 0094:1197. |
| `identity.patient.photo.set` | Patient added a profile photo | Matches 0094:1153. |
| `identity.patient.profile-details.update` | Patient updated their profile details | Matches 0094:1112. |
| `identity.patient.self.access-history` | Patient viewed their access history | Matches patient-self.service.ts:194-214. |
| `identity.patient.self.access-log` | Patient viewed who opened their record | Matches patient-self.service.ts:108. |
| `identity.patient.self.authorize` | Patient's session confirmed | Matches patient-self.service.ts:194-214. |
| `identity.patient.self.profile` | Patient viewed their profile | Matches patient-self.service.ts:194-214. |
| `identity.patient.self.profile-details` | Patient viewed their profile details | Matches patient-profile.service.ts:81. |
| `identity.patient.web-push.dropped` | Device notifications stopped after failures | Matches 0097:854, 890. |
| `identity.patient.web-push.removed` | Device notifications removed | Matches 0097:491. |
| `identity.patient.web-push.subscribed` | Patient turned on device notifications | Matches 0097:610, 639. |
| `identity.patient.web-push.unsubscribed` | Patient turned off device notifications | Matches 0097:678. |
| `identity.public-patient-enrollment.activated` | Patient created their Health ID account | Matches 0058:419, 0093:925. |
| `identity.record-access-notice.email.delivered` | Patient emailed that record was opened | Matches 0095:1530. |
| `identity.record-access-notice.email.failed` | Record-opened email to patient failed | Matches 0095:1460, 1530. Outcome failure is already in the label: no prefix. |
| `identity.record-access-notice.email.retry-scheduled` | Record-opened email will be retried | Matches 0095:1530. Outcome failure is already in the label: no prefix. |
| `identity.record-access-notice.email.suppressed` | Record-opened email not sent: patient has no email address | 0095:1466-1475 sets safe_code 'no_recipient'. Gives the reason. |
| `identity.record-access-notice.note` | Patient notified that their record was opened here // if refused: No 'record opened' notice needed | 0095:1403-1419: success puts a RECORDS_OPENED notice in the patient's inbox straight away and queues an email if they have one, so it is not just 'to be told'. Denied (0095:1384-1387) means not applicable (no ordinary active access grant, for example emergency access); nothing was refused. |
| `identity.registration-case.approve-new` | Registered a new patient | Matches nin-registration.service.ts:374. |
| `identity.registration-case.approve-new.replay` | Repeated a new patient registration | Matches nin-registration.service.ts:323. |
| `identity.registration-case.link-existing` | Matched registration to existing patient | Matches nin-registration.service.ts:473. |
| `identity.registration-case.link-existing.replay` | Repeated matching to existing patient | Matches nin-registration.service.ts:425. |
| `identity.registration-case.read` | Opened a patient registration | Matches nin-registration.service.ts:297. |
| `identity.sealed-demo.install` | Demo facilities set up | Matches 0098:1458. |
| `identity.sealed-demo.seed-share` | Demo record sharing set up | Matches 0098:1448 (demo facilities only). |
| `identity.share-invitation.accept` | Accepted a patient's sharing invitation | Matches 0095:1332. |
| `identity.share-invitation.cancel` | Patient cancelled a sharing invitation | Matches 0095:1133. |
| `identity.share-invitation.confirm` | Patient confirmed sharing their record with a staff member here | 0095:1200: patient row at the provider's facility. Replaces 'you'. |
| `identity.share-invitation.create` | Patient invited a provider to see records | Matches 0095:1054. |
| `identity.share-invitation.delivery` | Sharing invitation email sent | Matches 0095:1090-1094 (failure when sending failed; never at a facility). |
| `identity.share-invitation.expire` | Sharing invitation expired | Matches 0095:779. |
| `identity.share-invitation.list-mine` | Viewed sharing invitations sent to their email | 0095:1282: a staff member lists invitations sent to their own email. Replaces 'you'. |
| `identity.share-providers.search` | Patient searched for a provider | Matches 0095:836, 0098:2724. |
| `identity.shared-with-me.list` | Viewed records patients have shared with them | 0095:1246: a staff row. Replaces 'you'. |
| `identity.staff-invitation.accept` | Staff invitation accepted | Matches 0086:5373, 5571. |
| `identity.staff-invitation.create` | Invited a staff member | Matches 0086:4396. |
| `identity.staff-invitation.delivery` | Recorded whether a staff invitation email was sent | 0086:4440-4462: outcome is always success whether delivery succeeded or failed (deliveryOutcome sits in details, which the page does not keep). 'Email sent' overclaimed. |
| `identity.staff-invitation.open` | Staff invitation opened | Matches 0086:5154. |
| `identity.staff-invitation.resend` | Resent a staff invitation | Matches 0086:4583. |
| `identity.staff-invitation.revoke` | Cancelled a staff invitation | Matches 0086:4636. |
| `identity.staff.chat.profile.read` | Record assistant read patient's details | Matches identity.service.ts:22-33. |
| `lab.accession.create` | Registered a lab sample | Matches lab-accessions.service.ts:77. |
| `lab.accession.read` | Opened a lab sample record | Matches lab-accessions.service.ts:88. |
| `lab.execution.complete` | Completed a lab test | Matches lab-executions.service.ts:87. |
| `lab.execution.start` | Started a lab test | Matches lab-executions.service.ts:70. |
| `lab.import.create` | Added outside lab results | Matches lab-imports.service.ts:101. |
| `lab.import.read` | Opened outside lab results | Matches lab-imports.service.ts:49. |
| `lab.order-route.accept` | Accepted a lab order from another facility | Matches lab-order-routes.service.ts:165-199 (refused or failed attempts use the outcome rule). |
| `lab.order-route.cannot-complete` | Marked a lab order as cannot complete | Matches lab-order-routes.service.ts:349. |
| `lab.order-route.correctable` | Searched for a lab order to correct | Matches lab-order-routes.service.ts:273. |
| `lab.order-route.decline` | Declined a lab order from another facility | Matches lab-order-routes.service.ts:212. |
| `lab.order-route.list` | Viewed lab orders from other facilities | Matches lab-order-routes.service.ts:132. |
| `lab.order-route.read` | Opened a lab order from another facility | Matches lab-order-routes.service.ts:149. |
| `lab.order-route.wrong-patient` | Reported a lab order as wrong patient | Matches lab-order-routes.service.ts:242. |
| `lab.order-route.wrong-patient-correction` | Withdrew lab results for wrong patient | Matches lab-order-routes.service.ts:308. |
| `lab.patient.released-results.read` | Patient viewed their lab results | Matches patient-results.service.ts:75. |
| `lab.result.correct` | Corrected a lab result | Matches lab-executions.service.ts:125 (later version). |
| `lab.result.enter` | Entered a lab result | Matches lab-executions.service.ts:125 (version 1). |
| `lab.result.history.read` | Viewed a lab result's full history | Matches lab-executions.service.ts:150-152 (holders of lab.execution.read). |
| `lab.result.release` | Released a lab result | Matches lab-executions.service.ts:143. |
| `lab.result.released.read` | Viewed released lab results | Matches lab-executions.service.ts:152, 170. |
| `lab.result.verify` | Verified a lab result | Matches lab-executions.service.ts:143. |
| `lab.specimen.collect` | Recorded a specimen collected | Matches lab-accessions.service.ts:142. |
| `lab.specimen.receive` | Recorded a specimen received | Matches lab-accessions.service.ts:142. |
| `lab.specimen.reject` | Rejected a specimen | Matches lab-accessions.service.ts:142. |
| `lab.staff.chat.released-results.read` | Record assistant read lab results | Matches patient-results.service.ts:56. |
| `lab.work-item.accept` | Accepted a lab request into the lab | Matches lab-work-items.service.ts:117. |
| `lab.work-item.list` | Lab worklist showed a patient from another facility's order | lab-work-items.service.ts:178-198: lab-api writes no row for the list itself, only one per patient shown from a routed order. 'Viewed the lab worklist' would suggest one row per list view. |
| `lab.work-item.read` | Opened a lab work item | Matches lab-work-items.service.ts:132. |
| `ocr.extraction.list` | Viewed text read from a document | Matches ocr.service.ts:228. |
| `ocr.job.create` | Started reading a scanned document | Matches ocr.service.ts:188. |
| `ocr.job.find` | Looked up a document's reading | Matches ocr.service.ts:211. |
| `ocr.job.read` | Opened a document reading | Matches ocr.service.ts:197. |
| `ocr.job.retry` | Retried reading a document | Matches ocr.service.ts:250. |
| `ocr.job.reuse` | Reused an earlier document reading | Matches ocr.service.ts:164. |
| `ocr.patient.confirm` | Confirmed which patient a document is for | Matches ocr.service.ts:385. |
| `ocr.publication.fail` | Scanned document could not be added | Matches ocr.service.ts:589. Recorded with outcome success (auditEvent, ocr.service.ts:757); the label carries the failure, so no prefix. |
| `ocr.publication.list` | Viewed what a document added | Matches ocr.service.ts:465. |
| `ocr.publication.request` | Asked to add a scanned document | Matches ocr.service.ts:447. |
| `ocr.publication.succeed` | Scanned document added to the record | Matches ocr.service.ts:554. |
| `ocr.validation.accept` | Approved text read from a document | Matches ocr.service.ts:323-325. |
| `ocr.validation.list` | Viewed reviews of a document reading | Matches ocr.service.ts:340. |
| `ocr.validation.reject` | Rejected text read from a document | Matches ocr.service.ts:323-325. |
| `ocr.worker.claim` | Document reading started | Matches rds-compat 0015:91. |
| `ocr.worker.complete` | Document reading finished | Matches 0077:93. |
| `ocr.worker.fail` | A document reading attempt failed (tried again if attempts remain) | 0077:140-158: the job is queued again when will_retry, so one failed attempt is not always the end. Outcome failure is in the label: no prefix. |
| `ocr.worker.lease_recovered` | Document reading stopped responding (tried again if attempts remain) | rds-compat 0015:40-57: the job is failed and put back in the queue only while attempt_count < max_attempts. 'Restarted' overclaimed when attempts were used up. Outcome failure is already in the label: no prefix. |
| `outreach.campaign.created` | Created an outreach campaign | Matches outreach.service.ts:188. |
| `outreach.campaign.member-added` | Added a staff member to a campaign | Matches outreach.service.ts:241. |
| `outreach.campaign.status-changed` | Changed an outreach campaign's status | Matches outreach.service.ts:209. |
| `outreach.patient.linked-existing` | Linked registration to existing patient | Matches outreach.service.ts:140. |
| `outreach.registration-case.list` | Viewed outreach registrations | Matches outreach.service.ts:75. |
| `outreach.registration-case.read` | Opened an outreach registration | Matches outreach.service.ts:83. |
| `outreach.registration-case.received` | Recorded an outreach registration | Matches outreach.service.ts:58. |
| `pharmacy.dispensing.create` | Dispensed medication | Matches pharmacy.service.ts:260. |
| `pharmacy.dispensing.read` | Opened a dispensing record | Matches pharmacy.service.ts:273. |
| `pharmacy.dispensing.reverse` | Reversed a dispensing | Matches pharmacy.service.ts:312. |
| `pharmacy.import.create` | Added medicines from a scanned document | Matches pharmacy.service.ts:320-350 (input is the OCR publication). |
| `pharmacy.import.read` | Opened medicines from a scanned document | Matches pharmacy.service.ts:364. |
| `pharmacy.order-route.accept` | Accepted a prescription from another facility | Matches pharmacy-order-routes.service.ts:168, 187. |
| `pharmacy.order-route.cannot-complete` | Marked a prescription as cannot complete | Matches pharmacy-order-routes.service.ts:338. |
| `pharmacy.order-route.correctable` | Searched for a prescription to correct | Matches pharmacy-order-routes.service.ts:265. |
| `pharmacy.order-route.decline` | Declined a prescription from another facility | Matches pharmacy-order-routes.service.ts:203. |
| `pharmacy.order-route.list` | Viewed prescriptions from other facilities | Matches pharmacy-order-routes.service.ts:125. |
| `pharmacy.order-route.read` | Opened a prescription from another facility | Matches pharmacy-order-routes.service.ts:140. |
| `pharmacy.order-route.wrong-patient` | Reported a prescription as wrong patient | Matches pharmacy-order-routes.service.ts:234. |
| `pharmacy.order-route.wrong-patient-correction` | Withdrew dispensing for wrong patient | Matches pharmacy-order-routes.service.ts:299. |
| `pharmacy.work-item.accept` | Accepted a prescription into the pharmacy | Matches pharmacy.service.ts:150. |
| `pharmacy.work-item.list` | Viewed the pharmacy worklist // if resource pharmacy-work-item: Pharmacy worklist showed a patient from another facility's order | pharmacy.service.ts:175-177 writes one row per list (resource 'pharmacy-work-item-collection'); 205-210 writes one per patient shown from a routed order (resource 'pharmacy-work-item'). resourceType separates the two. |
| `pharmacy.work-item.read` | Opened a pharmacy work item | Matches pharmacy.service.ts:219. |
| `security.authorization` | Refused: their role here does not allow this action | identity security.guard.ts:97-118: by the time the facility is bound, only the permission check can still fail (runtime controls and cookie checks run earlier and write auth.authorization.denied). Same wording and filter note as security.authorization.denied. |
| `security.authorization.denied` | Refused: their role here does not allow this action | At a facility this row comes only from the EHR/OCR remote guard after the facility is bound, so the cause is a missing permission (ehr-api remote-security.guard.ts:44-51, 117-133). Identity's version (security.guard.ts:133-145) is a system row for 'not signed in' with no facility, so it never shows. The label states the outcome: no prefix. The current filter hides it (resource 'http-request'): filter on 'api.' only. |

## Legacy (hid-1.0) actions

| Action code | Label | Where it comes from |
|---|---|---|
| `organization_registered` | Facility registered on the previous Health ID system | hid-1.0 (/home/user/hid-1.0) supabase/migrations/20260413160000_infer_requested_role_for_hospital_signup_recovery.sql:232-244 (metadata.facility_id set); copied into audit.events by services/ehr-api/scripts/promote-legacy-identity.mjs:1176-1216 with actor_type 'legacy' and facility_id from metadata |
| `hospital_signup_completed` | Facility administrator signed up on the previous Health ID system | hid-1.0 supabase/migrations/20260413160000_infer_requested_role_for_hospital_signup_recovery.sql:248-258 (case expression; metadata.facility_id set); promoted as above |
| `staff_onboarding_completed` | Staff member joined from an invitation on the previous Health ID system | hid-1.0 supabase/migrations/20260413160000_infer_requested_role_for_hospital_signup_recovery.sql:248-258 (case expression; metadata.facility_id set); promoted as above |

## Fallback for codes not in the list

The page today keeps only action, outcome, actorType and resourceType (staff/api.ts facilityAuditPageFrom). The rules below therefore never use details (scope, section, wipe reason, closedBy). Never print the action code, the resourceType or a raw actorType anywhere, search included: search the label text. HOW TO READ THE LABELS: text after ' || if refused:', ' || if failed:' or ' || if resource X:' replaces the main text for that outcome or resourceType. OUTCOME (codes without their own refused/failed text): success shows the label. denied shows 'Refused: tried to ' + the base verb + the rest of the label ('Refused: tried to view a patient's visits'). failure shows "Didn't go through: tried to " + the same; for the clinical ehr.* reads and writes made through ClinicalRepository.run, failure means the record was not found, so use 'Not found: tried to ...'. Base verbs: Viewed=view, Opened=open, Added=add, Wrote=write, Started=start, Updated=update, Changed=change, Recorded=record, Corrected=correct, Sent=send, Withdrew=withdraw, Accepted=accept, Declined=decline, Downloaded=download, Uploaded=upload, Searched=search, Looked up=look up, Checked=check, Requested=request, Registered=register, Removed=remove, Invited=invite, Resent=resend, Cancelled=cancel, Released=release, Verified=verify, Entered=enter, Approved=approve, Rejected=reject, Reported=report, Marked=mark, Matched=match, Linked=link, Set up=set up, Dispensed=dispense, Reversed=reverse, Retried=retry, Reused=reuse, Confirmed=confirm, Asked=ask, Got=get, Cleared=clear, Signed=sign, Switched=switch, Repeated=repeat, Created=create, Completed=complete. If a label does not start with one of these verbs (system or passive rows), add ' (refused)' or " (didn't go through)" at the end. No prefix for labels that already state their outcome: auth.authorization.denied, security.authorization, security.authorization.denied, identity.nin.verify, identity.nin.protect, identity.patient-access-pin.verify-denied, identity.patient-access-pin.authorization-denied, identity.patient.contact-change.verify, identity.patient.contact-change.delivery, ehr.document.scan.rejected, ehr.document.scan.failed, ocr.worker.fail, ocr.worker.lease_recovered, ocr.publication.fail, and the *.email.failed / *.email.retry-scheduled / *.notification.failed codes. CODES NOT IN THE TABLE: (1) The action starts with 'api.': hide it (request log). Filter on that alone; the 'http-request' test also hides the security.* refusals. (2) actorType 'legacy', or a code with no dot (hid-1.0 snake_case such as 'access_requested'): use the hid-1.0 labels above if known, else 'Activity from the previous Health ID system'. (3) Otherwise split on '.'. A last part 'replay' or 'idempotent-replay' adds ' (repeated, nothing changed)'; a last part 'denied' or a '-denied' ending counts as refused. Drop those, then build the label from the last two parts. Verb from the last part: list=Viewed the list of; read/view=Viewed; search/find/lookup=Searched for; create/created/add/added/submit/record/received=Added; update/updated/change/changed/set/edit=Changed; delete/remove/removed/revoke/deactivate/end=Removed; accept/accepted/approve/approved=Accepted; decline/declined/reject/rejected/deny=Declined; withdraw/withdrawn=Withdrew; cancel/cancelled=Cancelled; send/sent/delivery/delivered=Sent; download=Downloaded; upload=Uploaded; complete/completed=Completed; verify/check=Checked; start=Started; close/closed=Closed; open=Opened; save=Saved; clear=Cleared; issue=Issued; import=Imported; export=Exported; fail/failed=Could not complete. Thing from the part before it, through this word map: encounter=visit, note=clinical note, vital=vital signs, lab-request=lab request, order-route=order between facilities, work-item=work item, accession=lab sample, result=lab result, registration-case=patient registration, consent-grant=access to a patient's record, access-request=access request, break-glass=emergency access, patient-access-pin=patient PIN, staff-invitation=staff invitation, facility-staff=staff member, emergency-contact=emergency contact, share-invitation=sharing invitation, campaign=outreach campaign, job/extraction/validation/publication=scanned-document reading. Any other word: hyphens become spaces. Lead-in from the first part: ehr='Patient record', lab='Lab', pharmacy='Pharmacy', ocr='Scanned documents', outreach='Outreach', identity='Patient access and registration', auth='Sign-in', security='Access check', audit='Audit log', admin='Health ID support', commercial='Health ID website'; an unknown area='Other'. Result: '<Lead-in>: <Verb> <thing>' (lab.sample-batch.create gives 'Lab: Added sample batch'). With no mapped verb: '<Lead-in> activity'. For actorType system or workload, start with 'Automatic: '; for platform, with 'Health ID support: '. Then apply the outcome rule. Never fall back to the code. ACTOR COLUMN: show actorType in words too: staff=Staff member, patient=Patient, system=Health ID (automatic), workload=Health ID background service, platform=Health ID support, legacy=Previous Health ID system.

## How the backend builds action codes (reference)

Path convention below: '<svc>/src/...' means services/<svc>/src/... ; 'migrations/...' means services/ehr-api/database/migrations/... (the one shared database every service writes to); 'rds-compat/...' means services/ehr-api/database/rds-compat/.... Read at origin/staging-novu-ci-20261005 (82f52b9).

1) One table, many writers. Every row is an INSERT into audit.events. Writers: identity-api, ehr-api, lab-api and ocr-api AuditService.record/recordWithClient (identity-api/src/audit/audit.service.ts:55-80, same shape in ehr/lab/ocr); pharmacy-api and outreach-api have their own one-line inserts (pharmacy-api/src/audit/audit.service.ts:17, outreach-api/src/audit/audit.service.ts:7, resource_type always 'outreach-registration-case' even for campaigns); ehr-api offline sync inserts device events directly (ehr-api/src/offline/offline.service.ts:248); and about 60 SECURITY DEFINER SQL functions in the migrations insert their own rows (identity.*, ehr.*, lab./pharmacy. route functions, ocr.*_worker_job). support-api, notification-api, notification-worker, event-dispatcher, workload-token-agent and the gateway write nothing to audit.events (failed sign-ins go to a different table, auth.session_events).

2) Request log (already hidden). The NestJS AuditInterceptor in identity, ehr, lab and ocr (identity-api/src/audit/audit.interceptor.ts:36-76) writes one row per HTTP call: action = 'api.' + the route's @AuditAction value (these end in '.request' or '.command', e.g. api.identity.authorization.check.request) or, with no decorator, 'api.' + method + '.' + route path; resource_type 'http-request'; outcome success or failure. pharmacy-api and outreach-api have no interceptor.

3) Semantic codes. Everything else is a dotted string '<area>.<thing>.<verb>' chosen at the call site. The first segment names the area: ehr (clinical record, documents, orders sent between facilities, offline), lab, pharmacy, ocr (reading scanned documents), outreach, identity (patients, access/consent, registration, facility staff, facility sign-up, patient self-service), auth (sign-in and session), security (guard refusals), audit (reading the audit log), admin (Health ID support console; actor_type 'platform'), commercial (website demo requests). The last segment is usually the verb: list (viewed a list), read (opened one), create, update, accept, decline, withdraw, send, search, download, clear, save. Common suffixes: '.replay' = the same request sent again with the same idempotency key, nothing new happened; '-denied' / '.denied' = refused. Most codes are literals; a few are built:
 - TS templates: ehr.staff.chat.${action} (start, context.read, history.save, history.read, history.clear, history.bindings.read) ehr-api/src/ehr/patient-records/staff-chat-history.service.ts:116; identity.patient.self.${operation} (profile, access-history, authorize) identity-api/src/auth/patient-self.service.ts:214; lab.specimen.${operation} (collect, receive, reject) lab-api/src/lab/lab-accessions.service.ts:142; lab.result.${operation} (verify, release) lab-api/src/lab/lab-executions.service.ts:143; lab.result.enter vs lab.result.correct chosen by result version (:125); admin.account.${status} (active, disabled) and admin.platform-role.${action} (grant, revoke) identity-api/src/admin/admin.service.ts:338,353; admin.facility.${status} (verified, rejected, suspended) :188; admin.integration.${action} (enable, pause, configure, select, fallback) identity-api/src/integrations/integration-admin.service.ts:161,190.
 - SQL: 'ehr.document.scan.' || event_type (scan_started, clean, rejected, failed) migrations/0009_document_scan_object_binding.sql:200; CASE expressions that pick X or X.replay, or a success/denied variant (e.g. identity.patient.contact-change.complete vs .verify); helper functions that take the action as a parameter: ehr.order_route_system_audit(route, side, action, ...) migrations/0086:7023, identity.share_audit 0095:577, identity.account_deletion_audit 0096:758, identity.web_push_audit 0097:448, identity.audit_emergency_contact_event 0084:238.
 - Shared helpers in TS that take the action: ClinicalRepository.run (ehr-api/src/ehr/shared/clinical.repository.ts:46-109) records the same code with outcome success, denied (identity refused access, details.reason 'identity_authorization') or failure (record not found); IdentityService.record (identity-api/src/identity/identity.service.ts:146); document auditEvent (ehr-api/src/documents/document.service.ts:361); lab/pharmacy/ocr auditEvent/event helpers.

4) The same code covers every outcome. outcome is a separate column (success, denied, failure). Examples: identity.authorization.check denied = access refused; ehr.encounter.list denied = no consent; lab.order-route.accept denied = patient details did not match; identity.nin.verify and identity.nin.protect are only ever written as denied/failure. Suggested page rule: label + (outcome denied -> prefix 'Refused:'; failure -> prefix 'Failed:').

5) Useful details for wording: identity.authorization.check details.scope read_records/write_records (view vs change); ehr.record.read resource_type 'patient-reported-health-profile' (online) vs 'offline-chart-section' with details.section; ehr.offline.wipe details.section = reason (sign-out, failed-unlocks, lease, membership, kill-switch, account); order-route rows details.kind lab_request/prescription and details.closedBy; actor_type tells who did it (staff, patient, system, workload = background service, platform = Health ID support, legacy).

6) Legacy rows: services/ehr-api/scripts/promote-legacy-identity.mjs:1192-1216 copied 571 hid-1.0 events (docs/STAGING_INTEGRATION.md:51) with actor_type 'legacy', provenance 'legacy_identity', source_system 'public.hid_audit_events', facility_id from the old metadata and action = whatever hid-1.0 wrote. That vocabulary is not in this repo, so these rows can show at a facility with codes nobody can list. Label them generically.

7) Fallback for unknown codes (legacy, or new codes added later): (a) actor_type 'legacy' -> 'Activity from the previous Health ID system'. (b) Strip a trailing '.replay' and add '(repeated)'. (c) Map the first segment to an area noun: ehr->'patient record', lab->'lab', pharmacy->'pharmacy', ocr->'scanned document', outreach->'outreach', identity->'patient access', auth->'sign-in', security->'access check', admin->'Health ID support', commercial->'website'. (d) Map the last segment to a past-tense verb: list->'Viewed', read->'Opened', create->'Added', update->'Updated', accept->'Accepted', decline->'Declined', withdraw->'Withdrew', send->'Sent', search->'Searched', download->'Downloaded', delete/remove/revoke->'Removed', other->'Activity'. Use the middle segment(s) with hyphens turned into spaces as the object ('Opened lab request'). (e) Apply the outcome prefix from point 4. (f) Never print the code itself.

8) Notes found while reading: (i) The current filter (resourceType 'http-request' OR action starts with 'api.', website apps/patient-web/src/staff/api.ts:273-275) also hides two real refusal codes whose resource_type is 'http-request': security.authorization (identity-api/src/auth/security.guard.ts:115) and security.authorization.denied when a person is known (ehr-api/src/auth/remote-security.guard.ts:128, ocr-api/src/auth/remote-security.guard.ts:83). Filter on action starting with 'api.' alone if those should show. (ii) lab-api has its own copy of IdentityService and writes identity.authorization.check itself (lab-api/src/identity/identity.service.ts:87,95), and identity-api writes another one for the same check, so Lab reads show two 'Checked access' rows with the same correlation_id. (iii) identity-api's assertActorFacility (audit.service.ts:150-168) refuses platform-actor rows whose action does not start with 'admin.', so commercial.demo-requests.list and commercial.demo-request.status can only be written when the support user also has a facility. As written, a support user with no facility gets a 503 there. (iv) The patient access-log classifier (migrations/0093:705-725) names lab.result.revise-released, lab.result.entered-in-error, lab.imported-evidence.create and pharmacy.imported-medication-evidence.create. No code writes these as audit actions; they are permissions or idempotency digests only. (v) The @AuditAction strings are request-log names only and never appear without the 'api.' prefix.
