// "Attendance is not syncing on this device. Some modules did not save —
// AppData: Lock timeout: another process was holding the lock for too long."
//
// Two faults in one banner. Attendance HAD synced — eight people were on the
// dashboard. And AppData was failing because every device re-sent the whole
// blob on every cycle: each row was stamped with a fresh updatedAt whether or
// not its contents had changed, so the tab never looked settled. Ten devices
// doing that queue behind each other on the Sheet's script lock, and the loser
// reports a lock timeout. AppData sat on revision 2965; Tasks, which people
// change all day, was on 442.
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

  const page = await (await browser.newContext({ viewport:{width:1400,height:1050}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));
  let appDataPushes = 0;
  await page.route('**/exec**', route => {
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json',
      body:JSON.stringify({ok:true,stamps:{},version:'2026-08-19-2'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-08-19-2'})}); }
    if (p.action === 'saveBatch') {
      if ((p.modules||{}).AppData) appDataPushes++;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-08-19-2'})}); }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,version:'2026-08-19-2'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    kbdcSetAttBackendUrl('');
    localStorage.removeItem('kbdc_sync_status');
    localStorage.removeItem('kbdc_blob_stamps');
    localStorage.removeItem('kbdc_push_full_at');
    localStorage.setItem('kbdc_settings', JSON.stringify({ clinicName:'K.B. Dental Clinic',
      industry:'Healthcare', size:'1-10', address:'Dilshad Garden' }));
  });

  // Three cycles with nothing changed in between.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => kbdcAutoSyncMain());
    await page.waitForTimeout(4000);
  }
  console.log('  AppData pushes across three settled cycles:', appDataPushes);
  ok(appDataPushes <= 1,
     'AppData is sent once and then left alone (' + appDataPushes + ' pushes)');

  // Change a setting: it must go out again.
  const before = appDataPushes;
  await page.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('kbdc_settings'));
    o.address = 'Shahdara, Delhi';
    localStorage.setItem('kbdc_settings', JSON.stringify(o));
  });
  await page.evaluate(() => kbdcAutoSyncMain());
  await page.waitForTimeout(4000);
  console.log('  pushes after editing a setting:', appDataPushes - before);
  ok(appDataPushes > before, 'a real change still reaches the Sheet');

  // The banner must not blame attendance for another tab's failure.
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(700);
  await page.click('text=LEAVE & ATTENDANCE').catch(()=>{}); await page.waitForTimeout(1600);
  await page.evaluate(() => { kbdcSetSyncStatus({ err:
    'Some modules did not save \u2014 AppData: Lock timeout: another process was holding the lock for too long.' });
    window.dispatchEvent(new Event('kbdc-modules-sync')); });
  await page.waitForTimeout(1500);
  let body = await page.locator('body').innerText();
  console.log('  says attendance is fine:', /Attendance is saving normally/.test(body));
  ok(/Attendance is saving normally/.test(body),
     'the card says attendance is fine when it is another tab that failed');
  ok(!/Attendance is not syncing on this device/.test(body),
     'and no longer claims attendance failed when it did not');
  ok(/AppData/.test(body), 'while still naming the part that did fail');

  // But a genuine attendance failure must still be reported loudly.
  await page.evaluate(() => { kbdcSetSyncStatus({ err:
    'Some modules did not save \u2014 Attendance: Lock timeout' });
    window.dispatchEvent(new Event('kbdc-modules-sync')); });
  await page.waitForTimeout(1500);
  body = await page.locator('body').innerText();
  console.log('  real attendance failure still shouts:', /Attendance is not syncing on this device/.test(body));
  ok(/Attendance is not syncing on this device/.test(body),
     'a real attendance failure is still reported as one');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
