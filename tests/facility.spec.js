const { test, expect } = require("@playwright/test");
const esbuild = require("esbuild");
const harness = esbuild.buildSync({
  stdin: {
    contents:
      "import * as service from './src/service';import * as storage from './src/storage';globalThis.testService=service;globalThis.testStorage=storage;",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
}).outputFiles[0].text;
async function inject(page) {
  await page.addScriptTag({ content: harness });
}
async function state(page) {
  return page.evaluate(() => testStorage.read());
}
async function call(page, name, ...args) {
  return page.evaluate(async ({ name, args }) => testService[name](...args), {
    name,
    args,
  });
}
async function asRole(page, role) {
  const email = role.toLowerCase().replaceAll(" ", "-") + "@example.test";
  const p = await call(page, "signIn", email, "DemoPass123!");
  const db = await state(page);
  await call(
    page,
    "verify",
    p.codeId,
    db.codes.find((c) => c.id === p.codeId).code,
  );
  const next = await state(page);
  const a = next.accounts.find((a) => a.email === email);
  const m = next.memberships.find((m) => m.accountId === a.id);
  await call(page, "chooseMembership", m.id, m.branchIds[0]);
  return m;
}
const op = () => require("crypto").randomUUID();
async function create(page, module, data, patient = "") {
  return call(page, "createRecord", module, data, patient, op());
}
async function act(page, module, id, action, data = {}) {
  return call(page, "act", module, id, action, data, op());
}
test.beforeEach(async ({ page }) => {
  await page.goto("/#/signin");
  await inject(page);
});
const profile = {
  name: "Alex Owner",
  phone: "08012345678",
  email: "owner@facility.test",
  password: "Example123!",
  confirm: "Example123!",
  facilityRole: "Owner",
  facilityName: "Fictional New Facility",
  facilityType: "Hospital",
  ownership: "Private",
  careLevel: "Secondary",
  address: "1 Fiction Lane",
  state: "Lagos",
  lga: "Ikeja",
  facilityPhone: "+2348012345678",
  facilityEmail: "facility@example.test",
  beds: 12,
  hours: "08:00-18:00",
  emergency24: "No",
  departments: ["General Outpatient", "Laboratory"],
  services: "Fictional consultation",
  licence: "DEMO-LIC",
  cac: "DEMO-CAC",
  directorName: "Demo Director",
  mdcn: "DEMO-MDCN",
  operatingLicence: "data:application/pdf;base64,JVBERi0xLjQ=",
  cacCertificate: "data:application/pdf;base64,JVBERi0xLjQ=",
  proofAddress: "data:application/pdf;base64,JVBERi0xLjQ=",
  staffCount: 10,
  products: ["EHR"],
  migrating: "No",
  interoperability: "No",
  terms: true,
  dpa: true,
  ndpa: true,
  authorised: true,
};
async function signIn(page, email, password = "Example123!") {
  const auth = await call(page, "signIn", email, password);
  let db = await state(page);
  await call(
    page,
    "verify",
    auth.codeId,
    db.codes.find((c) => c.id === auth.codeId).code,
  );
  db = await state(page);
  const account = db.accounts.find((a) => a.email === email),
    member = db.memberships.find((m) => m.accountId === account.id);
  await call(page, "chooseMembership", member.id, member.branchIds[0]);
  return member;
}
async function newFacility(page) {
  const auth = await call(page, "register", profile);
  let db = await state(page);
  await call(
    page,
    "verify",
    auth.codeId,
    db.codes.find((c) => c.id === auth.codeId).code,
  );
  db = await state(page);
  const member = db.memberships[0];
  await call(page, "chooseMembership", member.id, member.branchIds[0]);
  return db.hospitals[0].id;
}
test("five-step registration validates, saves, restores, accepts separate agreements and awaits review", async ({
  page,
}) => {
  await page.goto("/#/register");
  await page
    .getByRole("button", { name: "Save & continue", exact: true })
    .click();
  await expect(page.getByLabel("Full name", { exact: true })).toBeFocused();
  for (const [label, value] of Object.entries({
    "Full name": profile.name,
    Phone: "123",
    Email: profile.email,
    Password: profile.password,
    "Confirm password": profile.confirm,
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Role at the facility").selectOption("Owner");
  await page
    .getByRole("button", { name: "Save & continue", exact: true })
    .click();
  await expect(page.getByLabel("Phone", { exact: true })).toBeFocused();
  await page.getByLabel("Phone", { exact: true }).fill(profile.phone);
  await page
    .getByRole("button", { name: "Save & continue", exact: true })
    .click();
  for (const [label, value] of Object.entries({
    "Facility name": profile.facilityName,
    Address: profile.address,
    "Facility phone": profile.facilityPhone,
    "Facility email": profile.facilityEmail,
    "Bed count": "12",
    "Operating hours": profile.hours,
    "Services offered": profile.services,
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  for (const [label, value] of Object.entries({
    "Facility type": "Hospital",
    Ownership: "Private",
    "Level of care": "Secondary",
    State: "Lagos",
    "Local government area": "Ikeja",
    "24-hour emergency": "No",
  }))
    await page.getByLabel(label, { exact: true }).selectOption(value);
  await page
    .getByLabel("Departments", { exact: true })
    .selectOption(["General Outpatient", "Laboratory"]);
  await page
    .getByRole("button", { name: "Save & continue later", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Draft saved on this device" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Facility name")).toHaveValue(
    profile.facilityName,
  );
  await inject(page);
  let db = await state(page);
  expect(JSON.stringify(db.facilityDrafts)).not.toContain("Example123!");
  await page
    .getByRole("button", { name: "Save & continue", exact: true })
    .click();
  for (const [label, value] of Object.entries({
    "State Ministry of Health licence number": profile.licence,
    "CAC registration number": profile.cac,
    "Medical Director's full name": profile.directorName,
    "MDCN number": profile.mdcn,
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  const file = {
    name: "fictional.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fictional"),
  };
  for (const label of [
    "Operating licence (image/PDF, max 2 MB)",
    "CAC certificate (image/PDF, max 2 MB)",
    "Proof of address (image/PDF, max 2 MB)",
  ])
    await page.getByLabel(label, { exact: true }).setInputFiles(file);
  await page
    .getByRole("button", { name: "Save & continue", exact: true })
    .click();
  await page.getByLabel("Expected number of staff").fill("10");
  await page.getByLabel("Products to start with").selectOption("EHR");
  await page.getByLabel("Migrating existing records?").selectOption("No");
  await page
    .getByLabel("Need interoperability with other facilities?")
    .selectOption("No");
  await page
    .getByRole("button", { name: "Save & continue", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Submit facility for verification" }),
  ).toBeDisabled();
  await expect(page.getByRole("checkbox").first()).not.toBeChecked();
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page
    .getByRole("button", { name: "Submit facility for verification" })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(profile.password);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(profile.confirm);
  for (let i = 0; i < 4; i++)
    await page
      .getByRole("button", { name: "Save & continue", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Submit facility for verification" })
    .click();
  await page
    .getByRole("button", { name: "Accept agreements and submit" })
    .click();
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  db = await state(page);
  const hospital = db.hospitals[0];
  expect(hospital.verification).toBe("pending_verification");
  expect(db.subscriptions[hospital.id].trialStart).toBeNull();
  expect(hospital.registrationProfile.password).toBeUndefined();
  await page.getByLabel("Verification code").fill(db.codes.at(-1).code);
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await page.getByRole("button", { name: "Main", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Facility profile", exact: true }),
  ).toBeVisible();
  await page.goto("/#/patients/new");
  await expect(page).toHaveURL(/facility/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
test("verification starts one trial, rejection resubmits, grace preserves work and expiry preserves reads", async ({
  page,
}) => {
  const hospitalId = await newFacility(page);
  await call(
    page,
    "simulateFacilityReview",
    hospitalId,
    "rejected",
    "Replace fictional licence",
  );
  await call(
    page,
    "saveFacilityProfile",
    { ...profile, licence: "REPLACED" },
    true,
  );
  expect((await state(page)).hospitals[0].verification).toBe(
    "pending_verification",
  );
  await call(
    page,
    "simulateFacilityReview",
    hospitalId,
    "verified",
    "Fictional approval",
  );
  let sub = await call(page, "subscriptionDetails");
  expect(sub.trialEnd - sub.trialStart).toBe(21 * 86400000);
  await call(
    page,
    "simulateFacilityReview",
    hospitalId,
    "verified",
    "Repeat review does not reset trial",
  );
  expect((await call(page, "subscriptionDetails")).trialEnd).toBe(sub.trialEnd);
  await call(page, "launch");
  await call(page, "invite", {
    name: "Demo Doctor",
    email: "doctor@facility.test",
    role: "Doctor",
    department: "General Outpatient",
    branches: [(await state(page)).branches[0].id],
  });
  let db = await state(page);
  const inv = db.invitations[0];
  await call(page, "signOut");
  const a = await call(
    page,
    "register",
    {
      name: "Doctor",
      phone: "08012345678",
      email: inv.email,
      password: "Example123!",
      confirm: "Example123!",
      terms: true,
    },
    inv.id,
  );
  db = await state(page);
  await call(
    page,
    "verify",
    a.codeId,
    db.codes.find((c) => c.id === a.codeId).code,
  );
  await call(page, "acceptInvitation", inv.id);
  db = await state(page);
  const doctor = db.memberships.find((m) => m.role === "Doctor");
  await call(page, "chooseMembership", doctor.id, doctor.branchIds[0]);
  await expect(
    create(page, "patients", { name: "Blocked before first password change" }),
  ).rejects.toThrow("Change your password");
  await call(
    page,
    "changeOwnPassword",
    "Example123!",
    "NewExample123!",
    "NewExample123!",
  );
  const relogin = await call(page, "signIn", inv.email, "NewExample123!");
  const afterReset = await state(page);
  await call(
    page,
    "verify",
    relogin.codeId,
    afterReset.codes.find((c) => c.id === relogin.codeId).code,
  );
  await call(page, "chooseMembership", doctor.id, doctor.branchIds[0]);
  const patient = await create(page, "patients", {
    name: "Demo Patient",
    dob: "1990-01-01",
    phone: "08012345679",
    sex: "Female",
  });
  await call(page, "advanceSimulationDays", 21);
  await create(
    page,
    "journey",
    { complaint: "Grace care", department: "General Outpatient" },
    patient,
  );
  await call(page, "advanceSimulationDays", 21);
  await expect(
    create(
      page,
      "journey",
      { complaint: "Blocked", department: "General Outpatient" },
      patient,
    ),
  ).rejects.toThrow("Contact your administrator");
  db = await state(page);
  expect(
    await page.evaluate((db) => testService.records(db, "patients").length, db),
  ).toBe(1);
  await page.goto("/#/dashboard");
  await expect(
    page.getByRole("heading", { name: "Welcome, Doctor" }),
  ).toBeVisible();
  await expect(
    page.getByText(/trial|subscription|renewal|grace period/i),
  ).toHaveCount(0);
  await page.goto("/#/subscription");
  await expect(page).toHaveURL(/dashboard/);
  await expect(call(page, "subscriptionDetails")).rejects.toThrow(
    "Permission denied",
  );
  const projected = await call(page, "workspaceData");
  expect(projected.subscriptions).toBeUndefined();
  expect(projected.subscriptionReminders).toBeUndefined();
  await call(page, "signOut");
  await signIn(page, profile.email);
  await call(page, "renewSubscription", "Demo facility plan");
  expect((await call(page, "subscriptionDetails")).status).toBe("active");
});
test("subscription access is exact-role gated and reminders are idempotent across paid renewal periods", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Hospital Owner");
  await call(page, "renewSubscription", "Demo facility plan");
  await call(page, "advanceSimulationDays", 16);
  await call(page, "syncSubscriptionReminders");
  await call(page, "syncSubscriptionReminders");
  let db = await state(page);
  expect(db.subscriptionReminders).toHaveLength(1);
  expect(db.subscriptionReminders[0].days).toBe(14);
  for (const role of ["Hospital Owner", "Hospital Admin", "Billing Officer"]) {
    await asRole(page, role);
    expect(await call(page, "subscriptionDetails")).toBeTruthy();
  }
  for (const role of [
    "Doctor",
    "Nurse",
    "Pharmacist",
    "Lab Scientist",
    "Receptionist",
    "Cashier",
    "Medical Director",
    "Records Officer",
    "Platform Super Admin",
  ]) {
    await asRole(page, role);
    await expect(call(page, "subscriptionDetails")).rejects.toThrow(
      "Permission denied",
    );
    expect((await call(page, "workspaceData")).subscriptions).toBeUndefined();
  }
  await asRole(page, "Hospital Owner");
  await call(page, "renewSubscription", "Demo facility plan");
  await call(page, "advanceSimulationDays", 30);
  db = await state(page);
  expect(db.subscriptionReminders).toHaveLength(2);
  expect(db.subscriptionReminders[0].end).not.toBe(
    db.subscriptionReminders[1].end,
  );
});
