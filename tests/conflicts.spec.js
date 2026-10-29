const { test, expect } = require("@playwright/test");
const esbuild = require("esbuild");
const harness = esbuild.buildSync({
  stdin: {
    contents:
      "import * as s from './src/service';import * as d from './src/storage';import * as n from './src/connectivity';import * as q from './src/sync';import * as c from './src/conflicts';Object.assign(globalThis,{s,d,n,q,c});",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
}).outputFiles[0].text;
async function login(page, role = "Doctor") {
  await page.evaluate(async (role) => {
    await n.probe();
    const email = role.toLowerCase().replaceAll(" ", "-") + "@example.test";
    const challenge = await s.signIn(email, "DemoPass123!");
    const db = await d.readRoot();
    await s.verify(
      challenge.codeId,
      db.codes.find((c) => c.id === challenge.codeId).code,
    );
    const root = await d.readRoot();
    const account = root.accounts.find((a) => a.email === email);
    const member = root.memberships.find((m) => m.accountId === account.id);
    await s.chooseMembership(member.id, member.branchIds[0]);
  }, role);
}
async function conflict(page) {
  return page.evaluate(async () => {
    const root = await d.readRoot();
    const ctx = s.context(root);
    const record = root.records.find(
      (r) => r.kind === "patient" && r.branchId === ctx.s.branchId,
    );
    await d.writeRemote([
      { ...record, data: { ...record.data, allergies: "Connected allergy" } },
    ]);
    await d.transaction((db) => {
      db.records.find((r) => r.id === record.id).data.allergies =
        "Device allergy";
    });
    await q.syncNow();
    const item = (await d.queueForCurrent()).find(
      (i) => i.state === "conflict",
    );
    return { batchId: item.id, recordId: record.id };
  });
}
test.beforeEach(async ({ page }) => {
  await page.goto("/#/signin");
  await page.addScriptTag({ content: harness });
  await page.evaluate(() => s.sampleData());
  await login(page);
});

test("clinical reviewer can resolve another staff member's conflict with preserved versions and one audit receipt", async ({
  page,
}) => {
  await login(page, "Hospital Owner");
  const item = await conflict(page);
  expect(await page.evaluate(() => c.listConflictReviews())).toEqual([]);
  await expect(
    page.evaluate((id) => c.getConflictReview(id), item.batchId),
  ).rejects.toThrow(/clinical reviewer/);
  await login(page);
  expect((await page.evaluate(() => c.listConflictReviews())).length).toBe(1);
  await page.evaluate(async ({ batchId, recordId }) => {
    const review = await c.getConflictReview(batchId);
    const choices = { [recordId]: "remote" };
    await c.resolveConflict(
      batchId,
      review.token,
      choices,
      "Confirmed connected version during review.",
    );
    await c.resolveConflict(
      batchId,
      review.token,
      choices,
      "Confirmed connected version during review.",
    );
  }, item);
  const result = await page.evaluate(async ({ batchId, recordId }) => {
    const root = await d.readRoot();
    return {
      record: root.records.find((r) => r.id === recordId),
      remote: await d.readRemote(recordId),
      receipt: await d.syncReceipt(batchId),
      audit: root.audit.filter((a) => a.resource === batchId),
      queue: (await d.reviewQueue(s.context(root).h.id)).find(
        (i) => i.id === batchId,
      ),
    };
  }, item);
  expect(result.record.data.allergies).toBe("Connected allergy");
  expect(result.record.conflict).toBeUndefined();
  expect(result.record.versions.map((v) => v.data.allergies)).toEqual(
    expect.arrayContaining(["Device allergy", "Connected allergy"]),
  );
  expect(result.queue.resolution.versions[0].local.data.allergies).toBe(
    "Device allergy",
  );
  expect(result.remote.data).toEqual(result.record.data);
  expect(result.receipt.id).toBe(item.batchId);
  expect(
    result.audit.filter((a) => a.action === "sync.conflict.flagged"),
  ).toHaveLength(1);
  expect(
    result.audit.filter((a) => a.action === "sync.conflict.resolved"),
  ).toHaveLength(1);
});

test("stale reviews reject changed versions and later queued edits require their own review", async ({
  page,
}) => {
  const item = await conflict(page);
  const old = await page.evaluate(
    (id) => c.getConflictReview(id),
    item.batchId,
  );
  await page.evaluate(async (id) => {
    await d.transaction((db) => {
      db.records.find((r) => r.id === id).data.allergies = "Later device edit";
    });
  }, item.recordId);
  await expect(
    page.evaluate(
      async ({ item, old }) =>
        c.resolveConflict(
          item.batchId,
          old.token,
          { [item.recordId]: "remote" },
          "Use reviewed connected version.",
        ),
      { item, old },
    ),
  ).rejects.toThrow(/version changed/);
  await page.evaluate(async ({ batchId, recordId }) => {
    const review = await c.getConflictReview(batchId);
    await c.resolveConflict(
      batchId,
      review.token,
      { [recordId]: "remote" },
      "Use reviewed connected version.",
    );
    await q.syncNow();
  }, item);
  const result = await page.evaluate(
    async (id) => ({
      local: (await d.readRoot()).records.find((r) => r.id === id),
      remote: await d.readRemote(id),
      queue: await d.queueForCurrent(),
    }),
    item.recordId,
  );
  expect(result.local.data.allergies).toBe("Later device edit");
  expect(result.remote.data.allergies).toBe("Connected allergy");
  expect(result.queue.filter((i) => i.state === "conflict")).toHaveLength(1);
  expect(result.local.conflict.local.allergies).toBe("Later device edit");
});

test("permission revocation, wrong branch, lock and offline state block conflict review", async ({
  page,
  context,
}) => {
  const item = await conflict(page);
  const review = await page.evaluate(
    (id) => c.getConflictReview(id),
    item.batchId,
  );
  await page.evaluate(() =>
    d.transaction((db) => {
      s.context(db).m.deniedPermissions.push("patients.edit");
    }),
  );
  await expect(
    page.evaluate(
      ({ item, review }) =>
        c.resolveConflict(
          item.batchId,
          review.token,
          { [item.recordId]: "local" },
          "Device version was confirmed.",
        ),
      { item, review },
    ),
  ).rejects.toThrow(/permissions/);
  await page.evaluate(() =>
    d.transaction((db) => {
      s.context(db).m.deniedPermissions = [];
    }),
  );
  await page.evaluate(() =>
    d.transaction((db) => {
      s.context(db).s.branchId = "not-authorized";
    }),
  );
  await expect(
    page.evaluate((id) => c.getConflictReview(id), item.batchId),
  ).rejects.toThrow(/Branch access/);
  await login(page);
  await context.setOffline(true);
  await page.evaluate(() => n.probe());
  await expect(
    page.evaluate((id) => c.getConflictReview(id), item.batchId),
  ).rejects.toThrow();
  await context.setOffline(false);
  await page.evaluate(() => n.probe());
  await page.evaluate(() => d.lockDevice());
  expect(await page.evaluate(() => c.listConflictReviews())).toEqual([]);
  await expect(
    page.evaluate((id) => c.getConflictReview(id), item.batchId),
  ).rejects.toThrow();
});

test("an interrupted review commit leaves both originals and the queue unchanged", async ({
  page,
}) => {
  const item = await conflict(page);
  const result = await page.evaluate(async ({ batchId, recordId }) => {
    const review = await c.getConflictReview(batchId);
    const original = IDBObjectStore.prototype.put;
    let failed = false;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "remote" && String(key).startsWith("receipt:"))
        throw new DOMException("Test storage failure", "QuotaExceededError");
      return original.call(this, value, key);
    };
    try {
      await c.resolveConflict(
        batchId,
        review.token,
        { [recordId]: "local" },
        "Reviewed device version together.",
      );
    } catch {
      failed = true;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const root = await d.readRoot();
    return {
      failed,
      remote: await d.readRemote(recordId),
      receipt: await d.syncReceipt(batchId),
      item: (await d.queueForCurrent()).find((i) => i.id === batchId),
      audit: root.audit.filter((a) => a.action === "sync.conflict.resolved"),
    };
  }, item);
  expect(result.failed).toBe(true);
  expect(result.remote.data.allergies).toBe("Connected allergy");
  expect(result.receipt).toBeUndefined();
  expect(result.item.state).toBe("conflict");
  expect(result.audit).toHaveLength(0);
});

