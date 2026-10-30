DRAFT for legal and DPO review. Not legal advice. Not yet approved by the owner.

# Addendum under the Nigeria Data Protection Act 2023 (NDPA) [verify]: data protection impact assessment for the offline copy

## 1. Status, owner and review dates

| Item | Entry |
|---|---|
| Document | DPIA addendum for the offline copy (wave 1) |
| Entity | Health Identity Directory Technologies Ltd ("Health ID (HID)") |
| Owner | The owner of Health ID |
| Data protection officer | [DPO name and contact] |
| Status | Draft for legal and DPO review |
| Effective date | [effective date] |
| Approval needed | Owner, DPO and legal, before the first real facility is switched on (owner decision D10) |
| Review points | Before the first real facility; after the first pilot, before facilities are added 2-4 at a time; when escrow is switched on or off; before any offline use on patients' own phones (a new assessment); yearly (recommended) |

No data protection impact assessment exists yet. This is Health ID's first DPIA-type document. It answers, for wave 1, an internal decision note: "Offline patient-data-at-rest (device encryption, lost/stolen/shared-device) is OPEN - needs security + NDPA review before any T2 cached-read ships." [verify]

The NDPA's DPIA requirement [verify section] and whether this processing meets its threshold are for legal review. This document is written as a DPIA in any case.

## 2. Scope

**In scope.** Wave 1 of offline mode for staff, in the EHR and in Health ID Migrate, at switched-on facilities only. The first release switches it on only for a sealed demo facility with fictional patients. No real facility uses it until the owner names the first one ([first real pilot facility]).

**Out of scope.**

- Offline use on patients' own phones. It comes in a later wave and needs its own assessment.
- The Pharmacy and Laboratory apps, which stay online. An EHR clinician's hand-off of a prescription or lab request to the facility's own Pharmacy or Laboratory can be saved offline and is sent later.
- Facilities that are not switched on. Staff see nothing and nothing is stored.
- Health ID's online processing in general. It is not assessed here.
- Changes to the public Terms of Service and Privacy Policy, which are the owner's own words.

## 3. Description of the processing

**Nature.** A staff member signs in online at a switched-on facility. On a device with no offline copy yet, the EHR asks once whether to keep an offline copy. If the person chooses "Not on this device", nothing is written. If they choose "Keep an offline copy", Health ID keeps an encrypted device copy. A device copy belongs to one staff account at one facility on one site (EHR or Migrate). A browser holds at most 5 per site. Changes made offline are saved on the device and sent when Health ID can be reached. Health ID's servers check each change on arrival against that day's patient permission, staff role and audit rules.

**Scope.**

- Readable copy (saved charts): filled only from normal online reads of patients the staff member opened with the patient's permission. For each patient, staff can press "Keep available offline", which saves the latest 3 visits with their records, the patient's health profile and the list of documents. Nothing is downloaded in bulk.
- Limits: 100 patients per staff member per facility, 2 MB per patient, 50 MB per device copy. The least recently used patient is removed first.
- Work saved offline: new visits, notes, vital signs, diagnoses, prescriptions and lab requests; revisions and corrections; status changes; sending to the facility's own Pharmacy or Laboratory; closing a patient's access.
- Migrate photos and scans: encrypted until uploaded. JPEG and PNG photos are re-encoded, which removes GPS and EXIF details. Limits are 20 MB per file and 250 MB per device copy.
- Emergency records are never kept on the device. Emergency (break-glass) access stays in the screen's memory only.

**Context.**

- Data subjects: patients (health data) and staff (account details, audit records).
- Health ID's servers run on Amazon Web Services, region eu-west-1 (Ireland). The offline copy stays on the staff member's own device. Traffic between the device and Health ID passes through Cloudflare's network, as online use does today.
- Offline use needs a staff password of at least 12 characters and a recent Chrome, Edge, Firefox or Safari.
- At offline facilities, clinicians ask for access "for this visit": 1, 4, 8 or 12 hours, 8 by default. The patient sees the length before approving. Access requests in general can run from 5 minutes to 24 hours. Access given by PIN lasts at most 60 minutes.
- Existing public pages: the Terms of Service cite the older Nigeria Data Protection Regulation (NDPR) [verify] and "NDPC, GDPR and HIPAA-aligned best practices" [verify]. The Privacy Policy's lawful-basis section is headed "GDPR, HIPAA, NDPC Alignment" [verify]. Neither page mentions the NDPA 2023 [verify]. This is an open question (section 15).

**Purpose.** Clinics often lose internet. The purpose is to let staff keep working and to avoid losing clinical work when the connection drops.

