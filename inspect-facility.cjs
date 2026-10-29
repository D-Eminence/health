const { chromium } = require("@playwright/test");
const esbuild = require("esbuild");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await page.goto("http://localhost:4173/#/register");
  await page.getByLabel("Full name", { exact: true }).waitFor();
  await page.screenshot({
    path: "artifacts/facility-account-desktop.png",
    fullPage: true,
  });
  await page.addScriptTag({
    content: esbuild.buildSync({
      stdin: {
        contents: "import * as service from './src/service';window.S=service;",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
    }).outputFiles[0].text,
  });
  await page.evaluate(async () =>
    S.saveFacilityDraft(localStorage.getItem("health-id-facility-draft"), 1, {
      name: "Alex Example",
      phone: "08012345678",
      email: "alex@example.test",
      facilityRole: "Owner",
      facilityName: "Fictional Cedar Hospital",
      facilityType: "Hospital",
      ownership: "Private",
      careLevel: "Secondary",
      state: "Lagos",
      lga: "Ikeja",
      beds: 24,
      departments: ["General Outpatient"],
      hours: "08:00-18:00",
      emergency24: "No",
    }),
  );
  await page.reload();
  await page.getByLabel("Facility name", { exact: true }).waitFor();
  await page.screenshot({
    path: "artifacts/facility-details-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/facility-details-mobile.png",
    fullPage: true,
  });
  console.log(
    "Mobile document width",
    await page.evaluate(() => document.documentElement.scrollWidth),
  );
  await page.goto("http://localhost:4173/#/accept-invitation");
  await page.screenshot({
    path: "artifacts/facility-invitation-mobile.png",
    fullPage: true,
  });
  await browser.close();
})();
