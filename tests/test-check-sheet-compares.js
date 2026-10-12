// "Stationery stock has 71 items but it shows 69, and so on for another item
// category." Both sides held 726 inventory rows — the counts matched exactly
// — while disagreeing about the quantities inside them, and nothing on any
// screen would say so.
//
// "Check Sheet" answered only "Sheet has N rows", which is the one question
// that was already known to match. It now compares, names the rows that
// differ and shows both figures.
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

  const page = await (await browser.newContext({ viewport: { width: 1450, height: 1000 }, timezoneId: 'Asia/Kolkata' })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
  await page.route('**/react@18/umd/react.production.min.js', r => r.fulfill({ body: R, contentType: 'application/javascript' }));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r => r.fulfill({ body: RD, contentType: 'application/javascript' }));
  await page.route('**/@babel/standalone/babel.min.js', r => r.fulfill({ body: B, contentType: 'application/javascript' }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));

  // The Sheet's copy: same rows, two different quantities, one row the device
  // has never seen, and one the device deleted.
  const SHEET_ROWS = [
    { name: 'A4 Paper',   cat: 'Stationery', stock: 71, batches: '[]' },
    { name: 'Stapler',    cat: 'Stationery', stock: 12, batches: '[]' },
    { name: 'Pen Blue',   cat: 'Stationery', stock: 40, batches: '[]' },
    { name: 'Only On Sheet', cat: 'Stationery', stock: 5, batches: '[]' },
    { name: 'Thrown Away', cat: 'Stationery', stock: 3, batches: '[]' }
  ];
  await page.route('**/exec**', route => {
    let p = {}; try { p = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (p.action === 'getData') return route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ ok: true, rows: SHEET_ROWS, version: '2026-10-07-1' }) });
    if (p.action === 'getBatch') { const dt = {}; (p.sheets || []).forEach(sh => dt[sh] = []);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: dt, version: '2026-10-07-1' }) }); }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, stamps: {}, saved: {}, version: '2026-10-07-1' }) });
  });

  await page.goto('file://' + APP); await page.waitForTimeout(900);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/MAIN/exec');
    kbdcSetInvBackendUrl('https://script.google.com/macros/s/INV/exec');
    // This device: A4 Paper short by 2 (the owner's exact complaint), Pen Blue
    // short by 1, one item it alone has, one it deleted.
    localStorage.setItem('kbdc_inv_items', JSON.stringify([
      { name: 'A4 Paper', cat: 'Stationery', stock: 69, batches: [] },
      { name: 'Stapler',  cat: 'Stationery', stock: 12, batches: [] },
      { name: 'Pen Blue', cat: 'Stationery', stock: 39, batches: [] },
      { name: 'Only Here', cat: 'Stationery', stock: 7, batches: [] },
      { name: 'Thrown Away', cat: 'Stationery', stock: 3, batches: [], removed: true, updatedAt: '2026-10-12T05:00:00.000Z' }
    ]));
  });

  const report = await page.evaluate(async () => {
    // Exactly what the Check Sheet button runs.
    const mod = KBDC_INVENTORY_MODULES.filter(m => m.localKey === 'kbdc_inv_items')[0];
    const d = await kbdcInvBackendReq(mod.sheet, 'getData', {});
    const remote = (d.rows || []).map(kbdcUnflattenRow);
    let local = []; try { local = mod.get(); } catch (e) {}
    const key = r => kbdcInvRowKey(r);
    const label = r => String((r && (r.name || r.id)) || '?') + (r && r.cat ? (' (' + r.cat + ')') : '');
    const headline = r => (r && r.stock !== undefined) ? 'stock' : ((r && r.qty !== undefined) ? 'qty' : '');
    const rByKey = {}; remote.forEach(r => { if (r) rByKey[key(r)] = r; });
    const lByKey = {}; local.forEach(r => { if (r) lByKey[key(r)] = r; });
    let onlyLocal = 0, onlySheet = 0, removedLocally = 0; const differ = [];
    Object.keys(lByKey).forEach(k => {
      const lr = lByKey[k];
      if (kbdcInvRowRemoved(lr)) { removedLocally++; return; }
      if (!(k in rByKey)) { onlyLocal++; return; }
      const rr = rByKey[k], f = headline(lr);
      if (f && Number(lr[f] || 0) !== Number(rr[f] || 0)) {
        differ.push(label(lr) + ': here ' + Number(lr[f] || 0) + ', Sheet ' + Number(rr[f] || 0));
      }
    });
    Object.keys(rByKey).forEach(k => { if (!(k in lByKey)) onlySheet++; });
    return { differ, onlyLocal, onlySheet, removedLocally, remote: remote.length, local: local.length };
  });

  console.log('  ' + JSON.stringify(report, null, 0));

  // ---- Transactions: two missing rows must report as two, and be named ----
  const tx = await page.evaluate(async () => {
    const SHEET = [
      { id: 'tx1', type: 'OUT', name: 'L.A.',   cat: 'General', qty: 1, date: '2026-10-11T05:00:00.000Z', person: 'Vishal' },
      { id: 'tx2', type: 'OUT', name: 'Gloves', cat: 'General', qty: 2, date: '2026-10-11T06:00:00.000Z', person: 'Suman' },
      { id: 'tx3', type: 'OUT', name: 'L.A.',   cat: 'General', qty: 5, date: '2026-10-12T04:00:00.000Z', person: 'Vishal' }
    ];
    // This device has only the first. Two are missing, and two of the three
    // are the same item on the same day — the case that used to collapse.
    localStorage.setItem('kbdc_inv_tx', JSON.stringify([SHEET[0]]));
    const key = r => kbdcInvRowKey(r);
    const rByKey = {}; SHEET.forEach(r => rByKey[key(r)] = r);
    const lByKey = {}; [SHEET[0]].forEach(r => lByKey[key(r)] = r);
    const sheetOnly = [];
    Object.keys(rByKey).forEach(k => { if (!(k in lByKey)) sheetOnly.push(rByKey[k].name + ' qty ' + rByKey[k].qty); });
    return { onlySheet: sheetOnly.length, names: sheetOnly, distinctKeys: Object.keys(rByKey).length, rows: SHEET.length };
  });
  console.log('  stock-out compare:', JSON.stringify(tx));
  ok(tx.onlySheet === 2, 'two missing stock-outs report as two, not one (' + tx.onlySheet + ')');
  ok(tx.distinctKeys === tx.rows, 'two movements of the same item on the same day stay distinct');
  ok(tx.names.some(n => /L\.A\. qty 5/.test(n)), 'and each missing row is named with its quantity: ' + tx.names.join('; '));

  // Only one kbdcInvRowKey may exist: two declarations of one name meant the
  // later silently replaced the earlier for every caller.
  const defs = (fs.readFileSync(APP, 'utf8').match(/\nfunction kbdcInvRowKey\s*\(/g) || []).length;
  ok(defs === 1, 'kbdcInvRowKey is declared exactly once (' + defs + ')');
  ok(report.differ.length === 2, 'it finds the two rows whose quantities disagree (' + report.differ.length + ')');
  ok(report.differ.some(d => /A4 Paper .*here 69, Sheet 71/.test(d)),
     'and names them with both figures: ' + (report.differ[0] || '(none)'));
  ok(report.onlyLocal === 1, 'one row only this device has (' + report.onlyLocal + ')');
  ok(report.onlySheet === 1, 'one row only the Sheet has (' + report.onlySheet + ')');
  ok(report.removedLocally === 1, 'and a deleted row is reported as deleted, not as a mismatch (' + report.removedLocally + ')');

  // The old button could not have told him any of this.
  ok(report.remote === report.local,
     'the row counts match (' + report.local + ' vs ' + report.remote + ') — which is why counting them never found this');

  ok(errs.length === 0, 'no JavaScript errors (' + JSON.stringify(errs).slice(0, 200) + ')');
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
