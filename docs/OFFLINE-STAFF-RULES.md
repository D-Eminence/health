DRAFT for legal and DPO review. Not legal advice. Not yet approved by the owner.

# Offline copies on staff devices: notice and rules

Effective: [effective date]

**Where this applies.** Offline mode is switched on one facility at a time. At first it runs only in a sealed demo facility with fictional patients, for testing. The first real facility will be [first real pilot facility]. At a facility that is not switched on, you see nothing and nothing is stored on your device.

---

## 1. Who these rules are for

These rules are for staff who use the Health ID EHR or Health ID Migrate at a facility where offline mode is switched on. They are also for facility administrators, who have extra duties in sections 7 and 8.

They do not cover the Pharmacy and Laboratory apps, which stay online. Offline use on patients' own phones comes in a later wave and is not covered.

## 2. What offline mode is

Clinics often lose internet. Offline mode lets you keep working when the connection drops, in the EHR and in Health ID Migrate. Migrate is used to photograph or scan paper records into a patient's EHR documents.

A "device copy" belongs to one staff account, at one facility, on one site (EHR or Migrate). A browser holds at most 5 device copies per site.

### Saved charts (the "readable copy")

- The copy is filled only from normal online reads of patients you opened while you had the patient's permission. Health ID's audit log already records those reads. Nothing is downloaded in bulk automatically.
- For each patient, you can press "Keep available offline" while online. This saves the latest 3 visits with their records, the patient's health profile and the list of documents.
- The copy can hold: the list of patients on the device (name and Health ID number); consent status; visits and visit details; notes, vital signs, diagnoses, prescriptions and lab requests; note revisions and vital-sign corrections; the document list (titles and details only, never the files); the allergies and medicines the patient reported; and lab results released for an order.
- It also holds your account and membership numbers, email, display name, facility name and permissions, encrypted with the copy.
- Limits: 100 patients per staff member per facility, 2 MB per patient, 50 MB per device copy. When a limit is reached, the least recently used patient is removed first.

### Work you save offline

- New visits, notes, vital signs, diagnoses, prescriptions and lab requests.
- Revisions, corrections and status changes.
- Sending a prescription or lab request to your facility's own Pharmacy or Laboratory. It is saved and sent later.
- Closing a patient's access.
- Migrate photos and scans, encrypted until uploaded. JPEG and PNG photos are re-encoded, which removes location (GPS) and camera details (EXIF). The limits are 20 MB per file and 250 MB per device copy. Each file is deleted from the device once its upload is applied.
- An encrypted record of each chart section you open offline (see section 6).

### What is never kept on the device

- Passwords, PINs, authenticator codes, recovery codes, sign-in tokens, cookies or invitation links.
- Anything seen under emergency (break-glass) access. It stays in the screen's memory only. Emergency records are never kept on the device.
- Document files from the server, records imported from other systems, or their attachments.
- Shares, chat, staff lists, audit pages, billing, or orders to other facilities.
- Names, emails, Health ID numbers or patient IDs in readable (unencrypted) form.

## 3. The choice you are asked to make

After a normal online sign-in at a switched-on facility, on a device with no offline copy yet, the EHR asks once. The screen says:

> **Keep an offline copy on this device (personal devices only)**
>
> Health ID can keep an encrypted copy of the patients you open here, so you can keep working if the connection drops. Changes made offline are sent when Health ID can be reached. Do not choose this on a shared or public computer.
>
> Buttons: "Keep an offline copy" / "Not on this device"

If you choose "Not on this device", or the facility is not switched on, nothing is written to the device.

The owner's decision is: "Offline is opt-in at sign-in; not on shared computers."

To use offline mode you need a staff password of at least 12 characters and a recent Chrome, Edge, Firefox or Safari. The screens say:

> Change your password to 12+ characters to use offline.

> This browser cannot keep a safe offline copy. Use a recent Chrome, Edge, Firefox or Safari.

## 4. Rules for your device

**4.1 What "personal device" means.** In these rules, a personal device is a device used only by you, whether you own it or it was issued to you alone. It is never a shared ward, reception or public computer.

[owner to confirm: privately owned devices allowed?]

**4.2 Rules**

1. Choose "Keep an offline copy" only on a personal device. Never choose it on a shared or public computer.
2. Use a recent Chrome, Edge, Firefox or Safari. Keep it up to date (recommended).
3. Do not install browser extensions you do not know and trust (recommended). See section 9 for why.
4. Set the device clock to update automatically. If the clock looks set back by more than 5 minutes, offline opening is blocked until the clock is fixed and you sign in online.
5. Turn on the device's own screen lock (recommended).
6. Never share your password. Offline opening needs your password only, with no authenticator code, so the password is what protects the copy.
7. Use a password of at least 12 characters.

**4.3 Shared computers.** Automated tests check that, on a shared computer with two accounts, one account cannot open the other's copy. They also check that a wrong password, or the key of another device copy, opens nothing. The check on a real shared computer is planned but not yet done. Do not rely on it. Also note that 5 wrong passwords erase the readable copy for every account on that device.

## 5. Time limits and locks

- The copy can be opened offline for up to 8 hours after the device last reached Health ID. It can never be opened more than 24 hours after your last full online sign-in on that device.
- The workspace locks after 5 minutes without use, or after 5 minutes in the background, in every tab. Your password reopens it, and typed form text is kept. The screen says:

> For your security, the workspace locked after 5 minutes without use. Your work is kept.

