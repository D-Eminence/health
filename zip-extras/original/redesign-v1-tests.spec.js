const {test,expect} = require('@playwright/test');
async function signIn(page) {
  await page.goto('/');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('main h1')).toBeVisible();
}
async function role(page,label) {
  await page.getByTitle('Switch role').click();
  await page.locator('.hid-dropdown button').filter({hasText:label}).first().click();
  await expect(page.locator('main h1')).toBeVisible();
}
test('all 15 roles and 22 reachable modules render without runtime errors', async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await signIn(page);
  const roles=await page.evaluate(()=>ROLES.map(r=>r.label));const visited=new Set();
  for(const label of roles){
    await role(page,label);
    const names=await page.locator('.waya-sidebar nav button').evaluateAll(es=>es.map(e=>e.title));
    if(label==='Hospital Owner')expect(names).not.toContain('Patients');
    for(const name of names){if(visited.has(name))continue;visited.add(name);
      await page.locator('.waya-sidebar nav').getByRole('button',{name,exact:true}).click();
      await expect(page.locator('main')).not.toBeEmpty();
      await page.setViewportSize({width:390,height:844});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.setViewportSize({width:1440,height:1000});
    }
  }
  expect(roles).toHaveLength(15);expect(visited.size).toBe(22);expect(errors).toEqual([]);
});
test('patient filtering, empty results, duplicate warning and registration simulation',async({page})=>{
  await signIn(page);
  await page.locator('.waya-sidebar nav').getByRole('button',{name:'Patients',exact:true}).click();
  const input=page.locator('main input');await input.fill('Ngozi');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await input.fill('no-such-patient');await expect(page.getByText('No patients found')).toBeVisible();
  await page.getByRole('button',{name:'Register patient',exact:true}).click();
  await page.getByPlaceholder('First and last name').fill('Ngozi');
  await expect(page.getByText('Possible duplicate found')).toBeVisible();
  await page.getByPlaceholder('First and last name').fill('Preview Patient');
  await page.getByRole('button',{name:'Register & assign Health ID'}).click();
  await expect(page.getByRole('heading',{name:'Preview Patient registered'})).toBeVisible();
});
test('global search opens consultation and saves a note in the original demo flow',async({page})=>{
  await signIn(page);await page.getByRole('textbox',{name:'Search patients',exact:true}).fill('Ngozi');
  await page.locator('.hid-dropdown button').filter({hasText:'Ngozi Bello'}).click();
  await page.getByPlaceholder('History, examination, findings').fill('Local preview workflow check.');
  await page.getByPlaceholder('e.g. Iron-deficiency anaemia in pregnancy').fill('Preview assessment');
  await page.getByRole('button',{name:'Save consultation'}).click();
  await expect(page.getByRole('button',{name:'Back to dashboard'})).toBeVisible();
  await page.getByRole('button',{name:'Back to dashboard'}).click();
  await expect(page.locator('main h1')).toContainText('Good morning');
});
test('sidebar collapse, branch selection, Escape and sign out',async({page})=>{
  await signIn(page);await page.getByRole('button',{name:'Collapse sidebar'}).click();
  await expect(page.locator('.waya-sidebar')).toHaveCSS('width','60px');
  await page.getByRole('button',{name:'Expand sidebar'}).click();
  await page.getByRole('button',{name:'Hospital — Main',exact:true}).click();
  await page.locator('.hid-dropdown button').filter({hasText:'GRA Annex'}).click();
  await expect(page.locator('.workspace-context')).toContainText('GRA Annex');
  await page.getByTitle('Switch role').click();await page.keyboard.press('Escape');
  await expect(page.locator('.hid-dropdown')).toHaveCount(0);
  await page.getByRole('button',{name:'Account menu'}).click();await page.getByRole('button',{name:'Sign out'}).click();
  await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
});
test('phone navigation and role menu remain usable at 390px and 320px',async({page})=>{
  await page.setViewportSize({width:390,height:844});await signIn(page);
  await expect(page.locator('.waya-sidebar')).toBeHidden();
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.locator('.emr-sheet-scrim').getByRole('button',{name:'Laboratory',exact:true}).click();
  await expect(page.locator('main h1')).toHaveText('Laboratory');
  await role(page,'Hospital Owner');
  await page.setViewportSize({width:320,height:740});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button',{name:'More',exact:true}).click();
  await expect(page.locator('.emr-sheet-scrim').getByRole('button',{name:'Billing & Revenue',exact:true})).toBeVisible();
});