## 4. Data inventory

| Data | Where | Encryption key | When deleted |
|---|---|---|---|
| Staff account and membership numbers, email, display name, facility name, permissions | Staff device | Readable-copy key | With the readable copy (section 9) |
| List of patients on the device (name and Health ID number) | Staff device | Readable-copy key | With the readable copy; per patient as in section 9 |
| Consent status | Staff device | Readable-copy key | With the readable copy; per patient as in section 9 |
| Visits and visit details; notes, vital signs, diagnoses, prescriptions, lab requests; note revisions and vital-sign corrections | Staff device | Readable-copy key | With the readable copy; per patient as in section 9 |
| Document list (titles and details only, never the files) | Staff device | Readable-copy key | With the readable copy; per patient as in section 9 |
| Allergies and medicines the patient reported; lab results released for an order | Staff device | Readable-copy key | With the readable copy; per patient as in section 9 |
| Unsent work (new and revised clinical entries, status changes, hand-offs to Pharmacy or Laboratory, closing access) | Staff device | Unsent-work key | When sent. Discarded changes and receipts: kept encrypted 30 days |
| Migrate photos and scans | Staff device | Unsent-work key | Each file deleted once its upload is applied |
| Offline audit records (each chart section opened offline) | Staff device | Unsent-work key | Not before Health ID confirms receipt; kept through sign-out and wipe. A record Health ID rejects stays 7 days, then is dropped |
| Removed staff member's unsent work | Staff device | Unsent-work key | Locked 30 days, then deleted |
| Random device ID, technical settings, count of failed unlocks, timestamps (such as last sign-in and last contact), counts and sizes, scrambled tags | Staff device | None. Readable, not identifying | With the device copy. The store's presence shows Health ID was used offline on that device |
| Spare key for unsent work (escrow) | Derived by Health ID's server when needed; never stored on the device or in any database | Not applicable | Not stored. When the server secret is replaced, the old one is kept 30 days |
| Record of each spare-key issue | Health ID audit log, with no patient attached | Not applicable | Retention not set out in the facts supplied for this draft; for the DPO to confirm |
| Offline app files | Staff device | None. Identical for every user, no personal data | Not applicable |

**Never kept on the device:** passwords, PINs, authenticator codes, recovery codes, sign-in tokens, cookies or invitation links. Anything seen under emergency (break-glass) access. Document files from the server, records imported from other systems, or their attachments. Shares, chat, staff lists, audit pages, billing, or orders to other facilities. Names, emails, Health ID numbers or patient IDs in readable form. Emergency records are never kept on the device.

## 5. Lawful basis and special-category (health) data [verify]

Health information is treated as special category data in the Privacy Policy (section "Special Category Data (Health Information)"). The NDPA's rules on sensitive personal data and its conditions for processing health data [verify section] are expected to apply.

No lawful basis for the offline copy has been decided here. The patient's permission (access grant) is a product control that gates what staff can read. Whether it also counts as consent or another basis under the NDPA [verify section] is for legal review.

The Privacy Policy section "Role as Data Controller & Processor" says: "HID acts as a Data Controller for user account data. HID may act as a Data Processor when handling data on behalf of healthcare providers." It does not address a copy held on a staff member's device, or a privately owned device.

**Controller and processor for the offline copy:** [controller/processor determination]. This is an open question. It affects who answers patient requests, who assesses breaches, and who must hold the records of processing [verify section].

## 6. Necessity and proportionality

- Staff only. Switched on one facility at a time. At facilities that are not switched on, nothing is stored.
- Opt-in on each device, at sign-in, for personal devices only. Nothing is written if the person declines.
- Only patients the staff member opened online while they had the patient's permission. The copy is not filled in bulk.
- A per-patient button ("Keep available offline"). The button saves only the latest 3 visits with their records, the health profile and the document list.
- Limits: 100 patients, 2 MB per patient, 50 MB per device copy. The least recently used patient is removed first.
- Document files are never kept. Names and Health ID numbers are never kept in readable form. Emergency records are never kept on the device.
- Time limits: up to 8 hours after the device last reached Health ID, and never more than 24 hours after the last full online sign-in on that device.
- A saved chart can be read only while the patient's permission lasts. It is removed when permission expires, access is closed, Health ID refuses access online, or emergency access is used.
- Alternatives (for example, no offline mode, or a shorter limit) were not assessed in the facts supplied. The reviewer should consider them.

## 7. Security measures

**Encryption.**

