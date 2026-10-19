// "Anybody who is coming late by 10 minutes should be marked as half day on a
// daily basis, and this gets calculated in the month's final count on which
// the salary is based."
//
// What was there before: the first two lates of a month were tagged L1 and L2
// and forgiven, and from the third a row was tagged 'late-ded'. That tag was
// written and never read by anything — prAttStats did not look at lateness at
// all — so a month of late arrivals changed nobody's pay by a rupee.
//
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

  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, timezoneId: 'Asia/Kolkata' })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
  await page.route('**/react@18/umd/react.production.min.js', r => r.fulfill({ body: R, contentType: 'application/javascript' }));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r => r.fulfill({ body: RD, contentType: 'application/javascript' }));
  await page.route('**/@babel/standalone/babel.min.js', r => r.fulfill({ body: B, contentType: 'application/javascript' }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.route('**/exec**', r => r.fulfill({ contentType: 'application/json', body: '{"ok":true,"data":{},"stamps":{},"saved":{}}' }));

  await page.goto('file://' + APP); await page.waitForTimeout(900);

  // ---- The rule itself ----------------------------------------------------
  const rule = await page.evaluate(() => laLateRule());
  console.log('  default rule:', JSON.stringify(rule));
  ok(rule.enabled === true, 'the rule is on by default');
  ok(rule.graceMin === 10, 'the grace period is 10 minutes, as asked (' + rule.graceMin + ')');

  const judged = await page.evaluate(() => {
    const r = m => laIsLateHalfDay({ checkIn: '09:' + String(m).padStart(2, '0'), lateMin: m });
    return { onTime: r(0), five: r(5), nine: r(9), ten: r(10), eleven: r(11), thirty: r(30) };
  });
  console.log('  by minutes late:', JSON.stringify(judged));
  ok(!judged.onTime && !judged.five && !judged.nine, 'under 10 minutes late is not a half day');
  ok(judged.ten && judged.eleven && judged.thirty, '10 minutes late or more IS a half day');

  // A day already worked must not be re-judged if the policy changes later.
  const frozen = await page.evaluate(() => {
    const was = laIsLateHalfDay({ checkIn: '09:20', lateMin: 20, lateHalfDay: false });
    const alsoWas = laIsLateHalfDay({ checkIn: '09:02', lateMin: 2, lateHalfDay: true });
    return { was, alsoWas };
  });
  ok(frozen.was === false && frozen.alsoWas === true,
     'a day carries the decision made on the day, not today’s policy');

  // ---- Someone with no shift assigned ------------------------------------
  const noShift = await page.evaluate(() => {
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([{ id: 'EM1', name: 'Aaquib Arshad', active: true }]));
    const own = laGetStaffShift('Aaquib Arshad', laGetShifts());
    const used = laShiftFor('Aaquib Arshad', laGetShifts());
    return { own: own ? own.id : null, used: used ? used.id : null, start: used ? used.start : null };
  });
  console.log('  staff with no shiftId:', JSON.stringify(noShift));
  ok(noShift.own === null, 'that person has no shift of their own (as on the live roster)');
  ok(noShift.used === 'sh_morn' && noShift.start === '09:00',
     'so the clinic default is used, instead of the rule silently never applying');

  // ---- The month, and the salary it feeds --------------------------------
  const month = await page.evaluate(() => {
    const ms = '2026-09';            // September 2026
    const rows = [];
    const mk = (day, inAt, lateMin) => ({
      id: 'a' + day, staffId: 'EM1', staffName: 'Aaquib Arshad',
      date: ms + '-' + String(day).padStart(2, '0'), checkIn: inAt, checkOut: '18:00',
      lateMin: lateMin, lateHalfDay: lateMin >= 10
    });
    // Three genuinely late days, two inside the grace, one on time.
    rows.push(mk(1, '09:25', 25));
    rows.push(mk(2, '09:12', 12));
    rows.push(mk(3, '09:10', 10));
    rows.push(mk(4, '09:07', 7));
    rows.push(mk(7, '09:03', 3));
    rows.push(mk(8, '09:00', 0));
    localStorage.setItem('kbdc_la_attendance', JSON.stringify(rows));
    localStorage.setItem('kbdc_la_leaves', '[]');
    return {
      lateHalf: laLateHalfDays('Aaquib Arshad', 'EM1', ms),
      total: rows.length
    };
  });
  console.log('  month:', JSON.stringify(month));
  ok(month.lateHalf === 3, 'three late days become three half days (' + month.lateHalf + ')');

  // The same date twice (a re-check-in) must not be counted twice.
  const dupes = await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('kbdc_la_attendance') || '[]');
    rows.push(Object.assign({}, rows[0], { id: 'dup1' }));
    localStorage.setItem('kbdc_la_attendance', JSON.stringify(rows));
    const n = laLateHalfDays('Aaquib Arshad', 'EM1', '2026-09');
    rows.pop(); localStorage.setItem('kbdc_la_attendance', JSON.stringify(rows));
    return n;
  });
  ok(dupes === 3, 'two rows for the same date are still one half day (' + dupes + ')');

  // Switching the rule off leaves pay exactly as it was.
  const off = await page.evaluate(() => {
    laSaveLateRule({ enabled: false, graceMin: 10, fallbackShiftId: 'sh_morn' });
    const n = laLateHalfDays('Aaquib Arshad', 'EM1', '2026-09', JSON.parse(localStorage.getItem('kbdc_la_attendance') || '[]')
      .map(r => { const c = Object.assign({}, r); delete c.lateHalfDay; return c; }));
    laSaveLateRule({ enabled: true, graceMin: 10, fallbackShiftId: 'sh_morn' });
    return n;
  });
  ok(off === 0, 'with the rule switched off nothing is deducted (' + off + ')');

  // A different threshold.
  const strict = await page.evaluate(() => {
    laSaveLateRule({ enabled: true, graceMin: 5, fallbackShiftId: 'sh_morn' });
    const rows = JSON.parse(localStorage.getItem('kbdc_la_attendance') || '[]')
      .map(r => { const c = Object.assign({}, r); delete c.lateHalfDay; return c; });
    const n = laLateHalfDays('Aaquib Arshad', 'EM1', '2026-09', rows);
    laSaveLateRule({ enabled: true, graceMin: 10, fallbackShiftId: 'sh_morn' });
    return n;
  });
  ok(strict === 4, 'a 5-minute grace catches the 7-minute day too (' + strict + ' of 4)');

  // ---- The month the salary is actually built on -------------------------
  // kbdcMonthAttStats is what the Payroll screen calls. This is the figure
  // that decides pay, so it is checked directly rather than inferred.
  const stats = await page.evaluate(() => {
    localStorage.setItem('kbdc_la_holidays', '[]');
    localStorage.setItem('kbdc_settings', JSON.stringify({ weekOff: [0] }));
    laSaveLateRule({ enabled: true, graceMin: 10, fallbackShiftId: 'sh_morn' });
    const before = kbdcMonthAttStats('Aaquib Arshad', 'EM1', 2026, 9);
    // Same month with the lateness removed, to isolate what the rule costs.
    const rows = JSON.parse(localStorage.getItem('kbdc_la_attendance') || '[]');
    localStorage.setItem('kbdc_la_attendance', JSON.stringify(
      rows.map(r => Object.assign({}, r, { lateMin: 0, lateHalfDay: false }))));
    const after = kbdcMonthAttStats('Aaquib Arshad', 'EM1', 2026, 9);
    localStorage.setItem('kbdc_la_attendance', JSON.stringify(rows));
    return { before, after };
  });
  console.log('  with lateness :', JSON.stringify(stats.before));
  console.log('  without       :', JSON.stringify(stats.after));
  ok(stats.before.lateHalf === 3, 'the salary month sees the three late days (' + stats.before.lateHalf + ')');
  ok(stats.before.lateDed === 1.5, 'three half days come to 1.5 days (' + stats.before.lateDed + ')');
  ok(stats.before.totalDeductDays - stats.after.totalDeductDays === 1.5,
     'and the month deducts exactly 1.5 days more because of them (' +
     (stats.before.totalDeductDays - stats.after.totalDeductDays) + ')');
  ok(stats.before.present === stats.after.present,
     'a late day still counts as present \u2014 they were here (' + stats.before.present + ')');

  // The money. gross/workDays * totalDeductDays is what Payroll charges.
  const money = await page.evaluate(s2 => {
    const gross = 30000, wd = s2.before.workDays;
    return {
      withLate: Math.round(gross / wd * s2.before.totalDeductDays),
      without:  Math.round(gross / wd * s2.after.totalDeductDays),
      wd: wd
    };
  }, stats);
  console.log('  deduction on a 30,000 gross over', money.wd, 'working days:', JSON.stringify(money));
  ok(money.withLate - money.without === Math.round(30000 / money.wd * 1.5),
     'three late days add exactly 1.5 days of deduction (\u20b9' + money.without +
     ' \u2192 \u20b9' + money.withLate + ', i.e. \u20b9' + (money.withLate - money.without) + ' less pay)');

  // ---- The owner can see and change the rule -----------------------------
  await page.evaluate(() => {
    localStorage.setItem('kbdc_hr_staff', JSON.stringify([
      { id: 'EM1', name: 'Aaquib Arshad', active: true },
      { id: 'EM2', name: 'Vishal Kanojia', active: true }
    ]));
    localStorage.setItem('kbdc_shared_staff', localStorage.getItem('kbdc_hr_staff'));
    laSaveLateRule({ enabled: true, graceMin: 10, fallbackShiftId: 'sh_morn' });
  });
  await page.reload(); await page.waitForTimeout(900);
  await page.click('text=Admin Override').catch(() => {}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]', 'kbdc@admin').catch(() => {});
  await page.click('button:has-text("Enter")').catch(() => {}); await page.waitForTimeout(900);
  await page.locator('.nav', { hasText: 'LEAVE & ATTENDANCE' }).first().click().catch(() => {});
  await page.waitForTimeout(1000);
  // The strip sits with Week Off on the Leave Management tab.
  await page.getByText('Leave Management', { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(1000);

  const strip = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  ok(/more than 10 min late = HALF DAY/i.test(strip),
     'the Leave & Attendance screen states the rule in words');

  await page.locator('button:has-text("Change")').first().click().catch(() => {});
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => {
    const n = document.querySelector('input[type="number"]');
    return !!n;
  });
  ok(saved, 'and opens an editor for it');

  // Warn when the rule cannot reach anyone, instead of looking like it works.
  const warned = await page.evaluate(async () => {
    laSaveLateRule({ enabled: true, graceMin: 10, fallbackShiftId: '' });
    return true;
  });
  await page.reload(); await page.waitForTimeout(900);
  await page.click('text=Admin Override').catch(() => {}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]', 'kbdc@admin').catch(() => {});
  await page.click('button:has-text("Enter")').catch(() => {}); await page.waitForTimeout(900);
  await page.locator('.nav', { hasText: 'LEAVE & ATTENDANCE' }).first().click().catch(() => {});
  await page.waitForTimeout(900);
  await page.getByText('Leave Management', { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(900);
  await page.locator('button:has-text("Change")').first().click().catch(() => {});
  await page.waitForTimeout(600);
  const warnText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  ok(warned && /no shift set, so this rule cannot apply/i.test(warnText),
     'with no fallback shift it warns that nobody can be judged late');

  ok(errs.length === 0, 'no JavaScript errors (' + JSON.stringify(errs).slice(0, 200) + ')');
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
