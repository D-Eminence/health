# Audit action labels: the tables of docs/AUDIT_ACTION_LABELS.md

The first two columns of the spec's two tables (D-Eminence/health#75), copied as written. actionLabels.test.ts
checks that actionLabels.ts holds exactly these labels. Change both together when the spec changes.

## Labels

| Action code | Label |
|---|---|
| `<hid-1.0 legacy action>` | Activity from the previous Health ID system |
| `admin.account.active` | Support re-enabled an account |
| `admin.account.disabled` | Support disabled an account |
| `admin.account.sessions-revoked` | Support signed an account out everywhere |
| `admin.audit.list` | Support viewed the platform audit log |
| `admin.emergency-contact.opt-out` | Support opted out an emergency contact |
| `admin.facility.alert-phone.change` | Support changed facility alert phone |
| `admin.facility.rejected` | Support rejected a facility |
| `admin.facility.suspended` | Support suspended a facility |
| `admin.facility.verified` | Support verified a facility |
| `admin.imported-configuration.read` | Support viewed imported settings |
| `admin.integration.configure` | Support changed integration settings |
| `admin.integration.enable` | Support turned on an integration |
| `admin.integration.fallback` | Support set a backup provider |
| `admin.integration.pause` | Support paused an integration |
| `admin.integration.select` | Support chose an integration provider |
| `admin.integration.test` | Support tested an integration |
| `admin.order-route-destination.set` | Support changed a facility's order receiving |
| `admin.order-route.close` | Support closed an order between facilities |
| `admin.platform-control.change` | Support changed a platform switch |
| `admin.platform-role.bootstrap` | First platform administrator set up |
| `admin.platform-role.grant` | Support granted a platform role |
| `admin.platform-role.legacy-restore` | Platform administrator restored |
| `admin.platform-role.revoke` | Support removed a platform role |
| `admin.pricing.price.update` | Support updated a price |
| `admin.pricing.product.update` | Support updated a product |
| `admin.principals.export` | Support exported the account list |
| `admin.self-service-application.refusal-waive` | Support lifted a sign-up block |
| `admin.self-service-application.reject` | Support rejected a facility sign-up |
| `admin.self-service-facility.administrator-role` | Support changed administrator's access |
| `admin.self-service-facility.probation-end` | Support ended a facility's trial limits |
| `admin.self-service-facility.release` | Support closed a fraudulent sign-up |
| `admin.self-service-facility.release-order-routes` | Released facility's orders closed |
| `admin.self-service-facility.review` | Support reviewed a new facility |
| `admin.wrong-patient-report.review` | Support reviewed a wrong-patient report |
| `api.<route action or method.path>` | Hidden (request log) |
| `audit.events.list` | Viewed the audit log |
| `auth.authorization.denied` | Access refused before choosing a facility |
| `auth.facility.select` | Switched to this facility |
| `auth.google.auto-link` | Google account linked by email match |
| `auth.google.auto-link.revoke` | Automatic Google link removed |
| `auth.google.link` | Patient linked a Google account |
| `auth.google.login` | Patient signed in with Google |
| `auth.google.onboarding.link` | Google account linked during sign-up |
| `auth.login` | Signed in |
| `auth.logout` | Signed out |
| `auth.otp.recovery.completed` | Account recovered with a one-time code |
| `auth.refresh` | Sign-in session renewed |
| `auth.session.read` | Signed-in session checked |
| `commercial.demo-request.status` | Support updated a demo request |
| `commercial.demo-request.submitted` | Website demo request received |
| `commercial.demo-requests.list` | Support viewed demo requests |
| `ehr.diagnosis.create` | Added a diagnosis |
| `ehr.diagnosis.list` | Viewed diagnoses for a visit |
| `ehr.diagnosis.read` | Opened a diagnosis |
| `ehr.diagnosis.update` | Updated a diagnosis |
| `ehr.document.download` | Downloaded a document |
| `ehr.document.list` | Viewed documents for a visit |
| `ehr.document.ocr-source.read` | Sent a document for text reading |
| `ehr.document.scan.clean` | Document passed the safety check |
| `ehr.document.scan.failed` | Safety check on a document could not finish |
| `ehr.document.scan.idempotent-replay` | Safety check result sent again (nothing changed) |
| `ehr.document.scan.rejected` | Document failed the safety check and was blocked |
| `ehr.document.scan.scan_started` | Safety check started on an uploaded document |
| `ehr.document.upload-intent.create` | Started uploading a document |
| `ehr.document.upload.complete` | Uploaded a document |
| `ehr.emergency.records.read` | Viewed a patient's record summary using emergency access |
| `ehr.encounter.create` | Started a new visit |
| `ehr.encounter.list` | Viewed a patient's visits |
| `ehr.encounter.read` | Opened a patient's visit |
| `ehr.encounter.update` | Updated a visit |
| `ehr.imported.attachment.download` | Downloaded a file from a patient's previous Health ID records |
| `ehr.imported.records.read` | Viewed a patient's records from the previous Health ID system |
| `ehr.lab-request.create` | Requested a lab test |
| `ehr.lab-request.lab-handoff.eligibility-checked` | Checked a lab request could go to this facility's lab |
| `ehr.lab-request.list` | Viewed lab requests for a visit |
| `ehr.lab-request.read` | Opened a lab request |
| `ehr.lab-request.update` | Updated a lab request |
| `ehr.note-revision.create` | Changed the text of a clinical note (an amendment if it was already signed) |
| `ehr.note-revision.list` | Viewed a clinical note's history |
| `ehr.note.create` | Wrote a clinical note |
| `ehr.note.import-ocr` | Added a draft clinical note from a reviewed scanned document |
| `ehr.note.list` | Viewed clinical notes for a visit |
| `ehr.note.read` | Opened a clinical note |
| `ehr.note.update` | Signed or updated a clinical note |
| `ehr.offline.command.discarded` | Offline change was discarded |
| `ehr.offline.escrow-key.issue` | Offline recovery key issued |
| `ehr.offline.receipts.lookup` | Checked offline changes were saved |
| `ehr.offline.unlock` | Unlocked offline records on a device |
| `ehr.offline.wipe` | Offline records erased from a device |
| `ehr.order-route.accept-locked` | Order this facility sent was locked: the receiver's patient details did not match too many times |
| `ehr.order-route.accepted` | An order this facility sent was accepted |
| `ehr.order-route.attestation-text.read` | Viewed the patient-agreement wording before sending an order |
| `ehr.order-route.cancelled` | An order this facility accepted was closed because the sender changed or cancelled it |
| `ehr.order-route.closed` | Order closed by Health ID support |
| `ehr.order-route.declined` | An order this facility sent was declined |
| `ehr.order-route.dispensing-returned` | Pharmacy recorded a dispensing for a prescription this facility sent |
| `ehr.order-route.dispensing-reversed` | Pharmacy reversed a dispensing |
| `ehr.order-route.list` | Viewed where an order was sent |
| `ehr.order-route.not-completed` | Order could not be completed |
| `ehr.order-route.order-changed` | Sender changed an order this facility accepted or completed |
| `ehr.order-route.patient-list` | Patient viewed orders sent elsewhere |
| `ehr.order-route.patient-withdraw` | Patient stopped an order sent elsewhere |
| `ehr.order-route.patient-withdrawn` | Patient stopped an order this facility sent |
| `ehr.order-route.received` | Order received from another facility |
| `ehr.order-route.result-marked-in-error` | Returned lab result marked as error |
| `ehr.order-route.result-returned` | Lab result returned for an order this facility sent |
| `ehr.order-route.send` | Sent an order to another facility |
| `ehr.order-route.withdraw` | Withdrew an order from another facility |
| `ehr.order-route.withdrawn` | Order between facilities was withdrawn |
| `ehr.order-route.wrong-patient` | Order reported as the wrong patient |
| `ehr.order-route.wrong-patient-overview` | Viewed orders reported as the wrong patient |
| `ehr.order-route.wrong-patient-overview.item` | Viewed a patient's order that was reported as the wrong patient |
| `ehr.patient.chat.answer` | Record assistant answered a question about a patient // if failed: Record assistant could not give an answer backed by the record |
| `ehr.patient.chat.context.read` | Record assistant read the patient's earlier conversation |
| `ehr.patient.chat.evidence.read` | Assistant read the patient's record for them |
| `ehr.patient.chat.history.clear` | Patient cleared their assistant chat |
| `ehr.patient.chat.history.read` | Patient viewed their assistant chat |
| `ehr.patient.chat.history.save` | Patient's assistant chat saved |
| `ehr.patient.self.health-profile.read` | Patient viewed their health information |
| `ehr.patient.self.health-profile.update` | Patient updated their health information |
| `ehr.patient.self.records.read` | Patient viewed their own record |
| `ehr.prescription.create` | Wrote a prescription |
| `ehr.prescription.list` | Viewed prescriptions for a visit |
| `ehr.prescription.pharmacy-handoff.eligibility-checked` | Checked a prescription could go to this facility's pharmacy |
| `ehr.prescription.read` | Opened a prescription |
| `ehr.prescription.update` | Updated a prescription |
| `ehr.record.read` | Viewed the health information a patient entered themself // if resource offline-chart-section: Viewed part of a patient's record on a device while offline |
| `ehr.staff.chat.context.read` | Record assistant read the earlier conversation about a patient |
| `ehr.staff.chat.evidence.read` | Record assistant read the parts of a patient's record this staff member may see |
| `ehr.staff.chat.history.bindings.read` | Record assistant rechecked its sources |
| `ehr.staff.chat.history.clear` | Cleared a record assistant chat |
| `ehr.staff.chat.history.read` | Viewed record assistant chat history |
| `ehr.staff.chat.history.save` | Record assistant conversation saved |
| `ehr.staff.chat.start` | Record assistant started on a question about a patient |
| `ehr.vital-correction.create` | Corrected vital signs |
| `ehr.vital-correction.list` | Viewed corrections to vital signs |
| `ehr.vital.create` | Recorded vital signs |
| `ehr.vital.list` | Viewed vital signs for a visit |
| `ehr.vital.read` | Opened a vital signs entry |
| `identity.access-request.approve` | Patient approved an access request |
| `identity.access-request.create` | Requested access to a patient's record |
| `identity.access-request.deny` | Patient declined an access request |
| `identity.access-request.replay` | Repeated an access request |
| `identity.authorization.check` | Checked access to a patient's record |
| `identity.break-glass.activate` | Started emergency access to a patient's record |
| `identity.break-glass.replay` | Repeated an emergency access request |
| `identity.consent-grant.close` | Access to a patient's record ended |
| `identity.consent-grant.close.replay` | Repeated ending access to a record |
| `identity.consent-grant.patient-revoke` | Patient ended this facility's access to their record |
| `identity.consent-grant.patient-share` | Patient shared their record with a staff member here |
| `identity.consent.status.read` | Checked a patient's consent status |
| `identity.emergency-contact.changed` | Patient changed an emergency contact |
| `identity.emergency-contact.created` | Patient added an emergency contact |
| `identity.emergency-contact.deactivated` | Patient removed an emergency contact |
| `identity.emergency-contact.notification.delivered` | Emergency contact alert delivered |
| `identity.emergency-contact.notification.failed` | Emergency contact alert failed |
| `identity.emergency-contact.notification.intent-created` | Emergency contacts to be alerted |
| `identity.emergency-contact.notification.intent-failed` | Could not queue emergency contact alert |
| `identity.emergency-contact.notification.no-eligible-contact` | No emergency contact to alert |
| `identity.emergency-contact.notification.retry-scheduled` | Emergency contact alert will be retried |
| `identity.emergency-contact.notification.suppressed` | Emergency contact alert not sent |
| `identity.emergency-contact.verification-expired` | Emergency contact code expired |
| `identity.emergency-contact.verification-failed` | Emergency contact verification failed |
| `identity.emergency-contact.verification-requested` | Emergency contact verification requested |
| `identity.emergency-contact.verification-sent` | Emergency contact code sent |
| `identity.emergency-contact.verification-succeeded` | Emergency contact verified |
| `identity.facility-access.change` | Administrator's access changed by support |
| `identity.facility-access.unlock` | Facility administrator given full access after Health ID review |
| `identity.facility-administrator-licence.record` | Administrator recorded their licence |
| `identity.facility-staff.end` | Removed a staff member |
| `identity.facility-staff.role-change` | Changed a staff member's role |
| `identity.imported.notification.list` | Viewed earlier notifications |
| `identity.imported.notification.mark-read` | Marked an earlier notification read |
| `identity.nin.protect` | NIN check stopped by a system error |
| `identity.nin.resolve` | Verified a patient's NIN for registration |
| `identity.nin.resolve.replay` | Repeated a NIN registration request |
| `identity.nin.verify` | NIN could not be verified |
| `identity.order-destinations.search` | Searched for a facility to send to |
| `identity.order-route-destination.set` | Health ID support changed whether this facility receives orders from other facilities |
| `identity.organization.application.approve` | Facility application approved |
| `identity.organization.application.cac-verify` | Facility application CAC checked |
| `identity.organization.application.profile-complete` | Facility application details completed |
| `identity.organization.application.reject` | Facility application rejected |
| `identity.organization.application.submit` | Facility application submitted |
| `identity.organization.cac-verification` | Checked the organization's CAC registration // if refused: CAC registration not confirmed // if failed: CAC check could not be completed |
| `identity.organization.self-service.activate` | Facility account activated |
| `identity.organization.self-service.cac-quota` | Used a CAC lookup for a facility sign-up // if refused: CAC lookup limit reached |
| `identity.organization.self-service.cac-verify` | Facility sign-up CAC checked |
| `identity.organization.self-service.close` | Facility sign-up closed |
| `identity.organization.self-service.lapse` | Unfinished facility sign-up expired |
| `identity.organization.self-service.submit` | Facility sign-up started |
| `identity.organization.self-service.withdraw` | Facility sign-up withdrawn by applicant |
| `identity.patient-access-pin.authorization-denied` | PIN access blocked by patient's restriction |
| `identity.patient-access-pin.replay` | Repeated a PIN access request |
| `identity.patient-access-pin.revoke` | Patient removed their access PIN |
| `identity.patient-access-pin.set` | Patient set their access PIN |
| `identity.patient-access-pin.verify` | Got time-limited access to a patient's record with their PIN |
| `identity.patient-access-pin.verify-denied` | Patient PIN not accepted (wrong PIN, unknown patient or too many tries) |
| `identity.patient-account-deletion.access-revoked` | Deleted account's access ended |
| `identity.patient-account-deletion.blocked` | Account deletion blocked |
| `identity.patient-account-deletion.cancelled` | Patient cancelled account deletion |
| `identity.patient-account-deletion.completed` | Patient account deleted |
| `identity.patient-account-deletion.confirmation-rejected` | Account deletion confirmation refused |
| `identity.patient-account-deletion.email.delivered` | Account deletion email sent |
| `identity.patient-account-deletion.email.failed` | Account deletion email failed |
| `identity.patient-account-deletion.email.retry-scheduled` | Account deletion email will be retried |
| `identity.patient-account-deletion.email.suppressed` | Account deletion email not sent |
| `identity.patient-account-deletion.requested` | Patient asked to delete their account |
| `identity.patient-account-deletion.retention-evaluated` | Records to keep were checked |
| `identity.patient-account-deletion.scheduled` | Account deletion scheduled |
| `identity.patient-account-deletion.sessions-revoked` | Deleted account signed out everywhere |
| `identity.patient-account-deletion.verified` | Patient confirmed account deletion |
| `identity.patient.contact-change.complete` | Patient changed their email or phone |
| `identity.patient.contact-change.delivery` | Email change code could not be sent |
| `identity.patient.contact-change.start` | Patient started changing their email |
| `identity.patient.contact-change.verify` | Email change not confirmed |
| `identity.patient.enroll` | Set up a patient's portal account |
| `identity.patient.enroll.replay` | Repeated a portal account setup |
| `identity.patient.lookup` | Looked up a patient by Health ID |
| `identity.patient.nin-verification` | Patient verified their NIN |
| `identity.patient.photo.remove` | Patient removed their profile photo |
| `identity.patient.photo.set` | Patient added a profile photo |
| `identity.patient.profile-details.update` | Patient updated their profile details |
| `identity.patient.self.access-history` | Patient viewed their access history |
| `identity.patient.self.access-log` | Patient viewed who opened their record |
| `identity.patient.self.authorize` | Patient's session confirmed |
| `identity.patient.self.profile` | Patient viewed their profile |
| `identity.patient.self.profile-details` | Patient viewed their profile details |
| `identity.patient.web-push.dropped` | Device notifications stopped after failures |
| `identity.patient.web-push.removed` | Device notifications removed |
| `identity.patient.web-push.subscribed` | Patient turned on device notifications |
| `identity.patient.web-push.unsubscribed` | Patient turned off device notifications |
| `identity.public-patient-enrollment.activated` | Patient created their Health ID account |
| `identity.record-access-notice.email.delivered` | Patient emailed that record was opened |
| `identity.record-access-notice.email.failed` | Record-opened email to patient failed |
| `identity.record-access-notice.email.retry-scheduled` | Record-opened email will be retried |
| `identity.record-access-notice.email.suppressed` | Record-opened email not sent: patient has no email address |
| `identity.record-access-notice.note` | Patient notified that their record was opened here // if refused: No 'record opened' notice needed |
| `identity.registration-case.approve-new` | Registered a new patient |
| `identity.registration-case.approve-new.replay` | Repeated a new patient registration |
| `identity.registration-case.link-existing` | Matched registration to existing patient |
| `identity.registration-case.link-existing.replay` | Repeated matching to existing patient |
| `identity.registration-case.read` | Opened a patient registration |
| `identity.sealed-demo.install` | Demo facilities set up |
| `identity.sealed-demo.seed-share` | Demo record sharing set up |
| `identity.share-invitation.accept` | Accepted a patient's sharing invitation |
| `identity.share-invitation.cancel` | Patient cancelled a sharing invitation |
| `identity.share-invitation.confirm` | Patient confirmed sharing their record with a staff member here |
| `identity.share-invitation.create` | Patient invited a provider to see records |
| `identity.share-invitation.delivery` | Sharing invitation email sent |
| `identity.share-invitation.expire` | Sharing invitation expired |
| `identity.share-invitation.list-mine` | Viewed sharing invitations sent to their email |
| `identity.share-providers.search` | Patient searched for a provider |
| `identity.shared-with-me.list` | Viewed records patients have shared with them |
| `identity.staff-invitation.accept` | Staff invitation accepted |
| `identity.staff-invitation.create` | Invited a staff member |
| `identity.staff-invitation.delivery` | Recorded whether a staff invitation email was sent |
| `identity.staff-invitation.open` | Staff invitation opened |
| `identity.staff-invitation.resend` | Resent a staff invitation |
| `identity.staff-invitation.revoke` | Cancelled a staff invitation |
| `identity.staff.chat.profile.read` | Record assistant read patient's details |
| `lab.accession.create` | Registered a lab sample |
| `lab.accession.read` | Opened a lab sample record |
| `lab.execution.complete` | Completed a lab test |
| `lab.execution.start` | Started a lab test |
| `lab.import.create` | Added outside lab results |
| `lab.import.read` | Opened outside lab results |
| `lab.order-route.accept` | Accepted a lab order from another facility |
| `lab.order-route.cannot-complete` | Marked a lab order as cannot complete |
| `lab.order-route.correctable` | Searched for a lab order to correct |
| `lab.order-route.decline` | Declined a lab order from another facility |
| `lab.order-route.list` | Viewed lab orders from other facilities |
| `lab.order-route.read` | Opened a lab order from another facility |
| `lab.order-route.wrong-patient` | Reported a lab order as wrong patient |
| `lab.order-route.wrong-patient-correction` | Withdrew lab results for wrong patient |
| `lab.patient.released-results.read` | Patient viewed their lab results |
| `lab.result.correct` | Corrected a lab result |
| `lab.result.enter` | Entered a lab result |
| `lab.result.history.read` | Viewed a lab result's full history |
| `lab.result.release` | Released a lab result |
| `lab.result.released.read` | Viewed released lab results |
| `lab.result.verify` | Verified a lab result |
| `lab.specimen.collect` | Recorded a specimen collected |
| `lab.specimen.receive` | Recorded a specimen received |
| `lab.specimen.reject` | Rejected a specimen |
| `lab.staff.chat.released-results.read` | Record assistant read lab results |
| `lab.work-item.accept` | Accepted a lab request into the lab |
| `lab.work-item.list` | Lab worklist showed a patient from another facility's order |
| `lab.work-item.read` | Opened a lab work item |
| `ocr.extraction.list` | Viewed text read from a document |
| `ocr.job.create` | Started reading a scanned document |
| `ocr.job.find` | Looked up a document's reading |
| `ocr.job.read` | Opened a document reading |
| `ocr.job.retry` | Retried reading a document |
| `ocr.job.reuse` | Reused an earlier document reading |
| `ocr.patient.confirm` | Confirmed which patient a document is for |
| `ocr.publication.fail` | Scanned document could not be added |
| `ocr.publication.list` | Viewed what a document added |
| `ocr.publication.request` | Asked to add a scanned document |
| `ocr.publication.succeed` | Scanned document added to the record |
| `ocr.validation.accept` | Approved text read from a document |
| `ocr.validation.list` | Viewed reviews of a document reading |
| `ocr.validation.reject` | Rejected text read from a document |
| `ocr.worker.claim` | Document reading started |
| `ocr.worker.complete` | Document reading finished |
| `ocr.worker.fail` | A document reading attempt failed (tried again if attempts remain) |
| `ocr.worker.lease_recovered` | Document reading stopped responding (tried again if attempts remain) |
| `outreach.campaign.created` | Created an outreach campaign |
| `outreach.campaign.member-added` | Added a staff member to a campaign |
| `outreach.campaign.status-changed` | Changed an outreach campaign's status |
| `outreach.patient.linked-existing` | Linked registration to existing patient |
| `outreach.registration-case.list` | Viewed outreach registrations |
| `outreach.registration-case.read` | Opened an outreach registration |
| `outreach.registration-case.received` | Recorded an outreach registration |
| `pharmacy.dispensing.create` | Dispensed medication |
| `pharmacy.dispensing.read` | Opened a dispensing record |
| `pharmacy.dispensing.reverse` | Reversed a dispensing |
| `pharmacy.import.create` | Added medicines from a scanned document |
| `pharmacy.import.read` | Opened medicines from a scanned document |
| `pharmacy.order-route.accept` | Accepted a prescription from another facility |
| `pharmacy.order-route.cannot-complete` | Marked a prescription as cannot complete |
| `pharmacy.order-route.correctable` | Searched for a prescription to correct |
| `pharmacy.order-route.decline` | Declined a prescription from another facility |
| `pharmacy.order-route.list` | Viewed prescriptions from other facilities |
| `pharmacy.order-route.read` | Opened a prescription from another facility |
| `pharmacy.order-route.wrong-patient` | Reported a prescription as wrong patient |
| `pharmacy.order-route.wrong-patient-correction` | Withdrew dispensing for wrong patient |
| `pharmacy.work-item.accept` | Accepted a prescription into the pharmacy |
| `pharmacy.work-item.list` | Viewed the pharmacy worklist // if resource pharmacy-work-item: Pharmacy worklist showed a patient from another facility's order |
| `pharmacy.work-item.read` | Opened a pharmacy work item |
| `security.authorization` | Refused: their role here does not allow this action |
| `security.authorization.denied` | Refused: their role here does not allow this action |

## Legacy (hid-1.0) actions

| Action code | Label |
|---|---|
| `organization_registered` | Facility registered on the previous Health ID system |
| `hospital_signup_completed` | Facility administrator signed up on the previous Health ID system |
| `staff_onboarding_completed` | Staff member joined from an invitation on the previous Health ID system |
