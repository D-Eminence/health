const { chromium } = require("@playwright/test");
const esbuild = require("esbuild");
const fs = require("fs");
const zlib = require("zlib");
const harness = esbuild.buildSync({stdin:{contents:"import * as s from './src/service';import * as d from './src/storage';import * as c from './src/catalog';Object.assign(globalThis,{S:s,D:d,C:c});",resolveDir:process.cwd()},bundle:true,write:false}).outputFiles[0].text;
(async () => {
  const browser = await chromium.launch({channel:"chrome",headless:true});
  const report = { date:"2026-10-03", browser:browser.version(), scope:"Rendered route/form and responsive smoke audit, not complete workflow or accessibility certification", cases:[], errors:[], missingModules:[] };
  try {
    const page = await browser.newPage();
    page.on("pageerror", e => report.errors.push({route:page.url(),message:e.message}));
    await page.goto("http://localhost:4173/#/signin");
    await page.addScriptTag({content:harness});
    await page.evaluate(() => S.sampleData());
    const accounts = await page.evaluate(async () => {
      const db=await D.read();
      return db.memberships.map(m=>({role:m.role,email:db.accounts.find(a=>a.id===m.accountId).email}));
    });
    const covered = new Set();
    // Inspect one actually authorized role for every catalogue route and create form.
    accounts.sort((a,b)=>["Doctor","Hospital Owner"].indexOf(b.role)-["Doctor","Hospital Owner"].indexOf(a.role));
    for (const account of accounts) {
      await page.goto("http://localhost:4173/#/signin");
      await page.addScriptTag({content:harness});
      await page.evaluate(async account => {
        const auth=await S.signIn(account.email,"DemoPass123!");
        const db=await D.read(); await S.verify(auth.codeId,db.codes.find(c=>c.id===auth.codeId).code);
        const next=await D.read(); const m=next.memberships.find(m=>m.role===account.role);
        await S.chooseMembership(m.id,m.branchIds[0]);
      },account);
      const available = await page.evaluate(async () => {
        const db=await D.read(); return C.allModules.flatMap(m=>[
          ...(S.can(db,m.id)?[{route:m.id,title:m.title,mode:"list"}]:[]),
          ...(S.can(db,m.id,"create")?[{route:m.id+"/new",title:m.title,mode:"create"}]:[]),
        ]);
      });
      if (account.role==="Hospital Owner") available.push(...["dashboard","staff","facility","onboarding","subscription","reports","audit","profile"].map(route=>({route,mode:"workspace"})));
      if (account.role==="Platform Super Admin") available.push({route:"platform",mode:"workspace"});
      for (const entry of available) {
        if(covered.has(entry.route))continue;
        covered.add(entry.route);
        for(const [size,width,height] of [["desktop",1440,1000],["tablet",820,1180],["phone",390,844]]) {
          await page.setViewportSize({width,height});
          await page.goto("http://localhost:4173/#/"+entry.route);
          await page.locator(".emr-main h1").first().waitFor({timeout:10000});
          if(entry.mode==="create") {
            const patient=page.getByLabel("Patient",{exact:true});
            if(await patient.count()===1 && await patient.locator("option").count()>1)
              await patient.selectOption({index:1});
          }
          await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
          const result=await page.evaluate(()=>{
            const visible=e=>e.checkVisibility()&&!e.closest('[inert]');
            const name=e=>(e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')?.split(' ').map(id=>document.getElementById(id)?.textContent).join(' ')||Array.from(e.labels||[]).map(l=>l.textContent).join(' ')||(e.tagName==='BUTTON'?e.textContent:'')||'').trim();
            return {actualRoute:location.hash,heading:document.querySelector('.emr-main h1')?.textContent,
              width:document.documentElement.scrollWidth,viewport:innerWidth,
              unnamedControls:Array.from(document.querySelectorAll('input:not([type=hidden]),select,textarea,button')).filter(visible).filter(e=>!name(e)).map(e=>({tag:e.tagName,type:e.type,placeholder:e.getAttribute('placeholder'),class:e.className})),
              alerts:Array.from(document.querySelectorAll('[role=alert]')).filter(visible).map(e=>e.textContent.trim()),
              documentAgeMs:Math.round(performance.now()),nodes:document.querySelectorAll('*').length};
          });
          report.cases.push({...entry,role:account.role,size,...result});
          if(result.width>width || result.unnamedControls.length || result.alerts.length)
            await page.screenshot({path:`artifacts/audit-${entry.route.replaceAll('/','-')}-${size}.png`,animations:"disabled"});
        }
      }
      console.log(account.role+": "+report.cases.length+" viewport checks complete");
    }
    await page.addScriptTag({content:harness});
    report.missingModules=await page.evaluate(covered=>C.allModules.filter(m=>!covered.includes(m.id)).map(m=>m.id),[...covered]);
    const bundle=fs.readFileSync('public/app.js');
    report.bundle={rawBytes:bundle.length,gzipBytes:zlib.gzipSync(bundle).length};
    report.summary={routeCases:covered.size,viewportChecks:report.cases.length,overflow:report.cases.filter(c=>c.width>c.viewport).length,unnamedControlCases:report.cases.filter(c=>c.unnamedControls.length).length,errorCases:report.cases.filter(c=>c.alerts.length).length,pageErrors:report.errors.length};
  } catch(e){report.fatal=String(e);process.exitCode=1;}
  finally {fs.writeFileSync('artifacts/frontend-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary||{fatal:report.fatal}));await browser.close();}
})();
