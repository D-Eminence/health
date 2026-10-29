const {test,expect}=require('@playwright/test');
const esbuild=require('esbuild');
const harness=esbuild.buildSync({stdin:{contents:"import * as S from './src/service';import * as D from './src/storage';import * as N from './src/navigation';import * as C from './src/catalog';import * as M from './src/model';import * as U from './src/updates';Object.assign(globalThis,{S,D,N,C,M,U});",resolveDir:process.cwd()},bundle:true,write:false}).outputFiles[0].text;
async function login(page,role='Hospital Owner') {
  await page.goto('/#/signin'); await page.addScriptTag({content:harness});
  await page.evaluate(async role=>{
    await S.sampleData(); const auth=await S.signIn(role.toLowerCase().replaceAll(' ','-')+'@example.test','DemoPass123!');
    const db=await D.read(); await S.verify(auth.codeId,db.codes.find(c=>c.id===auth.codeId).code);
    const member=(await D.read()).memberships.find(m=>m.role===role); await S.chooseMembership(member.id,member.branchIds[0]);
  },role);
}
test('96 role/provider combinations intersect permissions and preserve separate merged-child gates',async({page})=>{
  await login(page);
  const checked=await page.evaluate(async()=>{
    const db=await D.read(),{m,h}=S.context(db);
    const providers=['Hospital','Clinic','Maternity home','Diagnostic lab','Pharmacy','Specialist centre']; let count=0;
    for(const role of M.roles) for(const provider of providers){
      m.role=role; h.verification="verified"; h.registrationProfile={facilityType:provider};
      const nav=N.navigation(db), ids=nav.flatMap(i=>i.children?i.children.map(c=>c.id):[i.id]);
      for(const mod of C.allModules) {
        if(S.can(db,mod.id)!==ids.includes(mod.id)) throw Error(role+'/'+provider+'/'+mod.id);
        if(S.can(db,mod.id)&&!C.permissions(role).includes(mod.id+'.view')) throw Error('Unexpected grant');
      }
      if(provider!=='Hospital'&&ids.some(id=>['wards','ward-config','ambulance','icu'].includes(id))) throw Error('Invalid provider capability');
      if(ids.includes('subscription')!==['Hospital Owner','Hospital Admin','Billing Officer'].includes(role)) throw Error('Subscription leak');
      if(new Set(nav.map(i=>i.icon)).size!==nav.length) throw Error('Repeated navigation icon');
      count++;
    }
    m.role='Hospital Owner';h.registrationProfile={facilityType:'Hospital'};
    m.deniedPermissions=['inventory.view'];
    const supply=N.navigation(db).find(i=>i.id==='supply');
    if(supply.children.map(c=>c.id).join()!=='procurement') throw Error('Child denial ignored');
    m.deniedPermissions.push('procurement.view');
    if(N.navigation(db).some(i=>i.id==='supply')) throw Error('Empty parent visible');
    h.registrationProfile={facilityType:'Pharmacy'};m.extraPermissions=['wards.view'];
    if(S.can(db,'wards')) throw Error('Extra permission bypasses capability');
    return count;
  }); expect(checked).toBe(96);
});
test('merged routes, scoped shortcuts, account menu and responsive dashboard remain usable',async({page})=>{
  await login(page); await page.goto('/#/dashboard');
  await expect(page.locator('.module-grid')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Supply',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Supply',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Procurement',exact:true}).click();
  await expect(page).toHaveURL(/#\/procurement$/);
  await page.goto('/#/policies');
  await expect(page.getByRole('navigation',{name:'Insurance & Claims',exact:true})).toBeVisible();
  await page.goto('/#/dashboard');
  for(const width of [1440,820,390,320]){
    await page.setViewportSize({width,height:900});
    await expect(page.getByRole('heading',{name:/Welcome,/})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`artifacts/redesign-owner-${width}.png`,fullPage:true});
  }
});
test('search is ephemeral and patient lists render bounded pages without losing records',async({page})=>{
  await login(page,'Records Officer');
  await page.evaluate(async()=>{const db=await D.read();const r=S.records(db,'patients')[0]; for(let n=0;n<120;n++)db.records.push({...structuredClone(r),id:crypto.randomUUID(),data:{...r.data,name:'Patient '+n}});await D.write(db);localStorage.setItem('filter-patients','Legacy private search');});
  await page.goto('/#/patients');
  await expect(page.locator('tbody tr')).toHaveCount(50);
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(page.getByText('Page 2 of 3',{exact:true})).toBeVisible();
  await page.getByLabel('Search Patients',{exact:true}).fill('Patient 119');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.addScriptTag({content:harness});await page.evaluate(()=>S.signOut());
  expect(await page.evaluate(()=>localStorage.getItem('filter-patients'))).toBeNull();
});
test('refresh safety rejects unsaved edits and encrypted pending work',async({page})=>{
  await login(page,'Records Officer');
  expect(await page.evaluate(()=>U.updateSafe())).toBe(true);
  await page.evaluate(()=>{const el=document.createElement('div');el.dataset.editable='';el.dataset.dirty='true';el.id='test-unsaved';document.body.append(el);});
  expect(await page.evaluate(()=>U.updateSafe())).toBe(false);
  await page.evaluate(()=>document.getElementById('test-unsaved').remove());
  await page.evaluate(async()=>{const db=await D.read();await S.createRecord('patients',{name:'Pending patient',dob:'2000-01-01',sex:'Male',phone:'08000000022',healthId:'DEMO-PENDING'},'',crypto.randomUUID());});
  expect(await page.evaluate(()=>U.updateSafe())).toBe(false);
});
