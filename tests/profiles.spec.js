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
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ioAAAAASUVORK5CYII=",
  "base64",
);
test("staff profile edits and picture persist without changing account authority", async ({
  page,
}) => {
  await call(page, "sampleData");
  const member = await asRole(page, "Nurse");
  await page.goto("/#/profile");
  await page.getByLabel("Full name", { exact: true }).fill("Nurse Updated");
  await page.getByLabel("Phone", { exact: true }).fill("+2348012345678");
  await page.getByLabel("Job title (display only)").fill("Ward nurse");
  await page.getByLabel("About you").fill("Fictional profile biography");
  await page.getByRole("button", { name: "Save personal details" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Profile updated" }),
  ).toBeVisible();
  await page
    .getByLabel("Upload staff profile picture")
    .setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Profile updated" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Nurse Updated",
  );
  await expect(
    page.getByRole("img", { name: "Nurse Updated profile picture" }).last(),
  ).toHaveAttribute("src", /^data:image\/png/);
  await inject(page);
  await call(page, "updateOwnProfile", {
    role: "Hospital Owner",
    accountId: "wrong-user",
  });
  const db = await state(page);
  expect(db.memberships.find((m) => m.id === member.id).role).toBe("Nurse");
  await expect(
    call(page, "updateHospitalIdentity", { name: "Unauthorized" }),
  ).rejects.toThrow("Permission denied");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page
    .getByRole("button", { name: "Remove picture", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Profile updated" }),
  ).toBeVisible();
  expect(
    (await state(page)).accounts.find((a) => a.id === member.accountId).photo,
  ).toBe("");
});
test("hospital admin edits hospital identity and image with validated updates", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Hospital Admin");
  await page.goto("/#/facility");
  await page
    .getByLabel("Hospital name", { exact: true })
    .fill("Fictional Updated Hospital");
  await page.getByLabel("Hospital phone").fill("08012345678");
  await page.getByLabel("Hospital email").fill("updated@example.test");
  await page.getByLabel("Hospital address").fill("2 Fictional Street");
  await page.getByRole("button", { name: "Save hospital details" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Profile updated" }),
  ).toBeVisible();
  await page
    .getByLabel("Upload hospital profile picture or logo")
    .setInputFiles({
      name: "hospital.png",
      mimeType: "image/png",
      buffer: png,
    });
  await page.getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Profile updated" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Hospital name", { exact: true })).toHaveValue(
    "Fictional Updated Hospital",
  );
  await expect(
    page.getByRole("img", {
      name: "Fictional Updated Hospital logo",
      exact: true,
    }),
  ).toBeVisible();
  await inject(page);
  const db = await state(page);
  expect(db.hospitals[0].email).toBe("updated@example.test");
  await expect(
    call(page, "updateHospitalIdentity", {
      logo: "data:application/pdf;base64,AAA=",
    }),
  ).rejects.toThrow("Choose a PNG");
});
test("password eye controls work across authentication and changes invalidate old credentials and sessions", async ({
  page,
}) => {
  await page.getByLabel("Password", { exact: true }).fill("NotSaved123!");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.goto("/#/register");
  await page
    .getByRole("button", { name: "Discard edits and leave", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show confirm password", exact: true })
    .click();
  await expect(
    page.getByLabel("Confirm password", { exact: true }),
  ).toHaveAttribute("type", "text");
  await page.goto("/#/reset-password");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.goto("/#/signin");
  await inject(page);
  await call(page, "sampleData");
  const member = await asRole(page, "Doctor");
  await page.goto("/#/profile");
  await page.getByLabel("Current password", { exact: true }).fill("Incorrect!");
  await page
    .getByLabel("New password", { exact: true })
    .fill("ChangedPass123!");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("ChangedPass123!");
  await page
    .getByRole("button", { name: "Show new password", exact: true })
    .click();
  await expect(
    page.getByLabel("New password", { exact: true }),
  ).toHaveAttribute("type", "text");
  await page
    .getByRole("button", { name: "Update password and sign out" })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Current password is incorrect." }),
  ).toBeVisible();
  await page
    .getByLabel("Current password", { exact: true })
    .fill("DemoPass123!");
  await page
    .getByRole("button", { name: "Update password and sign out" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Password updated" }),
  ).toBeVisible();
  const db = await state(page);
  expect(
    db.sessions.filter((s) => s.accountId === member.accountId),
  ).toHaveLength(0);
  expect(JSON.stringify(db)).not.toContain("ChangedPass123!");
  await expect(
    call(page, "signIn", "doctor@example.test", "DemoPass123!"),
  ).rejects.toThrow("Incorrect");
  const signed = await call(
    page,
    "signIn",
    "doctor@example.test",
    "ChangedPass123!",
  );
  expect(signed.purpose).toBe("mfa");
});
