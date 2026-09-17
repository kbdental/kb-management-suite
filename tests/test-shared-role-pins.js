// "When I am making 2 riders or 2 assistants I am not able to give separate
// PINs, the PIN is auto copying." PINs belonged to the role, so both riders got
// one PIN. People who share a role must each get their own, and one rider's PIN
// must not open the card as the other rider. Paths default to the Linux
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
  page.on('dialog', d => d.accept());
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
    ['kbdc_role_pins','kbdc_role_pins_updatedAt','kbdc_rolepin_fails'].forEach(k => localStorage.removeItem(k));
    Object.keys(localStorage).filter(k => k.indexOf('kbdc_role_emp_') === 0).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('kbdc_tasks_RDR', JSON.stringify([{ code:'RDR1', en:'Collect lab cases', freq:'Daily', done:false }]));
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      { id:'EM1', name:'Aaquib Arshad', designation:'Rider', pin:'1111', active:true, empStatus:'Active' },
      { id:'EM2', name:'Vishal Kanojia', designation:'Rider', pin:'2222', active:true, empStatus:'Active' },
      { id:'EM3', name:'Saloni Shrivastava', designation:'Receptionist', pin:'3333', active:true, empStatus:'Active' }]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
  });
  await page.reload(); await page.waitForTimeout(1200);

  async function nav(url) { await page.goto('about:blank'); await page.goto('file://' + APP); await page.waitForTimeout(1200); }
  async function roleCards() {
    await page.locator('.nav', { hasText:'TASK MANAGEMENT' }).first().click(); await page.waitForTimeout(700);
    await page.getByText('My Tasks', { exact:true }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(700);
  }

  // Owner issues PINs.
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);
  await roleCards();
  await page.locator('.role-card', { hasText:'Manager Dashboard' }).first().click({ timeout:8000 }); await page.waitForTimeout(500);
  await page.locator('.mgr-stab', { hasText:/^PINs$/ }).click(); await page.waitForTimeout(400);
  const rdrRows = await page.$$eval('#rp-table tr[data-key^="RDR"]', trs => trs.map(t => t.getAttribute('data-key')));
  console.log('  Rider rows on the PINs tab:', JSON.stringify(rdrRows));
  ok(rdrRows.length === 2 && rdrRows.indexOf('RDR|aaquib arshad') >= 0 && rdrRows.indexOf('RDR|vishal kanojia') >= 0, 'each rider has their own row');
  ok(await page.locator('#rp-table tr[data-key="RCP"]').count() === 1, 'a role one person holds still has one role row');
  await page.click('#rp-generate'); await page.waitForTimeout(300);
  await page.click('#rp-save'); await page.waitForTimeout(500);
  const pins = await page.evaluate(() => kbdcRolePins());
  const a = pins['RDR|aaquib arshad'], v = pins['RDR|vishal kanojia'];
  ok(/^\d{4}$/.test(a || '') && /^\d{4}$/.test(v || '') && a !== v, 'the two riders get two different PINs');
  ok(!pins.RDR, 'no shared Rider PIN is left behind');

  // Typing one PIN into a rider's box does not change the other's.
  await page.fill('#rp-table tr[data-key="RDR|aaquib arshad"] input', '4821'); await page.waitForTimeout(200);
  const vBox = await page.inputValue('#rp-table tr[data-key="RDR|vishal kanojia"] input');
  ok(vBox === v, 'changing Aaquib’s PIN leaves Vishal’s alone (' + vBox + ')');
  await page.click('#rp-save'); await page.waitForTimeout(500);

  // A rider (not the owner) signs in and opens the Rider card.
  await page.evaluate(() => kbdcClearSession());
  await nav();
  await page.locator('select').first().selectOption({ label:'Aaquib Arshad' }).catch(()=>{}); await page.waitForTimeout(400);
  for (const d of ['1','1','1','1']) { await page.getByRole('button', { name:d, exact:true }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(100); }
  await page.getByRole('button', { name:/Login/ }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(1500);
  async function openAs(who, pin) {
    await nav(); await roleCards();
    await page.locator('.rc-av', { hasText:/^RDR$/ }).first().click({ timeout:8000 }); await page.waitForTimeout(400);
    // The picker's copy of the name, not the signed-in user's name in the sidebar behind it.
    await page.getByText(who, { exact:true }).last().click({ timeout:8000 }); await page.waitForTimeout(500);
    for (const d of pin.split('')) { await page.locator('.pin-overlay').getByText(d, { exact:true }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(110); }
    await page.waitForTimeout(700);
    return (await page.locator('.task-row').count()) > 0;
  }
  ok(!(await openAs('Vishal Kanojia', '4821')), 'Aaquib’s PIN does not open the card as Vishal');
  ok(await openAs('Aaquib Arshad', '4821'), 'Aaquib’s PIN opens it as Aaquib');
  ok(await openAs('Vishal Kanojia', v), 'Vishal’s own PIN opens it as Vishal');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
