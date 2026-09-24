// "090496 & 120394 are for logging in to the management app but 4545 & 5454
// are only for my task logging in."
//
// Both riders were listed TWICE in the My Tasks picker. A person lands in
// kbdc_role_emp_* once derived from their HR record — carrying their
// app-login PIN — and once added by hand in Task Management, carrying the PIN
// that opens their task list. The two rows have different ids, RoleEmployees
// rows are keyed by id, so the merge treats them as two people and keeps both.
//
// Each rider must appear once, under their task PIN, never their login PIN.
// Paths default to the Linux sandbox; override with PW_MODULE / PW_CHROME.
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const R  = fs.readFileSync(V + '/react/umd/react.production.min.js', 'utf8');
  const RD = fs.readFileSync(V + '/react-dom/umd/react-dom.production.min.js', 'utf8');
  const B  = fs.readFileSync(V + '/@babel/standalone/babel.min.js', 'utf8');
  const pass = [], failed = [];
  function ok(c, l) { (c ? pass : failed).push(l); console.log((c ? '  PASS ' : '  FAIL ') + l); }

  const page = await (await browser.newContext({ viewport: { width: 1450, height: 1050 }, timezoneId: 'Asia/Kolkata' })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
  await page.route('**/react@18/umd/react.production.min.js', r => r.fulfill({ body: R, contentType: 'application/javascript' }));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r => r.fulfill({ body: RD, contentType: 'application/javascript' }));
  await page.route('**/@babel/standalone/babel.min.js', r => r.fulfill({ body: B, contentType: 'application/javascript' }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.route('**/exec**', route => {
    let p = {}; try { p = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (p.action === 'getStamps') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, stamps: {}, version: '2026-09-08-1' }) });
    if (p.action === 'getBatch') { const dt = {}; (p.sheets || []).forEach(sh => dt[sh] = []);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: dt, version: '2026-09-08-1' }) }); }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, saved: {}, version: '2026-09-08-1' }) });
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec');
    localStorage.setItem('kbdc_task_log', '[]');
    localStorage.setItem('kbdc_tasks_RDR', JSON.stringify([
      { code: 'RDR1', en: 'Collect lab cases', hi: '', freq: 'Daily', done: false },
      { code: 'RDR2', en: 'Deliver crowns',    hi: '', freq: 'Daily', done: false }]));
    // HR carries the APP-LOGIN PINs.
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      { id: 'EM1784807109980', name: 'Aaquib Arshad',  designation: 'Rider', pin: '090496', active: true, empStatus: 'Active', workLocation: 'Dilshad Garden' },
      { id: 'EM1784806691258', name: 'Vishal Kanojia', designation: 'Rider', pin: '120394', active: true, empStatus: 'Active', workLocation: 'Dilshad Garden' }]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
    // The owner's live RoleEmployees tab: the HR-derived row (login PIN) and
    // the hand-added row (task PIN) for each rider, kept apart by their ids.
    localStorage.setItem('kbdc_role_emp_RDR', JSON.stringify([
      { id: 'RDR-EM1784807109980', name: 'Aaquib Arshad',  pin: '090496', branch: 'Dilshad Garden' },
      { id: 'RDR-EM1784806691258', name: 'Vishal Kanojia', pin: '120394', branch: 'Dilshad Garden' },
      { id: 'RDR-1786609201389',   name: 'Vishal Kanojia', pin: '5454',   branch: 'Main Branch' },
      { id: 'RDR-1786609226503',   name: 'Aaquib Arshad',  pin: '4545',   branch: 'Main Branch' }]));
  });
  await page.reload(); await page.waitForTimeout(1500);

  const emps = await page.evaluate(() => getRoleEmployees('RDR').map(e => ({ name: e.name, pin: e.pin })));
  console.log('  picker list:', JSON.stringify(emps));
  ok(emps.length === 2, 'two riders, two rows — not four (' + emps.length + ')');
  const byName = {}; emps.forEach(e => byName[e.name] = e.pin);
  ok(byName['Aaquib Arshad'] === '4545',  'Aaquib opens his tasks with his task PIN, not his login PIN (' + byName['Aaquib Arshad'] + ')');
  ok(byName['Vishal Kanojia'] === '5454', 'Vishal opens his tasks with his task PIN, not his login PIN (' + byName['Vishal Kanojia'] + ')');
  ok(emps.every(e => e.pin !== '090496' && e.pin !== '120394'), 'neither app-login PIN opens a task list');

  // The role is still shared, so the scoring fix and the picker both still apply.
  ok(await page.evaluate(() => kbdcRoleIsShared('RDR')), 'RDR is still a role two people hold');

  // The HR sync runs on every load; it must not put the login-PIN row back.
  const afterSync = await page.evaluate(() => {
    kbdcSyncRoleEmployeesFromHR();
    return {
      stored: JSON.parse(localStorage.getItem('kbdc_role_emp_RDR') || '[]').map(e => e.name + '/' + e.pin),
      shown: getRoleEmployees('RDR').map(e => e.name + '/' + e.pin)
    };
  });
  console.log('  after the HR sync:', JSON.stringify(afterSync));
  ok(afterSync.shown.length === 2, 'the HR sync does not add a second row per rider back');
  ok(afterSync.shown.indexOf('Aaquib Arshad/4545') >= 0 && afterSync.shown.indexOf('Vishal Kanojia/5454') >= 0,
     'and leaves each rider on their task PIN');

  // The picker itself, on screen.
  await page.click('text=Admin Override').catch(() => {}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]', 'kbdc@admin').catch(() => {});
  await page.click('button:has-text("Enter")').catch(() => {}); await page.waitForTimeout(900);
  await page.locator('.nav', { hasText: 'TASK MANAGEMENT' }).first().click(); await page.waitForTimeout(800);
  await page.getByText('My Tasks', { exact: true }).first().click({ force: true }).catch(() => {}); await page.waitForTimeout(800);
  await page.locator('.rc-av', { hasText: /^RDR$/ }).first().click({ timeout: 8000 }); await page.waitForTimeout(700);
  const shownAaquib = await page.getByText('Aaquib Arshad', { exact: true }).count();
  const shownVishal = await page.getByText('Vishal Kanojia', { exact: true }).count();
  console.log('  on the picker screen: Aaquib x' + shownAaquib + ', Vishal x' + shownVishal);
  ok(shownAaquib === 1, 'Aaquib is offered once on the picker, not twice');
  ok(shownVishal === 1, 'Vishal is offered once on the picker, not twice');

  // A person with only an HR record — no task PIN set — must still be listed.
  const hrOnly = await page.evaluate(() => {
    localStorage.setItem('kbdc_role_emp_CAD', JSON.stringify([
      { id: 'CAD-EM1784806140092', name: 'Abhimanyu', pin: '190995', branch: 'Dilshad Garden' }]));
    return getRoleEmployees('CAD').map(e => e.name + '/' + e.pin);
  });
  ok(hrOnly.length === 1 && hrOnly[0] === 'Abhimanyu/190995', 'someone with a single row is left exactly as they are');

  ok(errs.length === 0, 'no JavaScript errors (' + JSON.stringify(errs).slice(0, 200) + ')');
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
