// "both riders checklist are getting done together means if one marks the
// tasks to be done, the tasks of 2nd rider are also getting done
// automatically ... so that we can see their individual tasks done and their
// performances individually."
//
// Each rider's own checklist was already separate (test-rider-separate-ticks).
// The Manager Dashboard was not: a staff row was scored on
// Math.max(role flag, own ticks), and the role flag only says "somebody
// holding this role did this task today". Two riders hold RDR, so whichever
// rider ticked lifted BOTH rows to the same percentage, and neither could be
// judged on their own work.
//
// Uses the owner's live RoleEmployees data, where each rider is listed twice.
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
      { code: 'RDR2', en: 'Deliver crowns',    hi: '', freq: 'Daily', done: false },
      { code: 'RDR3', en: 'Bank deposit',      hi: '', freq: 'Daily', done: false },
      { code: 'RDR4', en: 'Fuel log',          hi: '', freq: 'Daily', done: false }]));
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      { id: 'EM1', name: 'Aaquib Arshad',  designation: 'Rider', pin: '1111', active: true, empStatus: 'Active' },
      { id: 'EM2', name: 'Vishal Kanojia', designation: 'Rider', pin: '2222', active: true, empStatus: 'Active' }]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
    // The owner's live RoleEmployees tab: each rider listed twice, different
    // id, PIN and branch.
    localStorage.setItem('kbdc_role_emp_RDR', JSON.stringify([
      { id: 'RDR-EM1784807109980', name: 'Aaquib Arshad',  pin: '090496', branch: 'Dilshad Garden' },
      { id: 'RDR-EM1784806691258', name: 'Vishal Kanojia', pin: '120394', branch: 'Dilshad Garden' },
      { id: 'RDR-1786609201389',   name: 'Vishal Kanojia', pin: '3434',   branch: 'Main Branch' },
      { id: 'RDR-1786609226503',   name: 'Aaquib Arshad',  pin: '4545',   branch: 'Main Branch' }]));
  });
  await page.reload(); await page.waitForTimeout(1200);

  // Aaquib does three of the four; Vishal does one. Both the per-person ticks
  // and the role-level flag are written, exactly as ticking does.
  await page.evaluate(() => {
    const today = kbdcToday(), now = new Date().toISOString();
    const row = (n, code) => ({ id: 'tl' + code + n.replace(/\s/g, ''), roleCode: 'RDR', staffName: n,
      taskCode: code, taskEn: code, taskHi: '', frequency: 'Daily', date: today, time: '09:05', updatedAt: now });
    localStorage.setItem('kbdc_task_log', JSON.stringify([
      row('Aaquib Arshad', 'RDR1'), row('Aaquib Arshad', 'RDR2'), row('Aaquib Arshad', 'RDR3'),
      row('Vishal Kanojia', 'RDR4')]));
    // The role-level flag: "somebody holding RDR did this today".
    setRoleTasks('RDR', getRoleTasks('RDR').map(t =>
      Object.assign({}, t, { done: true, doneAt: now })));
  });

  await page.click('text=Admin Override').catch(() => {}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]', 'kbdc@admin').catch(() => {});
  await page.click('button:has-text("Enter")').catch(() => {}); await page.waitForTimeout(900);
  await page.locator('.nav', { hasText: 'TASK MANAGEMENT' }).first().click(); await page.waitForTimeout(900);
  await page.getByText('My Tasks', { exact: true }).first().click({ force: true }).catch(() => {}); await page.waitForTimeout(900);
  await page.locator('.role-card', { hasText: 'Manager Dashboard' }).first().click({ timeout: 8000 }); await page.waitForTimeout(400);
  for (const d of ['1', '2', '3', '4']) {
    await page.locator('.pin-overlay').getByText(d, { exact: true }).first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(900);

  const pct = async name => page.locator('.mgr-staff-row', { hasText: name }).locator('.mgr-spct').innerText().catch(() => '');
  const aaquib = await pct('Aaquib'), vishal = await pct('Vishal Kanojia');
  console.log('  Overview reads: Aaquib', aaquib, '· Vishal', vishal);

  ok(aaquib === '75%', 'Aaquib is scored on his own three of four (' + aaquib + ')');
  ok(vishal === '25%', 'Vishal is scored on his own one of four (' + vishal + ')');
  ok(aaquib !== vishal, 'the two riders no longer carry an identical score');

  // The same question asked of the Report, which counts over a date range.
  const counts = await page.evaluate(() => {
    const log = kbdcLog(), days = [kbdcToday()];
    return {
      aaquib: kbdcTdCount(days, ['RDR'], 'Aaquib Arshad', log).done,
      vishal: kbdcTdCount(days, ['RDR'], 'Vishal Kanojia', log).done,
      both:   kbdcTdCount(days, ['RDR'], '', log).done
    };
  });
  console.log('  Report counts:', JSON.stringify(counts));
  ok(counts.aaquib === 3, 'the Report credits Aaquib with 3');
  ok(counts.vishal === 1, 'the Report credits Vishal with 1');
  ok(counts.both === 4, 'and the role as a whole with all 4');

  // Ticks recorded before names were stored still have to be usable. For a
  // role ONE person holds they are that person's; for a shared role they can
  // only be counted at role level, never credited to each rider in turn.
  const unnamed = await page.evaluate(() => {
    const today = kbdcToday();
    const bare = c => ({ id: 'old' + c, roleCode: 'RDR', staffName: '', taskCode: c, taskEn: c,
      frequency: 'Daily', date: today, time: '08:00' });
    const solo = c => ({ id: 'oldS' + c, roleCode: 'CAD', staffName: '', taskCode: c, taskEn: c,
      frequency: 'Daily', date: today, time: '08:00' });
    localStorage.setItem('kbdc_tasks_CAD', JSON.stringify([{ code: 'CAD1', en: 'Mill units', freq: 'Daily', done: false }]));
    localStorage.setItem('kbdc_role_emp_CAD', JSON.stringify([{ id: 'CAD-1', name: 'Abhimanyu', pin: '190995' }]));
    localStorage.setItem('kbdc_task_log', JSON.stringify([bare('RDR1'), solo('CAD1')]));
    const log = kbdcLog(), days = [kbdcToday()];
    return {
      sharedA: kbdcTdCount(days, ['RDR'], 'Aaquib Arshad', log).done,
      sharedV: kbdcTdCount(days, ['RDR'], 'Vishal Kanojia', log).done,
      sharedAll: kbdcTdCount(days, ['RDR'], '', log).done,
      soloOwner: kbdcTdCount(days, ['CAD'], 'Abhimanyu', log).done
    };
  });
  console.log('  unnamed ticks:', JSON.stringify(unnamed));
  ok(unnamed.sharedA === 0 && unnamed.sharedV === 0, 'an unnamed tick is not credited to either rider');
  ok(unnamed.sharedAll === 1, 'but still counts for the role as a whole');
  ok(unnamed.soloOwner === 1, 'and an unnamed tick on a one-person role is still that person’s');

  ok(errs.length === 0, 'no JavaScript errors (' + JSON.stringify(errs).slice(0, 200) + ')');
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
