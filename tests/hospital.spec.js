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
test("owner registration, real codes, nine-step onboarding, refresh, invitation and assigned access", async ({
  page,
}) => {
  const auth = await call(page, "register", {
    name: "Owner Example",
    phone: "08000000001",
    email: "owner@fiction.test",
    password: "Example123!",
    confirm: "Example123!",
    facilityRole: "Owner",
    facilityName: "Fictional New Hospital",
    facilityType: "Clinic",
    ownership: "Private",
    careLevel: "Primary",
    address: "1 Demo Lane",
    state: "Lagos",
    lga: "Ikeja",
    facilityPhone: "08000000001",
    facilityEmail: "hospital@fiction.test",
    beds: 0,
    hours: "09:00-17:00",
    emergency24: "No",
    departments: ["General Outpatient"],
    services: "Demo",
    licence: "DEMO",
    cac: "DEMO",
    directorName: "Demo Director",
    mdcn: "DEMO",
    operatingLicence: "data:application/pdf;base64,JVBERi0xLjQ=",
    cacCertificate: "data:application/pdf;base64,JVBERi0xLjQ=",
    proofAddress: "data:application/pdf;base64,JVBERi0xLjQ=",
    staffCount: 1,
    products: ["EHR"],
    migrating: "No",
    interoperability: "No",
    terms: true,
    dpa: true,
    ndpa: true,
    authorised: true,
  });
  await call(
    page,
    "simulateFacilityReview",
    (await state(page)).hospitals[0].id,
    "verified",
    "Fictional approval",
  );
  await page.evaluate(
    (auth) =>
      localStorage.setItem("health-id-pending-auth", JSON.stringify(auth)),
    auth,
  );
  await page.goto("/#/verify");
  await expect(page.getByLabel("Verification code")).toBeVisible();
  await inject(page);
  let db = await state(page);
  expect(db.accounts[0].hash).not.toContain("Example123!");
  const c = db.codes.at(-1);
  await expect(call(page, "verify", c.id, "000000")).rejects.toThrow(
    "Incorrect code",
  );
  db = await state(page);
  expect(db.codes.at(-1).attempts).toBe(1);
  await page.getByLabel("Verification code").fill(c.code);
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await page.getByRole("button", { name: "Main", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Set up your hospital" }),
  ).toBeVisible();
  for (const [label, value] of [
    ["Hospital name", "Fictional New Hospital"],
    ["Main phone", "08000000001"],
    ["Main email", "hospital@fiction.test"],
    ["Address", "1 Demo Lane"],
    ["City", "Demo City"],
    ["State", "Demo State"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await page.getByLabel("Facility type").selectOption("Clinic");
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Enabled departments" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await page.getByLabel("Address", { exact: true }).fill("1 Demo Lane");
  await page.getByLabel("Contact", { exact: true }).fill("08000000001");
  await page.getByRole("button", { name: "Save branch", exact: true }).click();
  await page.getByRole("button", { name: "Continue to staff" }).click();
  await page.getByRole("button", { name: "Continue to roles" }).click();
  await page.getByRole("button", { name: "Continue to billing" }).click();
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review launch requirements" })
    .click();
  await page
    .getByRole("button", { name: "Launch hospital", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Owner Example" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome, Owner Example" }),
  ).toBeVisible();
  await inject(page);
  db = await state(page);
  expect(db.hospitals[0].launched).toBe(true);
  expect(db.records.filter((r) => r.kind === "patient")).toHaveLength(0);
  const branch = db.branches[0].id;
  await call(page, "invite", {
    name: "Nurse Example",
    email: "nurse@fiction.test",
    role: "Nurse",
    department: "General Outpatient",
    branches: [branch],
  });
  db = await state(page);
  const inv = db.invitations[0];
  await call(page, "signOut");
  const p = await call(
    page,
    "register",
    {
      name: "Nurse Example",
      email: "nurse@fiction.test",
      phone: "08000000002",
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
    p.codeId,
    db.codes.find((c) => c.id === p.codeId).code,
  );
  await call(page, "acceptInvitation", inv.id);
  db = await state(page);
  const nurse = db.memberships.find((m) => m.role === "Nurse");
  await call(page, "chooseMembership", nurse.id, branch);
  await expect(
    create(page, "billing", { service: "x", quantity: 1, source: "bad" }),
  ).rejects.toThrow("Permission denied");
  await page.goto("/#/billing");
  await expect(page).toHaveURL(/profile/);
  await expect(
    page.getByText(
      "Invitation accepted. Change your password below before making workspace changes.",
    ),
  ).toBeVisible();
});
test("connected registration, queue, triage, signed consultation, lab publication and pharmacy partial fulfilment", async ({
  page,
}) => {
  await call(page, "sampleData");
  const doctor = (await state(page)).memberships.find(
    (m) => m.role === "Doctor",
  );
  await asRole(page, "Receptionist");
  const patient = await create(page, "patients", {
    name: "Taylor Fiction",
    dob: "1991-01-01",
    sex: "Female",
    phone: "08000000005",
    provisional: true,
  });
  const visit = await create(
    page,
    "journey",
    {
      complaint: "Fictional visit",
      department: "General Outpatient",
      clinician: doctor.id,
    },
    patient,
  );
  await asRole(page, "Nurse");
  const triage = await create(
    page,
    "triage",
    {
      visit,
      complaint: "Fictional symptom",
      bp: "120/80",
      pulse: 80,
      temperature: 37,
      spo2: 98,
      priority: "Routine",
      observations: "Demo",
    },
    patient,
  );
  await act(page, "triage", triage, "complete");
  await asRole(page, "Doctor");
  const encounter = await create(
    page,
    "consult",
    {
      visit,
      complaint: "Fictional",
      history: "Demo history",
      examination: "Demo exam",
      diagnosis: "Fictional assessment",
      note: "Sample note",
      confirmed: true,
    },
    patient,
  );
  await act(page, "consult", encounter, "sign");
  const lab = await create(
    page,
    "lab",
    {
      encounter,
      test: "Fictional test",
      indication: "Demo",
      urgency: "Routine",
    },
    patient,
  );
  let db = await state(page);
  const item = db.records.find((r) => r.kind === "inventory");
  const rx = await create(
    page,
    "pharmacy",
    {
      encounter,
      item: item.id,
      quantity: 10,
      instructions: "Fictional directions",
      confirmed: true,
    },
    patient,
  );
  await asRole(page, "Lab Scientist");
  await act(page, "lab", lab, "collect", { sampleCode: "SAMPLE-1" });
  await act(page, "lab", lab, "process", {
    processing: "Sample processing recorded",
  });
  await act(page, "lab", lab, "result", {
    value: "5",
    unit: "demo units",
    comments: "Fictional result",
  });
  await expect(act(page, "lab", lab, "publish")).rejects.toThrow(
    "Permission denied",
  );
  await asRole(page, "Lab Manager");
  await act(page, "lab", lab, "verify", {
    review: "Reviewed sample and result",
  });
  await act(page, "lab", lab, "publish");
  await asRole(page, "Pharmacist");
  await act(page, "pharmacy", rx, "review", {
    review: "Reviewed fictional prescription",
  });
  db = await state(page);
  const batch = db.records.find(
    (r) => r.kind === "batch" && r.parentId === item.id,
  );
  await act(page, "pharmacy", rx, "dispense", { batch: batch.id, quantity: 4 });
  db = await state(page);
  expect(db.records.find((r) => r.id === rx).status).toBe("partial");
  expect(db.records.find((r) => r.id === batch.id).data.quantity).toBe(96);
  await act(page, "pharmacy", rx, "dispense", { batch: batch.id, quantity: 6 });
  await expect(
    act(page, "pharmacy", rx, "dispense", { batch: batch.id, quantity: 1 }),
  ).rejects.toThrow("no longer available");
  db = await state(page);
  expect(db.records.find((r) => r.id === rx).status).toBe("fulfilled");
  expect(db.records.find((r) => r.id === batch.id).data.quantity).toBe(90);
  expect(
    db.records.find((r) => r.kind === "labResult" && r.parentId === lab).status,
  ).toBe("published");
  expect(db.records.find((r) => r.id === encounter).status).toBe("signed");
  expect(db.records.filter((r) => r.kind === "grant")).toHaveLength(0);
});
test("invoices, idempotent payments, refunds, admissions, turnover and procurement receipts", async ({
  page,
}) => {
  await call(page, "sampleData");
  let db = await state(page);
  const patient = db.records.find((r) => r.kind === "patient").id;
  const service = db.records.find((r) => r.kind === "service").id;
  await asRole(page, "Billing Officer");
  const invoice = await create(
    page,
    "billing",
    { service, quantity: 2, source: "SERVICE-001" },
    patient,
  );
  await act(page, "billing", invoice, "issue");
  await asRole(page, "Cashier");
  const key = op();
  await call(
    page,
    "act",
    "billing",
    invoice,
    "pay",
    { amount: 4000, method: "Cash", reference: "TX-1" },
    key,
  );
  await call(
    page,
    "act",
    "billing",
    invoice,
    "pay",
    { amount: 4000, method: "Cash", reference: "TX-1" },
    key,
  );
  await act(page, "billing", invoice, "pay", {
    amount: 6000,
    method: "Cash",
    reference: "TX-2",
  });
  db = await state(page);
  expect(db.records.filter((r) => r.kind === "payment")).toHaveLength(2);
  expect(db.records.find((r) => r.id === invoice).status).toBe("paid");
  await expect(
    act(page, "billing", invoice, "refund", {
      amount: 100,
      reason: "No authority",
    }),
  ).rejects.toThrow("Permission denied");
  await asRole(page, "Hospital Owner");
  await act(page, "billing", invoice, "refund", {
    amount: 1000,
    reason: "Fictional refund",
  });
  await expect(
    act(page, "billing", invoice, "refund", {
      amount: 10000,
      reason: "Too much",
    }),
  ).rejects.toThrow("exceeds refundable");
  const item = db.records.find((r) => r.kind === "inventory").id;
  const purchase = await create(page, "procurement", {
    item,
    quantity: 20,
    supplier: "Demo Supplier",
    reason: "Stock request",
  });
  await act(page, "procurement", purchase, "approve");
  await act(page, "procurement", purchase, "order", { reference: "PO-1" });
  await act(page, "procurement", purchase, "receive", {
    quantity: 8,
    lot: "NEW-LOT",
    expiry: "2030-01-01",
    reference: "RCV-1",
  });
  await act(page, "procurement", purchase, "receive", {
    quantity: 12,
    lot: "NEW-LOT",
    expiry: "2030-01-01",
    reference: "RCV-2",
  });
  await expect(
    act(page, "procurement", purchase, "receive", {
      quantity: 1,
      lot: "NEW-LOT",
      expiry: "2030-01-01",
      reference: "RCV-3",
    }),
  ).rejects.toThrow("no longer");
  await asRole(page, "Doctor");
  db = await state(page);
  const beds = db.records.filter((r) => r.kind === "bed");
  const admission = await create(
    page,
    "inpatient",
    { reason: "Fictional admission", team: "Demo team" },
    patient,
  );
  await act(page, "inpatient", admission, "admit", { bed: beds[0].id });
  await act(page, "inpatient", admission, "transfer", {
    bed: beds[1].id,
    handover: "Demo handover",
  });
  await act(page, "inpatient", admission, "prepare", {
    followup: "Demo follow-up",
  });
  await act(page, "inpatient", admission, "discharge", {
    summary: "Demo discharge summary",
  });
  await asRole(page, "Nurse");
  await act(page, "wards", beds[1].id, "clean", {
    cleaning: "Cleaning complete",
  });
  db = await state(page);
  expect(db.records.find((r) => r.id === beds[1].id).status).toBe("available");
  expect(db.records.find((r) => r.id === purchase).status).toBe("closed");
  expect(
    db.records.find((r) => r.kind === "batch" && r.data.lot === "NEW-LOT").data
      .quantity,
  ).toBe(20);
});
test("consent approval, revocation, emergency audit, draft restoration and controlled failure", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Doctor");
  let db = await state(page);
  const patient = db.records.find((r) => r.kind === "patient").id;
  const request = await create(
    page,
    "consent",
    {
      reason: "Review prior fictional results",
      categories: "Published results",
      duration: 30,
    },
    patient,
  );
  expect(
    await call(page, "viewExternal", patient, "Published results"),
  ).toHaveLength(0);
  await call(page, "patientDecision", request, "approve");
  expect(
    await call(page, "viewExternal", patient, "Published results"),
  ).toHaveLength(1);
  await call(page, "patientDecision", request, "revoke");
  expect(
    await call(page, "viewExternal", patient, "Published results"),
  ).toHaveLength(0);
  await call(page, "emergencyGrant", patient, {
    reason: "Fictional emergency",
    justification: "Demo patient cannot consent",
    ack: true,
    categories: "Signed notes",
  });
  expect(
    await call(page, "viewExternal", patient, "Signed notes"),
  ).toHaveLength(1);
  await call(page, "saveDraft", "clinical-note", {
    note: "Persistent local note",
  });
  await page.reload();
  await inject(page);
  db = await state(page);
  expect(
    Object.values(db.drafts).some((d) => d.note === "Persistent local note"),
  ).toBe(true);
  expect(
    db.audit.some(
      (e) =>
        e.action === "external.category-view" && e.reason === "Signed notes",
    ),
  ).toBe(true);
  await page.evaluate(() => testStorage.simulateFailure());
  await expect(
    create(
      page,
      "journey",
      { complaint: "Retry case", department: "General Outpatient" },
      patient,
    ),
  ).rejects.toThrow("Simulated operation failure");
  await create(
    page,
    "journey",
    { complaint: "Retry case", department: "General Outpatient" },
    patient,
  );
  await call(page, "devAction", "expire-session");
  await expect(
    create(
      page,
      "journey",
      { complaint: "Denied", department: "General Outpatient" },
      patient,
    ),
  ).rejects.toThrow("Permission denied");
});
test("specialty and support service lifecycles save meaningful records", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Doctor");
  let db = await state(page);
  const patient = db.records.find((r) => r.kind === "patient").id;
  const emergency = await create(
    page,
    "emergency",
    { complaint: "Fictional urgent visit", priority: "Urgent", team: "Doctor" },
    patient,
  );
  await act(page, "emergency", emergency, "assess", {
    assessment: "Local assessment",
  });
  await act(page, "emergency", emergency, "disposition", {
    disposition: "Discharged",
    followup: "Review",
  });
  const maternity = await create(
    page,
    "maternity",
    { gestation: "Fictional enrolment", nextVisit: "2027-01-02T10:00" },
    patient,
  );
  await act(page, "maternity", maternity, "observe", {
    observations: "Fictional antenatal observations",
  });
  await act(page, "maternity", maternity, "delivery", {
    delivery: "Fictional delivery record",
    newborn: "Baby Example",
  });
  await act(page, "maternity", maternity, "followup", {
    followup: "Local follow-up",
  });
  const theatre = await create(
    page,
    "surgery",
    { procedure: "Fictional procedure", reason: "Demo" },
    patient,
  );
  await act(page, "surgery", theatre, "schedule", {
    scheduled: "2027-01-03T10:00",
    team: "Demo team",
  });
  await act(page, "surgery", theatre, "checklist", {
    checklist: "Fictional checklist, no medical guidance",
  });
  await act(page, "surgery", theatre, "perform", {
    documentation: "Procedure record",
  });
  await act(page, "surgery", theatre, "recover", {
    recovery: "Recovery complete",
  });
  const dental = await create(
    page,
    "dental",
    { scheduled: "2027-01-04T10:00", complaint: "Fictional dental visit" },
    patient,
  );
  await act(page, "dental", dental, "assess", {
    findings: "Fictional findings",
    plan: "Fictional plan",
  });
  await act(page, "dental", dental, "perform", {
    procedure: "Fictional treatment",
  });
  await act(page, "dental", dental, "followup", {
    followup: "Review in local demo",
  });
  const tele = await create(
    page,
    "telemedicine",
    {
      scheduled: "2027-01-05T10:00",
      clinician: "Demo doctor",
      reason: "Demo remote visit",
    },
    patient,
  );
  await act(page, "telemedicine", tele, "wait");
  await act(page, "telemedicine", tele, "start");
  await act(page, "telemedicine", tele, "end", {
    note: "No real video connection",
    followup: "Local follow-up",
  });
  const referral = await create(
    page,
    "referrals",
    {
      destination: "Fictional Partner Clinic",
      reason: "Demo referral",
      urgency: "Routine",
      summary: "Selected summary",
      scope: "This summary only",
    },
    patient,
  );
  await act(page, "referrals", referral, "send");
  await asRole(page, "Medical Director");
  await act(page, "referrals", referral, "accept", {
    review: "Local recipient response",
  });
  await act(page, "referrals", referral, "complete", {
    outcome: "Demo referral completed",
  });
  const icu = await create(
    page,
    "icu",
    { reason: "Fictional ICU admission", team: "Demo care team" },
    patient,
  );
  db = await state(page);
  const bed = db.records.find((r) => r.kind === "bed");
  await act(page, "icu", icu, "admit", { bed: bed.id });
  await create(
    page,
    "nursing",
    {
      admission: icu,
      category: "Vitals",
      note: "Fictional observation",
      units: "demo",
    },
    patient,
  );
  await act(page, "icu", icu, "prepare", { followup: "Ward follow-up" });
  await act(page, "icu", icu, "discharge", {
    summary: "ICU discharge summary",
  });
  await asRole(page, "Hospital Admin");
  db = await state(page);
  const vehicle = db.records.find((r) => r.kind === "ambulance");
  const dispatch = await create(page, "ambulance", {
    vehicle: vehicle.id,
    pickup: "Example A",
    destination: "Example B",
    crew: "Demo crew",
  });
  await act(page, "ambulance", dispatch, "dispatch");
  await act(page, "ambulance", dispatch, "complete", {
    handover: "Fictional handover",
  });
  const roster = await create(page, "shifts", {
    staff: db.memberships.find((m) => m.role === "Nurse").id,
    starts: "2027-02-01T08:00",
    ends: "2027-02-01T16:00",
    department: "General Outpatient",
  });
  await act(page, "shifts", roster, "clockin");
  await act(page, "shifts", roster, "clockout", { handover: "Demo handover" });
  const credential = await create(page, "hr", {
    staff: db.memberships.find((m) => m.role === "Doctor").id,
    name: "Fictional licence",
    expiry: "2030-01-01",
    employment: "Employed",
  });
  await act(page, "hr", credential, "review", { review: "Local review only" });
  const incident = await create(page, "quality", {
    title: "Fictional incident",
    description: "Demo investigation",
  });
  await act(page, "quality", incident, "assign", { reviewer: "Admin" });
  await act(page, "quality", incident, "investigate", {
    investigation: "Demo findings",
    corrective: "Demo action",
  });
  await act(page, "quality", incident, "resolve", {
    resolution: "Action completed",
  });
  await asRole(page, "Lab Manager");
  const donation = await create(page, "bloodbank", {
    donor: "Fictional donor",
    group: "O+",
    expiry: "2030-01-01",
  });
  await act(page, "bloodbank", donation, "screen", {
    screening: "Local screening record",
  });
  await act(page, "bloodbank", donation, "reserve", {
    patient,
    review: "Explicit fictional suitability review",
  });
  await act(page, "bloodbank", donation, "issue", {
    authorization: "Demo authorized issue",
  });
  db = await state(page);
  for (const record of [
    emergency,
    maternity,
    theatre,
    dental,
    tele,
    referral,
    dispatch,
    roster,
  ])
    expect(db.records.find((r) => r.id === record).status).toBe("completed");
  expect(db.records.find((r) => r.id === icu).status).toBe("discharged");
  expect(db.records.find((r) => r.id === donation).status).toBe("issued");
  expect(
    db.records.some((r) => r.kind === "patient" && r.data.motherId === patient),
  ).toBe(true);
});
test("radiology publication, insurance settlement, recovery and session invalidation", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Doctor");
  let db = await state(page);
  const patient = db.records.find((r) => r.kind === "patient").id;
  const visit = await create(
    page,
    "journey",
    { complaint: "Demo", department: "General Outpatient" },
    patient,
  );
  const encounter = await create(
    page,
    "consult",
    {
      visit,
      complaint: "Demo",
      history: "Demo",
      examination: "Demo",
      diagnosis: "Fictional diagnosis",
      note: "Demo",
      confirmed: true,
    },
    patient,
  );
  await act(page, "consult", encounter, "sign");
  const order = await create(
    page,
    "radiology",
    {
      encounter,
      modality: "Fictional scan",
      indication: "Demo",
      urgency: "Routine",
    },
    patient,
  );
  await asRole(page, "Radiology Reporter");
  await act(page, "radiology", order, "schedule", {
    scheduled: "2027-01-01T10:00",
  });
  await act(page, "radiology", order, "examine", {
    exam: "Fictional examination",
  });
  await act(page, "radiology", order, "attach", {
    attachment: "data:application/pdf;base64,JVBERi0xLjQ=",
  });
  await act(page, "radiology", order, "report", { report: "Fictional report" });
  await act(page, "radiology", order, "review", { review: "Reviewed report" });
  await act(page, "radiology", order, "publish");
  await asRole(page, "Billing Officer");
  db = await state(page);
  const invoice = await create(
    page,
    "billing",
    {
      service: db.records.find((r) => r.kind === "service").id,
      quantity: 1,
      source: "INS-SVC",
    },
    patient,
  );
  await act(page, "billing", invoice, "issue");
  const policy = await create(
    page,
    "policies",
    {
      insurer: "Demo HMO",
      number: "POL-DEMO",
      expiry: "2030-01-01",
      coverage: "Fictional coverage",
    },
    patient,
  );
  const claim = await create(
    page,
    "insurance",
    {
      invoice,
      policy,
      authorization: "AUTH-DEMO",
      support: "Invoice and service",
    },
    patient,
  );
  await act(page, "insurance", claim, "submit");
  await act(page, "insurance", claim, "approve", {
    approvedAmount: 3000,
    review: "Partial approval",
  });
  db = await state(page);
  expect(db.records.filter((r) => r.kind === "payment")).toHaveLength(0);
  await asRole(page, "Cashier");
  await act(page, "insurance", claim, "settle", {
    amount: 3000,
    reference: "HMO-TX-1",
  });
  db = await state(page);
  expect(db.records.find((r) => r.id === invoice).status).toBe("partial");
  expect(db.records.find((r) => r.id === order).status).toBe("published");
  const email = "cashier@example.test";
  const recovery = await call(page, "recover", email);
  db = await state(page);
  await call(
    page,
    "verify",
    recovery.codeId,
    db.codes.find((c) => c.id === recovery.codeId).code,
  );
  await call(
    page,
    "resetPassword",
    recovery.codeId,
    "NewDemo123!",
    "NewDemo123!",
  );
  await expect(call(page, "signIn", email, "DemoPass123!")).rejects.toThrow(
    "Incorrect",
  );
  const mfa = await call(page, "signIn", email, "NewDemo123!");
  db = await state(page);
  expect(db.sessions.some((s) => s.accountId === mfa.accountId)).toBe(false);
  await expect(call(page, "verify", mfa.codeId, "111111")).rejects.toThrow(
    "Incorrect",
  );
  await call(page, "devAction", "expire-code", mfa.codeId);
  await expect(
    call(
      page,
      "verify",
      mfa.codeId,
      db.codes.find((c) => c.id === mfa.codeId).code,
    ),
  ).rejects.toThrow("expired");
});
test("browser appointments, drafts, staff choices, refresh and return to last permitted page", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Receptionist");
  let db = await state(page);
  const patient = db.records.find(
    (r) => r.kind === "patient" && r.hospitalId === db.hospitals[0].id,
  ).id;
  const doctor = db.memberships.find((m) => m.role === "Doctor");
  await page.goto("/#/appointments/new");
  await page.getByLabel("Patient", { exact: true }).selectOption(patient);
  await page.getByLabel("Appointment time").fill("2027-01-10T10:00");
  await page.getByLabel("Clinician", { exact: true }).selectOption(doctor.id);
  await page
    .getByLabel("Department", { exact: true })
    .selectOption("General Outpatient");
  await page.getByLabel("Reason", { exact: true }).fill("Fictional follow-up");
  await expect(
    page.getByText("Draft saved on this device", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue(
    "Fictional follow-up",
  );
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Saved record", exact: true }),
  ).toBeVisible();
  await inject(page);
  db = await state(page);
  const booking = db.records.find((r) => r.kind === "appointment");
  await expect(
    create(
      page,
      "appointments",
      {
        starts: "2027-01-10T10:10",
        clinician: doctor.id,
        department: "General Outpatient",
        reason: "Conflicting",
      },
      patient,
    ),
  ).rejects.toThrow("overlapping");
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await page
    .getByRole("button", { name: "Check in", exact: true })
    .last()
    .click();
  await expect
    .poll(
      async () =>
        (await state(page)).records.filter(
          (r) => r.kind === "visit" && r.parentId === booking.id,
        ).length,
    )
    .toBe(1);
  const route = page.url().split("#")[1];
  await expect
    .poll(
      async () =>
        (await state(page)).accounts.find(
          (a) => a.email === "receptionist@example.test",
        ).lastContext?.route,
    )
    .toBe(route);
  await call(page, "signOut");
  await asRole(page, "Receptionist");
  db = await state(page);
  expect(
    await page.evaluate((db) => testService.sessionIn(db).lastRoute, db),
  ).toBe(route);
  await page.goto("/#/");
  await expect(page).toHaveURL(new RegExp(booking.id));
  await asRole(page, "Nurse");
  await page.goto("/#/billing/new");
  await expect(page).toHaveURL(/dashboard/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
});
test("reports reconcile payments, refunds and actual filtered exports", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Hospital Owner");
  let db = await state(page);
  const patient = db.records.find((r) => r.kind === "patient").id;
  const service = db.records.find((r) => r.kind === "service").id;
  const invoice = await create(
    page,
    "billing",
    { service, quantity: 2, source: "REPORT-CHARGE" },
    patient,
  );
  await act(page, "billing", invoice, "issue");
  await act(page, "billing", invoice, "pay", {
    amount: 7000,
    method: "Cash",
    reference: "REPORT-PAY",
  });
  await act(page, "billing", invoice, "refund", {
    amount: 500,
    reason: "Fictional adjustment",
  });
  const result = await call(page, "exportReport");
  expect(result.metrics).toMatchObject({
    invoiced: 10000,
    collected: 6500,
    outstanding: 3500,
  });
  expect(
    (await call(page, "exportReport", "2031-01-01", "2031-01-02")).metrics
      .invoiced,
  ).toBe(0);
  await page.goto("/#/reports");
  await expect(
    page.getByRole("heading", { name: "Reports & Analytics", exact: true }),
  ).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export report", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toBe("health-id-report.json");
  db = await state(page);
  expect(db.audit.some((e) => e.action === "reports.export")).toBe(true);
  await asRole(page, "Cashier");
  await expect(call(page, "exportReport")).rejects.toThrow("Permission denied");
});
test("nursing tasks, unsigned edits, platform review and branch isolation with stock transfer", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Doctor");
  let db = await state(page);
  const patient = db.records.find((r) => r.kind === "patient").id;
  const visit = await create(
    page,
    "journey",
    { complaint: "Fictional care", department: "General Outpatient" },
    patient,
  );
  const data = {
    visit,
    complaint: "Demo",
    history: "History",
    examination: "Exam",
    diagnosis: "Fictional",
    note: "Original",
    confirmed: true,
  };
  const encounter = await create(page, "consult", data, patient);
  await call(page, "updateDraftRecord", "consult", encounter, {
    ...data,
    note: "Edited before signing",
  });
  await act(page, "consult", encounter, "sign");
  await expect(
    call(page, "updateDraftRecord", "consult", encounter, data),
  ).rejects.toThrow("unsigned draft");
  const admission = await create(
    page,
    "inpatient",
    { reason: "Demo care", team: "Demo team" },
    patient,
  );
  const nurse = db.memberships.find((m) => m.role === "Nurse");
  const task = await create(
    page,
    "nursing-tasks",
    {
      admission,
      name: "Fictional care check",
      assignedTo: nurse.id,
      due: "2027-01-01T10:00",
    },
    patient,
  );
  await asRole(page, "Nurse");
  await act(page, "nursing-tasks", task, "start");
  await act(page, "nursing-tasks", task, "complete", {
    note: "Fictional task completed",
  });
  const owner = await asRole(page, "Hospital Owner");
  db = await state(page);
  const hospital = db.hospitals[0];
  const sourceItem = db.records.find((r) => r.kind === "inventory");
  const sourceBatch = db.records.find((r) => r.kind === "batch");
  await call(page, "saveBranch", {
    name: "East",
    address: "Demo East",
    contact: "08000000000",
    departments: hospital.departments,
    hours: "00:00-23:59",
  });
  db = await state(page);
  const east = db.branches.find((b) => b.name === "East");
  await act(page, "inventory", sourceItem.id, "transfer", {
    batch: sourceBatch.id,
    quantity: 15,
    destination: east.id,
    reason: "Demo transfer",
  });
  await call(page, "chooseMembership", owner.id, east.id);
  db = await state(page);
  const dest = db.records.find(
    (r) => r.kind === "inventory" && r.branchId === east.id,
  );
  expect(dest).toBeTruthy();
  expect(
    db.records.find((r) => r.kind === "batch" && r.parentId === dest.id).data
      .quantity,
  ).toBe(15);
  expect(db.records.find((r) => r.id === sourceBatch.id).data.quantity).toBe(
    85,
  );
  await expect(
    act(page, "inventory", sourceItem.id, "adjust", {
      batch: sourceBatch.id,
      delta: 1,
      reason: "Wrong branch",
    }),
  ).rejects.toThrow("not found");
  await expect(
    call(page, "platformAction", hospital.id, "Verified", "No authority"),
  ).rejects.toThrow("Permission denied");
  await asRole(page, "Platform Super Admin");
  await call(
    page,
    "platformAction",
    hospital.id,
    "Verified",
    "Fictional review completed",
  );
  await page.goto("/#/platform");
  await expect(
    page.getByRole("heading", { name: "Facility review", exact: true }),
  ).toBeVisible();
  expect((await state(page)).hospitals[0].verification).toBe("Verified");
});
