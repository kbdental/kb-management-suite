// The Inventory screen had a SECOND sync of its own, left over from when the
// inventory app was a standalone page: its own "Google Sheet Sync" card with
// its own URL box and Push to Sheet / Pull from Sheet / Test buttons, sitting
// underneath the suite's own automatic sync.
//
// It could not work, and it could do harm:
//   - "Push to Sheet" sent all 725 items in ONE request (about 846 KB, which
//     Apps Script's redirect hop drops) and called the action `saveItems`,
//     which the Inventory backend does not implement at all — so it answered
//     "Unknown action" on the rare occasions the request arrived.
//   - "Pull from Sheet" REPLACED this device's stock with whatever came back,
//     bypassing the merge that protects a movement not yet pushed.
//   - "Test" tested a connection this screen no longer uses.
//
// The owner was pressing these and reading "Failed: Failed to fetch" while the
// suite's own sync, two inches above, read "Backed up just now".
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
  if (i < 0) throw new Error('inventory template not found');
  const j = html.indexOf('\n', i);
  return JSON.parse(html.slice(i + 'var __kbdcInvTpl = '.length, j).replace(/;\s*$/, ''));
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const pass = [], failed = [];
  function ok(c, l) { (c ? pass : failed).push(l); console.log((c ? '  PASS ' : '  FAIL ') + l); }

  const html = fs.readFileSync(APP, 'utf8');
  const tpl = extractInvTemplate(html);

  // The backend implements these and nothing else. Anything the screen calls
  // outside this list can only ever come back "Unknown action".
  const gs = fs.readFileSync(__dirname + '/../backend/Inventory-Code.gs', 'utf8');
  const supported = (gs.match(/action === '([a-zA-Z]+)'/g) || []).map(m => m.split("'")[1]);
  console.log('  backend implements:', supported.join(', '));
  ok(supported.indexOf('saveItems') < 0, 'the backend has no saveItems — so "Push to Sheet" could never work');

  // No way left to reach it from the screen.
  for (const [what, needle] of [
    ['Push to Sheet',  'onclick="pushToSheet()'],
    ['Pull from Sheet', 'onclick="pullFromSheet()'],
    ['Test',           'onclick="testSheet()'],
    ['Save URL',       'onclick="saveGasUrl()']
  ]) ok(tpl.indexOf(needle) < 0, 'the ' + what + ' button is gone from the Inventory screen');
  for (const id of ['id="gas-url"', 'id="gas-url-s"', 'id="gas-status"', 'id="gas-st"'])
    ok(tpl.indexOf(id) < 0, 'and its ' + id.slice(4, -1) + ' box with it');

  // Nothing calls the old request helper any more.
  const callers = (tpl.match(/gasRequest\(/g) || []).length;
  ok(callers === 1, 'nothing calls the old gasRequest helper except its own definition (' + callers + ')');

  // Loaded for real: the Settings screen renders, says sync is automatic, and
  // offers no sync buttons.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kbdc-sett-'));
  const invPath = path.join(dir, 'inventory.html');
  fs.writeFileSync(invPath, tpl);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
  await page.goto('file://' + invPath);
  await page.evaluate(() => {
    localStorage.setItem('kbdc_role', 'admin');
    localStorage.setItem('kbdc_user', 'Admin');
    localStorage.setItem('kbdc_inv_items', '[]');
    localStorage.setItem('kbdc_inv_tx', '[]');
  });
  await page.reload(); await page.waitForTimeout(700);
  await page.click('#nb-sett').catch(() => {});
  await page.waitForTimeout(600);

  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  ok(/syncs automatically/i.test(body), 'the Settings screen says inventory syncs by itself');
  for (const label of ['Push to Sheet', 'Pull from Sheet']) {
    const n = await page.locator('button:has-text("' + label + '")').count();
    ok(n === 0, 'no "' + label + '" button on screen (' + n + ')');
  }

  // Even reached directly — from a stale cached page — they must not fire a
  // request at the Sheet.
  let hits = 0;
  await page.route('**/exec**', route => { hits++; return route.fulfill({ body: '{}', contentType: 'application/json' }); });
  await page.evaluate(() => {
    localStorage.setItem('kbdc_inv_gas_url', 'https://script.google.com/macros/s/INV/exec');
    try { pushToSheet(); } catch (e) {}
    try { pullFromSheet(); } catch (e) {}
    try { testSheet(); } catch (e) {}
  });
  await page.waitForTimeout(1200);
  ok(hits === 0, 'calling them directly sends nothing to the Sheet (' + hits + ' request(s))');

  ok(errs.length === 0, 'no script errors (' + JSON.stringify(errs).slice(0, 200) + ')');
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  process.exit(failed.length ? 1 : 0);
})();