- 5 wrong offline passwords in a row erase the readable copy for every account on that device. Unsent work is kept. The screens say:

> That password does not unlock this device. After 5 wrong tries the offline copy is cleared; waiting changes are kept.

> The offline copy was cleared after too many wrong passwords. Waiting changes are kept. Sign in online to send them.

- Offline opening works only after a full online sign-in on that device.

## 6. Working offline

**6.1 Patient permission stays in charge.** A saved chart can be read offline only while the patient's permission lasts. The chart is removed when that permission expires, when access is closed, when Health ID refuses access online, or when emergency access is used. If a patient withdraws permission while your device is offline, the device learns this only when it reconnects. Until then, access ends when the permission expires or the 8-hour limit passes, whichever comes first.

At offline facilities, you ask for access "for this visit": 1, 4, 8 or 12 hours, 8 by default. The screen says "The patient sees how long before approving." Access requests in general can run from 5 minutes to 24 hours. Access given by PIN lasts at most 60 minutes. Notes you save after it ends wait for the patient's permission again. If a patient's permission has ended, the screen says:

> Access to this patient ended

> The change is kept. Ask the patient for access again and it is sent with no need to enter it again.

**6.2 Send waiting work often.** The screen shows:

> [N] changes saved on this device, not sent yet

Watch this number. Connect and send when you can. Work not yet sent from a lost device is lost.

**6.3 Passwords and waiting work.** Do not change your password while work is waiting, unless escrow is on.

Escrow is a spare key that lets unsent work survive a password change. Health ID's server derives it for each device copy. It is used only for unsent work, never for saved charts. Status: [escrow live: yes/no and date].

- If escrow is off, the screen says: "Unsent work on this device is protected by your password only. If you change your password before it is sent, ask your facility administrator for help." The steps an administrator can take have not been settled yet, so do not rely on this. Send your work first.
- If escrow is on, the screen says: "If you change your password, unsent work on this device can still be sent after your next online sign-in."

**6.4 Sign out when you finish with the device** (recommended). Signing out wipes the readable copy. Unsent work stays until it is sent. A device copy with nothing waiting is deleted completely at sign-out.

**6.5 Storage.** The browser may clear the copy when the device runs low on space, and an iPhone may delete website data after 7 days unused. Send waiting changes soon. On iPhone, add Health ID to the Home Screen. The screen says:

> The browser may clear this offline copy if the device runs low on space. Pending changes are kept safe for as long as it allows.

**6.6 Emergency access.** Emergency records are never kept on the device. Anything seen under emergency (break-glass) access stays in the screen's memory only.

**6.7 Your offline views are recorded.** Each chart section you open offline is recorded on the device. The record is encrypted, numbered in order, and kept through sign-out and wipe until Health ID confirms receipt. Opening the same patient and section again within 10 minutes counts once. After you reconnect, the records go into Health ID's audit log. The patient sees them as "Viewed your record", possibly some hours later. A record Health ID rejects stays on the device for 7 days and is then dropped.

**6.8 What needs a connection.** The screens say these need a connection:

- "Asking a patient for access, PIN access and emergency access"
- "Emergency summaries, imported records and downloads"
- "Orders to another facility, Laboratory and Pharmacy work, billing and reading documents"

## 7. If a device is lost or stolen

1. Tell your facility administrator at once. Give the device, when it was last online and how many changes were waiting.
2. The administrator tells the owner: [owner escalation contact for lost devices].
3. The data protection officer ([DPO name and contact]) decides whether this is a reportable personal data breach. The Nigeria Data Protection Commission's notification is commonly cited as within 72 hours [verify]. Do not wait to be sure. Report first.

Work not yet sent from a lost device is lost.

What other steps do (recommended steps are marked):

- (recommended) Ask Health ID support (support@healthidentitydirectory.com) to sign the account out everywhere. This stops the device extending its 8-hour limit and locks the copy if it reconnects. It does not wipe the copy.
- (recommended) The administrator ends the membership or disables the account. This wipes the readable copy, but only if the device reconnects.
- A password change does not affect a lost device's copy. The old password keeps opening it offline until the 8-hour or 24-hour limit. (recommended) Change your password only once no other device has waiting work, or while escrow is on.

What limits the exposure: the encryption and password, the 8-hour and 24-hour limits, and the end of each patient's permission. Health ID cannot erase a device that stays offline.

## 8. When someone leaves the facility

**If you are leaving:** connect and send your waiting work first. If you cannot, it is kept locked on the device for 30 days and then deleted. The screens say:

> You no longer work at [facility]. These [N] changes cannot be sent.

> These changes cannot be sent. They stay locked on this device for 30 days.

**If you are an administrator:**

- Let the person's devices send waiting work before you remove them.
- Ending a membership needs a reason and your own password. It also ends that person's patient permissions at the facility.
- Once a membership has ended or the account is disabled, the readable copy is wiped the next time the device goes online.
- Neither action reaches a device that stays offline.

## 9. What this protection does not cover

The specification states the limit in these words: "this protects a locked or stolen device and other accounts on the same profile. It does not protect against malicious same-origin script while unlocked".

In plain words: if harmful script runs inside the Health ID page while your workspace is unlocked, the encryption does not protect against it. A browser security policy (CSP) is meant to deal with this. It only watches at first and is enforced after 48 hours without problems. No system is completely safe.

## 10. Acknowledgement

I have read these rules and I will follow them on any device where I keep an offline copy. Name: ____________  Signature: ____________  Date: ____________
