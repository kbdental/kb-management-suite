// 13 November, 1:14 pm. The owner's dashboard: "2 Present, 7 Absent", listing
// Suman at 08:52 and Sanjeeta at 09:18 — which were the 12th's check-ins, at
// the 12th's times. Three people had checked in that morning and the rows were
// on the Sheet, on the device, and in the status line directly underneath:
// "3 check-ins held on this device today".
//
// LA_TODAY was `const LA_TODAY = kbdcToday()` at module scope, evaluated once
// when the page loaded. His browser is open for days, so every panel on the
// Leave & Attendance page went on filtering attendance to the date the tab was
// opened. This is the "daily in morning everyone shows Absent" the clinic kept
// hitting, and no amount of sync work could ever have fixed it.
//
// Worse than the display: a check-in RECORDS date: LA_TODAY, so anyone
// checking in from a page opened the day before was filed under yesterday.
//
// Paths default to the Linux sandbox; override with PW_MODULE / PW_CHROME.
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const R  = fs.readFileSync(V + '/react/umd/react.production.min.js','utf8');
  const RD = fs.readFileSync(V + '/react-dom/umd/react-dom.production.min.js','utf8');
  const B  = fs.readFileSync(V + '/@babel/standalone/babel.min.js','utf8');
  const pass=[], failed=[];
  function ok(c,l){ (c?pass:failed).push(l); console.log((c?'  PASS ':'  FAIL ')+l); }

  const page = await (await browser.newContext({ viewport:{width:1450,height:1050}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror', e=>errs.push(String(e.message).slice(0,160)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));
  // No backend in this test: the rows are already on the device, which is the
  // whole point — nothing here is a sync problem.
  await page.route('**/exec**', r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,version:'2026-10-07-1'})}));

  await page.goto('file://' + APP); await page.waitForTimeout(800);

  const seeded = await page.evaluate(() => {
    localStorage.clear();
    kbdcSetBackendUrl('');
    kbdcSetAttBackendUrl('');
    const pad = n => (n<10?'0':'')+n;
    const fmt = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
    const loadDay = fmt(new Date());
    const nextDay = fmt(new Date(Date.now() + 86400000));
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      { id:'EM_SU', name:'Suman',        designation:'Dental Assistant', active:true, empStatus:'Active' },
      { id:'EM_SA', name:'Sanjeeta',     designation:'Dental Assistant', active:true, empStatus:'Active' },
      { id:'EM_SR', name:'Suman Rathor', designation:'Lead Dental Nurse', active:true, empStatus:'Active' }]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
    // Yesterday two people came in. Today, three did — including one who did
    // not come in yesterday at all.
    localStorage.setItem('kbdc_la_attendance', JSON.stringify([
      { id:'a_su_y', staffId:'EM_SU', staffName:'Suman',    date:loadDay, checkIn:'08:52', checkOut:'17:40', branch:'Main Branch', updatedAt:new Date().toISOString() },
      { id:'a_sa_y', staffId:'EM_SA', staffName:'Sanjeeta', date:loadDay, checkIn:'09:18', checkOut:'18:20', branch:'Main Branch', updatedAt:new Date().toISOString() },
      { id:'a_su_t', staffId:'EM_SU', staffName:'Suman',        date:nextDay, checkIn:'08:41', checkOut:'', branch:'Main Branch', updatedAt:new Date().toISOString() },
      { id:'a_sa_t', staffId:'EM_SA', staffName:'Sanjeeta',     date:nextDay, checkIn:'09:31', checkOut:'', branch:'Main Branch', updatedAt:new Date().toISOString() },
      { id:'a_sr_t', staffId:'EM_SR', staffName:'Suman Rathor', date:nextDay, checkIn:'09:37', checkOut:'', branch:'Main Branch', updatedAt:new Date().toISOString() }]));
    return { loadDay, nextDay };
  });
  console.log('  tab opened on ' + seeded.loadDay + ', will be left open into ' + seeded.nextDay);

  // Seeded into the running page, not across a reload: the point of the test
  // is a page that has been OPEN since the day before.
  await page.evaluate(() => {
    ['kbdc-staff-sync','kbdc-modules-sync'].forEach(e => window.dispatchEvent(new Event(e)));
  });
  await page.waitForTimeout(600);
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(800);
  await page.click('text=LEAVE & ATTENDANCE').catch(()=>{}); await page.waitForTimeout(1600);

  let body = await page.locator('body').innerText();
  ok(/08:52/.test(body) && /09:18/.test(body),
     "on the day it was opened, the page shows that day's check-ins");

  // Midnight passes. The tab is never touched — this is the owner's browser,
  // open since the day before, exactly as in the screenshot.
  await page.evaluate(() => {
    const Real = Date, shift = 86400000;
    function Shifted(...a) {
      if (!(this instanceof Shifted)) return new Real(Real.now() + shift).toString();
      return a.length ? new Real(...a) : new Real(Real.now() + shift);
    }
    Shifted.prototype = Real.prototype;
    Shifted.now = () => Real.now() + shift;
    Shifted.parse = Real.parse; Shifted.UTC = Real.UTC;
    window.Date = Shifted;
  });
  // The panels repaint on the ordinary sync events. The app must also notice
  // the rollover by itself, but a repaint is what the clinic actually sees.
  await page.evaluate(() => window.dispatchEvent(new Event('kbdc-modules-sync')));
  await page.waitForTimeout(1200);

  const appToday = await page.evaluate(() => kbdcToday());
  console.log('  after midnight the app says today is ' + appToday);
  ok(appToday === seeded.nextDay, 'the app itself has moved on to the new day');

  body = await page.locator('body').innerText();
  const panel = body.slice(0, body.indexOf('Team Leave Balance') >= 0 ? body.indexOf('Team Leave Balance') : 6000);

  ok(/08:41/.test(panel) && /09:31/.test(panel) && /09:37/.test(panel),
     "the dashboard lists the NEW day's check-ins (08:41, 09:31, 09:37)");
  ok(!/08:52/.test(panel) && !/09:18/.test(panel),
     "and no longer shows yesterday's times as if they were today's");

  // The one the owner actually noticed: a person who only checked in today.
  // Read the row itself rather than the page text, so a layout change cannot
  // turn this into a silent pass.
  const srRow = await page.evaluate(() => {
    const title = Array.from(document.querySelectorAll('.la-panel-title'))
      .find(t => /Today's Attendance/.test(t.textContent || ''));
    const panel = title && title.closest('.la-panel');
    if (!panel) return '(panel not found)';
    const line = (panel.innerText || '').split('\n')
      .map(x => x.trim()).filter(Boolean)
      .find(x => /^Suman Rathor/.test(x));
    if (!line) return '(row not found)';
    // The verdict sits on the lines just after the name.
    const all = (panel.innerText || '').split('\n').map(x => x.trim()).filter(Boolean);
    const i = all.indexOf(line);
    return all.slice(i, i + 3).join(' | ');
  });
  console.log('  Suman Rathor row: ' + srRow);
  // He arrived at 09:37, so the late rule may tag him — what matters is that
  // a person who came to work is not filed as Absent.
  ok(!/Absent/.test(srRow),
     'somebody who checked in this morning is not reported Absent (' + srRow + ')');

  // The status line and the list must agree. Them disagreeing — "3 check-ins
  // held on this device today" above a list showing 2 — was the giveaway.
  const held = (panel.match(/(\d+)\s+check-ins? held on this device today/) || [])[1];
  const presentTile = (body.match(/(\d+)\s*\n?\s*Present Today/) || [])[1];
  console.log('  status line says ' + held + ' held · Present Today tile says ' + presentTile);
  ok(held === '3', 'the status line counts the new day (' + held + ')');
  ok(presentTile === '3', 'and the Present Today tile agrees with it (' + presentTile + ')');

  // A check-in made now must be filed under the new day, not the old one.
  await page.evaluate(() => {
    const att = kbdcLsArray('kbdc_la_attendance');
    att.push({ id:'a_new', staffId:'EM_X', staffName:'Someone Else', date:laToday(),
               checkIn:'10:05', checkOut:'', branch:'Main Branch', updatedAt:new Date().toISOString() });
    localStorage.setItem('kbdc_la_attendance', JSON.stringify(att));
  });
  const filedUnder = await page.evaluate(() =>
    (kbdcLsArray('kbdc_la_attendance').find(a => a.id === 'a_new') || {}).date);
  console.log('  a check-in made now is filed under ' + filedUnder);
  ok(filedUnder === seeded.nextDay,
     'a check-in made after midnight is recorded under the new day, not yesterday');

  ok(errs.length === 0, 'no JavaScript errors (' + JSON.stringify(errs).slice(0,200) + ')');
  await browser.close();
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) { failed.forEach(f=>console.log('  FAIL: '+f)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
