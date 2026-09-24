// "when i try to delete any items from the stock as it is not in used anymore
// now. however, even after deleting, it is not getting deleted it comes in
// stock again."
//
// Delete Product used to splice the item out of the local list and save. The
// sync merges rows and never deletes — it cannot tell "this device deleted the
// row" from "this device hasn't pulled the row yet" — so the very next pull
// handed the item straight back. This drives the real Manage -> Delete & Sync
// button, then replays a pull from a Sheet that still holds the old row
// through the app's own merge, and checks the item stays gone.
//
// Paths default to the Linux sandbox; override with PW_MODULE / PW_CHROME.
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// The mini-app ships inside index.html as a JSON string literal that the
// Inventory page drops into an iframe's srcdoc. Pull out the very same text
// the app runs, so this tests what is shipped rather than a copy of it.
function extractInvTemplate(html) {
  const marker = 'var __kbdcInvTpl = "';
  const i = html.indexOf(marker);
  if (i < 0) throw new Error('inventory template not found in index.html');
  const j = html.indexOf('\n', i);
  const raw = html.slice(i + 'var __kbdcInvTpl = '.length, j).replace(/;\s*$/, '');
  return JSON.parse(raw);
}

const ITEM = {
  name: 'L.A.', cat: 'Emergency Drugs', brand: 'Septodont', uom: 'Box', packing: '50',
  totalIn: 24, totalOut: 0, stock: 24, price: 100, value: 2400, issuedVal: 0, reorder: 5,
  batches: [{ batch: 'B-77', expiry: '2027-01-31', stock: 24, brand: 'Septodont', company: '', uom: 'Box', packing: '50' }]
};
const KEEP = { name: 'Gloves', cat: 'General', stock: 10, batches: [] };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const R  = fs.readFileSync(V + '/react/umd/react.production.min.js', 'utf8');
  const RD = fs.readFileSync(V + '/react-dom/umd/react-dom.production.min.js', 'utf8');
  const B  = fs.readFileSync(V + '/@babel/standalone/babel.min.js', 'utf8');
  const pass = [], failed = [];
  function ok(c, l) { (c ? pass : failed).push(l); console.log((c ? '  PASS ' : '  FAIL ') + l); }

  const html = fs.readFileSync(APP, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kbdc-del-'));
  const invPath = path.join(dir, 'inventory.html');
  fs.writeFileSync(invPath, extractInvTemplate(html));

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, timezoneId: 'Asia/Kolkata' });

  // ---- 1. The mini-app: delete the item through the real button ------------
  const inv = await ctx.newPage();
  const invErrs = []; inv.on('pageerror', e => invErrs.push(String(e.message).slice(0, 150)));
  inv.on('dialog', d => d.accept());
  await inv.goto('file://' + invPath);
  await inv.evaluate(seed => {
    localStorage.setItem('kbdc_role', 'admin');
    localStorage.setItem('kbdc_user', 'Admin');
    localStorage.setItem('kbdc_inv_items', JSON.stringify(seed));
    localStorage.setItem('kbdc_inv_tx', '[]');
  }, [ITEM, KEEP]);
  await inv.reload();
  await inv.waitForTimeout(600);

  ok(await inv.isVisible('#main-app'), 'mini-app opens straight into the admin view');

  await inv.click('#nb-mgr');
  await inv.waitForTimeout(300);
  await inv.selectOption('#dc', ITEM.cat);
  await inv.waitForTimeout(200);
  await inv.selectOption('#di', ITEM.name);
  await inv.waitForTimeout(200);
  await inv.click('button:has-text("Delete & Sync")');
  await inv.waitForTimeout(700);

  const afterDelete = await inv.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('kbdc_inv_items') || '[]'),
    shown: (typeof IT !== 'undefined' ? IT : []).map(x => x.name)
  }));
  const tomb = afterDelete.stored.filter(r => r.name === ITEM.name)[0];

  ok(afterDelete.shown.indexOf(ITEM.name) < 0, 'the item disappears from the live list');
  ok(afterDelete.shown.indexOf(KEEP.name) >= 0, 'and the other item is untouched');
  ok(!!tomb && tomb.removed === true, 'a deletion is written down, not just dropped locally');
  ok(!!tomb && !!tomb.updatedAt && !isNaN(new Date(tomb.updatedAt).getTime()),
     'the deletion is timestamped, so it can out-date the row on the Sheet');

  // ---- 2. The sync: a Sheet that still holds the old row -------------------
  const main = await ctx.newPage();
  const mainErrs = []; main.on('pageerror', e => mainErrs.push(String(e.message).slice(0, 150)));
  await main.route('**/react@18/umd/react.production.min.js', r => r.fulfill({ body: R, contentType: 'application/javascript' }));
  await main.route('**/react-dom@18/umd/react-dom.production.min.js', r => r.fulfill({ body: RD, contentType: 'application/javascript' }));
  await main.route('**/@babel/standalone/babel.min.js', r => r.fulfill({ body: B, contentType: 'application/javascript' }));
  await main.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await main.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  await main.goto('file://' + APP);
  await main.waitForTimeout(800);

  // The Sheet knows nothing of the delete yet: it still returns the item, and
  // a Google Sheet hands booleans back as real booleans and blank cells as ''.
  const merged = await main.evaluate(args => {
    const [local, remote] = args;
    return kbdcMergeInvItemsByNameCat(local, remote);
  }, [afterDelete.stored, [ITEM, KEEP]]);

  const mergedRow = merged.filter(r => r.name === ITEM.name)[0];
  ok(!!mergedRow && mergedRow.removed === true,
     'the sync merge lets the deletion win over the row still on the Sheet');
  ok(merged.filter(r => r.name === KEEP.name).length === 1, 'the untouched item survives the merge');

  // The push has to carry the deletion up, or no other device ever hears of it.
  const pushed = await main.evaluate(rows => {
    localStorage.setItem('kbdc_inv_items', JSON.stringify(rows));
    const m = KBDC_INVENTORY_MODULES.filter(x => x.localKey === 'kbdc_inv_items')[0];
    return m.get();
  }, merged);
  ok(pushed.filter(r => r.name === ITEM.name && r.removed === true).length === 1,
     'the deletion is uploaded to the Sheet, so every other device sees it');

  // ---- 3. Back in the mini-app after that pull -----------------------------
  await inv.evaluate(rows => localStorage.setItem('kbdc_inv_items', JSON.stringify(rows)), merged);
  await inv.reload();
  await inv.waitForTimeout(700);
  const afterPull = await inv.evaluate(() => ({
    shown: (typeof IT !== 'undefined' ? IT : []).map(x => x.name),
    count: (document.getElementById('icnt') || {}).textContent || ''
  }));
  ok(afterPull.shown.indexOf(ITEM.name) < 0, 'the deleted item does NOT come back after a sync');
  ok(afterPull.shown.indexOf(KEEP.name) >= 0, 'and the rest of the stock is still there');
  ok(afterPull.count.indexOf('1 item') === 0, 'the item count reads 1, not 2 ("' + afterPull.count + '")');

  // A Sheet round trip turns removed into the string 'TRUE' as often as a
  // boolean; the reader has to accept both or the item reappears on one device.
  const textTomb = await inv.evaluate(item => {
    localStorage.setItem('kbdc_inv_items', JSON.stringify([
      Object.assign({}, item, { removed: 'TRUE', updatedAt: new Date().toISOString() }),
      { name: 'Gloves', cat: 'General', stock: 10, batches: [] }
    ]));
    return kbdcInvLive(JSON.parse(localStorage.getItem('kbdc_inv_items'))).map(x => x.name);
  }, ITEM);
  ok(textTomb.indexOf(ITEM.name) < 0, "a deletion read back from the Sheet as text ('TRUE') still counts");

  // ---- 4. Adding the item back must beat its own tombstone ----------------
  await inv.reload();
  await inv.waitForTimeout(600);
  const readded = await inv.evaluate(item => {
    const fresh = Object.assign({}, item, { stock: 12, batches: [] });
    const saved = kbdcInvMergeSave([fresh, { name: 'Gloves', cat: 'General', stock: 10, batches: [] }]);
    const row = saved.filter(r => r.name === item.name);
    return { rows: row.length, removed: row[0] && row[0].removed, at: row[0] && row[0].updatedAt };
  }, ITEM);
  ok(readded.rows === 1 && readded.removed === false,
     'adding the item back clears its deletion instead of leaving both rows');
  ok(!!readded.at, 'and is timestamped, so it out-dates the deletion on every device');

  // ---- 5. A phone still on the old build pushes the item back ------------
  // The Sheet then holds a live row again. This device keeps the deletion
  // (it is newer), but it must also correct the Sheet, or a phone that never
  // saw the deletion shows the item again.
  const healed = await main.evaluate(args => {
    const [local, sheetRows] = args;
    localStorage.setItem('kbdc_inv_items', JSON.stringify(local));
    kbdcSetPushSigs({ 'inv:InventoryItems': 'unchanged-since-last-push' });
    const merged = kbdcMergeInvItemsByNameCat(local, sheetRows);
    const liveOnSheet = {};
    sheetRows.forEach(r => { if (r && r.name && !kbdcInvRowRemoved(r)) liveOnSheet[kbdcInvRowKey(r)] = true; });
    return {
      stillDeleted: merged.filter(r => r.name === 'L.A.').every(r => kbdcInvRowRemoved(r)),
      undone: merged.some(r => kbdcInvRowRemoved(r) && liveOnSheet[kbdcInvRowKey(r)])
    };
  }, [merged, [ITEM, KEEP]]);
  ok(healed.stillDeleted, 'an older phone pushing the item back does not undo the delete here');
  ok(healed.undone, 'and the Sheet is spotted as out of date, so the delete is re-uploaded');

  ok(invErrs.length === 0, 'no script errors in the inventory app' + (invErrs.length ? ': ' + invErrs[0] : ''));
  ok(mainErrs.length === 0, 'no script errors in the suite' + (mainErrs.length ? ': ' + mainErrs[0] : ''));

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n' + pass.length + ' passed, ' + failed.length + ' failed');
  if (failed.length) { failed.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
