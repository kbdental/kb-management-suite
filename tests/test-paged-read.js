// "Inventory: Apps Script answered the redirected request with its greeting
// page instead of the data (a known Google redirect hiccup) — retrying", with
// "Largest download: 846 KB" in red, over and over.
//
// Apps Script answers a POST with a 302 the browser must follow, and a reply
// too big for that hop is dropped — the redirected GET lands back on the
// script and returns doGet's greeting. Reading fewer tabs per call was already
// in place, and it stops helping once ONE tab is bigger than the hop carries:
// InventoryItems, at 725 items, is about 846 KB on its own. Every retry asked
// for exactly the same oversized reply, so it never came.
//
// A tab can now be read a page at a time. Run against the REAL backend.
const { startServer } = require(__dirname + '/gas-server.js');
const GAS = process.env.KB_GAS || __dirname + '/../backend/Inventory-Code.gs';
const PORT = Number(process.env.KB_PORT || 8913);

(async () => {
  const { tabs, server } = await startServer(GAS, PORT);
  const pass = [], failed = [];
  function ok(c, l) { (c ? pass : failed).push(l); console.log((c ? '  PASS ' : '  FAIL ') + l); }
  const tok = 'kbdc-live-g01_zGKPi54vzk2zzKey7UST';
  const post = (obj) => new Promise(res => {
    const body = JSON.stringify(obj);
    const rq = require('http').request({ host: '127.0.0.1', port: PORT, path: '/exec', method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } },
      r => { let s = ''; r.on('data', c => s += c); r.on('end', () => res(JSON.parse(s))); });
    rq.end(body);
  });

  // The clinic's inventory: 725 items, each carrying its batches.
  const ITEMS = 725;
  const rows = [];
  for (let i = 0; i < ITEMS; i++) {
    rows.push({ name: 'Item ' + i, cat: 'Stationery', brand: 'Gold Leaf', company: 'Shanthi Impex',
      stock: i, price: 10 + i, updatedAt: '2026-10-06T05:00:00.000Z' });
  }
  const saved = await post({ token: tok, action: 'saveBatch', modules: { InventoryItems: rows } });
  ok(saved && saved.ok !== false, 'the 725 items are on the Sheet' + (saved && saved.error ? ': ' + saved.error : ''));

  // What the app used to do, and still does for an ordinary tab: ask for all
  // of it. This is the reply that is too big to survive the redirect hop.
  const whole = await post({ token: tok, action: 'getBatch', sheets: ['InventoryItems'] });
  const wholeBytes = JSON.stringify(whole).length;
  console.log('  whole tab in one reply:', Math.round(wholeBytes / 1024), 'KB,',
              (whole.data.InventoryItems || []).length, 'rows');
  ok((whole.data.InventoryItems || []).length === ITEMS, 'asking for the whole tab still returns every row');

  // Paged. Each reply has to be small enough to arrive.
  // An older script ignores `pages` and returns the whole tab, so `more` is
  // absent. The app treats that as "no more pages" and behaves exactly as it
  // did before — so read it defensively here too, and let the assertions
  // report the gap instead of throwing.
  const more = (res, name) => !!(res && res.more && res.more[name]);
  const PAGE = 150;
  let got = [], offset = 0, pages = 0, biggest = 0;
  while (pages++ < 50) {
    const res = await post({ token: tok, action: 'getBatch', sheets: ['InventoryItems'],
      pages: { InventoryItems: { offset: offset, limit: PAGE } } });
    if (res.ok === false) { console.log('  page rejected:', res.error); break; }
    const page = (res.data || {}).InventoryItems || [];
    biggest = Math.max(biggest, JSON.stringify(res).length);
    got = got.concat(page);
    if (!more(res, 'InventoryItems') || !page.length) break;
    offset += page.length;
  }
  console.log('  paged:', got.length, 'rows in', pages, 'pages · biggest reply',
              Math.round(biggest / 1024), 'KB');

  ok(got.length === ITEMS, 'paging returns every row (' + got.length + ' of ' + ITEMS + ')');
  ok(pages > 1, 'and it genuinely took more than one page (' + pages + ')');
  ok(biggest < wholeBytes / 3, 'each reply is a fraction of the whole tab (' +
     Math.round(biggest / 1024) + ' KB vs ' + Math.round(wholeBytes / 1024) + ' KB)');

  // The rows must come back in order and complete, not just in the right count.
  const names = got.map(r => r.name);
  ok(names[0] === 'Item 0' && names[ITEMS - 1] === 'Item ' + (ITEMS - 1),
     'the pages stitch back together in order');
  ok(new Set(names).size === ITEMS, 'with no row repeated across a page boundary');
  ok(got[200] && Number(got[200].stock) === 200 && got[200].brand === 'Gold Leaf',
     'and every field survives the paging');

  // Edges: past the end, and a limit larger than the tab.
  const past = await post({ token: tok, action: 'getBatch', sheets: ['InventoryItems'],
    pages: { InventoryItems: { offset: ITEMS + 50, limit: PAGE } } });
  ok(((past.data || {}).InventoryItems || []).length === 0 && !more(past, 'InventoryItems'),
     'asking past the last row returns nothing and says there is no more');
  const all = await post({ token: tok, action: 'getBatch', sheets: ['InventoryItems'],
    pages: { InventoryItems: { offset: 0, limit: 100000 } } });
  ok(((all.data || {}).InventoryItems || []).length === ITEMS && !more(all, 'InventoryItems'),
     'a limit bigger than the tab returns it all and says there is no more');
  const empty = await post({ token: tok, action: 'getBatch', sheets: ['NoSuchTab'],
    pages: { NoSuchTab: { offset: 0, limit: 10 } } });
  ok(((empty.data || {}).NoSuchTab || []).length === 0, 'a tab that does not exist is empty, not an error');

  // Mixed: one tab paged, another whole, in the same call.
  await post({ token: tok, action: 'saveBatch', modules: { InventoryStockIn: [
    { id: 'tx1', name: 'Item 1', qty: 5, updatedAt: '2026-10-06T05:00:00.000Z' }] } });
  const mixed = await post({ token: tok, action: 'getBatch',
    sheets: ['InventoryItems', 'InventoryStockIn'],
    pages: { InventoryItems: { offset: 0, limit: 10 } } });
  ok(((mixed.data || {}).InventoryItems || []).length === 10 &&
     ((mixed.data || {}).InventoryStockIn || []).length === 1,
     'one tab can be paged while another comes whole in the same call');

  server.close();
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  process.exit(failed.length ? 1 : 0);
})();
