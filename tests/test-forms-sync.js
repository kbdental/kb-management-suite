// "Please see the Form Builder in one system and nothing is showing in
// another system." Seven forms on the owner's laptop, "No forms yet" on the
// next machine, with the backup badge green on both.
//
// Nothing had failed. Only the form RESPONSES were ever in the list of things
// to sync; the forms themselves live in kbdc_forms_v3 and were never sent at
// all. A form built on one device existed nowhere else, for ever.
//
// Run against the REAL backend/Code.gs in Node.
const { startServer } = require(__dirname + '/gas-server.js');
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const GAS = __dirname + '/../backend/Code.gs';
const PORT = Number(process.env.KB_PORT || 8941);

(async () => {
  const { tabs, server } = await startServer(GAS, PORT);
  const browser = await chromium.launch({ executablePath: CHROME });
  const R  = fs.readFileSync(V + '/react/umd/react.production.min.js', 'utf8');
  const RD = fs.readFileSync(V + '/react-dom/umd/react-dom.production.min.js', 'utf8');
  const B  = fs.readFileSync(V + '/@babel/standalone/babel.min.js', 'utf8');
  const pass = [], failed = [];
  function ok(c, l) { (c ? pass : failed).push(l); console.log((c ? '  PASS ' : '  FAIL ') + l); }

  async function device(name) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on('pageerror', e => console.log('  [' + name + '] ' + String(e.message).slice(0, 120)));
    await page.route('**/react@18/umd/react.production.min.js', r => r.fulfill({ body: R, contentType: 'application/javascript' }));
    await page.route('**/react-dom@18/umd/react-dom.production.min.js', r => r.fulfill({ body: RD, contentType: 'application/javascript' }));
    await page.route('**/@babel/standalone/babel.min.js', r => r.fulfill({ body: B, contentType: 'application/javascript' }));
    await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
    await page.route('**/exec**', async route => {
      const body = route.request().postData() || '';
      const reply = await new Promise(res => {
        const rq = require('http').request({ host: '127.0.0.1', port: PORT, path: '/exec', method: 'POST',
          headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } },
          r => { let s = ''; r.on('data', c => s += c); r.on('end', () => res(s)); });
        rq.on('error', () => res('{"ok":false}'));
        rq.end(body);
      });
      return route.fulfill({ contentType: 'application/json', body: reply });
    });
    await page.goto('file://' + APP); await page.waitForTimeout(700);
    await page.evaluate(() => {
      kbdcSetBackendUrl('https://script.google.com/macros/s/MAIN/exec');
      ['kbdc_pull_revs','kbdc_pull_sizes','kbdc_pull_paged','kbdc_push_sigs'].forEach(k => localStorage.removeItem(k));
      localStorage.setItem('kbdc_forms_v3', '[]');
    });
    // Let the app's own start-up sync finish. kbdcAutoSyncMain holds a
    // re-entrancy guard, so a call made while it is running returns at once
    // and the test would measure nothing.
    await page.waitForTimeout(3500);
    return page;
  }

  // Two passes, because one cycle may be skipped by the running-guard.
  async function syncFully(p) {
    for (let i = 0; i < 2; i++) { await p.evaluate(() => kbdcAutoSyncMain()); await p.waitForTimeout(3500); }
  }

  const A = await device('A'), Bd = await device('B');

  // Forms must be in the list of things that get sent at all.
  const listed = await A.evaluate(() => KBDC_BACKEND_MODULES.filter(m => m.localKey === 'kbdc_forms_v3').map(m => m.sheet));
  ok(listed.length === 1, 'the forms themselves are a synced module (' + JSON.stringify(listed) + ')');

  // Device A builds two forms, exactly as Save and Publish do.
  await A.evaluate(() => {
    fbSaveForms([
      { id: 'f1', name: 'RADIOLOGY LAB RECORD', icon: '📋', desc: '', status: 'published',
        fields: [{ id: 'q1', type: 'text', label: 'Patient', required: true, options: [] }],
        createdAt: '2026-10-16T06:00:00.000Z', updatedAt: '2026-10-16T06:00:00.000Z' },
      { id: 'f2', name: 'Fogging Record', icon: '📋', desc: '', status: 'published',
        fields: [{ id: 'q1', type: 'date', label: 'Date', required: true, options: [] }],
        createdAt: '2026-10-16T06:01:00.000Z', updatedAt: '2026-10-16T06:01:00.000Z' }
    ]);
  });
  await syncFully(A);

  const onSheet = (tabs['Forms'] || []).length - 1;
  console.log('  Forms rows on the Sheet after A saves:', onSheet);
  ok(onSheet === 2, 'both forms reach the Google Sheet (' + onSheet + ' of 2)');

  // Device B syncs. This is the whole complaint.
  await syncFully(Bd);
  const onB = await Bd.evaluate(() => fbLoadForms().map(f => f.name).sort());
  console.log('  device B sees:', JSON.stringify(onB));
  ok(onB.length === 2, 'the other machine now has the forms (' + onB.length + ' of 2)');
  ok(onB.indexOf('RADIOLOGY LAB RECORD') >= 0, 'by name');

  const fields = await Bd.evaluate(() => {
    const f = fbLoadForms().filter(x => x.id === 'f1')[0];
    return Array.isArray(f && f.fields) ? f.fields.length : -1;
  });
  ok(fields === 1, 'with their fields intact, not a flattened string (' + fields + ')');

  // An edit on B must travel back, not be overwritten by A's older copy.
  await Bd.evaluate(() => {
    const list = fbLoadForms();
    const i = list.findIndex(f => f.id === 'f2');
    list[i] = Object.assign({}, list[i], { name: 'Fogging Record 2026', updatedAt: new Date().toISOString() });
    fbSaveForms(list);
  });
  await syncFully(Bd);
  await syncFully(A);
  const renamed = await A.evaluate(() => (fbLoadForms().filter(f => f.id === 'f2')[0] || {}).name);
  ok(renamed === 'Fogging Record 2026', 'an edit made on the other machine comes back (' + renamed + ')');

  // And a deletion must travel rather than reappearing on the next pull.
  await A.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('kbdc_forms_v3') || '[]');
    const i = all.findIndex(f => f.id === 'f1');
    all[i] = Object.assign({}, all[i], { removed: true, updatedAt: new Date().toISOString() });
    localStorage.setItem('kbdc_forms_v3', JSON.stringify(all));
  });
  await syncFully(A);
  await syncFully(Bd);
  const afterDelete = await Bd.evaluate(() => fbLoadForms().map(f => f.id));
  console.log('  device B after the delete:', JSON.stringify(afterDelete));
  ok(afterDelete.indexOf('f1') < 0, 'a form deleted on one machine disappears on the other');
  ok(afterDelete.indexOf('f2') >= 0, 'and the other form is untouched');

  // The deleted one must not come back on A either.
  await syncFully(A);
  const backOnA = await A.evaluate(() => fbLoadForms().map(f => f.id));
  ok(backOnA.indexOf('f1') < 0, 'and does not return to the machine it was deleted on');

  await browser.close();
  server.close();
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  process.exit(failed.length ? 1 : 0);
})();
