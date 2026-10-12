// "jis device se stock in kara hai us device se app mein stock out ke time pe
// wo stock show ho raha hai but other devices mein nahi ho raha. sync now,
// re-upload everything har ek device se karke dekh liya fir bhi nahi ho raha."
//
// Two devices, the REAL Inventory backend running in Node, and a real stock-in.
// Device A books stock in and pushes; device B syncs and must see it.
//
// The clinic's 725 items were bulk-imported before the app stamped anything,
// so almost every row on the Sheet carries a BLANK updatedAt — that is the
// state this starts from, because it is the state that matters.
const { startServer } = require(__dirname + '/gas-server.js');
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const GAS = __dirname + '/../backend/Inventory-Code.gs';
const PORT = Number(process.env.KB_PORT || 8921);

(async () => {
  const { tabs, server } = await startServer(GAS, PORT);
  const browser = await chromium.launch({ executablePath: CHROME });
  const R  = fs.readFileSync(V + '/react/umd/react.production.min.js', 'utf8');
  const RD = fs.readFileSync(V + '/react-dom/umd/react-dom.production.min.js', 'utf8');
  const B  = fs.readFileSync(V + '/@babel/standalone/babel.min.js', 'utf8');
  const pass = [], failed = [];
  const sent = [], dropped = [];
  let dropBig = false;
  const DROP_OVER = 60000;
  function ok(c, l) { (c ? pass : failed).push(l); console.log((c ? '  PASS ' : '  FAIL ') + l); }

  // Two devices: separate browser contexts, so separate localStorage.
  async function device(name) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('  [' + name + '] page error: ' + String(e.message).slice(0, 120)));
    await page.route('**/react@18/umd/react.production.min.js', r => r.fulfill({ body: R, contentType: 'application/javascript' }));
    await page.route('**/react-dom@18/umd/react-dom.production.min.js', r => r.fulfill({ body: RD, contentType: 'application/javascript' }));
    await page.route('**/@babel/standalone/babel.min.js', r => r.fulfill({ body: B, contentType: 'application/javascript' }));
    await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
    /* Every backend call is forwarded to the real Code.gs running in Node and
       the reply handed back verbatim. Forwarded here rather than with
       route.continue, which refuses to change https to http. */
    await page.route('**/exec**', async route => {
      const body = route.request().postData() || '';
      try {
        const p = JSON.parse(body || '{}');
        if (p.action === 'saveBatch') {
          const rows = Object.keys(p.modules || {}).reduce((n, k) => n + (p.modules[k] || []).length, 0);
          sent.push({ dev: name, bytes: body.length, rows: rows, tabs: Object.keys(p.modules || {}).join('+') });
          // A Sheet that drops anything big, which is the Sheet this clinic has.
          if (dropBig && body.length > DROP_OVER) {
            dropped.push(body.length);
            return route.fulfill({ status: 404, contentType: 'text/html',
              body: '<!DOCTYPE html><html><body>Sorry, unable to open the file at this time.</body></html>' });
          }
        }
      } catch (e) {}
      const reply = await new Promise(res => {
        const rq = require('http').request(
          { host: '127.0.0.1', port: PORT, path: '/exec', method: 'POST',
            headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } },
          r => { let s = ''; r.on('data', c => s += c); r.on('end', () => res(s)); });
        rq.on('error', () => res('{"ok":false,"error":"forward failed"}'));
        rq.end(body);
      });
      return route.fulfill({ contentType: 'application/json', body: reply });
    });
    await page.goto('file://' + APP); await page.waitForTimeout(800);
    await page.evaluate(() => {
      kbdcSetInvBackendUrl('https://script.google.com/macros/s/INV/exec');
      ['kbdc_pull_revs', 'kbdc_pull_sizes', 'kbdc_pull_paged', 'kbdc_push_sigs'].forEach(k => localStorage.removeItem(k));
    });
    return page;
  }

  // The starting inventory, as it sits on the clinic's Sheet: a blank
  // updatedAt on every row, because they were imported before stamping.
  const ITEM = { name: 'L.A.', cat: 'General' };
  /* At the clinic's real size. This matters: 725 items is about 846 KB, which
     is over the limit for Apps Script's redirect hop, so the read is paged and
     the push is split into chunks. The two-item version of this test passes
     either way, which is exactly why it had to be run at full size. */
  const COUNT = Number(process.env.KB_ITEMS || 725);
  const seed = [{ name: 'L.A.', cat: 'General', stock: 0, totalIn: 0, totalOut: 0, price: 100, batches: [] }];
  for (let i = 1; i < COUNT; i++) {
    seed.push({ name: 'Filler Item ' + i, cat: 'General', stock: 5, totalIn: 5, totalOut: 0,
      price: 100 + i, brand: 'Gold Leaf', company: 'Shanthi Impex', hsn: '90212900', ref: 'PO-' + i,
      uom: 'Box', packing: '10 pcs/box', value: 500, issuedVal: 0, reorder: 2,
      batches: [{ batch: 'B' + i, expiry: '2029-01-01', stock: 5, brand: 'Gold Leaf', company: 'Shanthi Impex', uom: 'Box', packing: '10' }] });
  }

  const A = await device('A');
  const Bd = await device('B');
  for (const p of [A, Bd]) {
    await p.evaluate(rows => {
      localStorage.setItem('kbdc_inv_items', JSON.stringify(rows));
      localStorage.setItem('kbdc_inv_tx', '[]');
    }, seed);
  }
  // Both devices start agreeing with the Sheet.
  await A.evaluate(() => kbdcAutoSyncInventory()); await A.waitForTimeout(9000);
  await Bd.evaluate(() => kbdcAutoSyncInventory()); await Bd.waitForTimeout(9000);
  const onSheet0 = (tabs['InventoryItems'] || []).length - 1;
  ok(onSheet0 === seed.length, 'both devices start in step with the Sheet (' + onSheet0 + ' items)');

  // ---- Device A books 24 in, exactly as the Stock IN form does ------------
  // Measure only what the stock-in itself sends, not the initial seeding push.
  const mark = sent.length;
  await A.evaluate(item => {
    const rows = JSON.parse(localStorage.getItem('kbdc_inv_items') || '[]');
    const i = rows.findIndex(r => r.name === item.name && r.cat === item.cat);
    rows[i] = Object.assign({}, rows[i], {
      updatedAt: new Date().toISOString(), totalIn: 24, stock: 24,
      batches: [{ batch: 'B-77', expiry: '2029-01-01', stock: 24 }]
    });
    localStorage.setItem('kbdc_inv_items', JSON.stringify(rows));
    const tx = JSON.parse(localStorage.getItem('kbdc_inv_tx') || '[]');
    tx.unshift({ id: 'tx-in-1', type: 'IN', name: item.name, cat: item.cat, qty: 24,
      date: new Date().toISOString(), person: 'Admin', batch: 'B-77' });
    localStorage.setItem('kbdc_inv_tx', JSON.stringify(tx));
  }, ITEM);
  await A.evaluate(() => kbdcAutoSyncInventory()); await A.waitForTimeout(12000);

  // The Sheet must now hold both the movement AND the new stock figure.
  const hdr = (tab) => (tabs[tab] || [])[0] || [];
  const rowsOf = (tab) => {
    const h = hdr(tab), out = [];
    (tabs[tab] || []).slice(1).forEach(r => { const o = {}; h.forEach((k, i) => o[k] = r[i]); out.push(o); });
    return out;
  };
  const stockInRows = rowsOf('InventoryStockIn');
  const sheetItem = rowsOf('InventoryItems').filter(r => r.name === ITEM.name)[0];
  console.log('  Sheet after A books in — StockIn rows:', stockInRows.length,
              '· item stock:', sheetItem && sheetItem.stock, '· updatedAt:', (sheetItem && sheetItem.updatedAt) || '(blank)');
  ok(stockInRows.some(r => r.id === 'tx-in-1'), 'the stock-in movement reaches the InventoryStockIn tab');
  ok(sheetItem && Number(sheetItem.stock) === 24,
     'and the item’s stock on the Sheet becomes 24 (' + (sheetItem && sheetItem.stock) + ')');

  const inPush = sent.slice(mark).filter(x => x.dev === 'A');
  const biggest = inPush.reduce((m, x) => Math.max(m, x.bytes), 0);
  const totalRows = inPush.reduce((n, x) => n + x.rows, 0);
  console.log('  A\u2019s push for one stock-in:', inPush.length, 'request(s), biggest',
              Math.round(biggest / 1024), 'KB,', totalRows, 'rows');
  ok(biggest < 60000, 'booking one item in sends a small request, not 846 KB (' +
     Math.round(biggest / 1024) + ' KB)');
  ok(totalRows < 20, 'and a handful of rows, not all ' + COUNT + ' (' + totalRows + ')');

  // ---- Device B syncs. This is what the owner says does not happen -------
  await Bd.evaluate(() => kbdcAutoSyncInventory()); await Bd.waitForTimeout(12000);
  const bStock = await Bd.evaluate(item => {
    const rows = JSON.parse(localStorage.getItem('kbdc_inv_items') || '[]');
    const r = rows.filter(x => x.name === item.name && x.cat === item.cat)[0];
    return { stock: r && r.stock, batches: (r && r.batches) ? JSON.stringify(r.batches).slice(0, 80) : '' };
  }, ITEM);
  console.log('  device B after syncing — stock:', bStock.stock, '· batches:', bStock.batches);
  ok(Number(bStock.stock) === 24,
     'device B sees the stock booked in on device A (' + bStock.stock + ' of 24)');
  ok(/B-77/.test(bStock.batches), 'including the batch, so Stock OUT can issue from it');

  // ---- And B must not push its stale copy back over A's ------------------
  await Bd.evaluate(() => kbdcAutoSyncInventory()); await Bd.waitForTimeout(9000);
  await A.evaluate(() => kbdcAutoSyncInventory()); await A.waitForTimeout(9000);
  const after = rowsOf('InventoryItems').filter(r => r.name === ITEM.name)[0];
  ok(after && Number(after.stock) === 24,
     'and a further round of syncing does not undo it (' + (after && after.stock) + ')');
  const aStock = await A.evaluate(item => {
    const rows = JSON.parse(localStorage.getItem('kbdc_inv_items') || '[]');
    const r = rows.filter(x => x.name === item.name && x.cat === item.cat)[0];
    return r && r.stock;
  }, ITEM);
  ok(Number(aStock) === 24, 'device A still reads 24 too (' + aStock + ')');

  /* And now the Sheet this clinic actually has: one that drops anything large.
     The whole-tab push could never get through it; a changed-rows push can. */
  dropBig = true;
  const n0 = sent.length;
  await A.evaluate(item => {
    const rows = JSON.parse(localStorage.getItem('kbdc_inv_items') || '[]');
    const i = rows.findIndex(r => r.name === item.name && r.cat === item.cat);
    rows[i] = Object.assign({}, rows[i], { updatedAt: new Date().toISOString(), stock: 19, totalOut: 5 });
    localStorage.setItem('kbdc_inv_items', JSON.stringify(rows));
  }, ITEM);
  await A.evaluate(() => kbdcAutoSyncInventory()); await A.waitForTimeout(12000);
  await Bd.evaluate(() => kbdcAutoSyncInventory()); await Bd.waitForTimeout(12000);
  const bAfter = await Bd.evaluate(item => {
    const rows = JSON.parse(localStorage.getItem('kbdc_inv_items') || '[]');
    const r = rows.filter(x => x.name === item.name && x.cat === item.cat)[0];
    return r && r.stock;
  }, ITEM);
  console.log('  with a Sheet that drops anything over', Math.round(DROP_OVER / 1024),
              'KB \u2014 requests dropped:', dropped.length, '\u00b7 device B now reads:', bAfter);
  ok(Number(bAfter) === 19,
     'a stock-out still reaches device B through a Sheet that drops big requests (' + bAfter + ' of 19)');

  await browser.close();
  server.close();
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  process.exit(failed.length ? 1 : 0);
})();
