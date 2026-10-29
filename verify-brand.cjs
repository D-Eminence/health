const { chromium }=require('@playwright/test');
const fs=require('fs');const assert=require('assert/strict');const crypto=require('crypto');
(async()=>{
 const out='artifacts/health-id-brand';fs.mkdirSync(out,{recursive:true});
 for(const name of ['logo.png','logo-icon.png']){
  const a=fs.readFileSync('public/brand/'+name);const b=fs.readFileSync('C:/Users/USER/Documents/health ID/.hid-static/public/brand/'+name);assert(a.equals(b));
 }
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4173');await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.title(),'Health ID | Hospital workspace');
 assert.equal(await page.locator('.auth-form-panel img').getAttribute('src'),'brand/logo.png');
 await page.screenshot({path:out+'/login.png',fullPage:true});
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('main h1').waitFor();
 const accent=await page.locator('.page-heading .hid-button').evaluate(e=>getComputedStyle(e).backgroundColor);assert.equal(accent,'rgb(8, 109, 217)');
 assert.equal(await page.locator('.workspace-brand img').getAttribute('src'),'brand/logo.png');
 await page.screenshot({path:out+'/dashboard.png',fullPage:true});
 await page.getByRole('button',{name:'Collapse sidebar'}).click();assert.equal(await page.locator('.workspace-brand img').getAttribute('src'),'brand/logo-icon.png');
 await page.screenshot({path:out+'/collapsed.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);
 const report={date:'2026-10-03',logoFiles:'byte-identical to supplied source',title:await page.title(),primaryButton:accent,runtimeErrors:errors,screenshots:['login','dashboard','collapsed','mobile']};fs.writeFileSync(out+'/verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();
})();
