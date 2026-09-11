// Staff tick tasks; the Sheet's TaskCompletions tab has stood at 39 rows since
// 13 August, and the manager's Overview reads 0% for everyone. Follow one tick
// from the button to the Sheet and find where it stops.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = __dirname + '/vendor/node_modules';

(async () => {
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
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
  const pushedLog = [];
  await page.route('**/exec**', route => {
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json',
      body:JSON.stringify({ok:true,stamps:{},version:'2026-09-08-1'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-09-08-1'})}); }
    if (p.action === 'saveBatch') {
      ((p.modules||{}).TaskCompletions||[]).forEach(r => pushedLog.push(r.staffName + '/' + r.taskCode));
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-09-08-1'})}); }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,version:'2026-09-08-1'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    localStorage.removeItem('kbdc_sync_status');
    localStorage.setItem('kbdc_task_log','[]');
    // Role cards check a real PIN since 2026-09-11 (any four digits used to work).
    localStorage.setItem('kbdc_role_pins', JSON.stringify({ RCP:'1234' }));
    localStorage.setItem('kbdc_tasks_RCP', JSON.stringify([
      { code:'RCP1', en:'Open reception', hi:'', freq:'Daily', done:false },
      { code:'RCP2', en:'Check appointments', hi:'', freq:'Daily', done:false },
    ]));
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      {id:'EM1',name:'Saloni Shrivastava',designation:'Receptionist',pin:'1234',active:true,empStatus:'Active'}]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
  });
  await page.reload(); await page.waitForTimeout(1200);

  // Sign in as the staff member, which is what they actually do.
  await page.locator('select').first().selectOption({ label: 'Saloni Shrivastava' }).catch(()=>{});
  await page.waitForTimeout(1200);
  console.log('  after choosing her name:', JSON.stringify(
    (await page.locator('body').innerText()).replace(/\s+/g,' ').slice(0, 260)));
  for (const digit of ['1','2','3','4']) {
    await page.getByRole('button', { name: digit, exact: true }).first().click({force:true}).catch(()=>{});
    await page.waitForTimeout(250);
  }
  await page.getByRole('button', { name: /Login/ }).first().click({force:true}).catch(()=>{});
  await page.waitForTimeout(2000);
  console.log('  after PIN:', JSON.stringify(
    (await page.locator('body').innerText()).replace(/\s+/g,' ').slice(0, 200)));
  await page.click('text=TASK MANAGEMENT').catch(()=>{}); await page.waitForTimeout(1200);
  await page.getByText('My Tasks', { exact: true }).first().click({force:true}).catch(()=>{});
  await page.waitForTimeout(1200);
  await page.getByText('Receptionist', { exact: false }).first().click({force:true}).catch(()=>{});
  await page.waitForTimeout(900);
  for (const digit of ['1','2','3','4']) {
    await page.getByText(digit, { exact: true }).first().click({force:true}).catch(()=>{});
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1500);

  console.log('  SCREEN:', JSON.stringify((await page.locator('body').innerText()).replace(/\s+/g,' ').slice(0, 500)));
  const body = await page.locator('body').innerText();
  const onList = /Open reception/.test(body);
  console.log('  task list reached:', onList);
  ok(onList, 'the role’s task list is on screen');

  // Tick the first task.
  // A task is a .task-row div, not a checkbox.
  const boxes = page.locator('.task-row');
  const nb = await boxes.count();
  console.log('  task rows on screen:', nb);
  if (nb) { await boxes.first().scrollIntoViewIfNeeded().catch(()=>{});
            await boxes.first().click({force:true}).catch(()=>{}); }
  await page.waitForTimeout(2500);

  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_task_log')||'[]'));
  console.log('  rows written to the completion log:', JSON.stringify(
    log.map(r => r.roleCode + '/' + r.taskCode + ' by ' + JSON.stringify(r.staffName) + ' on ' + r.date)));
  ok(log.length >= 1, 'ticking a task writes a row to the completion log');
  ok(log[0] && log[0].date === (await page.evaluate(() => kbdcToday())),
     'and it is dated today, so today’s dashboard counts it');
  ok(log[0] && String(log[0].staffName || '').trim() !== '',
     'and it records WHO did it (' + JSON.stringify(log[0] && log[0].staffName) + ')');

  await page.evaluate(() => kbdcAutoSyncMain());
  await page.waitForTimeout(7000);
  console.log('  pushed to the Sheet:', JSON.stringify(pushedLog));
  ok(pushedLog.length >= 1, 'and it reaches the Google Sheet');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
