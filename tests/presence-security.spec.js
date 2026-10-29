const { test, expect } = require("@playwright/test");
const esbuild = require("esbuild");
const harness = esbuild.buildSync({
  stdin: {
    contents:
      "import * as service from './src/service';import * as storage from './src/storage';import * as presence from './src/presence';globalThis.testPresence=presence;globalThis.testService=service;globalThis.testStorage=storage;",
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
test("profile email re-verification, credential review, device revocation and admin-only reset", async ({
  page,
}) => {
  await call(page, "sampleData");
  const nurse = await asRole(page, "Nurse");
  const codeId = await call(
    page,
    "requestProfileEmail",
    "new-nurse@example.test",
    "DemoPass123!",
  );
  let db = await state(page);
  expect(db.accounts.find((a) => a.id === nurse.accountId).email).toBe(
    "nurse@example.test",
  );
  await call(
    page,
    "confirmProfileEmail",
    codeId,
    db.codes.find((c) => c.id === codeId).code,
  );
  await expect(
    call(page, "confirmProfileEmail", codeId, "000000"),
  ).rejects.toThrow("Code unavailable");
  await call(page, "submitCredentials", "MDCN-DEMO", "Fictional licence");
  await expect(call(page, "adminReset", nurse.id)).rejects.toThrow(
    "Only Owner or Admin",
  );
  await page.evaluate(() =>
    testStorage.transaction((db) => {
      const s = db.sessions.find(
        (s) => s.id === localStorage.getItem("health-id-session"),
      );
      db.sessions.push({
        ...s,
        id: crypto.randomUUID(),
        device: "Other browser",
      });
    }),
  );
  await call(page, "signOutOtherDevices");
  db = await state(page);
  expect(
    db.sessions.filter((s) => s.accountId === nurse.accountId),
  ).toHaveLength(1);
  await call(page, "signOut");
  await asRole(page, "Hospital Admin");
  await call(page, "reviewCredentials", nurse.id, true);
  await call(page, "adminReset", nurse.id);
  db = await state(page);
  expect(
    db.accounts.find((a) => a.id === nurse.accountId).credentials.status,
  ).toBe("approved");
  expect(
    db.codes.some(
      (c) => c.accountId === nurse.accountId && c.purpose === "recover",
    ),
  ).toBe(true);
});
test("neutral phone recovery is single-use, rate limited and invalidates sessions", async ({
  page,
}) => {
  await call(page, "sampleData");
  const nurse = await asRole(page, "Nurse");
  await call(page, "updateOwnProfile", { phone: "08087654321" });
  const unknown = await call(page, "recover", "nobody@example.test");
  expect(unknown.purpose).toBe("recover");
  expect((await state(page)).codes.some((c) => c.id === unknown.codeId)).toBe(
    false,
  );
  const recovery = await call(page, "recover", "08087654321");
  let db = await state(page);
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
    "Recovered123!",
    "Recovered123!",
  );
  await expect(
    call(page, "resetPassword", recovery.codeId, "Again123!", "Again123!"),
  ).rejects.toThrow("expired");
  db = await state(page);
  expect(db.sessions.some((s) => s.accountId === nurse.accountId)).toBe(false);
  expect(
    db.accounts.find((a) => a.id === nurse.accountId).securityNotices,
  ).toHaveLength(1);
  for (let i = 0; i < 5; i++)
    await call(page, "recover", "unknown" + i + "@example.test");
  const limited = await call(page, "recover", "08087654321");
  expect((await state(page)).codes.some((c) => c.id === limited.codeId)).toBe(
    false,
  );
});
test("presence expires, respects facility policy and sound rules preserve critical visual alerts", async ({
  page,
}) => {
  await call(page, "sampleData");
  const owner = await asRole(page, "Hospital Owner");
  await call(page, "setPresence", "Do not disturb", "On ward round", 60);
  let result = await page.evaluate(async () =>
    testPresence.presenceOf(
      await testStorage.read(),
      testService.context(await testStorage.read()).a.id,
    ),
  );
  expect(result.status).toBe("Do not disturb");
  await page.evaluate(() =>
    testStorage.transaction((db) => {
      const s = db.sessions.find(
        (s) => s.id === localStorage.getItem("health-id-session"),
      );
      s.presence.heartbeat = Date.now() - 60000;
    }),
  );
  result = await page.evaluate(async () =>
    testPresence.presenceOf(
      await testStorage.read(),
      testService.context(await testStorage.read()).a.id,
    ),
  );
  expect(result.status).toBe("Offline");
  await call(page, "savePresencePolicy", {
    enabled: true,
    allowOffline: false,
    idleMinutes: 3,
    criticalSounds: true,
  });
  await expect(call(page, "setPresence", "Offline", "", 0)).rejects.toThrow(
    "disables",
  );
  const sound = await page.evaluate(() => {
    const p = { ...testService.defaultPreferences, muteClinical: false };
    return [
      testPresence.soundAllowed(
        p,
        "Do not disturb",
        false,
        true,
        false,
        "12:00",
      ),
      testPresence.soundAllowed(
        p,
        "Do not disturb",
        true,
        true,
        false,
        "23:00",
      ),
      testPresence.soundAllowed(
        { ...p, sounds: false },
        "Online",
        true,
        true,
        false,
        "12:00",
      ),
    ];
  });
  expect(sound).toEqual([false, true, false]);
  await call(page, "savePresencePolicy", {
    enabled: false,
    allowOffline: false,
    idleMinutes: 3,
    criticalSounds: true,
  });
  result = await page.evaluate(async () =>
    testPresence.presenceOf(
      await testStorage.read(),
      testService.context(await testStorage.read()).a.id,
    ),
  );
  expect(result.status).toBe("Hidden");
  await call(page, "signOut");
  await asRole(page, "Nurse");
  await expect(
    call(page, "savePresencePolicy", { enabled: true }),
  ).rejects.toThrow("Only Owner or Admin");
});
test("profile controls, adjustable crop and optional two-step sign-in remain accessible", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Nurse");
  await page.goto("/#/profile");
  await expect(
    page.getByRole("heading", { name: "Active sessions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Facility presence policy" }),
  ).toHaveCount(0);
  await page
    .getByLabel("Upload staff profile picture")
    .setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ioAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(page.getByRole("group", { name: "Crop picture" })).toBeVisible();
  await page.getByLabel("Zoom", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save picture", exact: true }).click();
  await call(page, "setTwoFactor", false, "DemoPass123!");
  await call(page, "signOut");
  const login = await call(
    page,
    "signIn",
    "nurse@example.test",
    "DemoPass123!",
  );
  expect(login.session).toBeTruthy();
});
test("regulatory edits require review while contact changes save immediately with actor history", async ({
  page,
}) => {
  await call(page, "sampleData");
  const admin = await asRole(page, "Hospital Admin");
  let db = await state(page);
  const hospital = db.hospitals.find((h) => h.id === admin.hospitalId),
    before = hospital.verification;
  await call(page, "updateHospitalIdentity", { name: "Updated hospital" });
  db = await state(page);
  expect(db.hospitals.find((h) => h.id === hospital.id).verification).toBe(
    before,
  );
  await call(page, "updateHospitalOperations", {
    hours: "24 hours",
    beds: 10,
    departments: hospital.departments,
    services: "General outpatient",
    licence: "CHANGED-123",
    cac: "CAC-DEMO",
    registryId: "REG-DEMO",
    directorName: "Demo Director",
  });
  db = await state(page);
  const changed = db.hospitals.find((h) => h.id === hospital.id);
  expect(changed.verification).toBe("pending_verification");
  expect(changed.profileHistory.at(-1).actorId).toBe(admin.accountId);
  expect(changed.profileHistory.at(-1).fields).toContain("licence");
  await call(page, "signOut");
  await asRole(page, "Nurse");
  await expect(
    call(page, "updateHospitalIdentity", { name: "Blocked" }),
  ).rejects.toThrow("Permission denied");
});
test("replaced recovery codes cannot be used as verified password-reset grants", async ({
  page,
}) => {
  await call(page, "sampleData");
  const nurse = await asRole(page, "Nurse");
  const recovery = await call(page, "recover", "nurse@example.test");
  await page.evaluate(() =>
    testStorage.transaction((db) => {
      db.codes
        .filter((c) => c.purpose === "recover")
        .forEach((c) => (c.sentAt = Date.now() - 31000));
    }),
  );
  await call(page, "resend", nurse.accountId, "recover");
  await expect(
    call(
      page,
      "resetPassword",
      recovery.codeId,
      "NotAllowed123!",
      "NotAllowed123!",
    ),
  ).rejects.toThrow("expired");
});
