// "The task they are completing is not showing on the dashboard or even on the
// Google Sheet." Six of eight staff checked in every day but their ticks never
// arrived (Saloni's last on 20 Aug). A tick only left the phone inside the full
// sync, which first reads the Sheet; when that read failed, the fallback sent
// everything the phone held as ONE request, too big for Apps Script, and hid
// the error. This phone cannot read the Sheet, and the backend drops large
// requests: its ticks must still arrive, and a stuck tick must be visible.
// Paths default to the Linux sandbox; override with PW_MODULE / PW_CHROME /
// KB_VENDOR to run elsewhere.
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const LIMIT = 150000;   // bytes: bigger requests are dropped, as Apps Script does

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
  let sheetDown = false, dropped = 0;
  const onSheet = {};
  await page.route('**/exec**', route => {
    const raw = route.request().postData() || '';
    let p={}; try{ p=JSON.parse(raw); }catch(e){}
    if (sheetDown) return route.abort('failed');
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json', body:JSON.stringify({ok:true,stamps:{},version:'2026-09-08-1'})});
    // This phone's reads always fail, like a weak connection timing out on the big download.
    if (p.action === 'getBatch') return route.abort('timedout');
    if (p.action === 'saveBatch') {
      if (raw.length > LIMIT) { dropped++; return route.abort('failed'); }
      ((p.modules || {}).TaskCompletions || []).forEach(r => { onSheet[r.id] = r; });
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-09-08-1'})});
    }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,version:'2026-09-08-1'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    Object.keys(localStorage).filter(k => k.indexOf('kbdc_role_emp_') === 0 || k.indexOf('kbdc_tasks_') === 0).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('kbdc_task_log', '[]');
    localStorage.removeItem('kbdc_log_sent');
    // A real-sized task list: this is what made the old one-shot upload too big.
    const big = [];
    for (let i = 1; i <= 1500; i++) big.push({ code:'RCP' + i, en:'Reception task number ' + i + ' with a realistic description of the work', hi:'रिसेप्शन कार्य ' + i, freq:'Daily', done:false });
    localStorage.setItem('kbdc_tasks_RCP', JSON.stringify(big));
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      { id:'EM1', name:'Saloni Shrivastava', designation:'Receptionist', pin:'1234', active:true, empStatus:'Active' }]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
  });
  await page.reload(); await page.waitForTimeout(1200);
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);
  await page.locator('.nav', { hasText:'TASK MANAGEMENT' }).first().click(); await page.waitForTimeout(700);
  await page.getByText('My Tasks', { exact:true }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(700);
  await page.locator('.rc-av', { hasText:/^RCP$/ }).first().click({ timeout:8000 }); await page.waitForTimeout(900);

  // Tick on a phone that cannot read the Sheet.
  await page.locator('.task-row').nth(0).click({force:true}); await page.waitForTimeout(6000);
  const mine = await page.evaluate(() => kbdcLog().map(r => r.id));
  console.log('  ticks on the phone:', mine.length, '· on the Sheet:', Object.keys(onSheet).length, '· oversized requests dropped:', dropped);
  ok(mine.length === 1, 'the tick is recorded on the phone');
  ok(mine.every(id => onSheet[id]), 'and it reaches the Sheet although this phone cannot read the Sheet');
  ok(await page.locator('#tick-unsent').count() === 0, 'nothing is shown as waiting once it arrived');

  // The Sheet is unreachable: the tick waits, visibly, and Send now delivers it.
  sheetDown = true;
  await page.locator('.task-row').nth(1).click({force:true}); await page.waitForTimeout(3000);
  await page.evaluate(() => window.dispatchEvent(new Event('kbdc-ticks-sent'))); await page.waitForTimeout(300);
  const banner = await page.locator('#tick-unsent').innerText().catch(()=> '');
  console.log('  while the Sheet is down:', JSON.stringify(banner.replace(/\s+/g,' ').slice(0, 160)));
  ok(/1 tick on this phone has not reached the Google Sheet/.test(banner), 'a tick that could not be sent is shown as waiting');
  sheetDown = false;
  await page.click('#tick-send-now'); await page.waitForTimeout(3000);
  const all = await page.evaluate(() => kbdcLog().map(r => r.id));
  ok(all.length === 2 && all.every(id => onSheet[id]), '“Send now” delivers it');
  ok(await page.locator('#tick-unsent').count() === 0, 'and the warning goes away');

  // Ticks already on the Sheet are not re-sent every cycle.
  const before = Object.keys(onSheet).length;
  const sentBefore = await page.evaluate(() => kbdcLogUnsent().length);
  ok(sentBefore === 0, 'the phone remembers which ticks the Sheet has (' + sentBefore + ' still unsent)');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
