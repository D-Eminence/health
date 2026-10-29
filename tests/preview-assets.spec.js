const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

test("fresh login styles load while an old offline worker controls the tab", async ({ page }) => {
  // A real legacy worker, in an isolated test browser: it still serves a stale
  // unversioned stylesheet. New immutable asset paths must bypass that cache.
  const fixture = path.resolve("public/__test_legacy_preview_sw.js");
  fs.writeFileSync(fixture, `
    self.addEventListener('install', e => e.waitUntil(caches.open('legacy-preview-test').then(c =>
      c.put('/application.css', new Response('.password-toggle { transform:translateY(16px)!important; }', {headers:{'Content-Type':'text/css'}}))
    )));
    self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', e => {
      if(new URL(e.request.url).pathname === '/application.css')
        e.respondWith(caches.open('legacy-preview-test').then(c => c.match('/application.css')));
    });
  `);
  try {
    await page.route("**/__legacy-test-host", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Preview test</title>" }));
    await page.goto("/__legacy-test-host");
    await page.evaluate(async () => {
      localStorage.setItem("preview-preservation-check", "retained");
      await navigator.serviceWorker.register("/__test_legacy_preview_sw.js");
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.goto("/#/signin");
    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
    const measured = await page.evaluate(() => {
      const input = document.querySelector('.password-control input').getBoundingClientRect();
      const icon = document.querySelector('.password-toggle svg').getBoundingClientRect();
      return {
        offset: Math.abs(input.top + input.height / 2 - icon.top - icon.height / 2),
        stylesheet: Array.from(document.querySelectorAll('link[rel=stylesheet]')).find(e => e.href.includes('application.')).href,
        data: localStorage.getItem('preview-preservation-check'),
        controller: navigator.serviceWorker.controller.scriptURL,
      };
    });
    expect(measured.controller).toContain('__test_legacy_preview_sw.js');
    expect(measured.stylesheet).toMatch(/application\.[a-f0-9]{12}\.css$/);
    expect(measured.offset).toBeLessThan(1);
    expect(measured.data).toBe('retained');
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  } finally {
    fs.unlinkSync(fixture);
  }
});
