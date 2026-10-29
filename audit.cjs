const { chromium }=require('@playwright/test');
(async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true}); const p=await b.newPage({viewport:{width:1440,height:1000}}); const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:4173');await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.waitForTimeout(650);
 const roles=await p.evaluate(()=>ROLES.map(r=>({key:r.key,label:r.label})));const seen=new Set();const report=[];
 for(const role of roles){await p.getByTitle('Switch role').click();await p.locator('.hid-dropdown button').filter({hasText:role.label}).first().click();await p.waitForTimeout(350);const navs=await p.locator('.waya-sidebar nav button').evaluateAll(es=>es.map(e=>e.title));report.push({role:role.label,nav:navs});
  for(const nav of navs){if(seen.has(nav))continue;seen.add(nav);await p.locator('.waya-sidebar nav').getByRole('button',{name:nav,exact:true}).click();await p.waitForTimeout(90);if(!(await p.locator('main').innerText()).trim())errors.push('Blank '+nav);}
 }
 await p.getByTitle('Switch role').click();await p.locator('.hid-dropdown button').filter({hasText:'Consultant'}).first().click();await p.waitForTimeout(350);
 await p.locator('.waya-sidebar nav').getByRole('button',{name:'Patients',exact:true}).click();await p.screenshot({path:'patients.png',fullPage:true});
 await p.setViewportSize({width:390,height:844});await p.getByRole('button',{name:'Dashboard',exact:true}).click();await p.screenshot({path:'mobile.png',fullPage:true});
 console.log('MOBILE WIDTH',await p.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth})));
 await p.getByRole('button',{name:'More',exact:true}).click();await p.screenshot({path:'mobile-menu.png',fullPage:true});
 console.log(JSON.stringify({roles:report,modules:[...seen],errors},null,2));await b.close();
})();
