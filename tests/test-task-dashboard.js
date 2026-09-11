// Task Management → Dashboard was a design never wired to data: every number
// a literal 0, time filters inert, while the Manager Overview showed 7/1186.
// It must now count the real ticks and delegated tasks, per period, move with
// the time filter, redraw when a sync brings work in, and delegated tasks must
// reach the Sheet. Paths default to the Linux sandbox; override with
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
  const pushed = {};
  await page.route('**/exec**', route => {
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json', body:JSON.stringify({ok:true,stamps:{},version:'2026-09-08-1'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-09-08-1'})}); }
    if (p.action === 'saveBatch') Object.keys(p.modules||{}).forEach(sh => { pushed[sh] = p.modules[sh]; });
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-09-08-1'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    const t = kbdcToday(), day = n => kbdcTdAddDays(t, n), iso = (d, h) => d + 'T' + (h || '10') + ':00:00.000Z';
    Object.keys(localStorage).filter(k => k.indexOf('kbdc_tasks_') === 0 || k.indexOf('kbdc_role_emp_') === 0).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      { id:'EM1', name:'Saloni Shrivastava', designation:'Receptionist', pin:'1234', active:true, empStatus:'Active' },
      { id:'EM2', name:'Madhuri', designation:'House Keeping', pin:'2345', active:true, empStatus:'Active' }]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
    localStorage.setItem('kbdc_tasks_RCP', JSON.stringify([
      { code:'RCP1', en:'Open reception', freq:'Daily' }, { code:'RCP2', en:'Check appointments', freq:'Daily' },
      { code:'RCP3', en:'Weekly report', freq:'Weekly' }, { code:'RCP4', en:'Renew licences', freq:'Yearly' }]));
    localStorage.setItem('kbdc_tasks_HSK', JSON.stringify([{ code:'HSK1', en:'Clean operatory', freq:'Daily' }]));
    const L = (id, role, who, code, date) => ({ id, roleCode:role, staffName:who, taskCode:code, taskEn:code, frequency:'Daily', date, time:'10:00' });
    localStorage.setItem('kbdc_task_log', JSON.stringify([
      L('l1','RCP','Saloni Shrivastava','RCP1',t), L('l2','RCP','Saloni Shrivastava','RCP3',t), L('l3','HSK','—','HSK1',t),
      L('l4','RCP','Saloni Shrivastava','RCP1',day(-1)), L('l5','RCP','Saloni Shrivastava','RCP2',day(-1))]));
    const D = (id, title, who, due, status, completedAt) => ({ id, title, assignees:[who], dueDate:due, dueTime:'', status,
      createdAt:iso(day(-5)), updatedAt:iso(day(-1)), completedAt:completedAt || '' });
    localStorage.setItem('kbdc_tasks', JSON.stringify([
      D('d1','Call lab about crown','Saloni Shrivastava',day(-1),'Done',iso(day(-1))),
      D('d2','File insurance claims','Saloni Shrivastava',day(-3),'Done',iso(t)),
      D('d3','Deep clean store','Madhuri',day(-1),'Pending'),
      D('d4','Confirm tomorrow list','Saloni Shrivastava',t,'In Progress')]));
  });
  await page.reload(); await page.waitForTimeout(1200);
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);

  // The numbers themselves.
  const today = await page.evaluate(() => kbdcTaskDashData('Today'));
  const sal = today.rows.find(r => r.name === 'Saloni Shrivastava') || {}, mad = today.rows.find(r => r.name === 'Madhuri') || {};
  ok(sal.expected === 4, 'Saloni today: 2 daily + 1 weekly + 1 yearly role task expected (' + sal.expected + ')');
  ok(sal.roleDone === 2 && sal.ip === 1 && sal.total === 5 && sal.score === 40, 'she did 2, has 1 delegated in progress: 2 of 5, 40% (' + [sal.roleDone, sal.ip, sal.total, sal.score] + ')');
  ok(mad.roleDone === 1 && mad.score === 100, 'Madhuri’s unnamed "—" tick counts for her as the role holder (' + mad.score + '%)');
  ok(today.totals.completed === 3 && today.totals.ip === 1 && today.totals.pending === 2, 'clinic today: 3 completed, 1 in progress, 2 pending (' + [today.totals.completed, today.totals.ip, today.totals.pending] + ')');
  const yest = await page.evaluate(() => kbdcTaskDashData('Yesterday'));
  const salY = yest.rows.find(r => r.name === 'Saloni Shrivastava') || {}, madY = yest.rows.find(r => r.name === 'Madhuri') || {};
  ok(salY.completed === 3 && salY.inTime === 3, 'Saloni yesterday: 2 role tasks + 1 delegated finished in time (' + salY.completed + '/' + salY.inTime + ')');
  ok(madY.overdue === 1 && yest.totals.overdue === 1, 'Madhuri’s delegated task due yesterday is overdue');
  const allTime = await page.evaluate(() => kbdcTaskDashData('All Time'));
  ok(allTime.totals.delayed === 1, 'the claims task finished after its due date counts as delayed');
  ok(await page.evaluate(() => kbdcTaskPeriodKey('Yearly', new Date()).charAt(0) === 'Y'), '"Yearly" tasks are yearly now, not daily');

  // On screen.
  await page.locator('.nav', { hasText:'TASK MANAGEMENT' }).first().click(); await page.waitForTimeout(900);
  const box = k => page.locator('#td-stats [data-k="' + k + '"]').innerText().catch(()=> '');
  ok(await box('Completed') === '3' && await box('In Progress') === '1', 'the Dashboard boxes show today’s real numbers, not 0');
  ok(/40%/.test(await page.locator('#td-emp tr[data-name="Saloni Shrivastava"]').innerText().catch(()=> '')), 'and Saloni’s row shows 40%');
  await page.locator('button.tf', { hasText:/^Yesterday$/ }).click(); await page.waitForTimeout(300);
  ok(await box('Overdue') === '1' && await box('Completed') === '3', 'switching to Yesterday changes the numbers');
  await page.locator('button.tf', { hasText:/^Today$/ }).click(); await page.waitForTimeout(300);
  await page.locator('button.stab', { hasText:/^Delegated$/ }).click(); await page.waitForTimeout(300);
  ok(/Confirm tomorrow list/.test(await page.locator('#td-deleg').innerText().catch(()=> '')), 'the Delegated sub-tab lists today’s delegated task');
  await page.locator('button.stab', { hasText:/^Overdue$/ }).click(); await page.waitForTimeout(300);
  ok(/Deep clean store/.test(await page.locator('#td-overdue').innerText().catch(()=> '')), 'the Overdue sub-tab lists the late task');
  await page.locator('button.stab', { hasText:/^Employees$/ }).click(); await page.waitForTimeout(300);

  // Live: a tick arrives through a sync while the screen is open.
  await page.evaluate(() => {
    const log = JSON.parse(localStorage.getItem('kbdc_task_log'));
    log.push({ id:'l9', roleCode:'RCP', staffName:'Saloni Shrivastava', taskCode:'RCP2', date:kbdcToday(), time:'11:00' });
    localStorage.setItem('kbdc_task_log', JSON.stringify(log));
    window.dispatchEvent(new Event('kbdc-tasks-sync'));
  });
  await page.waitForTimeout(400);
  ok(await box('Completed') === '4', 'a tick arriving by sync moves the Completed box without a click');

  // Delegated tasks: finishing stamps the time; they reach the Sheet.
  const nx = await page.evaluate(() => { const a = kbdcDelegatedNext({ status:'Pending' }), b = kbdcDelegatedNext(a); return [a.status, a.completedAt, b.status, !!b.completedAt]; });
  ok(nx[0] === 'In Progress' && nx[1] === '' && nx[2] === 'Done' && nx[3], 'moving a delegated task to Done records when it was finished');
  await page.evaluate(() => kbdcAutoSyncMain()); await page.waitForTimeout(3500);
  const dt = pushed.DelegatedTasks || [];
  ok(dt.length === 4 && dt.some(r => r.id === 'd4'), 'delegated tasks are sent to the Sheet’s DelegatedTasks tab (' + dt.length + ')');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
