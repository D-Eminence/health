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
test("profile drawer traps focus, preserves cancelled edits and returns focus on close", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Nurse");
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Edit my profile" });
  await expect(drawer).toBeVisible();
  expect(
    await page.locator("#health-id-workspace").evaluate((e) => e.inert),
  ).toBe(true);
  const close = drawer.getByRole("button", { name: "Close Edit my profile" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  expect(await drawer.evaluate((e) => e.contains(document.activeElement))).toBe(
    true,
  );
  await drawer
    .getByLabel("Full name", { exact: true })
    .fill("Unsaved display name");
  await close.click();
  await expect(
    drawer.getByRole("heading", { name: "Discard unsaved changes?" }),
  ).toBeVisible();
  await drawer.getByRole("button", { name: "Keep editing" }).click();
  await expect(drawer.getByLabel("Full name", { exact: true })).toHaveValue(
    "Unsaved display name",
  );
  await close.click();
  await drawer
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(drawer).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeFocused();
  expect(
    await page.locator("#health-id-workspace").evaluate((e) => e.inert),
  ).toBe(false);
});
test("destructive staff decision replaces the drawer and requires the confirmation word", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Hospital Admin");
  await page.goto("/#/staff");
  const row = page
    .locator(".record-block")
    .filter({ has: page.getByText("Demo Nurse", { exact: true }) });
  await row.getByRole("button", { name: "Edit access" }).click();
  const drawer = page.getByRole("dialog", { name: "Staff details and access" });
  await drawer
    .getByLabel("Account access", { exact: true })
    .selectOption("suspended");
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  const decision = page.getByRole("alertdialog", {
    name: "Deactivate this staff membership?",
  });
  await expect(decision).toBeVisible();
  await expect(drawer).toBeHidden();
  await expect(
    decision.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await expect(
    decision.getByRole("button", { name: "Deactivate staff member" }),
  ).toBeDisabled();
  await decision.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    drawer.getByLabel("Account access", { exact: true }),
  ).toHaveValue("suspended");
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await decision.getByLabel("Type DEACTIVATE to confirm").fill("DEACTIVATE");
  await decision
    .getByRole("button", { name: "Deactivate staff member" })
    .click();
  await expect(decision).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await state(page)).memberships.find((m) => m.role === "Nurse").status,
    )
    .toBe("suspended");
  await expect(drawer).toHaveCount(0);
});
test("toast privacy, deduplication, maximum stack and persistent errors", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Nurse");
  await page.goto("/#/dashboard");
  await page.clock.install();
  await page.evaluate(() => {
    for (const detail of [
      { code: "profile" },
      { code: "profile" },
      { code: "retry", error: true },
      { code: "saved" },
      { code: "invitation" },
      { code: "Patient Jane 123" },
    ])
      window.dispatchEvent(new CustomEvent("hid-toast", { detail }));
  });
  await expect(page.locator(".feedback-toast")).toHaveCount(3);
  await expect(page.locator(".feedback-toasts")).not.toContainText(
    "Patient Jane",
  );
  const saved = page
    .locator(".feedback-toast")
    .filter({ hasText: "Saved on this device" });
  await saved.hover();
  await page.clock.runFor(6000);
  await expect(saved).toBeVisible();
  await page.mouse.move(5, 5);
  await page.clock.runFor(6000);
  await expect(page.locator(".feedback-toast")).toHaveCount(1);
  await expect(page.locator(".feedback-toast")).toHaveAttribute(
    "role",
    "alert",
  );
  await page
    .locator(".feedback-toast")
    .getByRole("button", { name: "Dismiss confirmation" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".feedback-toast")).toHaveCount(0);
});
test("connection popover uses Escape, sync drawer keeps indicator visible, mobile respects reduced motion", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Nurse");
  await page.goto("/#/dashboard");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const indicator = page.getByRole("button", {
    name: "Connection and sync status",
  });
  await indicator.click();
  await expect(
    page.getByRole("region", { name: "Connection details" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: "Connection details" }),
  ).toHaveCount(0);
  await expect(indicator).toBeFocused();
  await indicator.click();
  await page.getByRole("button", { name: "View sync details" }).click();
  const drawer = page.getByRole("dialog", {
    name: "Connection and sync details",
  });
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate((e) => getComputedStyle(e).animationName)).toBe(
    "none",
  );
  const d = await drawer.boundingBox(),
    i = await indicator.boundingBox();
  expect(d.y + d.height).toBeLessThanOrEqual(i.y);
  await expect(indicator).toBeVisible();
});
test("validation remains inline and focuses the linked field; DND suppresses transient feedback", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Nurse");
  await page.goto("/#/profile");
  const name = page.getByLabel("Full name", { exact: true });
  await name.fill("");
  await page.getByRole("button", { name: "Save personal details" }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  const described = await name.getAttribute("aria-describedby");
  expect(await page.locator('[id="' + described + '"]').textContent()).toBe(
    "Complete this field.",
  );
  await expect(page.locator(".feedback-toast")).toHaveCount(0);
  await call(page, "setPresence", "Do not disturb", "", 60);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("hid-toast", { detail: { code: "profile" } }),
    ),
  );
  await expect(page.locator(".feedback-toast")).toHaveCount(0);
});
test("workspace search respects permissions and browser Back closes the clean profile drawer", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Nurse");
  await page.goto("/#/dashboard");
  await expect(
    page.getByRole("button", { name: "Search Health ID", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search Health ID" });
  await expect(search).toBeVisible();
  await search.getByLabel("Search modules, patients and staff").fill("subscription");
  await expect(
    search.getByText("No matching results", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit my profile" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "Edit my profile" }),
  ).toHaveCount(0);
  const projected = await call(page, "workspaceData");
  expect(projected.subscriptions).toBeUndefined();
  expect(projected.subscriptionReminders).toBeUndefined();
});
test("notification centre and record preview keep context and financial banners stay role-scoped", async ({
  page,
}) => {
  await call(page, "sampleData");
  await asRole(page, "Nurse");
  await page.goto("/#/patients");
  await page
    .getByRole("button", { name: "Quick view", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Record quick view" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Notifications" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Facility subscription")).toHaveCount(0);
});
