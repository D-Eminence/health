const { chromium } = require("@playwright/test");
const esbuild = require("esbuild");
(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on("pageerror", (e) => console.log("ERROR", e.message));
  await p.goto("http://127.0.0.1:4173/#/signin");
  await p.screenshot({ path: "artifacts/ehr-login.png", fullPage: true });
  const code = esbuild.buildSync({
    stdin: {
      contents:
        "import * as svc from './src/service'; import * as store from './src/storage'; globalThis.S=svc;globalThis.D=store;",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
  }).outputFiles[0].text;
  await p.addScriptTag({ content: code });
  await p.evaluate(async () => {
    await S.sampleData();
    const auth = await S.signIn("doctor@example.test", "DemoPass123!");
    let db = await D.read();
    await S.verify(
      auth.codeId,
      db.codes.find((c) => c.id === auth.codeId).code,
    );
    db = await D.read();
    const m = db.memberships.find((m) => m.role === "Doctor");
    await S.chooseMembership(m.id, m.branchIds[0]);
  });
  await p.goto("http://127.0.0.1:4173/#/dashboard");
  await p.getByRole("heading", { name: "Welcome, Demo Doctor" }).waitFor();
  await p.screenshot({ path: "artifacts/ehr-dashboard.png", fullPage: true });
  await p.goto("http://127.0.0.1:4173/#/patients");
  await p.getByRole("heading", { name: "Patients", exact: true }).waitFor();
  await p.screenshot({ path: "artifacts/ehr-patients.png", fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({ path: "artifacts/ehr-mobile.png", fullPage: true });
  console.log(
    "OVERFLOW",
    await p.evaluate(() => document.documentElement.scrollWidth),
  );
  await b.close();
})();
