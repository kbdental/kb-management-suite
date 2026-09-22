// After the 2026-09-18 asset load the Inventory Sheet stayed overloaded for
// days (1 in 6 requests answered 404, some taking 60 s). Every failed read made
// each phone re-upload EVERY inventory tab; every upload bumped each tab's
// revision; every phone then downloaded everything again. And each phone sent
// a colleague's change straight back. This checks the phone now only sends
// what it changed, never echoes, sends the Asset Register only after its own
// change, and that a 404 from a busy Sheet is not called a wrong address.
// Paths default to the Linux sandbox; override with PW_MODULE / PW_CHROME /
// KB_VENDOR to run elsewhere.
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

  const page = await (await browser.newContext({ viewport:{width:1400,height:1000}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));
  // The Inventory backend.
  let readsFail = false, remoteReg = null;
  const sent = [];     // one entry per saveBatch: the tab names it carried
  await page.route('**/exec**', route => {
    const req = route.request(), inv = req.url().indexOf('/INV/') >= 0;
    if (req.method() === 'GET') return route.fulfill({ contentType:'application/json',
      body:JSON.stringify({ ok:true, message:'K.B. Dental backend is running. Send a POST request from the app.', version:'2026-09-03-1' }) });
    let p={}; try{ p=JSON.parse(req.postData()||'{}'); }catch(e){}
    if (!inv) return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,stamps:{},data:{},saved:{},version:'2026-09-08-1'})});
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json', body:JSON.stringify({ok:true,stamps:{},version:'2026-09-03-1'})});
    if (p.action === 'getBatch') {
      if (readsFail) return route.fulfill({ status:404, contentType:'text/html', body:'<!DOCTYPE html><html><body>Sorry, unable to open the file at this time.</body></html>' });
      const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      if (remoteReg) dt.InstrumentRegister = remoteReg;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-09-03-1'})});
    }
    if (p.action === 'saveBatch') sent.push(Object.keys(p.modules || {}));
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-09-03-1'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/MAIN/exec'); kbdcSetInvBackendUrl('https://script.google.com/macros/s/INV/exec');
    const u = '2026-09-18T08:00:00.000Z', A = (id, tag, name) => ({ id, tag, name, kind:'Equipment', cat:'Dental Chair', location:'Clinic 1', status:'In use', condition:'Good', updatedAt:u });
    localStorage.setItem('kbdc_ins_assets', JSON.stringify([A('a1','KBDC/DE/DC-01','Chamundi Dental Chair'), A('a2','KBDC/DE/DC-02','Enova Pad Plus Dental Chair')]));
    localStorage.setItem('kbdc_ins_log', JSON.stringify([{ id:'l1', assetId:'a1', tag:'KBDC/DE/DC-01', name:'Chamundi Dental Chair', event:'Added', date:'2026-09-18', updatedAt:u }]));
    localStorage.setItem('kbdc_ins_settings', JSON.stringify([{ id:'locations', list:['Clinic 1','Clinic 2'], updatedAt:u }]));
    localStorage.setItem('kbdc_inv_items', JSON.stringify([{ name:'Gloves', cat:'PPE', stock:10, updatedAt:u }]));
    ['kbdc_ins_sets','kbdc_ins_loads','kbdc_ins_master_dirty','kbdc_push_sigs'].forEach(k => localStorage.removeItem(k));
  });
  await page.reload(); await page.waitForTimeout(3000);
  const cycle = async () => { const n = sent.length; await page.evaluate(() => kbdcAutoSyncInventory()); await page.waitForTimeout(1500); return sent.slice(n).reduce((a, b) => a.concat(b), []); };

  // A first good sync sends what the Sheet does not have yet.
  await cycle();
  // 1. Reads fail, nothing changed here: send nothing, cycle after cycle.
  readsFail = true;
  const f1 = await cycle(), f2 = await cycle(), f3 = await cycle();
  console.log('  sent during 3 failed reads:', JSON.stringify([f1, f2, f3]));
  ok(f1.length + f2.length + f3.length === 0, 'a failed read does not make the phone re-upload every tab');
  const err = await page.evaluate(() => (kbdcGetSyncStatus() || {}).invErr || '');
  console.log('  message:', JSON.stringify(err.slice(0, 140)));
  ok(/busy/i.test(err) && !/URL is wrong/.test(err), 'a 404 from a busy Sheet is reported as busy, not as a wrong address');

  // 2. Reads still failing, one real change here: send only that tab (plus the master, since this phone changed it).
  await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('kbdc_ins_assets'));
    a[0].location = 'Clinic 2'; a[0].updatedAt = new Date().toISOString();
    localStorage.setItem('kbdc_ins_assets', JSON.stringify(a));
    kbdcInsSetMasterDirty(true);
  });
  const f4 = await cycle();
  console.log('  sent after one local change:', JSON.stringify(f4));
  ok(f4.indexOf('InstrumentRegister') >= 0 && f4.indexOf('Asset Register') >= 0, 'the changed register (and the master copy) is sent');
  ok(f4.indexOf('InventoryItems') < 0 && f4.indexOf('InstrumentLog') < 0 && f4.indexOf('InstrumentSettings') < 0, 'and nothing it did not change');
  ok(await page.evaluate(() => kbdcInsMasterDirty()) === false, 'the master copy is marked as sent');
  ok((await cycle()).length === 0, 'the next failed read sends nothing again');

  // 3. A colleague's change arrives: it is not sent back, and the master is not re-sent.
  readsFail = false;
  const mine = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_assets')));
  remoteReg = mine.map(r => Object.assign({}, r)).concat([{ id:'a3', tag:'KBDC/DE/DC-49', name:'Dental Chair - Foldable', kind:'Equipment',
    cat:'Dental Chair', location:'Stock Room', status:'In use', condition:'Good', updatedAt:new Date().toISOString() }]);
  const e1 = await cycle();
  const nowHas = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_assets')).length);
  console.log('  sent after pulling a colleague’s change:', JSON.stringify(e1), '· items here now:', nowHas);
  ok(nowHas === 3, 'the colleague’s new item arrives on this phone');
  ok(e1.indexOf('InstrumentRegister') < 0, 'and is not uploaded straight back (no echo)');
  ok(e1.indexOf('Asset Register') < 0, 'and the master copy is not re-sent by a phone that only received the change');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