- Everything held in the readable copy and in unsent work is encrypted with AES-GCM-256. Each encryption uses a fresh random value, and each record is bound to its place so records cannot be swapped.
- There are two data keys. One is for the readable copy. The other is for unsent work, scans, offline audit records and receipts.
- Both are locked with a key made from the staff member's password using PBKDF2-SHA256: 600,000 rounds by default and at least 310,000 on slow devices. Once created, the keys cannot be copied out by the app's own code.
- Password minimum: 12 characters. Offline opening needs the password only, with no authenticator code, and only after a full online sign-in on that device.

**Limits and locks.**

- Open for up to 8 hours after the device last reached Health ID, never more than 24 hours after the last full online sign-in.
- The workspace locks after 5 minutes without use or in the background, in every tab.
- 5 wrong offline passwords in a row erase the readable copy for every account on that device. Unsent work is kept.
- If the device clock seems set back more than 5 minutes, offline opening is blocked until the clock is fixed and the person signs in online.
- A trusted clock judges the patient's permission.

**Server checks.** Every change saved offline is checked on arrival against that day's patient permission, staff role and audit rules. If permission has ended, the change is held on the device. It is neither added to the record nor lost.

**Shared computers.** On a shared computer with two accounts, one account cannot open the other's copy. Automated tests check that a wrong password or another device copy's key opens nothing. The check on a real shared computer is planned but not yet done.

**Spare key (escrow).** Purpose: a password change or reset must never destroy unsent clinical work. The server derives a spare key for each device copy from one server secret. The device uses it only to lock the unsent-work key, never the saved charts. The spare key is never stored on the device or in any database. It is issued only to the signed-in staff member, at most 30 times an hour per account, and each issue is recorded in Health ID's audit log with no patient attached. Status: [escrow live: yes/no and date]. The owner decided it must be on before the first real pilot. This addendum recommends that escrow being on be a precondition for the first real pilot.

**Browser policy.** A browser security policy (CSP) only watches at first. It is enforced after 48 hours without problems.

**The honest limit.** The specification states it as: "this protects a locked or stolen device and other accounts on the same profile. It does not protect against malicious same-origin script while unlocked".

**Inference, flagged for legal review.** The app enforces the 8-hour and 24-hour limits and the clock check. The encryption itself rests on the password. Someone with both the device and the password could in principle read the encrypted store outside the app. The 5-wrong-password erase is also enforced by the app. Someone who copies the encrypted store off the device can try passwords without that limit, slowed only by PBKDF2 and the 12-character minimum. A device that never opens Health ID again keeps its encrypted data until the app runs again or the browser clears it.

## 8. Transparency and patient rights

- **Notice.** `docs/OFFLINE-PATIENT-NOTICE.md` is the patient notice. It includes the anchor sentence approved by the owner: "A clinic working without internet may keep seeing records it already opened for up to 8 hours, never longer than your permission." The notice must be approved before the first real facility is switched on (D10).
- **Access length.** The patient sees the access length before approving. A patient can end access early on the Access and consent page. A device working offline learns this only when it reconnects.
- **Access log.** Online reads that fill the copy are recorded in Health ID's audit log as usual. Each chart section opened offline is recorded on the device and sent on reconnect, with both device time and server time. A time more than 26 hours old is recorded as 26 hours ago and flagged. The patient sees these as "Viewed your record" under "Who viewed or changed your record" on the Access and consent page, possibly some hours later. Changes sent from offline carry the time they were captured and a mark that they were made offline.
- **Gap in the Privacy Policy wording.** The Privacy Policy section "Health Data Access & Audit Trails" says: "All access to sensitive health data is logged and monitored. Users may request a record of access to their data where applicable." Re-opens on a device that never reconnects are never recorded centrally. The original online reads are. Legal should check whether that wording remains accurate.
- **Rights and contacts.** The facility first, then support@healthidentitydirectory.com and [DPO name and contact]. The Privacy Policy sections "User Rights" and "Data Subject Rights" apply. How patient rights apply to the device copy depends on [controller/processor determination].
- **Opt-out (open).** Whether a patient can ask that their record never be kept offline has not been decided. This addendum does not promise it.
- **DPO.** The Privacy Policy says "HID may appoint a Data Protection Officer (DPO)". No DPO has been named yet. Whether appointment is required is a legal question [verify section].

## 9. Retention

