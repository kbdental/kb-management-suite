// "The task management dashboard is not updating, I feel it is not connected."
// The Sheet was receiving ticks (1,029 TaskCompletions rows on 2026-09-11),
// but the Manager Dashboard never redrew when the background sync brought them
// in: the staff screens listened for 'kbdc-tasks-sync', the dashboard did not.
// Leave it open, let a colleague's tick arrive through a real sync, and the
// numbers must move without anyone touching the screen.
// Also: a role card with nobody assigned (DAS, ASD) saved every tick as "—";
// it must record the person signed in instead.
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

  const page = await (await browser.newContext({ viewport:{width:1450,height:1050}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));
  // The backend: once `remote` is set, the Sheet holds a tick made on someone else's phone.
  let remote = null;
  await page.route('**/exec**', route => {
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json',
      body:JSON.stringify({ok:true,stamps:{},version:'2026-09-08-1'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      if (remote) dt.TaskCompletions = [remote];
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-09-08-1'})}); }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-09-08-1'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    localStorage.setItem('kbdc_task_log','[]');
    localStorage.setItem('kbdc_tasks_RCP', JSON.stringify([
      { code:'RCP1', en:'Open reception', hi:'', freq:'Daily', done:false },
      { code:'RCP2', en:'Check appointments', hi:'', freq:'Daily', done:false }]));
    localStorage.setItem('kbdc_tasks_DAS', JSON.stringify([
      { code:'DAS1', en:'Prepare operatory', hi:'', freq:'Daily', done:false }]));
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      {id:'EM1',name:'Saloni Shrivastava',designation:'Receptionist',pin:'1234',active:true,empStatus:'Active'}]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
    Object.keys(localStorage).filter(k => k.indexOf('kbdc_role_emp_') === 0).forEach(k => localStorage.removeItem(k));
  });
  await page.reload(); await page.waitForTimeout(1200);
  async function login() {
    if (!(await page.locator('text=Admin Override').count())) return;
    await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
    await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
    await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);
  }
  async function pin() {
    for (const digit of ['1','2','3','4']) {
      await page.locator('.pin-overlay').getByText(digit, { exact:true }).first().click({force:true}).catch(()=>{});
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(700);
  }
  // The role cards sit behind Task Management → My Tasks.
  async function openRoleCards() {
    await page.locator('.nav', { hasText:'TASK MANAGEMENT' }).first().click(); await page.waitForTimeout(900);
    await page.getByText('My Tasks', { exact:true }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(900);
    if (!(await page.locator('.role-card').count()))
      console.log('  NO ROLE CARDS. Screen:', JSON.stringify((await page.locator('body').innerText()).replace(/\s+/g,' ').slice(0, 400)));
  }
  await login();
  await openRoleCards();
  await page.locator('.role-card', { hasText:'Manager Dashboard' }).first().click({ timeout:8000 }); await page.waitForTimeout(400);
  await pin();

  const kpi = () => page.locator('.mgr-kpi-num').nth(3).innerText().catch(()=> '');
  const saloniPct = () => page.locator('.mgr-staff-row', { hasText:'Saloni' }).locator('.mgr-spct').innerText().catch(()=> '');
  const before = await kpi(), beforePct = await saloniPct();
  console.log('  on opening: Completed', before, '· Saloni', beforePct);
  ok(/^0\//.test(before) && beforePct === '0%', 'the dashboard opens with nothing done yet');

  // Saloni ticks on her own phone; this device's background sync picks it up.
  remote = { id:'tlREMOTE1', roleCode:'RCP', staffName:'Saloni Shrivastava', taskCode:'RCP1', taskEn:'Open reception',
             taskHi:'', frequency:'Daily', date: await page.evaluate(() => kbdcToday()), time:'09:05' };
  await page.evaluate(() => kbdcAutoSyncMain()); await page.waitForTimeout(3500);
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_task_log')||'[]'));
  ok(log.some(r => r.id === 'tlREMOTE1'), 'the sync brings her tick onto this device');
  const after = await kpi(), afterPct = await saloniPct();
  console.log('  without touching the screen: Completed', after, '· Saloni', afterPct);
  ok(/^1\//.test(after), 'and the Completed count moves by itself (' + before + ' → ' + after + ')');
  ok(afterPct === '50%', 'and her row shows 1 of 2 done (' + beforePct + ' → ' + afterPct + ')');

  // A DAS card with nobody assigned: the tick must carry who actually did it.
  await page.goto('about:blank'); await page.goto('file://' + APP); await page.waitForTimeout(1200);
  await login();
  await openRoleCards();
  // Exactly the DAS badge: a plain "DAS" text match also hits "Manager DASHboard".
  await page.locator('.rc-av', { hasText:/^DAS$/ }).first().click({ timeout:8000 }); await page.waitForTimeout(400);
  await pin();
  console.log('  after the DAS PIN:', JSON.stringify((await page.locator('body').innerText()).replace(/\s+/g,' ').slice(0, 300)));
  await page.locator('.task-row').first().click({force:true}).catch(()=>{}); await page.waitForTimeout(800);
  const who = await page.evaluate(() => (kbdcGetSession() || {}).name || '');
  const das = (await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_task_log')||'[]'))).filter(r => r.roleCode === 'DAS');
  console.log('  DAS tick saved as:', JSON.stringify(das.map(r => r.staffName)), '· signed in as', JSON.stringify(who));
  ok(das.length === 1, 'ticking on the unassigned DAS card records a completion');
  ok(das[0] && das[0].staffName && das[0].staffName !== '—' && das[0].staffName === who, 'credited to the person signed in, not "—"');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
