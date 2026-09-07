// The owner's two screenshots together: the Attendance Sheet holds today's six
// check-ins written by app 2026-09-05-4, the dashboard shows exactly those six
// — and the status line reads "main Sheet read 17m ago · Attendance Sheet read
// 17m ago" with a red Backup issue. Both backends frozen at the same instant.
//
// fetch has no timeout of its own. A phone that loses signal mid-request, or an
// Apps Script call that is never returned, leaves the promise pending for ever.
// With the re-entrancy guards added to the sync cycles that is fatal: the guard
// stays raised, every later cycle returns on its first line, and the device
// stops syncing while still looking normal — until someone reloads. That is
// "it worked for two days and then stopped".
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

  const page = await (await browser.newContext({ viewport:{width:1280,height:900}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));

  // The first request is answered by nobody, ever — a phone that walked out of
  // range mid-call. Later requests are healthy.
  let hang = true, calls = 0, saved = 0;
  await page.route('**/exec**', async route => {
    calls++;
    if (hang) return;                       // never fulfilled, never aborted
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json',
      body:JSON.stringify({ok:true,stamps:{},version:'2026-08-19-2'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-08-19-2'})}); }
    if (p.action === 'saveBatch') { saved++;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-08-19-2'})}); }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,version:'2026-08-19-2'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(700);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    localStorage.removeItem('kbdc_sync_status');
    // A short timeout so the test does not sit here for 45 seconds.
    KBDC_REQ_TIMEOUT_MS = 3000;
    localStorage.setItem('kbdc_la_attendance', JSON.stringify([{ id:'attX', staffId:'EM2',
      staffName:'Madhuri', date:kbdcToday(), checkIn:'08:59', checkOut:null,
      branch:'Main Branch', updatedAt:new Date().toISOString() }]));
  });

  // Cycle one walks into the hang.
  page.evaluate(() => kbdcAutoSyncMain()).catch(()=>{});
  await page.waitForTimeout(1500);
  const stuck = await page.evaluate(() => kbdcSyncMainRunning);
  console.log('  during the hung request — sync marked running:', stuck);
  ok(stuck === true, 'the cycle is genuinely in flight, so the guard is raised');

  // Every attempt in the cycle has to time out in turn before the cycle can
  // end, so poll rather than guess at a total.
  let released = true, waited = 0;
  while (waited < 120000) {
    await page.waitForTimeout(2000); waited += 2000;
    released = await page.evaluate(() => kbdcSyncMainRunning);
    if (!released) break;
  }
  console.log('  guard released after', Math.round(waited/1000) + 's');
  const st = await page.evaluate(() => kbdcGetSyncStatus());
  console.log('  after the timeout — still running:', released, '| err:', JSON.stringify((st.err||'').slice(0,70)));
  ok(released === false, 'the guard is released instead of staying raised for ever');
  ok(/did not answer|giving up/.test(st.err || ''),
     'and the device says the Sheet did not answer, rather than looking healthy');

  // The clinic's connection comes back. The very next cycle must work.
  hang = false;
  const before = saved;
  await page.evaluate(() => kbdcAutoSyncMain());
  await page.waitForTimeout(8000);
  const st2 = await page.evaluate(() => kbdcGetSyncStatus());
  console.log('  next cycle — pushes:', saved - before, '| err:', JSON.stringify(st2.err || ''));
  ok(saved > before, 'the next cycle actually runs and uploads (' + (saved - before) + ' pushes)');
  ok(!st2.err, 'and the device recovers on its own, with no reload');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
