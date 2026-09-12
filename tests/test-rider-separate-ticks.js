// "There are 2 riders, and if 1 completes his task the other rider's task gets
// done automatically." A role held by two people shares one task list, and
// done was stored on that list. Each rider must see only his own ticks, and
// un-ticking must never remove the other rider's. Paths default to the Linux
// sandbox; override with PW_MODULE / PW_CHROME / KB_VENDOR to run elsewhere.
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
  await page.route('**/exec**', route => {
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json', body:JSON.stringify({ok:true,stamps:{},version:'2026-09-08-1'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-09-08-1'})}); }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-09-08-1'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    Object.keys(localStorage).filter(k => k.indexOf('kbdc_role_emp_') === 0).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('kbdc_task_log', '[]');
    localStorage.setItem('kbdc_tasks_RDR', JSON.stringify([
      { code:'RDR1', en:'Collect lab cases', freq:'Daily', done:false },
      { code:'RDR2', en:'Deliver crowns', freq:'Daily', done:false }]));
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      { id:'EM1', name:'Aaquib Arshad', designation:'Rider', pin:'1111', active:true, empStatus:'Active' },
      { id:'EM2', name:'Vishal Kanojia', designation:'Rider', pin:'2222', active:true, empStatus:'Active' }]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
  });
  await page.reload(); await page.waitForTimeout(1200);
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);

  // Open the Rider card as one of the two riders (the owner is not asked for a PIN).
  async function openAs(name) {
    await page.goto('about:blank'); await page.goto('file://' + APP); await page.waitForTimeout(1200);
    await page.locator('.nav', { hasText:'TASK MANAGEMENT' }).first().click(); await page.waitForTimeout(700);
    await page.getByText('My Tasks', { exact:true }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(700);
    await page.locator('.rc-av', { hasText:/^RDR$/ }).first().click({ timeout:8000 }); await page.waitForTimeout(500);
    await page.getByText(name, { exact:true }).first().click({ timeout:8000 }); await page.waitForTimeout(900);
  }
  const done = () => page.$$eval('.task-row', rows => rows.map(r => !!r.querySelector('.task-circle.done')));
  const tick = async i => { await page.locator('.task-row').nth(i).click({force:true}); await page.waitForTimeout(700); };

  await openAs('Aaquib Arshad');
  ok((await done()).length === 2, 'Aaquib sees the two rider tasks');
  await tick(0);
  ok(JSON.stringify(await done()) === '[true,false]', 'Aaquib ticks "Collect lab cases"');

  await openAs('Vishal Kanojia');
  const v = await done();
  console.log('  Vishal sees:', JSON.stringify(v));
  ok(JSON.stringify(v) === '[false,false]', 'Vishal’s list is NOT ticked by Aaquib’s work');
  await tick(1);
  ok(JSON.stringify(await done()) === '[false,true]', 'Vishal ticks his own "Deliver crowns"');

  await openAs('Aaquib Arshad');
  ok(JSON.stringify(await done()) === '[true,false]', 'Aaquib still sees only his own tick');

  // Aaquib un-ticks: only his record goes.
  await tick(0);
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_task_log') || '[]'));
  console.log('  log now:', JSON.stringify(log.map(r => r.staffName + '/' + r.taskCode)));
  ok(log.length === 1 && log[0].staffName === 'Vishal Kanojia' && log[0].taskCode === 'RDR2', 'un-ticking removes Aaquib’s own tick and leaves Vishal’s');
  ok(JSON.stringify(await done()) === '[false,false]', 'Aaquib’s list is clear again');
  const shared = await page.evaluate(() => getRoleTasks('RDR').map(t => !!t.done));
  ok(JSON.stringify(shared) === '[false,true]', 'the role-level flag still says someone did "Deliver crowns"');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
