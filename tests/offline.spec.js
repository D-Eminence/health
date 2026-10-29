const { test, expect } = require("@playwright/test");
const esbuild = require("esbuild");
const harness = esbuild.buildSync({
  stdin: {
    contents:
      "import * as s from './src/service';import * as d from './src/storage';import * as n from './src/connectivity';import * as q from './src/sync';Object.assign(globalThis,{s,d,n,q});",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
}).outputFiles[0].text;
async function login(page) {
  await page.evaluate(async () => {
    await n.probe();
    const p = await s.signIn("hospital-owner@example.test", "DemoPass123!");
    const db = await d.read();
    await s.verify(p.codeId, db.codes.find((c) => c.id === p.codeId).code);
    const next = await d.read();
    const a = next.accounts.find(
      (a) => a.email === "hospital-owner@example.test",
    );
    const m = next.memberships.find((m) => m.accountId === a.id);
    await s.chooseMembership(m.id, m.branchIds[0]);
  });
}
test.beforeEach(async ({ page }) => {
  await page.goto("/#/signin");
  await page.addScriptTag({ content: harness });
  await page.evaluate(() => s.sampleData());
  await login(page);
});
test("offline saves are encrypted, retained after sign-out and synced exactly once", async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  await page.evaluate(() => n.probe());
  const id = await page.evaluate(async () => {
    return d.transaction((db) => {
      const p = db.records.find((r) => r.kind === "patient");
      p.data.offlineNote = "Offline test";
      return p.id;
    });
  });
  expect(
    await page.evaluate(() =>
      d
        .queueForCurrent()
        .then((q) => q.filter((i) => i.state === "pending").length),
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      d.stored("state", "data").then((v) => v.encrypted),
    ),
  ).toBe(true);
  await page.evaluate(() => s.signOut());
  expect(await page.evaluate(() => d.cacheMeta())).toBeUndefined();
  await context.setOffline(false);
  await login(page);
  await page.evaluate(() => q.syncNow());
  await page.evaluate(() => q.syncNow());
  expect(
    await page.evaluate(
      (id) => d.readRemote(id).then((r) => r.data.offlineNote),
      id,
    ),
  ).toBe("Offline test");
  expect(
    await page.evaluate(() =>
      d
        .queueForCurrent()
        .then((q) => q.filter((i) => i.state === "synced").length),
    ),
  ).toBe(1);
});
test("offline cache has a 100-patient cap and excludes subscription data; lock requires credentials", async ({
  page,
  context,
}) => {
  await page.evaluate(async () => {
    await d.transaction((db) => {
      const p = db.records.find((r) => r.kind === "patient");
      for (let i = 0; i < 130; i++)
        db.records.push({ ...structuredClone(p), id: crypto.randomUUID() });
    });
    await d.refreshCache();
  });
  await context.setOffline(true);
  await page.evaluate(() => n.probe());
  const result = await page.evaluate(async () => {
    const db = await d.read();
    return {
      count: db.records.filter((r) => r.kind === "patient").length,
      subscriptions: db.subscriptions,
    };
  });
  expect(result.count).toBe(100);
  expect(result.subscriptions).toBeUndefined();
  await page.evaluate(() => d.lockDevice());
  await expect(
    page.getByRole("dialog", { name: "Unlock workspace" }),
  ).toBeVisible();
  await page.evaluate(() =>
    d.unlockDevice("hospital-owner@example.test", "DemoPass123!"),
  );
  expect(await page.evaluate(() => d.deviceState().locked)).toBe(false);
});
test("concurrent record edits preserve both versions and do not overwrite mock authority", async ({
  page,
}) => {
  const id = await page.evaluate(async () => {
    const root = await d.readRoot();
    const p = root.records.find((r) => r.kind === "patient");
    await d.writeRemote([
      { ...p, data: { ...p.data, allergies: "Remote allergy" } },
    ]);
    await d.transaction((db) => {
      db.records.find((r) => r.id === p.id).data.allergies = "Local allergy";
    });
    return p.id;
  });
  await page.evaluate(() => q.syncNow());
  expect(
    await page.evaluate(() => d.queueForCurrent().then((q) => q[0].state)),
  ).toBe("conflict");
  const data = await page.evaluate(
    (id) =>
      d.readRoot().then((db) => db.records.find((r) => r.id === id).conflict),
    id,
  );
  expect(data.local.allergies).toBe("Local allergy");
  expect(data.remote.allergies).toBe("Remote allergy");
});
test("installed shell reopens offline and requires cache unlock", async ({
  page,
  context,
}) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.addScriptTag({ content: harness });
  await page.evaluate(() => d.refreshCache());
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Unlock workspace" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByLabel("Email", { exact: true })
    .fill("hospital-owner@example.test");
  await page
    .getByRole("dialog")
    .getByLabel("Password", { exact: true })
    .fill("DemoPass123!");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Unlock workspace" }),
  ).toHaveCount(0);
});
