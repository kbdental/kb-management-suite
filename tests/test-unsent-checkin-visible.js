// Five days of "only N employees showing". Every fix so far addressed a real
// cause, and the reports kept coming, because the one thing nobody could see
// was which phone was holding a check-in. The person who tapped Check In saw
// "Present" on their own screen. The owner saw "Absent". Nothing anywhere said
// the row had not been sent, so there was no way to know which phone to go and
// prod — or even that a phone was the problem at all.
//
// The device that holds an unsent check-in must say so, by name, to the person
// standing in front of it.
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

  let accept = false, saved = [];
  const page = await (await browser.newContext({ viewport:{width:1400,height:1050}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));
  await page.route('**/exec**', route => {
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json',
      body:JSON.stringify({ok:true,stamps:{},version:'2026-08-19-2'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]);
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-08-19-2'})}); }
    if (p.action === 'saveBatch') {
      if (!accept) {   // the Sheet is refusing — exactly a stuck phone
        return route.fulfill({contentType:'application/json',
          body:JSON.stringify({ok:false,error:'Service invoked too many times'})});
      }
      ((p.modules||{}).Attendance||[]).forEach(r => saved.push(r.staffName));
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-08-19-2'})});
    }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,version:'2026-08-19-2'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    kbdcSetAttBackendUrl('');
    localStorage.removeItem('kbdc_sync_status');
    localStorage.removeItem('kbdc_att_confirmed');
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      {id:'EM2',name:'Madhuri',designation:'House Keeping',active:true,empStatus:'Active'},
      {id:'EM7',name:'Vishal Tiwari',designation:'Administration',active:true,empStatus:'Active'}]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
    localStorage.setItem('kbdc_la_attendance', JSON.stringify([{ id:'att_md', staffId:'EM2',
      staffName:'Madhuri', date:kbdcToday(), checkIn:'08:59', checkOut:null,
      branch:'Main Branch', updatedAt:new Date().toISOString() }]));
  });

  // The push fails, as it has been doing on somebody's phone all week.
  await page.evaluate(() => kbdcAutoSyncMain());
  await page.waitForTimeout(6000);

  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(700);
  await page.click('text=LEAVE & ATTENDANCE').catch(()=>{}); await page.waitForTimeout(1600);

  let body = await page.locator('body').innerText();
  console.log('  unsent notice shown:', /has not reached the Google Sheet/.test(body));
  ok(/has not reached the Google Sheet/.test(body),
     'the phone says plainly that a check-in has not reached the Sheet');
  ok(/Madhuri/.test(body), 'and names whose it is, so the right phone can be found');
  ok(/Send it now/.test(body), 'with a button to send it, rather than only a reload');

  // Now the Sheet accepts. The warning must clear itself.
  accept = true;
  await page.getByRole('button', { name: /Send it now/ }).first().click({force:true}).catch(()=>{});
  await page.waitForTimeout(7000);
  body = await page.locator('body').innerText();
  console.log('  rows the Sheet accepted:', JSON.stringify(saved));
  ok(saved.indexOf('Madhuri') >= 0, 'the button actually gets the check-in to the Sheet');
  ok(!/has not reached the Google Sheet/.test(body),
     'and the warning clears once the Sheet has acknowledged it');

  const confirmed = await page.evaluate(() => Object.keys(kbdcAttConfirmed()));
  console.log('  acknowledged ids:', JSON.stringify(confirmed));
  ok(confirmed.indexOf('att_md') >= 0, 'the acknowledgement is remembered, not re-asked every cycle');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
