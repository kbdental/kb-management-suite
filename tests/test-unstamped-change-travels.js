// The owner's Check Sheet output, after a week of this:
//
//   21 differ — Sorbitrate 5 (Emergency Drugs): totalOut here 0, Sheet 10,
//   stock here 10, Sheet 0, batches here 1 batch, 10 total, Sheet 1 batch,
//   0 total; Pantoprazole Gastro (General Medicine): ... and 16 more
//
// The Sheet says these were issued. The device says they are still in stock,
// and will not accept the Sheet's version however many times Sync now is
// pressed. That is the whole complaint, inverted: on the device that issued
// them everything looks right, and every other device is frozen.
//
// Cause: the merge keeps the LOCAL row when the timestamps cannot separate
// the two. Most of the clinic's 725 items were imported before anything
// stamped them, so updatedAt is blank on both sides, every comparison is a
// tie, and a device can never learn about a change it did not make itself.
//
// Run against the REAL Inventory backend in Node.
const { startServer } = require(__dirname + '/gas-server.js');
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const GAS = __dirname + '/../backend/Inventory-Code.gs';
const PORT = Number(process.env.KB_PORT || 8931);

(async () => {
  const { server } = await startServer(GAS, PORT);
  const browser = await chromium.launch({ executablePath: CHROME });
  const R  = fs.readFileSync(V + '/react/umd/react.production.min.js', 'utf8');
  const RD = fs.readFileSync(V + '/react-dom/umd/react-dom.production.min.js', 'utf8');
  const B  = fs.readFileSync(V + '/@babel/standalone/babel.min.js', 'utf8');
  const pass = [], failed = [];
  function ok(c, l) { (c ? pass : failed).push(l); console.log((c ? '  PASS ' : '  FAIL ') + l); }

  async function device(name) {
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 860 } })).newPage();
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
      kbdcSetInvBackendUrl('https://script.google.com/macros/s/INV/exec');
      ['kbdc_pull_revs','kbdc_pull_sizes','kbdc_pull_paged','kbdc_push_sigs','kbdc_inv_row_sigs'].forEach(k => localStorage.removeItem(k));
    });
    return page;
  }

  // Imported before anything stamped them: NO updatedAt on any row. This is
  // the state of almost every row in the clinic's Sheet, and the whole point.
  const SEED = [
    { name: 'Sorbitrate 5', cat: 'Emergency Drugs', stock: 10, totalIn: 10, totalOut: 0, price: 5,
      batches: [{ batch: 'S1', expiry: '2029-01-01', stock: 10 }] },
    { name: 'Gloves', cat: 'General', stock: 20, totalIn: 20, totalOut: 0, price: 9, batches: [] }
  ];

  const A = await device('A'), Bd = await device('B');
  for (const p of [A, Bd]) await p.evaluate(rows => {
    localStorage.setItem('kbdc_inv_items', JSON.stringify(rows));
    localStorage.setItem('kbdc_inv_tx', '[]');
  }, SEED);
  await A.evaluate(() => kbdcAutoSyncInventory()); await A.waitForTimeout(2500);
  await Bd.evaluate(() => kbdcAutoSyncInventory()); await Bd.waitForTimeout(2500);

  // Device A issues all ten — and, like the clinic's rows, WITHOUT a stamp.
  await A.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('kbdc_inv_items') || '[]');
    const i = rows.findIndex(r => r.name === 'Sorbitrate 5');
    rows[i] = Object.assign({}, rows[i], { stock: 0, totalOut: 10,
      batches: [{ batch: 'S1', expiry: '2029-01-01', stock: 0 }] });
    delete rows[i].updatedAt;                     // no stamp, as on the Sheet
    localStorage.setItem('kbdc_inv_items', JSON.stringify(rows));
  });
  await A.evaluate(() => kbdcAutoSyncInventory()); await A.waitForTimeout(3000);

  // Device B syncs. Nothing has been touched on B, so it must take the Sheet's.
  await Bd.evaluate(() => kbdcAutoSyncInventory()); await Bd.waitForTimeout(3000);
  const b = await Bd.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('kbdc_inv_items') || '[]').filter(x => x.name === 'Sorbitrate 5')[0];
    return { stock: r && r.stock, totalOut: r && r.totalOut,
             batchTotal: (r && r.batches || []).reduce((n, x) => n + (Number(x.stock) || 0), 0) };
  });
  console.log('  device B after syncing:', JSON.stringify(b));
  ok(Number(b.stock) === 0, 'an unstamped issue on another device finally reaches this one (stock ' + b.stock + ' of 0)');
  ok(Number(b.totalOut) === 10, 'with the issued total (' + b.totalOut + ' of 10)');
  ok(b.batchTotal === 0, 'and the batch emptied too, so Stock OUT agrees (' + b.batchTotal + ')');

  // The other half: an edit this device has NOT yet pushed must survive a pull.
  await Bd.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('kbdc_inv_items') || '[]');
    const i = rows.findIndex(r => r.name === 'Gloves');
    rows[i] = Object.assign({}, rows[i], { stock: 3, totalOut: 17 });   // unsent, unstamped
    localStorage.setItem('kbdc_inv_items', JSON.stringify(rows));
    // Pull only, so the edit has had no chance to go out first.
    return kbdcPullSheets(kbdcInvBackendUrl(), ['InventoryItems'], true).then(got => {
      const merged = kbdcMergeInvItemsByNameCat(rows, (got.data.InventoryItems || []).map(kbdcUnflattenRow));
      localStorage.setItem('kbdc_inv_items', JSON.stringify(merged));
    });
  });
  await Bd.waitForTimeout(1500);
  const kept = await Bd.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('kbdc_inv_items') || '[]').filter(x => x.name === 'Gloves')[0];
    return r && r.stock;
  });
  console.log('  unsent local edit after a pull:', kept);
  ok(Number(kept) === 3, 'an unsent change made here is NOT wiped by the Sheet (' + kept + ' of 3)');

  await browser.close();
  server.close();
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  process.exit(failed.length ? 1 : 0);
})();
