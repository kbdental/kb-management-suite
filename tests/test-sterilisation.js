// Instruments Phase 2: sterilisation loads. A load records the cycle and its
// indicators; a failed load must put every pack in it on a recall list; packs
// past their shelf life and an autoclave whose Bowie-Dick test failed must show
// on the dashboard; a used set is no longer sterile. Loads go to the INVENTORY
// Sheet only. Paths default to the Linux sandbox; override with PW_MODULE /
// PW_CHROME / KB_VENDOR to run elsewhere.
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MAIN = 'https://script.google.com/macros/s/MAIN/exec';
const INV  = 'https://script.google.com/macros/s/INV/exec';

(async () => {
  const browser = await chromium.launch({ executablePath:CHROME });
  const R  = fs.readFileSync(V + '/react/umd/react.production.min.js','utf8');
  const RD = fs.readFileSync(V + '/react-dom/umd/react-dom.production.min.js','utf8');
  const B  = fs.readFileSync(V + '/@babel/standalone/babel.min.js','utf8');
  const pass=[], failed=[];
  function ok(c,l){ (c?pass:failed).push(l); console.log((c?'  PASS ':'  FAIL ')+l); }

  const page = await (await browser.newContext({ viewport:{width:1400,height:1000}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('All packs reprocessed in the next load') : d.accept());
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
    const t = kbdcToday(), u = new Date().toISOString();
    localStorage.setItem('kbdc_ins_assets', JSON.stringify([
      { id:'eq1', tag:'EQP-0001', kind:'Equipment', name:'Autoclave', cat:'Autoclave / Sterilisation', status:'In use', condition:'Good', updatedAt:u },
      { id:'a1', tag:'INS-0001', kind:'Instrument', name:'Mouth mirror', cat:'Diagnostic', status:'In use', condition:'Good', setId:'st1', updatedAt:u },
      { id:'a2', tag:'INS-0002', kind:'Instrument', name:'Airotor handpiece', cat:'Handpiece', status:'In use', condition:'Good', updatedAt:u }]));
    localStorage.setItem('kbdc_ins_sets', JSON.stringify([
      { id:'st1', tag:'SET-001', name:'Examination Set 1', status:'Active', loose:[], updatedAt:u },
      { id:'st2', tag:'SET-002', name:'Extraction Set 1', status:'Active', loose:[], updatedAt:u }]));
    ['kbdc_ins_log','kbdc_ins_loads','kbdc_ins_settings'].forEach(k => localStorage.removeItem(k));
  }, [MAIN, INV]);
  await page.reload(); await page.waitForTimeout(1200);
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);
  await page.locator('.nav', { hasText:'INSTRUMENTS & EQUIPMENT' }).first().click(); await page.waitForTimeout(800);

  const today = await page.evaluate(() => kbdcToday());
  const loads = () => page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_loads')||'[]'));
  const closeModal = async () => { await page.locator('button', { hasText:'✕' }).first().click().catch(()=>{}); await page.waitForTimeout(200); };
  const alerts = async () => { await page.click('#ins-tab-dash'); await page.waitForTimeout(300); return page.locator('#ins-alerts').innerText().catch(()=>''); };
  async function recordLoad(o) {
    await page.click('#ins-tab-ster'); await page.waitForTimeout(300);
    await page.click('#ins-add-load'); await page.waitForTimeout(300);
    if (o.cycle) await page.selectOption('#ins-l-cycle', o.cycle);
    if (o.date) await page.fill('#ins-l-date', o.date);
    if (o.time) await page.fill('#ins-l-time', o.time);
    if (o.chem) await page.selectOption('#ins-l-chem', o.chem);
    if (o.bi) await page.selectOption('#ins-l-bi', o.bi);
    if (o.test) await page.selectOption('#ins-l-bowieDick', o.test);
    for (const k of (o.pick || [])) await page.click('#ins-pick-' + k);
    await page.click('#ins-load-save'); await page.waitForTimeout(500);
    await closeModal();
  }

  // 1. A load with the chemical indicator passed and the BI still incubating.
  await recordLoad({ chem:'Pass', bi:'Pending', pick:['set-st1', 'asset-a2'] });
  let L = await loads();
  ok(L.length === 1 && L[0].tag === 'L-0001', 'the first load is numbered L-0001');
  ok(L[0] && L[0].autoclaveId === 'eq1', 'the only autoclave is chosen for you');
  ok(L[0] && L[0].result === 'BI pending', 'chemical pass + BI pending = "BI pending" (' + (L[0]&&L[0].result) + ')');
  ok(L[0] && JSON.stringify(L[0].items.map(i=>i.tag)) === '["SET-001","INS-0002"]', 'it records exactly what went in');
  const plus30 = await page.evaluate(() => kbdcInsAddDays(kbdcToday(), 30));
  ok(L[0] && L[0].packExpiry === plus30, 'packs are sterile for the default 30 days (' + (L[0]&&L[0].packExpiry) + ')');
  await page.click('#ins-tab-sets'); await page.waitForTimeout(300);
  ok(/Sterile until/.test(await page.locator('body').innerText()), 'the set now shows as sterile');

  // 2. The BI comes back failed: everything in that load goes on the recall list.
  await page.click('#ins-tab-ster'); await page.waitForTimeout(300);
  await page.click('#ins-loads tr:has-text("L-0001")'); await page.waitForTimeout(300);
  await page.click('#ins-bi-fail'); await page.waitForTimeout(400);
  L = await loads();
  ok(L[0].result === 'Failed' && L[0].failReason === 'biological indicator', 'a failed BI fails the load');
  await closeModal();
  let al = await alerts();
  ok(/Load L-0001 FAILED \(biological indicator\).*SET-001, INS-0002/.test(al), 'dashboard: recall SET-001 and INS-0002');
  await page.click('#ins-tab-sets'); await page.waitForTimeout(300);
  ok(/In failed load L-0001/.test(await page.locator('body').innerText()), 'the set shows it was in a failed load');

  // 3. Recall done clears the alert.
  await page.click('#ins-tab-ster'); await page.waitForTimeout(300);
  await page.click('#ins-loads tr:has-text("L-0001")'); await page.waitForTimeout(300);
  await page.click('#ins-recall'); await page.waitForTimeout(400);
  L = await loads();
  ok(L[0].recallDone === true && /reprocessed/.test(L[0].recallNote), 'recall is recorded with what was done');
  await closeModal();
  ok(!/Load L-0001 FAILED/.test(await alerts()), 'and the recall alert goes away');

  // 4. A pack sterilised 40 days ago is past its 30-day shelf life.
  const d40 = await page.evaluate(() => kbdcInsAddDays(kbdcToday(), -40));
  await recordLoad({ date:d40, chem:'Pass', pick:['set-st2'] });
  ok(/1 pack is past the sterile date.*SET-002/.test(await alerts()), 'dashboard: SET-002 is past its sterile date');

  // 5. A failed Bowie-Dick test stands until a later one passes.
  await recordLoad({ cycle:'Bowie-Dick test', time:'00:01', test:'Fail' });
  L = await loads();
  ok(L[L.length-1].result === 'Failed' && L[L.length-1].items.length === 0, 'a failed Bowie-Dick test is recorded, with no packs');
  al = await alerts();
  ok(/EQP-0001 Autoclave: Bowie-Dick test FAILED/.test(al), 'dashboard: do not use the autoclave');
  ok(/loads run today without a passed Bowie-Dick test/.test(al), 'dashboard: today’s load ran without a passed test');
  await recordLoad({ cycle:'Bowie-Dick test', time:'00:02', test:'Pass' });
  al = await alerts();
  ok(!/Bowie-Dick test FAILED/.test(al), 'a later passing test clears it');
  ok(!/without a passed Bowie-Dick test/.test(al), 'and today now has a passed test');

  // 6. A freshly sterilised set, once used, needs reprocessing.
  await recordLoad({ chem:'Pass', pick:['set-st1'] });
  await page.click('#ins-tab-sets'); await page.waitForTimeout(300);
  await page.click('#ins-used-st1'); await page.waitForTimeout(400);
  ok(/Used, needs reprocessing/.test(await page.locator('body').innerText()), '"Mark used" means the set needs reprocessing');

  // 7. Sync: the Inventory Sheet gets the loads; the Management Sheet gets nothing.
  await page.evaluate(() => kbdcAutoSyncInventory()); await page.waitForTimeout(2500);
  await page.evaluate(() => kbdcAutoSyncMain()); await page.waitForTimeout(3000);
  const inv = saved.INV.SterilisationLoads || [];
  ok(inv.some(r => r.tag === 'L-0001') && inv.some(r => r.tag === 'L-0005'), 'loads reach the Inventory Sheet (' + inv.length + ' rows sent)');
  const leaked = Object.keys(saved.MAIN).filter(t => /Sterilis|Instrument/i.test(t) || /"L-000\d"/.test(JSON.stringify(saved.MAIN[t])));
  ok(leaked.length === 0, 'nothing reaches the Management Sheet (' + (leaked.join(',') || 'clean') + ')');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
