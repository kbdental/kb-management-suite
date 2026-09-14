// "Fix the untick coming back after sync." Un-ticking deleted the tick on the
// device only; the sync merges and never deletes, so the next pull brought it
// straight back from the Sheet. It is now kept as a timestamped tombstone that
// wins the merge. Paths default to the Linux sandbox; override with
// PW_MODULE / PW_CHROME / KB_VENDOR to run elsewhere.
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

  const page = await (await browser.newContext({ viewport:{width:1450,height:1050}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));
  // The Sheet still holds the original tick, exactly as it was first uploaded.
  let sheetTick = null, pushedLog = [];
  await page.route('**/exec**', route => {
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json', body:JSON.stringify({ok:true,stamps:{},version:'2026-09-08-1'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]); if (sheetTick) dt.TaskCompletions = [sheetTick];
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-09-08-1'})}); }
    if (p.action === 'saveBatch' && (p.modules||{}).TaskCompletions) pushedLog = p.modules.TaskCompletions;
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-09-08-1'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  const today = await page.evaluate(() => kbdcToday());
  sheetTick = { id:'tlSHEET1', roleCode:'RCP', staffName:'Saloni Shrivastava', taskCode:'RCP1', taskEn:'Open reception', taskHi:'',
                frequency:'Daily', date:today, time:'09:00' };
  await page.evaluate((tick) => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    Object.keys(localStorage).filter(k => k.indexOf('kbdc_role_emp_') === 0).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('kbdc_task_log', JSON.stringify([tick]));
    localStorage.setItem('kbdc_tasks_RCP', JSON.stringify([{ code:'RCP1', en:'Open reception', freq:'Daily', done:true, doneAt:new Date().toISOString() },
                                                          { code:'RCP2', en:'Check appointments', freq:'Daily', done:false }]));
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      { id:'EM1', name:'Saloni Shrivastava', designation:'Receptionist', pin:'1234', active:true, empStatus:'Active' }]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
  }, sheetTick);
  await page.reload(); await page.waitForTimeout(1200);
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);
  await page.locator('.nav', { hasText:'TASK MANAGEMENT' }).first().click(); await page.waitForTimeout(700);
  await page.getByText('My Tasks', { exact:true }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(700);
  await page.locator('.rc-av', { hasText:/^RCP$/ }).first().click({ timeout:8000 }); await page.waitForTimeout(900);
  const done = () => page.$$eval('.task-row', rows => rows.map(r => !!r.querySelector('.task-circle.done')));

  ok(JSON.stringify(await done()) === '[true,false]', 'the tick from the Sheet shows as done');
  await page.locator('.task-row').nth(0).click({force:true}); await page.waitForTimeout(700);
  ok(JSON.stringify(await done()) === '[false,false]', 'un-ticking clears it');

  // The next sync: the Sheet still returns the original tick.
  await page.evaluate(() => kbdcAutoSyncMain()); await page.waitForTimeout(3500);
  const after = await done();
  console.log('  after the sync:', JSON.stringify(after));
  ok(JSON.stringify(after) === '[false,false]', 'the un-tick survives a sync that still carries the old tick');
  ok(await page.evaluate(() => kbdcLog().length) === 0, 'and nothing counts it any more');
  const sent = pushedLog.find(r => r.id === 'tlSHEET1');
  ok(sent && (sent.removed === true || sent.removed === 'true') && !!sent.updatedAt, 'the removal goes to the Sheet, timestamped, so other phones drop it too');

  // Another phone that had the original tick picks the removal up.
  sheetTick = Object.assign({}, sent);
  await page.evaluate((tick) => { const l = [Object.assign({}, tick, { removed:'', updatedAt:'' })]; localStorage.setItem('kbdc_task_log', JSON.stringify(l)); }, sheetTick);
  await page.evaluate(() => kbdcAutoSyncMain()); await page.waitForTimeout(3500);
  ok(await page.evaluate(() => kbdcLog().length) === 0, 'a device still holding the old tick drops it when the removal arrives');

  // Ticking again works and counts.
  await page.goto('about:blank'); await page.goto('file://' + APP); await page.waitForTimeout(1200);
  await page.locator('.nav', { hasText:'TASK MANAGEMENT' }).first().click(); await page.waitForTimeout(700);
  await page.getByText('My Tasks', { exact:true }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(700);
  await page.locator('.rc-av', { hasText:/^RCP$/ }).first().click({ timeout:8000 }); await page.waitForTimeout(900);
  await page.locator('.task-row').nth(0).click({force:true}); await page.waitForTimeout(700);
  ok(JSON.stringify(await done()) === '[true,false]' && await page.evaluate(() => kbdcLog().length) === 1, 'ticking it again works and counts once');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
