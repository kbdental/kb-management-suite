// A phone, on the very screen that matters: "Inventory Sheet is busy: Google
// turned one request away (HTTP 404) while the script was overloaded."
//
// The paging fix only engaged for a tab the device had already MEASURED as
// large. A phone that has never read the Sheet — a new one, or one whose
// storage was cleared — knows no sizes, so the big tab starts out inside a
// group of four. The group failed, split once into two, and gave up: it never
// reached the single tab, which was the only place paging kicked in. So the
// devices that needed it most never got it.
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

  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 }, timezoneId: 'Asia/Kolkata' })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
  await page.route('**/react@18/umd/react.production.min.js', r => r.fulfill({ body: R, contentType: 'application/javascript' }));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r => r.fulfill({ body: RD, contentType: 'application/javascript' }));
  await page.route('**/@babel/standalone/babel.min.js', r => r.fulfill({ body: B, contentType: 'application/javascript' }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));

  // A Sheet that behaves exactly like the real one: any reply carrying the
  // whole of the big tab is too large for the redirect hop and comes back as
  // Google's 404 page. A paged request is small enough to arrive.
  const BIG = 'InventoryItems', ROWS = 725;
  const asked = [];
  await page.route('**/exec**', route => {
    let p = {}; try { p = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const V2 = '2026-10-07-1';
    if (p.action === 'getStamps') return route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ ok: true, stamps: {}, version: V2 }) });
    if (p.action !== 'getBatch') return route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ ok: true, saved: {}, version: V2 }) });

    const sheets = p.sheets || [], pg = (p.pages || {})[BIG];
    asked.push(sheets.join('+') + (pg ? ('[' + pg.offset + '+' + pg.limit + ']') : ''));
    // The whole of the big tab, unpaged, never arrives.
    if (sheets.indexOf(BIG) >= 0 && !pg) {
      return route.fulfill({ status: 404, contentType: 'text/html',
        body: '<!DOCTYPE html><html><body>Sorry, unable to open the file at this time.</body></html>' });
    }
    const dt = {}; const more = {};
    sheets.forEach(sh => {
      if (sh === BIG && pg) {
        const start = pg.offset || 0, n = Math.min(pg.limit || 100, ROWS - start);
        dt[sh] = [];
        for (let i = 0; i < n; i++) dt[sh].push({ name: 'Item ' + (start + i), cat: 'Stationery', stock: start + i });
        more[sh] = (start + n) < ROWS;
      } else dt[sh] = [];
    });
    return route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: dt, more: more, version: V2 }) });
  });

  await page.goto('file://' + APP); await page.waitForTimeout(900);
  // A device that has never read this Sheet: no measured sizes at all. This is
  // the state every phone is in after an update that clears storage, and the
  // state the owner's phone was in when it reported "Inventory Sheet is busy".
  await page.evaluate(() => {
    kbdcSetInvBackendUrl('https://script.google.com/macros/s/INV/exec');
    localStorage.removeItem('kbdc_pull_sizes');
    localStorage.removeItem('kbdc_pull_revs');
  });

  const got = await page.evaluate(async (BIG) => {
    try {
      // The big tab inside a group of four, exactly as kbdcPullSheets builds
      // it when no sizes are known.
      const res = await kbdcPullSheets(kbdcInvBackendUrl(),
        ['InventoryStockIn', 'InventoryStockOut', BIG, 'InventoryTransactions'], false);
      return { rows: ((res.data || {})[BIG] || []).length, err: '' };
    } catch (e) { return { rows: -1, err: String(e && e.message).slice(0, 120) }; }
  }, BIG);

  console.log('  requests made:', JSON.stringify(asked));
  console.log('  rows retrieved:', got.rows, got.err ? ('· error: ' + got.err) : '');

  ok(got.rows === ROWS, 'a device that has never measured the tab still gets all ' + ROWS +
     ' rows (' + got.rows + ')');
  ok(!got.err, 'instead of "Inventory Sheet is busy ... HTTP 404"' + (got.err ? ': ' + got.err : ''));
  ok(asked.some(a => /\[\d+\+\d+\]/.test(a)), 'it got down to asking for the tab a page at a time');
  ok(asked.filter(a => /\[\d+\+\d+\]/.test(a)).length >= 4, 'across several pages (' +
     asked.filter(a => /\[\d+\+\d+\]/.test(a)).length + ')');

  // The size is now known, so the next read must go straight to paging rather
  // than discovering it the hard way again.
  const sizes = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_pull_sizes') || '{}'));
  ok((sizes[BIG] || 0) > 0, 'and the tab’s size is written down for next time');

  const n0 = asked.length;
  const again = await page.evaluate(async (BIG) => {
    localStorage.removeItem('kbdc_pull_revs');   // force a re-read
    const res = await kbdcPullSheets(kbdcInvBackendUrl(),
      ['InventoryStockIn', 'InventoryStockOut', BIG, 'InventoryTransactions'], false);
    return ((res.data || {})[BIG] || []).length;
  }, BIG);
  const second = asked.slice(n0);
  console.log('  second read:', again, 'rows ·', JSON.stringify(second));
  ok(again === ROWS, 'the second read gets every row too');
  ok(!second.some(a => a.indexOf(BIG) >= 0 && !/\[/.test(a)),
     'and never asks for the whole tab again, now that it knows the size');

  ok(errs.length === 0, 'no JavaScript errors (' + JSON.stringify(errs).slice(0, 200) + ')');
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
