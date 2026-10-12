// "Stationery stock has 71 items but it shows 69, and so on for another item
// category."
//
// Check Sheet settled where it was NOT: the device and the Sheet agreed on all
// 726 inventory rows, every quantity identical. The two missing items were on
// the device the whole time — they just could not be reached.
//
// Every category dropdown was built from the fixed CATS list and every lookup
// compared the category string exactly. An item stored as "stationery", or
// "Stationery " with a trailing space, or under a category that is not on the
// list at all, is then invisible in every category view: it does not appear
// under Stationery, it cannot be picked for Stock IN or Stock OUT, and it
// cannot be corrected or deleted — while still counting in "725 items" and
// still syncing perfectly.
//
// Paths default to the Linux sandbox; override with PW_MODULE / PW_CHROME.
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function extractInvTemplate(html) {
  const marker = 'var __kbdcInvTpl = "';
  const i = html.indexOf(marker);
  const j = html.indexOf('\n', i);
  return JSON.parse(html.slice(i + 'var __kbdcInvTpl = '.length, j).replace(/;\s*$/, ''));
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const pass = [], failed = [];
  function ok(c, l) { (c ? pass : failed).push(l); console.log((c ? '  PASS ' : '  FAIL ') + l); }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kbdc-cat-'));
  const invPath = path.join(dir, 'inventory.html');
  fs.writeFileSync(invPath, extractInvTemplate(fs.readFileSync(APP, 'utf8')));

  const page = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
  page.on('dialog', d => d.accept());
  await page.goto('file://' + invPath);

  // Three items that belong to Stationery, spelled three different ways —
  // plus one in a category that is not on the standard list at all.
  const ITEMS = [
    { name: 'A4 Paper',   cat: 'Stationery',  stock: 10, totalIn: 10, totalOut: 0, price: 1, batches: [] },
    { name: 'Stapler',    cat: 'stationery',  stock: 5,  totalIn: 5,  totalOut: 0, price: 1, batches: [] },
    { name: 'Pen Blue',   cat: 'Stationery ', stock: 7,  totalIn: 7,  totalOut: 0, price: 1, batches: [] },
    { name: 'Lab Coat',   cat: 'Laundry',     stock: 3,  totalIn: 3,  totalOut: 0, price: 1, batches: [] }
  ];
  await page.evaluate(items => {
    localStorage.setItem('kbdc_role', 'admin');
    localStorage.setItem('kbdc_user', 'Admin');
    localStorage.setItem('kbdc_inv_items', JSON.stringify(items));
    localStorage.setItem('kbdc_inv_tx', '[]');
  }, ITEMS);
  await page.reload(); await page.waitForTimeout(800);

  // ---- The Stock screen, filtered to Stationery ---------------------------
  const shown = await page.evaluate(() => {
    qc = 'Stationery'; qs = ''; qs2 = ''; pg = 0; sv('stk');
    return IT.filter(x => sameCat(x.cat, 'Stationery')).map(x => x.name);
  });
  console.log('  under Stationery:', JSON.stringify(shown));
  ok(shown.length === 3, 'all three Stationery items are reachable, however they are spelled (' + shown.length + ' of 3)');
  ok(shown.indexOf('Stapler') >= 0 && shown.indexOf('Pen Blue') >= 0,
     'including the lower-case one and the one with a trailing space');

  // ---- A category the standard list has never heard of --------------------
  const cats = await page.evaluate(() => allCats());
  ok(cats.indexOf('Laundry') >= 0, 'a category only the data knows about is still offered (Laundry)');
  ok(cats.filter(c => String(c).trim().toLowerCase() === 'stationery').length === 1,
     'and the three spellings of Stationery collapse to one entry in the list');

  // ---- Stock OUT must be able to issue from them --------------------------
  const issuable = await page.evaluate(() => {
    const out = {};
    ['Stationery', 'stationery', 'STATIONERY '].forEach(c => {
      out[c] = IT.filter(x => sameCat(x.cat, c)).map(x => x.name).sort().join(',');
    });
    return out;
  });
  console.log('  Stock OUT item list by spelling:', JSON.stringify(issuable));
  const lists = Object.keys(issuable).map(k => issuable[k]);
  ok(lists.every(l => l === lists[0] && l.split(',').length === 3),
     'Stock OUT offers the same three items whichever spelling is chosen');

  // ---- And the item can actually be found for a stock movement ------------
  const found = await page.evaluate(() => {
    // Exactly the lookup Stock OUT does before issuing.
    const x = IT.find(i => i.name === 'Stapler' && sameCat(i.cat, 'Stationery'));
    return x ? x.stock : null;
  });
  ok(found === 5, 'an item stored under a different spelling can be issued against (' + found + ')');

  // ---- A genuinely different word, not a spacing slip ---------------------
  // "Stationary" is not "Stationery". Matching cannot paper over that - the
  // items are simply under another heading - so the filter has to SAY where
  // they went, which is the whole of the owner's "71 but it shows 69".
  const counted = await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('kbdc_inv_items') || '[]');
    rows.push({ name: 'Box File', cat: 'Stationary', stock: 2, batches: [] });
    rows.push({ name: 'Tape', cat: 'Stationary', stock: 4, batches: [] });
    localStorage.setItem('kbdc_inv_items', JSON.stringify(rows));
    IT = rows;
    const cc = catCounts();
    return {
      stationery: cc[catKey('Stationery')] || 0,
      stationary: cc[catKey('Stationary')] || 0,
      offered: allCats().filter(c => /station/i.test(c))
    };
  });
  console.log('  category counts:', JSON.stringify(counted));
  ok(counted.stationery === 3 && counted.stationary === 2,
     'the two spellings are counted separately (' + counted.stationery + ' and ' + counted.stationary + ')');
  ok(counted.offered.length === 2,
     'and BOTH are offered in the filter, so the missing items can be found: ' + counted.offered.join(', '));

  const dd = await page.evaluate(() => { sv('stk'); const el = document.querySelector('#p-stk select'); return el ? el.innerHTML : ''; });
  ok(/Stationery \(3\)/.test(dd) && /Stationary \(2\)/.test(dd),
     'the filter shows each category with its item count');

  ok(errs.length === 0, 'no script errors (' + JSON.stringify(errs).slice(0, 200) + ')');
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  process.exit(failed.length ? 1 : 0);
})();