| Item | Kept for | Removed when |
|---|---|---|
| Readable copy (charts, patient list, staff details) | While the device copy is open and within limits | Sign-out; 5 wrong passwords; the 8-hour or 24-hour limit passing; membership ended or account disabled (readable copy wiped the next time the device goes online); switch-off |
| A single patient's chart | While the patient's permission lasts | Permission expires; access closed; access refused online; emergency access used; patient pushed out past 100 |
| Unsent work | Until sent. Survives all wipes above | Sent. Discarded changes and receipts then kept encrypted 30 days |
| Migrate scans and photos | Until uploaded | Deleted once the upload is applied |
| Offline audit records | Until Health ID confirms receipt. Kept through sign-out and wipe | Confirmed. Rejected records: 7 days, then dropped |
| Removed staff member's unsent work | 30 days, locked | Deleted after 30 days |
| Device copy with nothing waiting | Until sign-out | Deleted completely at sign-out |
| Old server secret for escrow | 30 days after replacement | Deleted after 30 days |
| Data cleared by the browser | Not controlled by Health ID | The browser may clear it when the device runs low on space. An iPhone may delete website data after 7 days unused |

Records sent to Health ID follow the facility's own retention terms and the Privacy Policy sections "Data Retention" and "Retention of Health Data". This addendum does not change them.

## 10. Risks and mitigations

Likelihood and severity are left for the reviewer.

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Lost or stolen device | For reviewer | For reviewer | Encryption and password; 5 wrong passwords erase the readable copy; 8-hour and 24-hour limits; copy readable only while the patient's permission lasts; report to the facility administrator, then the owner, then DPO decision on breach. Support can sign the account out everywhere (locks the copy if it reconnects, does not wipe it). Ending membership or disabling the account wipes only on reconnect. A password change does not affect the lost copy. Health ID's audit log shows which patient records reached the device through online reads. |
| Shared computer | For reviewer | For reviewer | Opt-in screen warns "Do not choose this on a shared or public computer". Staff rules forbid it. One account cannot open another's copy (tested automatically; real shared-computer check planned, not done). 5 wrong passwords erase the readable copy for every account on the device, so another user can cause that erase. Unsent work is kept. |
| BYOD (privately owned devices) | For reviewer | For reviewer | Case A, device owned by the staff member: the facility and Health ID have little control over browser updates, extensions, screen lock, other household users, or return of the device when staff leave. Case B, device issued to one person: the facility can set controls (for example screen lock and browser updates). Staff rules set minimum rules for both. [owner to confirm: privately owned devices allowed?] |
| Script running in the page while unlocked | For reviewer | For reviewer | The honest limit in section 7 applies. CSP watches first and is enforced after 48 hours without problems. Staff are told to avoid unknown extensions (recommended) and to use a recent browser. The 5-minute lock shortens the unlocked window. Not removed. |
| Limits enforced by the app, not by cryptography (including password guessing on a copied store) | For reviewer | For reviewer | See the inference in section 7. Mitigations: PBKDF2-SHA256 (600,000 rounds by default, at least 310,000 on slow devices), 12-character minimum, keys not copyable by the app's own code. These slow guessing. They do not stop it. |
| A permission withdrawn while offline | For reviewer | For reviewer | The device learns this only on reconnect. Until then, access ends when the permission expires or the 8-hour limit passes, whichever comes first. The patient sees the access length before approving. Servers check every change on arrival. |
| A device that never reconnects (lost audit records) | For reviewer | For reviewer | The original online reads are recorded. Offline re-opens on that device are never recorded centrally. A daily manual check for gaps in each device's numbering runs during the pilot. A device that never opens Health ID again keeps its encrypted data until the app runs again or the browser clears it. No remote wipe in wave 1. |
| Unsent work lost (iPhone 7-day deletion, low storage, password reset with escrow off, lost device) | For reviewer | For reviewer | The waiting count is always visible. Staff are told to send soon and, on iPhone, to add Health ID to the Home Screen. Escrow, when on, keeps unsent work sendable after a password change. Unsent work survives all wipes. Lost work can affect patient care, which the reviewer should weigh. |
| Server secret for escrow | For reviewer | For reviewer | Health ID could derive any device's spare key. That key opens unsent work only, never saved charts, and only with the device in hand. Issue is limited to the signed-in staff member, 30 times an hour per account, and recorded in the audit log with no patient attached. The old secret is kept 30 days when replaced. How the secret is stored and who can reach it is not in the facts supplied; for security review. |
| A removed staff member's device | For reviewer | For reviewer | Ending membership needs a reason and the administrator's password, and ends patient permissions. The readable copy is wiped only when the device next goes online. Unsent work stays locked 30 days, then is deleted. Facilities should let devices send before removing staff. Offline opening still stops at the 8-hour and 24-hour limits. |
| A wrong device clock | For reviewer | For reviewer | A clock set back more than 5 minutes blocks offline opening until fixed and the person signs in online. A trusted clock judges permission. Audit records carry device time and server time. A time more than 26 hours old is recorded as 26 hours ago and flagged. |
| Escrow still off when the first real pilot starts | For reviewer | For reviewer | Recommended: record escrow being on as a precondition. Status: [escrow live: yes/no and date]. |
| Patients not told | For reviewer | For reviewer | The patient notice must be approved before the first real facility (D10). |

