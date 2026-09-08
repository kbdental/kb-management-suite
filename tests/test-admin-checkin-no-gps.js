// The owner cannot wait for a staff member's phone to recover — he needs to be
// able to mark today's attendance himself, from the laptop that is known to
// sync. But the dashboard's own check-in did everything inside
// laFetchLocation().then(...), so it saved nothing at all until the browser
// answered for a location. On a laptop indoors, or with permission never
// granted, that answer may never come: he clicks, nothing happens, and there
// is no way to correct an attendance record. Same fault fixed on the staff
// side weeks ago, still sitting here.
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

  const ctx = await browser.newContext({ viewport:{width:1400,height:1050}, timezoneId:'Asia/Kolkata' });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  // Location that never answers — the owner's laptop, indoors.
  await page.addInitScript(`{ navigator.geolocation = {
    getCurrentPosition:function(){}, watchPosition:function(){return 0;}, clearWatch:function(){} }; }`);
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));
  await page.route('**/nominatim.openstreetmap.org/**', r=>r.abort('failed'));
  const pushed = [];
  await page.route('**/exec**', route => {
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json',
      body:JSON.stringify({ok:true,stamps:{},version:'2026-08-19-2'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-08-19-2'})}); }
    if (p.action === 'saveBatch') { ((p.modules||{}).Attendance||[]).forEach(r => pushed.push(r.staffName + '@' + r.checkIn));
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-08-19-2'})}); }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,version:'2026-08-19-2'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    kbdcSetAttBackendUrl('');
    localStorage.removeItem('kbdc_sync_status');
    localStorage.setItem('kbdc_la_attendance','[]');
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      {id:'EM2',name:'Madhuri',designation:'House Keeping',active:true,empStatus:'Active'}]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
    // The dashboard only offers Clock In once a mood is recorded for the day.
    localStorage.setItem('kbdc_la_moods', JSON.stringify([{ id:'M1', staffName:'Madhuri',
      mood:'good', emoji:'\u{1F642}', label:'Good', note:'',
      date:new Date().toISOString(), branch:'Main Branch' }]));
  });

  await page.reload(); await page.waitForTimeout(1200);   // load with the staff list in place

  // Mark Madhuri present from the dashboard, exactly as the owner would.
  const called = await page.evaluate(() => {
    if (typeof kbdcAdmClockInProbe === 'function') return 'probe';
    return 'ui';
  });
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(700);
  await page.click('text=LEAVE & ATTENDANCE').catch(()=>{}); await page.waitForTimeout(1500);
  // The staff table with the admin Clock In buttons is the Attendance tab of
  // Leave & Attendance, not the staff-facing check-in panel.
  await page.getByText('Attendance', { exact: false }).nth(1).click({force:true}).catch(()=>{});
  await page.waitForTimeout(1500);
  let seen = await page.getByRole('button', { name: /Clock In/i }).count();
  if (!seen) {
    for (const label of ['⏱️ Attendance', 'Attendance']) {
      await page.getByText(label, { exact: true }).first().click({force:true}).catch(()=>{});
      await page.waitForTimeout(1200);
      seen = await page.getByRole('button', { name: /Clock In/i }).count();
      if (seen) break;
    }
  }

  // The admin-side check-in buttons sit on the staff rows.
  // The staff table with Clock In sits behind the Admin View toggle.
  await page.getByRole('button', { name: /Admin View/i }).first().click({force:true}).catch(()=>{});
  await page.waitForTimeout(800);
  // It asks for the admin password before showing the staff table.
  for (const pw of ['kbdc@admin', '1234']) {
    const box = page.locator('input[type="password"]').first();
    if (await box.count()) { await box.fill(pw).catch(()=>{}); }
    await page.getByRole('button', { name: /^Unlock$/i }).first().click({force:true}).catch(()=>{});
    await page.waitForTimeout(1200);
    if (await page.getByRole('button', { name: /Clock In/i }).count()) break;
  }
  const btn = page.getByRole('button', { name: /Clock In/i });
  const n = await btn.count();
  console.log('  admin Check In buttons on screen:', n, '| entry path:', called);
  console.log('  buttons present:', JSON.stringify(
    (await page.locator('button').allInnerTexts()).map(t=>t.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,18)));
  console.log('  Madhuri on screen:', (await page.locator('body').innerText()).indexOf('Madhuri') >= 0);
  if (n) { await btn.first().scrollIntoViewIfNeeded().catch(()=>{}); await btn.first().click({force:true}).catch(()=>{}); }
  await page.waitForTimeout(3000);      // GPS is still hanging

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_la_attendance')||'[]'));
  console.log('  stored while GPS still hanging:', JSON.stringify(stored.map(a=>a.staffName+'@'+a.checkIn)));
  ok(stored.length >= 1, 'the record is saved at once, without waiting for a location');
  ok(stored[0] && /^\d\d:\d\d$/.test(stored[0].checkIn || ''), 'and it carries a real check-in time');

  await page.waitForTimeout(4000);
  console.log('  pushed to the Sheet:', JSON.stringify(pushed));
  ok(pushed.length >= 1, 'and it is uploaded rather than waiting on a location that never comes');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
