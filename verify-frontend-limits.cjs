const {chromium}=require('@playwright/test');
const esbuild=require('esbuild');
const fs=require('fs');
const harness=esbuild.buildSync({stdin:{contents:"import * as s from './src/service';import * as d from './src/storage';Object.assign(globalThis,{S:s,D:d});",resolveDir:process.cwd()},bundle:true,write:false}).outputFiles[0].text;
(async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});
 const report={auth:[],reflow:[],performance:[],errors:[]};
 try{
  const p=await b.newPage();
  p.on('pageerror',e=>report.errors.push(e.message));
  for(const width of [1440,820,390,320]){
   await p.setViewportSize({width,height:1000});
   for(const route of ['signin','register','recover','reset-password','verify','accept-invitation']){
    await p.goto('http://localhost:4173/#/'+route);
    await p.locator('.auth-shell h1').first().waitFor();
    const result=await p.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,heading:document.querySelector('h1')?.textContent,fields:document.querySelectorAll('input,select,textarea').length}));
    report.auth.push({route,...result});
    if(result.width>width)await p.screenshot({path:`artifacts/audit-auth-${route}-${width}.png`});
   }
  }
  await p.addScriptTag({content:harness});
  await p.evaluate(async()=>{
   await S.sampleData();const a=await S.signIn('doctor@example.test','DemoPass123!');const db=await D.read();
   await S.verify(a.codeId,db.codes.find(c=>c.id===a.codeId).code);const next=await D.read();const m=next.memberships.find(m=>m.role==='Doctor');await S.chooseMembership(m.id,m.branchIds[0]);
  });
  for(const route of ['dashboard','patients','patients/new','profile']){
   await p.goto('http://localhost:4173/#/'+route);await p.locator('.emr-main h1').first().waitFor();
   report.reflow.push({route,...await p.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}))});
  }
  await p.setViewportSize({width:1440,height:1000});
  await p.addScriptTag({content:harness});
  await p.evaluate(async()=>{
   const db=await D.readRoot(),source=db.records.find(r=>r.kind==='patient');
   for(let i=0;i<1999;i++)db.records.push({...structuredClone(source),id:crypto.randomUUID(),data:{...source.data,name:'Load Test Patient '+i}});
   await D.write(db);
  });
  const start=performance.now();
  await p.goto('http://localhost:4173/#/patients');
  await p.waitForFunction(()=>document.querySelectorAll('.table-wrap tbody tr').length===2000);
  const renderMs=Math.round(performance.now()-start);
  const nodes=await p.evaluate(()=>document.querySelectorAll('*').length);
  const searchStart=performance.now();
  await p.getByPlaceholder('Search saved records…').fill('Load Test Patient 1998');
  await p.waitForFunction(()=>document.querySelectorAll('.table-wrap tbody tr').length===1);
  const filterMs=Math.round(performance.now()-searchStart);
  report.searchPrivacy=await p.evaluate(async()=>{const query=localStorage.getItem('filter-patients');await S.signOut();return {storedUnencrypted:!!query,retainedAfterSignOut:localStorage.getItem('filter-patients')===query};});
  report.performance.push({scenario:'2000 fictional patients, local Chrome, warm application, no network or CPU throttling',renderMs,filterMs,domNodesBeforeFilter:nodes,renderedRows:2000});
 }catch(e){report.fatal=String(e);process.exitCode=1;}
 finally{fs.writeFileSync('artifacts/frontend-limits.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await b.close();}
})();