test("review drawer compares versions, guards edits and records a decision on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await conflict(page);
  await page.evaluate(() => {
    location.hash = "/dashboard";
  });
  await page
    .getByRole("button", { name: "Connection and sync status" })
    .click();
  await page.getByRole("button", { name: "View sync details" }).click();
  await page
    .getByRole("button", { name: "Review versions", exact: true })
    .click();
  const drawer = page.getByRole("dialog", {
    name: "Review conflicting versions",
    exact: true,
  });
  await expect(
    drawer.getByText("Device allergy", { exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByText("Connected allergy", { exact: true }),
  ).toBeVisible();
  await drawer.getByLabel("Record 1: version to retain").selectOption("remote");
  await drawer
    .getByLabel("Reason for the decision")
    .fill("Confirmed the connected version with the care team.");
  await drawer
    .getByRole("button", {
      name: "Close Review conflicting versions",
      exact: true,
    })
    .click();
  await drawer.getByRole("button", { name: "Keep editing" }).click();
  await expect(drawer.getByLabel("Reason for the decision")).toHaveValue(
    "Confirmed the connected version with the care team.",
  );
  await page.screenshot({
    path: "artifacts/conflict-review-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await drawer.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: "artifacts/conflict-review-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await drawer.getByRole("button", { name: "Record review decision" }).click();
  await expect(
    drawer.getByText("Review recorded", { exact: true }),
  ).toBeVisible();
});

test("new connected changes invalidate the review and a whole batch requires every choice", async ({
  page,
}) => {
  const items = await page.evaluate(async () => {
    const db = await d.readRoot();
    const p = db.records.find((r) => r.kind === "patient");
    const second = { ...structuredClone(p), id: crypto.randomUUID() };
    db.records.push(second);
    await d.write(db);
    await d.writeRemote(
      [p, second].map((r) => ({
        ...r,
        data: { ...r.data, allergies: "Connected allergy" },
      })),
    );
    await d.transaction((root) => {
      for (const record of root.records.filter((r) =>
        [p.id, second.id].includes(r.id),
      ))
        record.data.allergies = "Device allergy";
    });
    await q.syncNow();
    return {
      batchId: (await d.queueForCurrent()).find((i) => i.state === "conflict")
        .id,
      first: p.id,
      second: second.id,
    };
  });
  const old = await page.evaluate(
    (id) => c.getConflictReview(id),
    items.batchId,
  );
  await expect(
    page.evaluate(
      ({ items, old }) =>
        c.resolveConflict(
          items.batchId,
          old.token,
          { [items.first]: "local" },
          "Both versions were reviewed.",
        ),
      { items, old },
    ),
  ).rejects.toThrow(/every record/);
  await page.evaluate(async (id) => {
    const remote = await d.readRemote(id);
    await d.writeRemote([
      {
        ...remote,
        data: { ...remote.data, allergies: "New connected allergy" },
      },
    ]);
  }, items.first);
  await expect(
    page.evaluate(
      ({ items, old }) =>
        c.resolveConflict(
          items.batchId,
          old.token,
          { [items.first]: "local", [items.second]: "local" },
          "Both versions were reviewed.",
        ),
      { items, old },
    ),
  ).rejects.toThrow(/version changed/);
  const result = await page.evaluate(async (items) => {
    const review = await c.getConflictReview(items.batchId);
    await c.resolveConflict(
      items.batchId,
      review.token,
      { [items.first]: "local", [items.second]: "remote" },
      "Each complete version was reviewed.",
    );
    return {
      first: await d.readRemote(items.first),
      second: await d.readRemote(items.second),
    };
  }, items);
  expect(result.first.data.allergies).toBe("Device allergy");
  expect(result.second.data.allergies).toBe("Connected allergy");
  expect(
    result.first.versions.some(
      (v) => v.data.allergies === "New connected allergy",
    ),
  ).toBe(true);
});

test("later compatible edits retain reviewed history after sync", async ({
  page,
}) => {
  const item = await conflict(page);
  const result = await page.evaluate(async ({ batchId, recordId }) => {
    await d.transaction((db) => {
      db.records.find((r) => r.id === recordId).data.address =
        "Updated address";
    });
    const review = await c.getConflictReview(batchId);
    await c.resolveConflict(
      batchId,
      review.token,
      { [recordId]: "local" },
      "Device version confirmed during review.",
    );
    await q.syncNow();
    return {
      remote: await d.readRemote(recordId),
      queue: await d.queueForCurrent(),
    };
  }, item);
  expect(result.remote.data.address).toBe("Updated address");
  expect(result.remote.conflict).toBeUndefined();
  expect(
    result.remote.versions.some(
      (v) => v.data.allergies === "Connected allergy",
    ),
  ).toBe(true);
  expect(result.queue.every((i) => i.state === "synced")).toBe(true);
});

test("an open review retains offline input and clears details when clinical access is revoked", async ({
  page,
  context,
}) => {
  await conflict(page);
  await page.evaluate(() => {
    location.hash = "/dashboard";
  });
  await page
    .getByRole("button", { name: "Connection and sync status" })
    .click();
  await page.getByRole("button", { name: "View sync details" }).click();
  await page
    .getByRole("button", { name: "Review versions", exact: true })
    .click();
  const drawer = page.getByRole("dialog", {
    name: "Review conflicting versions",
    exact: true,
  });
  await drawer
    .getByLabel("Reason for the decision")
    .fill("Keep this review draft while offline.");
  await context.setOffline(true);
  await page.evaluate(() => n.probe());
  await expect(drawer.getByLabel("Reason for the decision")).toHaveValue(
    "Keep this review draft while offline.",
  );
  await context.setOffline(false);
  await page.evaluate(() => n.probe());
  await page.evaluate(() =>
    d.transaction((db) => {
      s.context(db).m.deniedPermissions.push("patients.edit");
    }),
  );
  await expect(
    drawer.getByText(
      "Your review access changed. Return to your current workspace.",
    ),
  ).toBeVisible();
  await expect(drawer.getByText("Device allergy", { exact: true })).toHaveCount(
    0,
  );
});

test("a cache refresh failure reports the committed review and safely retries without another decision", async ({
  page,
}) => {
  const item = await conflict(page);
  const result = await page.evaluate(async ({ batchId, recordId }) => {
    const review = await c.getConflictReview(batchId);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "cache")
        throw new DOMException("Test cache failure", "QuotaExceededError");
      return put.call(this, value, key);
    };
    let first;
    try {
      first = await c.resolveConflict(
        batchId,
        review.token,
        { [recordId]: "local" },
        "Reviewed device version together.",
      );
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const retry = await c.resolveConflict(
      batchId,
      review.token,
      { [recordId]: "local" },
      "Reviewed device version together.",
    );
    const root = await d.readRoot();
    return {
      first,
      retry,
      remote: await d.readRemote(recordId),
      audits: root.audit.filter((a) => a.action === "sync.conflict.resolved"),
    };
  }, item);
  expect(result.first.cacheRefreshed).toBe(false);
  expect(result.retry.cacheRefreshed).toBe(true);
  expect(result.remote.data.allergies).toBe("Device allergy");
  expect(result.audits).toHaveLength(1);
});
