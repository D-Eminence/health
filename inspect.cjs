const { chromium } = require('@playwright/test');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400) errors.push(r.status()+' '+r.url())});
 await page.goto('http://127.0.0.1:4173');await page.screenshot({path:'login.png',fullPage:true});
 console.log('LOGIN',await page.locator('body').innerText());
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForTimeout(800);
 await page.screenshot({path:'dashboard.png',fullPage:true});
 console.log('DASHBOARD',await page.locator('body').innerText());console.log('ERRORS',errors);
 await browser.close();
})();
