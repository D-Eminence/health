const { chromium } = require("@playwright/test");
const esbuild = require("esbuild");
const harness = esbuild.buildSync({ stdin: {
  contents: "import * as s from './src/service';import * as d from './src/storage';Object.assign(globalThis,{S:s,D:d});",
  resolveDir: process.cwd(),
}, bundle: true, write: false }).outputFiles[0].text;
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("http://localhost:4173/#/signin");
    await page.addScriptTag({ content: harness });
    await page.evaluate(() => S.sampleData());
    for (const [role, routes] of [
      ["Hospital Owner", ["dashboard", "staff", "subscription", "reports", "inventory", "audit", "onboarding"]],
      ["Doctor", ["dashboard", "patients", "consult", "triage", "profile"]],
    ]) {
      await page.addScriptTag({ content: harness });
      await page.evaluate(async role => {
        const auth = await S.signIn(role.toLowerCase().replaceAll(" ", "-") + "@example.test", "DemoPass123!");
        const db = await D.read();
        await S.verify(auth.codeId, db.codes.find(c => c.id === auth.codeId).code);
        const next = await D.read();
        const member = next.memberships.find(m => m.role === role);
        await S.chooseMembership(member.id, member.branchIds[0]);
      }, role);
      for (const [size, width, height] of [["desktop",1440,1000],["tablet",820,1180],["mobile",390,844]]) {
        await page.setViewportSize({ width, height });
        for (const route of routes) {
          await page.goto("http://localhost:4173/#/" + route);
          await page.locator(".emr-main h1").first().waitFor();
          await page.evaluate(() => document.fonts.ready);
          const result = await page.evaluate(() => {
            const main = document.querySelector(".emr-main");
            const stats = main.querySelector(".stat-grid");
            const modules = main.querySelector(".module-grid");
            const heading = main.querySelector(".page-heading");
            const context = main.querySelector(".workspace-context");
            return {
              width: document.documentElement.scrollWidth, viewport: innerWidth,
              overflow: Array.from(document.querySelectorAll("body *")).filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 10).map(e => e.tagName + "." + e.className),
              logo: document.querySelector(".health-id-lockup")?.getBoundingClientRect().width,
              sectionGap: stats && modules ? modules.getBoundingClientRect().top - stats.getBoundingClientRect().bottom : null,
              headingMargin: heading ? parseFloat(getComputedStyle(heading).marginBottom) : null,
              contextMargin: context ? parseFloat(getComputedStyle(context).marginBottom) : null,
            };
          });
          console.log(role, size, route, JSON.stringify(result));
          if (result.width > width || (result.sectionGap !== null && result.sectionGap < 24) ||
              (result.headingMargin !== null && result.headingMargin < 24))
            throw Error("Spacing/overflow check failed: " + role + " " + size + " " + route);
          if (["dashboard", "staff", "profile"].includes(route)) {
            await page.screenshot({ path: `artifacts/spacing-${role.toLowerCase().replaceAll(" ", "-")}-${route}-${size}.png`, animations: "disabled" });
          }
        }
      }
    }
    if (errors.length) throw Error(errors.join("\n"));
  } finally { await browser.close(); }
})();
