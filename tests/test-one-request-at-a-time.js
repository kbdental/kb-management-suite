// The owner's connection panel, minutes after a clean backup:
//   "Could not read the Google Sheet — Failed to fetch.
//    Attendance Sheet: Failed to fetch · Inventory: Failed to fetch"
// All three at the same instant, on three separate Apps Script deployments
// that have nothing in common except the Google account behind them. The pull
// already retries three times, so this is not a blip — it is the device asking
// Google for too much at once.
//
// Nothing stopped the syncs overlapping: the scheduled cycle, a tick pushed the
// moment someone taps it, a check-in, the Inventory screen, and the Sync now /
// Re-upload buttons could all have requests in flight together. One request at
// a time, app-wide.
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

  // Every backend answers slowly, so overlapping requests are easy to spot.
  let live = 0, peak = 0, total = 0;
  await page.route('**/exec**', async route => {
    live++; total++; if (live > peak) peak = live;
    await new Promise(r => setTimeout(r, 120));
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    live--;
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json',
      body:JSON.stringify({ok:true,stamps:{},version:'2026-09-08-1'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-09-08-1'})}); }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-09-08-1'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/MAIN/exec');
    kbdcSetAttBackendUrl('https://script.google.com/macros/s/ATT/exec');
    kbdcSetInvBackendUrl('https://script.google.com/macros/s/INV/exec');
    localStorage.removeItem('kbdc_sync_status');
    localStorage.setItem('kbdc_la_attendance', JSON.stringify([{ id:'a1', staffId:'EM2',
      staffName:'Madhuri', date:kbdcToday(), checkIn:'09:00', checkOut:null,
      branch:'Main Branch', updatedAt:new Date().toISOString() }]));
  });

  // Fire all three at once — the Sync now button while a cycle is already
  // running, which is exactly what the owner did.
  await page.evaluate(() => {
    kbdcAutoSyncMain(); kbdcAutoSyncAttendance(); kbdcAutoSyncInventory();
    return null;
  });
  await page.waitForTimeout(14000);

  console.log('  requests the network saw at once — peak:', peak, '| total:', total);
  const seen = await page.evaluate(() => (typeof kbdcReqPeak === 'undefined')
    ? { peak: null, active: null }        // the queue does not exist in this build
    : { peak: kbdcReqPeak, active: kbdcReqActive });
  console.log('  the app’s own count — peak:', seen.peak, '| still active:', seen.active);
  ok(peak === 1, 'never more than one request to Google is in flight (peak ' + peak + ')');
  ok(seen.peak === 1, 'and the app agrees it queued them (peak ' + seen.peak + ')');
  ok(total > 3, 'while still doing the work — ' + total + ' requests went out');
  ok(seen.active === 0, 'and nothing is left stuck in the queue');

  // A failing request must not stop everything after it.
  await page.unroute('**/exec**');
  let after = 0, failFirst = true;
  await page.route('**/exec**', route => {
    if (failFirst) { failFirst = false; return route.abort('failed'); }   // "Failed to fetch"
    after++;
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json',
      body:JSON.stringify({ok:true,stamps:{},version:'2026-09-08-1'})});
    const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
    return route.fulfill({contentType:'application/json',
      body:JSON.stringify({ok:true,data:dt,saved:{},version:'2026-09-08-1'})});
  });
  await page.evaluate(() => kbdcAutoSyncMain());
  await page.waitForTimeout(9000);
  console.log('  requests after one was refused:', after);
  ok(after > 0, 'a refused request does not block every request after it');

  const st = await page.evaluate(() => kbdcGetSyncStatus());
  console.log('  error text:', JSON.stringify((st.err || '(none)').slice(0, 90)));
  ok(!/Failed to fetch/.test(st.err || ''),
     'and the bare browser wording is not what the owner is shown');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
