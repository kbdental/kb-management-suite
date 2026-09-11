// Instruments Phase 3: reports and QR labels. The reports must add up (value,
// spend inside the date range only, retirements and life, sterilisation
// failure rate); printing labels must produce one QR per item pointing back at
// the app; and opening the app from a scanned label must land on that item.
// Paths default to the Linux sandbox; override with PW_MODULE / PW_CHROME /
// KB_VENDOR to run elsewhere. Needs qrcode-generator in the vendor folder:
//   cd tests/vendor && npm install qrcode-generator@1.4.4
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
  const QR = fs.readFileSync(V + '/qrcode-generator/qrcode.js','utf8');
  const pass=[], failed=[];
  function ok(c,l){ (c?pass:failed).push(l); console.log((c?'  PASS ':'  FAIL ')+l); }

  const page = await (await browser.newContext({ viewport:{width:1400,height:1000}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));
  // Registered after the catch-all, so it wins for the QR library itself.
  await page.route('**/qrcode-generator/**', r=>r.fulfill({body:QR,contentType:'application/javascript'}));
  await page.route('**/exec**', route => route.fulfill({contentType:'application/json',
    body:JSON.stringify({ok:true,stamps:{},data:{},saved:{},version:'2026-09-08-1'})}));

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/MAIN/exec'); kbdcSetInvBackendUrl('https://script.google.com/macros/s/INV/exec');
    const t = kbdcToday(), day = n => kbdcInsAddDays(t, n), u = new Date().toISOString();
    const A = (o) => Object.assign({ status:'In use', condition:'Good', updatedAt:u }, o);
    localStorage.setItem('kbdc_ins_assets', JSON.stringify([
      A({ id:'eq1', tag:'EQP-0001', kind:'Equipment', name:'Autoclave', cat:'Autoclave / Sterilisation', location:'CSSD / Sterilisation', price:350000 }),
      A({ id:'a1',  tag:'INS-0001', kind:'Instrument', name:'Mouth mirror', cat:'Diagnostic', location:'Operatory 1', price:250 }),
      A({ id:'a2',  tag:'INS-0002', kind:'Instrument', name:'Airotor handpiece', cat:'Handpiece', location:'Operatory 1', price:14500 }),
      A({ id:'a3',  tag:'INS-0003', kind:'Instrument', name:'Forceps', cat:'Surgical / Extraction', location:'Operatory 2', price:1800, status:'Missing' }),
      A({ id:'a4',  tag:'INS-0004', kind:'Instrument', name:'Old scaler tip', cat:'Periodontic', location:'Store', price:900, status:'Retired', purchaseDate:day(-1096) }),
      A({ id:'a5',  tag:'INS-0005', kind:'Instrument', name:'Tweezer', cat:'Diagnostic', location:'Operatory 1', price:'' })]));
    localStorage.setItem('kbdc_ins_sets', JSON.stringify([{ id:'st1', tag:'SET-001', name:'Examination Set 1', status:'Active', loose:[], updatedAt:u }]));
    const Lg = (o) => Object.assign({ id:'l' + Math.random(), updatedAt:u, by:'Admin', detail:'' }, o);
    localStorage.setItem('kbdc_ins_log', JSON.stringify([
      Lg({ assetId:'eq1', tag:'EQP-0001', name:'Autoclave', event:'Serviced', cost:2000, date:day(-3) }),
      Lg({ assetId:'a2', tag:'INS-0002', name:'Airotor handpiece', event:'Repaired', cost:1500, date:day(-60) }),
      Lg({ assetId:'eq1', tag:'EQP-0001', name:'Autoclave', event:'Serviced', cost:500, date:day(-400) }),
      Lg({ assetId:'a3', tag:'INS-0003', name:'Forceps', event:'Reported missing', date:day(-2) }),
      Lg({ assetId:'a4', tag:'INS-0004', name:'Old scaler tip', event:'Retired', date:day(-1), detail:'worn out' })]));
    const L = (o) => Object.assign({ autoclaveId:'eq1', autoclaveTag:'EQP-0001', autoclaveName:'Autoclave', updatedAt:u, items:[] }, o);
    localStorage.setItem('kbdc_ins_loads', JSON.stringify([
      L({ id:'d1', tag:'L-0001', date:day(-10), time:'09:00', cycle:'134°C Wrapped (standard)', chem:'Pass', bi:'Pass', result:'Released', items:[{type:'set',id:'st1',tag:'SET-001',name:'Examination Set 1'}] }),
      L({ id:'d2', tag:'L-0002', date:day(-5), time:'09:00', cycle:'134°C Wrapped (standard)', chem:'Pass', bi:'Fail', result:'Failed', failReason:'biological indicator' }),
      L({ id:'d3', tag:'L-0003', date:day(-1), time:'09:00', cycle:'134°C Wrapped (standard)', chem:'Pass', bi:'Not done', result:'Released' }),
      L({ id:'d4', tag:'L-0004', date:day(-1), time:'08:00', cycle:'Bowie-Dick test', bowieDick:'Pass', result:'Test passed' }),
      L({ id:'d5', tag:'L-0005', date:day(-1), time:'10:00', cycle:'134°C Wrapped (standard)', chem:'Pass', result:'Void', voidReason:'mistake' })]));
    localStorage.removeItem('kbdc_ins_settings');
  });
  await page.reload(); await page.waitForTimeout(1200);
  async function login() {
    if (!(await page.locator('text=Admin Override').count())) return;
    await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
    await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
    await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);
  }
  await login();
  await page.locator('.nav', { hasText:'INSTRUMENTS & EQUIPMENT' }).first().click(); await page.waitForTimeout(800);

  // Reports: the numbers themselves, then what is on screen.
  const rep = await page.evaluate(() => kbdcInsReports(kbdcInsReadAll(), kbdcInsAddDays(kbdcToday(), -365), kbdcToday()));
  ok(rep.totalValue === 350000 + 250 + 14500 + 1800, 'value counts every item still in the register, not the retired one (' + rep.totalValue + ')');
  ok(rep.unpriced === 1, 'and says how many have no price (' + rep.unpriced + ')');
  ok(rep.spendTotal === 3500, 'spend counts only the dates in range: 2000 + 1500, not the 500 from 400 days ago (' + rep.spendTotal + ')');
  ok(rep.spendByItem[0] && rep.spendByItem[0].tag === 'EQP-0001' && rep.spendByItem[0].total === 2000, 'the autoclave tops the spend list');
  ok(rep.retired.length === 1 && rep.retired[0].years === 3, 'one retirement, three years in service (' + JSON.stringify(rep.retired[0] && rep.retired[0].years) + ')');
  ok(rep.missingNow === 1 && rep.missingValue === 1800, 'one item missing now, worth ₹1,800');
  ok(rep.ster.loads === 3 && rep.ster.failed === 1 && rep.ster.failRate === 33.3, 'sterilisation: 3 loads (void excluded), 1 failed, 33.3% (' + rep.ster.loads + '/' + rep.ster.failed + '/' + rep.ster.failRate + ')');
  ok(rep.ster.tests === 1 && rep.ster.biTested === 2 && rep.ster.biFailed === 1, 'machine tests and BI counted apart');

  await page.click('#ins-tab-rep'); await page.waitForTimeout(400);
  // Five, not four: the missing forceps is still on the register.
  ok(/₹3,66,550 across 5 items in the register/.test(await page.locator('#ins-rep-value').innerText()), 'the Reports tab shows the register value');
  ok(/₹3,500 in the period/.test(await page.locator('#ins-rep-spend').innerText()), 'and the spend for the period');
  ok(/1 failed \(33\.3%\)/.test(await page.locator('#ins-rep-ster').innerText()), 'and the sterilisation failure rate');
  await page.fill('#ins-rep-from', await page.evaluate(() => kbdcInsAddDays(kbdcToday(), -30))); await page.waitForTimeout(300);
  ok(/₹2,000 in the period/.test(await page.locator('#ins-rep-spend').innerText()), 'narrowing the dates narrows the spend');

  // Labels: capture what the print window receives.
  await page.evaluate(() => {
    window.__printed = ''; window.__printCalled = false;
    window.open = function(){
      const doc = { h:'', open(){ this.h=''; }, write(s){ this.h += s; }, close(){ window.__printed = this.h; } };
      return { document:doc, focus(){}, print(){ window.__printCalled = true; }, close(){} };
    };
  });
  await page.click('#ins-tab-reg'); await page.waitForTimeout(300);
  await page.click('#ins-labels'); await page.waitForTimeout(300);
  await page.click('#ins-labels-print'); await page.waitForTimeout(1500);
  const html = await page.evaluate(() => window.__printed);
  const svgs = (html.match(/<svg/g) || []).length;
  ok(svgs === 5, 'one QR code per item in the register list (' + svgs + ')');
  ok(/INS-0002/.test(html) && /Airotor handpiece/.test(html), 'each label carries the tag and name');
  ok(await page.evaluate(() => window.__printCalled), 'and the print dialog is opened');
  const url = await page.evaluate(() => kbdcInsItemUrl('INS-0002'));
  ok(/index\.html#ins=INS-0002$/.test(url), 'the QR points at this app, opened at the item (' + url.slice(-30) + ')');

  // Scanning: a phone opens the item's address as a fresh page. Going there
  // straight from the app would only change the hash, not load anything.
  await page.goto('about:blank');
  await page.goto('file://' + APP + '#ins=INS-0002'); await page.waitForTimeout(1500);
  await login(); await page.waitForTimeout(800);
  const body = await page.locator('body').innerText();
  ok(/INS-0002 · Airotor handpiece/.test(body), 'a scanned label opens straight onto that item');
  ok(await page.evaluate(() => window.location.hash === ''), 'and clears the address, so a reload does not reopen it');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
