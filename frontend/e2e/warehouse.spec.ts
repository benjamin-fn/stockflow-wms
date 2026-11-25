import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

const screenshots='../docs/screenshots';
const password='StockFlow!2026';
async function login(page:Page,username='admin'){
  await page.goto('/');
  await page.getByLabel('Användarnamn').fill(username);
  await page.getByLabel('Lösenord').fill(password);
  await page.getByRole('button',{name:'Logga in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Översikt'})).toBeVisible();
}
async function go(page:Page,name:string){
  await page.getByRole('navigation',{name:'Huvudnavigation'}).getByRole('link',{name,exact:true}).click();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
}
const dialog=(page:Page)=>page.getByRole('dialog');
const click=(page:Page,name:string)=>dialog(page).getByRole('button',{name,exact:true}).click();
async function confirm(page:Page,name:string){await click(page,name);await click(page,'Bekräfta')}
async function open(page:Page,name:string){await page.getByRole('button',{name,exact:true}).click();await expect(dialog(page)).toBeVisible()}

test('Swedish dashboard, register, picking and mobile screenshots',async({page})=>{
  await mkdir(screenshots,{recursive:true});
  await login(page);
  await expect(page.getByRole('heading',{name:'Lagerrörelser'})).toBeVisible();
  await expect(page.locator('.recharts-area').first()).toBeVisible();
  await page.screenshot({path:screenshots+'/oversikt.png',fullPage:true,animations:'disabled'});
  await go(page,'Artikelregister');
  await expect(page.getByText('Artikelnummer',{exact:true})).toBeAttached();
  await expect(page.getByRole('table')).toBeVisible();
  await page.screenshot({path:screenshots+'/artikelregister.png',fullPage:true,animations:'disabled'});
  await go(page,'Plocklistor');
  await open(page,'UT-3302');
  await expect(dialog(page).getByRole('cell',{name:'Plockning pågår'})).toBeVisible();
  await page.screenshot({path:screenshots+'/plocklista.png',animations:'disabled'});
  await click(page,'Stäng');
  await go(page,'Inleveranser');
  await expect(page.getByRole('table')).toBeVisible();
  await page.screenshot({path:screenshots+'/inleveranser.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Sök med streckkod'}).click();
  await dialog(page).getByLabel('Streckkod').fill('73100001001');
  await dialog(page).getByLabel('Streckkod').press('Enter');
  await expect(page.getByRole('heading',{name:'Wellåda dubbelwell'})).toBeVisible();
  await page.getByRole('button',{name:'Streckkod',exact:true}).click();
  await expect(dialog(page).getByRole('img',{name:'Streckkod 73100001001'})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Översikt'})).toBeVisible();
  await page.screenshot({path:screenshots+'/mobil.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Öppna navigering'}).click();
  await go(page,'Artikelregister');
  await expect(page.getByRole('button',{name:'Öppna navigering'})).toBeVisible();
});

test('create, receive, pick, ship and adjust through the real browser UI',async({page})=>{
  const suffix=Date.now().toString(36);
  const sku='E2E-'+suffix, name='E2E Lagerlåda '+suffix, incoming='IN-'+suffix, outgoing='UT-'+suffix;
  await login(page);
  const before=await (await page.request.get('/api/dashboard')).json();
  await go(page,'Artikelregister');
  await page.getByRole('button',{name:'Ny artikel'}).click();
  const d=dialog(page);
  await d.getByLabel('Artikelnummer').fill(sku);
  await d.getByLabel('Artikelnamn').fill(name);
  await d.getByLabel('Kategori').selectOption({index:1});
  await d.getByLabel('Leverantör').selectOption({index:1});
  await d.getByLabel('Inköpspris (SEK)').fill('19.50');
  await d.getByLabel('Minsta lagersaldo').fill('2');
  await click(page,'Spara');
  await expect(page.getByRole('status')).toContainText('Artikeln har sparats');
  await page.getByLabel('Sök i artikelregistret').fill(sku);
  const row=page.getByRole('row').filter({hasText:name});
  await expect(row).toBeVisible();
  const articlePath=await row.getByRole('link').getAttribute('href');
  const productId=Number(articlePath!.split('/').at(-1));

  await go(page,'Inleveranser');
  await page.getByRole('button',{name:'Ny inleverans'}).click();
  await d.getByLabel('Leveransreferens').fill(incoming);
  await d.getByLabel('Leverantör').selectOption({index:1});
  await d.getByRole('combobox',{name:'Artikel',exact:true}).selectOption(String(productId));
  await d.getByRole('combobox',{name:'Lagerplats',exact:true}).selectOption('1');
  await d.getByLabel('Förväntat antal').fill('10');
  await click(page,'Skapa inleverans');
  await expect(d.getByRole('heading',{name:incoming})).toBeVisible();
  await click(page,'Registrera mottagning');
  await d.getByRole('spinbutton').fill('10');
  await d.getByLabel('Slutför leveransen').check();
  await click(page,'Registrera antal');
  await expect(d.getByText('Slutförd',{exact:true})).toBeVisible();
  await click(page,'Stäng');

  await go(page,'Utleveranser');
  await page.getByRole('button',{name:'Ny utleverans'}).click();
  await d.getByLabel('Orderreferens').fill(outgoing);
  await d.getByLabel('Mottagare').fill('Exempelkund');
  await d.getByRole('combobox',{name:'Artikel',exact:true}).selectOption(String(productId));
  await d.getByLabel('Antal',{exact:true}).fill('4');
  await click(page,'Skapa utleverans');
  await expect(d.getByRole('heading',{name:outgoing})).toBeVisible();
  await confirm(page,'Reservera saldo');
  await expect(d.getByText('Reserverad',{exact:true})).toBeVisible();
  let stock=await (await page.request.get('/api'+articlePath)).json();
  expect([stock.quantity,stock.reserved,stock.available]).toEqual([10,4,6]);
  await click(page,'Stäng');

  await go(page,'Plocklistor');
  await open(page,outgoing);
  await click(page,'Registrera plock');
  await d.getByRole('spinbutton').fill('4');
  await click(page,'Spara plock');
  await expect(d.getByText('Färdigplockad',{exact:true}).first()).toBeVisible();
  await confirm(page,'Skicka order');
  await expect(d.getByText('Skickad',{exact:true})).toBeVisible();
  await click(page,'Stäng');

  await go(page,'Inventering');
  await page.getByRole('button',{name:'Ny inventering'}).click();
  await d.getByRole('combobox',{name:'Artikel',exact:true}).selectOption(String(productId));
  await click(page,'Skapa inventering');
  await expect(d.getByRole('heading',{name:/Inventering INV-/})).toBeVisible();
  await click(page,'Registrera räkning');
  await d.getByRole('spinbutton').fill('5');
  await click(page,'Spara räknat antal');
  await click(page,'Godkänn korrigering');
  await d.getByLabel('Orsak till korrigering').fill('Kontroll vid plockplats');
  await click(page,'Godkänn och uppdatera saldo');
  await expect(d.getByText('Godkänd',{exact:true})).toBeVisible();
  await click(page,'Stäng');

  await go(page,'Transaktionshistorik');
  await page.getByRole('combobox',{name:'Artikel',exact:true}).selectOption(String(productId));
  await expect(page.getByRole('cell',{name:'Kontroll vid plockplats'})).toBeVisible();
  await expect(page.getByRole('row').filter({hasText:name})).toHaveCount(3);
  stock=await (await page.request.get('/api'+articlePath)).json();
  expect([stock.quantity,stock.reserved,stock.available]).toEqual([5,0,5]);
  await go(page,'Översikt');
  await expect(page.getByRole('heading',{name:'Lagerrörelser'})).toBeVisible();
  const after=await (await page.request.get('/api/dashboard')).json();
  expect(after.articles).toBe(before.articles+1);
  expect(after.quantity).toBe(before.quantity+5);
  expect(after.incoming).toBe(before.incoming+1);
  expect(after.outgoing).toBe(before.outgoing+1);
});

for(const [username,role] of [['arbetsledare','Arbetsledare'],['lager','Lagermedarbetare']]){
  test('role permissions for '+role,async({page})=>{
    await login(page,username);
    await expect(page.getByText(role,{exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:'Användare',exact:true})).toHaveCount(0);
    expect((await page.request.get('/api/users')).status()).toBe(403);
    if(username==='lager'){
      await go(page,'Plocklistor');
      await expect(page.getByRole('button',{name:'UT-3302'})).toBeVisible();
      expect((await page.request.get('/api/reports/value')).status()).toBe(403);
      await page.goto('/reports');
      await expect(page.getByRole('alert')).toHaveText('Du har inte behörighet att visa den här sidan.');
    }else{
      await go(page,'Rapporter');
      await expect(page.getByRole('button',{name:'Exportera CSV'})).toBeEnabled();
      const download=page.waitForEvent('download');
      await page.getByRole('button',{name:'Exportera CSV'}).click();
      expect((await download).suggestedFilename()).toBe('stockflow-value.csv');
    }
    await page.getByRole('button',{name:'Användarmeny'}).click();
    await page.getByRole('button',{name:'Logga ut',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Logga in'})).toBeVisible();
  });
}
