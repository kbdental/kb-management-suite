// Bulk Edit and the master "Asset Register" tab (2026-09-18). The owner wants
// to change many items at once as things change, and a separate Google Sheet
// that always shows the current register for inspections. Paths default to
// the Linux sandbox; override with PW_MODULE / PW_CHROME / KB_VENDOR.
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const browser = await chromium.launch({ executablePath:CHROME });
  const R  = fs.readFileSync(V + '/react/umd/react.production.min.js','utf8');
  const RD = fs.readFileSync(V + '/react-dom/umd/react-dom.production.min.js','utf8');
  const B  = fs.readFileSync(V + '/@babel/standalone/babel.min.js','utf8');
  const pass=[], failed=[];
  function ok(c,l){ (c?pass:failed).push(l); console.log((c?'  PASS ':'  FAIL ')+l); }

  const page = await (await browser.newContext({ viewport:{width:1500,height:1000}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));
  const inv = {}, invReads = [];
  await page.route('**/exec**', route => {
    const which = route.request().url().indexOf('/INV/') >= 0 ? 'INV' : 'MAIN';
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json', body:JSON.stringify({ok:true,stamps:{},version:'2026-09-08-1'})});
    if (p.action === 'getBatch') {
      if (which === 'INV') invReads.push.apply(invReads, p.sheets || []);
      const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      // Even if something ever asked, the master tab must not be merged into the app.
      if (which === 'INV') dt['Asset Register'] = [{ Tag:'X', Item:'from the Sheet', id:'zzz' }];
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-09-03-1'})}); }
    if (p.action === 'saveBatch' && which === 'INV') Object.keys(p.modules||{}).forEach(sh => { inv[sh] = p.modules[sh]; });
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-09-08-1'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/MAIN/exec'); kbdcSetInvBackendUrl('https://script.google.com/macros/s/INV/exec');
    const u = '2026-09-01T10:00:00.000Z', A = o => Object.assign({ status:'In use', condition:'Good', updatedAt:u, kind:'Equipment' }, o);
    localStorage.setItem('kbdc_ins_assets', JSON.stringify([
      A({ id:'a1', tag:'KBDC/DE/DC-01', name:'Chamundi Dental Chair', cat:'Dental Chair', brand:'Confident', location:'Clinic 1' }),
      A({ id:'a2', tag:'KBDC/DE/AC-08', name:'Front Loading Autoclave -Enclave', cat:'Autoclave / Sterilisation', brand:'Runyes', location:'Sterilization Zone' }),
      A({ id:'a3', tag:'KBDC/ME/GM-01', name:'Glucometer', cat:'Medical Equipment', brand:'Dr. Morepen', location:'' })]));
    localStorage.setItem('kbdc_ins_settings', JSON.stringify([{ id:'locations', list:['Clinic 1','Clinic 2','Sterilization Zone','Reception'], updatedAt:u }]));
    ['kbdc_ins_log','kbdc_ins_sets','kbdc_ins_loads'].forEach(k => localStorage.removeItem(k));
    localStorage.removeItem('undefined');
  });
  await page.reload(); await page.waitForTimeout(1200);
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);
  await page.locator('.nav', { hasText:'INSTRUMENTS & EQUIPMENT' }).first().click(); await page.waitForTimeout(800);
  await page.click('#ins-tab-bulk'); await page.waitForTimeout(400);

  const row = t => page.locator('#bulk-table tr[data-tag="' + t + '"]');
  ok(await page.locator('#bulk-table tbody tr').count() === 3, 'Bulk Edit lists every item');
  // One-off edits in the grid.
  await row('KBDC/DE/AC-08').locator('input[data-f="price"]').fill('350000');
  await row('KBDC/DE/AC-08').locator('input[data-f="serviceMonths"]').fill('6');
  await row('KBDC/DE/AC-08').locator('input[data-f="lastService"]').fill('2026-06-01');
  ok(/1 item changed/.test(await page.locator('#bulk-count').innerText()), 'the change count shows what is waiting to be saved');
  // Set one field for several ticked rows.
  await row('KBDC/DE/DC-01').locator('input[type="checkbox"]').check();
  await row('KBDC/ME/GM-01').locator('input[type="checkbox"]').check();
  await page.selectOption('#bulk-field', 'location');
  await page.selectOption('#bulk-value', 'Clinic 2');
  await page.click('#bulk-apply'); await page.waitForTimeout(200);
  ok(/3 items changed/.test(await page.locator('#bulk-count').innerText()), '“Apply to ticked” sets the field on each ticked row');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_assets')).map(a => a.location));
  ok(JSON.stringify(before) === '["Clinic 1","Sterilization Zone",""]', 'nothing is saved before Save is pressed');
  await page.click('#bulk-save'); await page.waitForTimeout(600);

  const a = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_assets')));
  const by = t => a.find(x => x.tag === t) || {};
  ok(by('KBDC/DE/DC-01').location === 'Clinic 2' && by('KBDC/ME/GM-01').location === 'Clinic 2', 'Save moves both ticked items to Clinic 2');
  ok(by('KBDC/DE/AC-08').price === 350000 && by('KBDC/DE/AC-08').nextService === '2026-12-01', 'the autoclave’s price is saved and its next service worked out (' + by('KBDC/DE/AC-08').nextService + ')');
  ok(a.every(x => x.updatedAt > '2026-09-01T10:00:00.000Z'), 'each changed item is stamped, so the change travels to the Sheet');
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_log') || '[]'));
  ok(log.length === 3 && log.every(r => /^Bulk edit:/.test(r.detail)) && log.some(r => /Location → Clinic 2/.test(r.detail)), 'each item’s history says what the bulk edit changed');

  // The master register tab.
  await page.evaluate(() => kbdcAutoSyncInventory()); await page.waitForTimeout(3000);
  const m = inv['Asset Register'] || [];
  console.log('  Asset Register columns:', JSON.stringify(Object.keys(m[0] || {})));
  ok(m.length === 3, 'the Asset Register tab gets one row per item (' + m.length + ')');
  ok(JSON.stringify(Object.keys(m[0] || {}).slice(0, 4)) === '["Tag","Item","Type","Category"]' && Object.keys(m[0] || {}).pop() === 'id', 'with fixed, readable columns in a fixed order, ending with the record id');
  const mc = m.find(r => r.Tag === 'KBDC/DE/AC-08') || {};
  ok(String(mc['Price (₹)']) === '350000' && mc['Next Service'] === '2026-12-01' && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(mc['Last Updated']), 'showing the edits and when they were made');
  ok(invReads.indexOf('Asset Register') < 0, 'the app never reads that tab back');
  ok(await page.evaluate(() => localStorage.getItem('undefined')) === null, 'and nothing from it lands on the device');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