## 11. Residual risks

- No system is completely safe.
- Encryption does not protect against malicious script in the page while unlocked.
- Someone with both the device and the password could in principle read the encrypted store outside the app.
- Someone who copies the store off the device can guess passwords without the 5-wrong erase.
- A patient's withdrawal of permission is not immediate on a device that is offline.
- Offline re-opens on a device that never reconnects are not recorded centrally.
- Work not yet sent from a lost device is lost.
- Health ID cannot wipe a device that stays offline.
- A password change does not affect a lost device's copy.
- With escrow off, a password change leaves unsent work on the person's other devices unable to be sent.
- The real shared-computer test is not yet done.

## 12. Breach handling

- A lost or stolen device is reported to the facility administrator first, then to the owner ([owner escalation contact for lost devices]).
- Whether the loss is a reportable personal data breach is for the DPO to decide ([DPO name and contact]). The NDPA's notification to the Nigeria Data Protection Commission is commonly cited as within 72 hours [verify].
- Information to gather: the device, when it was last online, how many changes were waiting, and which patient records reached the device (from Health ID's audit log of online reads).
- Whether encryption lowers the reporting risk is a legal question [verify].
- Support can sign the account out everywhere. The administrator can end the membership or disable the account. Both take full effect only if the device reconnects.

## 13. Cross-border transfer [verify]

Health ID's servers run in Amazon Web Services eu-west-1 (Ireland). Traffic between the device and Health ID passes through Cloudflare's network. The offline copy stays on the staff member's own device. Whether the NDPA's transfer rules apply to these flows, and whether the offline copy adds a new transfer, is for legal review [verify section]. The full list of processors and transfers is for the DPO to confirm [verify]. The Privacy Policy has a section titled "Cross-Border Data Transfers".

## 14. Governance

- **Switch-off.** Health ID can switch offline mode off for everyone, or for one facility, by releasing a configuration change. On each device's next online load, the app refuses offline opening, stops saving, wipes every readable copy, sends all waiting work, and then deletes the device copies. Waiting clinical work is never thrown away. Health ID can also pause Migrate uploads, or stop all staff portals, without a release.
- **No remote wipe in wave 1** for a device that stays offline.
- **Approval.** The patient notice and this addendum must be approved before the first real facility is switched on (D10).
- **Rollout.** A sealed demo facility with fictional patients first. Then the facility the owner names ([first real pilot facility]). Then facilities are added 2-4 at a time, after 3 clean pilot days.
- **Escrow.** Recommended precondition for the first real pilot: escrow on ([escrow live: yes/no and date]).
- **Pilot check.** A daily manual check for gaps in each device's numbering.

## 15. Open questions for legal and the DPO

1. Controller or processor for the offline copy: [controller/processor determination].
2. May a patient ask that their record never be kept offline? Not decided.
3. Are privately owned devices allowed? [owner to confirm: privately owned devices allowed?]
4. What can a facility administrator do when escrow is off? The staff screen says to ask the administrator, but no steps are defined.
5. The Terms of Service cite the NDPR [verify]. Neither the Terms nor the Privacy Policy cites the NDPA 2023 [verify].
6. Does the daily gap check continue after the pilot?
7. Does the 2025 General Application and Implementation Directive (GAID) apply, and what does it require for DPIAs [verify]?
8. Is a lost, encrypted device a reportable breach, and does encryption change the answer [verify]?
9. Is the Privacy Policy wording "All access to sensitive health data is logged and monitored" accurate for offline re-opens?
10. Must a DPO be appointed, and by when [verify section]?
11. Is prior consultation with the NDPC needed [verify]?
12. How does the 8-hour and 24-hour design fit "never longer than your permission" when a patient withdraws while a device is offline?
13. What happens to held changes (permission ended) when a switch-off wipes the device copy?
14. Do the facts about Migrate cover file types other than JPEG and PNG?
15. How long is the server audit log of spare-key issues kept?
16. The full list of processors and transfers [verify].

## 16. Sign-off

| Role | Name | Decision | Signature | Date |
|---|---|---|---|---|
| Owner | | | | |
| Data protection officer | | | | |
| Legal | | | | |
