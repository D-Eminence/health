const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    page.on("pageerror", error => { throw error; });
    for (const [name, width, height] of [["desktop",1440,1000],["tablet",820,1180],["mobile",390,844]]) {
      await page.setViewportSize({ width, height });
      await page.goto("http://localhost:4173/#/signin");
      await page.locator(".auth-form").waitFor();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `artifacts/login-${name}.png`, animations: "disabled" });
      const result = await page.evaluate(() => {
        const input = document.querySelector(".password-control input").getBoundingClientRect();
        const button = document.querySelector(".password-toggle").getBoundingClientRect();
        const icon = document.querySelector(".password-toggle svg").getBoundingClientRect();
        return { logoWidth: document.querySelector(".auth-brand").getBoundingClientRect().width,
          scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
          eyeCenterOffset: Math.abs((button.top + button.height/2) - (input.top + input.height/2)),
          iconCenterOffset: Math.abs((icon.top + icon.height/2) - (input.top + input.height/2)),
          touchTarget: [button.width,button.height] };
      });
      if (result.eyeCenterOffset > 1 || result.iconCenterOffset > 1 || result.scrollWidth > width) throw Error("Login layout failed: " + JSON.stringify(result));
      console.log(name, JSON.stringify(result));
      await page.getByRole("button", { name: "Show password", exact: true }).click();
      if (await page.getByLabel("Password", {exact: true}).getAttribute("type") !== "text") throw Error("Password eye did not reveal input");
      await page.getByRole("button", { name: "Hide password", exact: true }).click();
    }
  } finally { await browser.close(); }
})();
