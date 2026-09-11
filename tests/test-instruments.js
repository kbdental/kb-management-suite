// Instruments & Equipment (sidebar app, 2026-09-11). An item added here must
// get its own tag per physical piece, stay on the device, raise the right
// dashboard alerts, and reach the INVENTORY Sheet — never the Management
// Sheet, which the owner has had to clean inventory tabs out of before.
// Paths default to the Linux sandbox; override with PW_MODULE / PW_CHROME /
// KB_VENDOR to run elsewhere.
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME === '' ? undefined : (process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const MAIN = 'https://script.google.com/macros/s/MAIN/exec';
const INV  = 'https://script.google.com/macros/s/INV/exec';

(async () => {
  const browser = await chromium.launch(CHROME ? { executablePath:CHROME } : {});
  const R  = fs.readFileSync(V + '/react/umd/react.production.min.js','utf8');
  const RD = fs.readFileSync(V + '/react-dom/umd/react-dom.production.min.js','utf8');
  const B  = fs.readFileSync(V + '/@babel/standalone/babel.min.js','utf8');
  const pass=[], failed=[];
  function ok(c,l){ (c?pass:failed).push(l); console.log((c?'  PASS ':'  FAIL ')+l); }

  const page = await (await browser.newContext({ viewport:{width:1400,height:1000}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));
  const saved = { MAIN:{}, INV:{} };
  await page.route('**/exec**', route => {
    const which = route.request().url().indexOf('/INV/') >= 0 ? 'INV' : 'MAIN';
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json',
      body:JSON.stringify({ok:true,stamps:{},version: which==='INV' ? '2026-09-03-1' : '2026-09-08-1'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt})}); }
    if (p.action === 'saveBatch') {
      Object.keys(p.modules||{}).forEach(sh => { saved[which][sh] = (saved[which][sh]||[]).concat(p.modules[sh]); });
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{}})}); }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(([m, i]) => {
    kbdcSetBackendUrl(m); kbdcSetInvBackendUrl(i);
    ['kbdc_ins_assets','kbdc_ins_sets','kbdc_ins_log','kbdc_ins_settings'].forEach(k => localStorage.removeItem(k));
  }, [MAIN, INV]);
  await page.reload(); await page.waitForTimeout(1200);

  // Owner / admin sign-in, as the other tests do it.
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);

  const nav = page.locator('.nav', { hasText: 'INSTRUMENTS & EQUIPMENT' });
  ok(await nav.count() === 1, 'the sidebar has an INSTRUMENTS & EQUIPMENT entry');
  await nav.first().click().catch(()=>{}); await page.waitForTimeout(900);
  ok(/Nothing registered yet/.test(await page.locator('body').innerText()), 'an empty register says so and offers a way to start');

  // Three mouth mirrors in one go: three tagged items, one per physical piece.
  await page.click('#ins-add-instrument'); await page.waitForTimeout(300);
  await page.fill('#ins-f-name', 'Mouth mirror');
  await page.fill('#ins-f-qty', '3');
  await page.selectOption('#ins-f-location', 'Operatory 1');
  await page.selectOption('#ins-f-cat', 'Diagnostic');
  await page.click('#ins-save'); await page.waitForTimeout(500);
  let assets = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_assets')||'[]'));
  ok(assets.length === 3, 'quantity 3 creates three items (' + assets.length + ')');
  ok(JSON.stringify(assets.map(a=>a.tag)) === JSON.stringify(['INS-0001','INS-0002','INS-0003']), 'tagged INS-0001..0003 (' + assets.map(a=>a.tag) + ')');
  ok(new Set(assets.map(a=>a.id)).size === 3 && assets.every(a=>a.id), 'each has its own id, so the Sheet cannot merge them into one');

  // An autoclave last serviced eight months ago on a six-month interval is overdue.
  const d = new Date(); d.setMonth(d.getMonth() - 8);
  const eightAgo = d.toISOString().slice(0,10);
  await page.click('#ins-tab-reg'); await page.waitForTimeout(300);
  await page.click('#ins-add-equipment'); await page.waitForTimeout(300);
  await page.fill('#ins-f-name', 'Autoclave');
  await page.fill('#ins-f-serviceMonths', '6');
  await page.fill('#ins-f-lastService', eightAgo);
  await page.click('#ins-save'); await page.waitForTimeout(500);
  assets = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_assets')||'[]'));
  const ac = assets.find(a => a.name === 'Autoclave');
  ok(ac && ac.tag === 'EQP-0001' && ac.kind === 'Equipment', 'equipment gets its own EQP- series (' + (ac && ac.tag) + ')');
  ok(ac && ac.nextService && ac.nextService < new Date().toISOString().slice(0,10), 'next service is worked out from the last service (' + (ac && ac.nextService) + ')');

  // Staff-side report: INS-0002 goes missing.
  await page.click('#ins-table tr:has-text("INS-0002")'); await page.waitForTimeout(300);
  await page.click('#ins-act-missing'); await page.waitForTimeout(300);
  await page.fill('#ins-act-note', 'not in Op 1 drawer');
  await page.click('#ins-act-save'); await page.waitForTimeout(500);
  assets = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_assets')||'[]'));
  ok(assets.find(a=>a.tag==='INS-0002').status === 'Missing', 'reporting missing sets the status');
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_log')||'[]'));
  ok(log.some(r => r.tag==='INS-0002' && r.event==='Reported missing' && /drawer/.test(r.detail)), 'and records it in the history with the note');
  await page.keyboard.press('Escape').catch(()=>{});
  await page.locator('button', { hasText: '✕' }).first().click().catch(()=>{}); await page.waitForTimeout(200);

  // A set holding the missing mirror is flagged as not usable.
  await page.click('#ins-tab-sets'); await page.waitForTimeout(300);
  await page.click('#ins-add-set'); await page.waitForTimeout(300);
  await page.fill('#ins-set-name', 'Examination Set 1');
  const boxes = page.locator('input[type="checkbox"]');
  for (let i = 0; i < Math.min(3, await boxes.count()); i++) await boxes.nth(i).check();
  await page.click('#ins-set-save'); await page.waitForTimeout(500);
  const sets = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_sets')||'[]'));
  assets = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_assets')||'[]'));
  ok(sets.length === 1 && sets[0].tag === 'SET-001', 'a set is created as SET-001');
  ok(assets.filter(a => a.setId === (sets[0]||{}).id).length === 3, 'the three mirrors belong to it');

  await page.click('#ins-tab-dash'); await page.waitForTimeout(300);
  const alerts = await page.locator('#ins-alerts').innerText().catch(()=> '');
  ok(/EQP-0001 Autoclave: service overdue/.test(alerts), 'dashboard: autoclave service overdue');
  ok(/INS-0002 Mouth mirror: missing/.test(alerts), 'dashboard: the missing mirror');
  ok(/SET-001 Examination Set 1: 1 item not usable \(INS-0002\)/.test(alerts), 'dashboard: the set is incomplete, naming the item');

  // Sync: to the Inventory Sheet, and nothing at all to the Management Sheet.
  await page.evaluate(() => kbdcAutoSyncInventory()); await page.waitForTimeout(2500);
  await page.evaluate(() => kbdcAutoSyncMain()); await page.waitForTimeout(3000);
  const invReg = saved.INV.InstrumentRegister || [];
  ok(invReg.length >= 4 && invReg.some(r => r.tag === 'EQP-0001'), 'the register reaches the Inventory Sheet (' + invReg.length + ' rows)');
  ok((saved.INV.InstrumentSets||[]).length >= 1 && (saved.INV.InstrumentLog||[]).length >= 1, 'sets and history go there too');
  const mainTabs = Object.keys(saved.MAIN);
  const leaked = mainTabs.filter(t => /Instrument/i.test(t) || JSON.stringify(saved.MAIN[t]).indexOf('INS-000') >= 0);
  ok(leaked.length === 0, 'nothing from instruments reaches the Management Sheet (' + (leaked.join(',') || 'clean') + ')');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
