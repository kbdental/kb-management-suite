// Role PINs. The PIN screen used `np === '1234' || np === role.pin || true`,
// so any four digits opened any role card and the Manager Dashboard. Now each
// role has its own PIN, set by the owner in Manager Dashboard → PINs, shared
// to every device through ClinicSettings; a role with no PIN stays locked;
// the owner is not asked. Paths default to the Linux sandbox; override with
// PW_MODULE / PW_CHROME / KB_VENDOR to run elsewhere.
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
  let remoteSettings = [], pushedSettings = null;
  await page.route('**/exec**', route => {
    let p={}; try{ p=JSON.parse(route.request().postData()||'{}'); }catch(e){}
    if (p.action === 'getStamps') return route.fulfill({contentType:'application/json', body:JSON.stringify({ok:true,stamps:{},version:'2026-09-08-1'})});
    if (p.action === 'getBatch') { const dt={}; (p.sheets||[]).forEach(sh=>dt[sh]=[]); dt.ClinicSettings = remoteSettings;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:dt,version:'2026-09-08-1'})}); }
    if (p.action === 'saveBatch' && (p.modules||{}).ClinicSettings) pushedSettings = p.modules.ClinicSettings;
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,saved:{},version:'2026-09-08-1'})});
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    ['kbdc_role_pins','kbdc_role_pins_updatedAt','kbdc_rolepin_fails'].forEach(k => localStorage.removeItem(k));
    localStorage.setItem('kbdc_tasks_RCP', JSON.stringify([{ code:'RCP1', en:'Open reception', freq:'Daily', done:false }]));
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      { id:'EM1', name:'Saloni Shrivastava', designation:'Receptionist', pin:'1234', active:true, empStatus:'Active' }]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
  });
  await page.reload(); await page.waitForTimeout(1200);

  async function staffLogin() {
    await page.locator('select').first().selectOption({ label:'Saloni Shrivastava' }).catch(()=>{});
    await page.waitForTimeout(500);
    for (const d of ['1','2','3','4']) { await page.getByRole('button', { name:d, exact:true }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(120); }
    await page.getByRole('button', { name:/Login/ }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(1500);
  }
  async function openCard(code) {
    await page.locator('.nav', { hasText:'TASK MANAGEMENT' }).first().click(); await page.waitForTimeout(700);
    await page.getByText('My Tasks', { exact:true }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(700);
    if (code === 'MGR') await page.locator('.role-card', { hasText:'Manager Dashboard' }).first().click({ timeout:8000 });
    else await page.locator('.rc-av', { hasText:new RegExp('^' + code + '$') }).first().click({ timeout:8000 });
    await page.waitForTimeout(500);
  }
  async function type(pin) {
    for (const d of pin.split('')) { await page.locator('.pin-overlay').getByText(d, { exact:true }).first().click({force:true}).catch(()=>{}); await page.waitForTimeout(120); }
    await page.waitForTimeout(700);
  }
  const inTasks = async () => (await page.locator('.task-row').count()) > 0;
  const overlay = async () => (await page.locator('.pin-overlay').innerText().catch(()=> '')).replace(/\s+/g, ' ');

  await staffLogin();
  // 1. No PIN set yet: the card stays shut, and 1234 no longer opens it.
  await openCard('RCP');
  ok(/No PIN has been set for this role/.test(await overlay()), 'a role with no PIN says so');
  await type('1234');
  ok(!(await inTasks()), 'and 1234 does not open it any more');

  // 2. With a PIN set: wrong PIN refused, right PIN opens.
  await page.evaluate(() => kbdcSetRolePins({ RCP:'4821', MGR:'7390' }));
  await page.goto('about:blank'); await page.goto('file://' + APP); await page.waitForTimeout(1200);
  await openCard('RCP');
  await type('1234');
  ok(/Incorrect PIN/.test(await overlay()) && !(await inTasks()), 'a wrong PIN is refused');
  await type('4821');
  ok(await inTasks(), 'the role’s own PIN opens the task list');

  // 3. Five wrong tries lock the card.
  await page.goto('about:blank'); await page.goto('file://' + APP); await page.waitForTimeout(1200);
  await openCard('RCP');
  for (let i = 0; i < 5; i++) await type('0000');
  await type('4821');
  ok(/Locked for 60 seconds|Wait \d+ seconds/.test(await overlay()) && !(await inTasks()), 'five wrong tries lock the card, even against the right PIN');
  await page.evaluate(() => localStorage.removeItem('kbdc_rolepin_fails'));

  // 4. The Manager Dashboard needs its own PIN from staff.
  await page.goto('about:blank'); await page.goto('file://' + APP); await page.waitForTimeout(1200);
  await openCard('MGR');
  await type('4821');
  ok((await page.locator('.mgr-kpis').count()) === 0, 'a role PIN does not open the Manager Dashboard');
  await type('7390');
  ok((await page.locator('.mgr-kpis').count()) === 1, 'the Manager PIN does');

  // 5. The owner is not asked, and can issue new PINs for every role.
  await page.evaluate(() => kbdcClearSession());
  await page.goto('about:blank'); await page.goto('file://' + APP); await page.waitForTimeout(1200);
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);
  await openCard('MGR'); await page.waitForTimeout(400);
  ok((await page.locator('.mgr-kpis').count()) === 1, 'the owner opens the Manager Dashboard without a PIN');
  await page.locator('.mgr-stab', { hasText:/^PINs$/ }).click(); await page.waitForTimeout(400);
  await page.click('#rp-generate'); await page.waitForTimeout(300);
  await page.click('#rp-save'); await page.waitForTimeout(500);
  const pins = await page.evaluate(() => kbdcRolePins());
  const codes = await page.evaluate(() => kbdcAllRoleCards().map(r => r.code));
  const vals = codes.map(c => pins[c]);
  ok(vals.every(v => /^\d{4}$/.test(v || '')), 'every role and the Manager Dashboard get a 4-digit PIN (' + codes.length + ')');
  ok(new Set(vals).size === vals.length && vals.indexOf('1234') < 0, 'all different, and none is 1234');
  ok(pins.RCP !== '4821', 'the old PINs are replaced');

  // 6. Shared through the Sheet, both ways.
  await page.evaluate(() => kbdcAutoSyncMain()); await page.waitForTimeout(3000);
  const row = (pushedSettings || []).find(r => r.key === 'rolePins');
  ok(row && JSON.parse(row.value).RCP === pins.RCP, 'the new PINs go to the Sheet as the rolePins setting');
  remoteSettings = [{ key:'rolePins', value:JSON.stringify(Object.assign({}, pins, { RCP:'5555' })), updatedAt:new Date(Date.now() + 60000).toISOString() }];
  await page.evaluate(() => kbdcAutoSyncMain()); await page.waitForTimeout(3000);
  ok(await page.evaluate(() => kbdcRolePin('RCP')) === '5555', 'PINs changed on another device arrive on this one');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
