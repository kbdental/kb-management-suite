// "daily in morning this is what i see" — every staff member Absent, a red
// Backup issue, and "main Sheet read 16h ago · Attendance Sheet read 16h ago"
// on a page that had just been opened. Both backends frozen at the same
// instant, while the Attendance tab on the Sheet was filling up normally.
//
// test-hung-request covers a request that never ANSWERS. This is the other
// half: a request that answers its headers and then stalls part-way through
// the body. The abort timer was cleared the moment the headers arrived, so
// r.json() waited for ever with nothing left to cancel it — an ordinary
// outcome on a phone that walks out of signal, since Apps Script replies
// across a redirect. Two things then went wrong at once:
//   - the sync guard stayed raised, so every later cycle returned on its
//     first line and the device went quiet until someone reloaded;
//   - the global request queue never advanced, so every request the app would
//     ever make, on all three backends, was stuck behind the dead one.
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

  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Kolkata', ignoreHTTPSErrors: true })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
  await page.route('**/react@18/umd/react.production.min.js', r => r.fulfill({ body: R, contentType: 'application/javascript' }));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r => r.fulfill({ body: RD, contentType: 'application/javascript' }));
  await page.route('**/@babel/standalone/babel.min.js', r => r.fulfill({ body: B, contentType: 'application/javascript' }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => kbdcSetBackendUrl('https://script.google.com/macros/s/M/exec'));

  // Shorten the deadlines so the test runs in seconds rather than a minute.
  // The mechanism under test is the same one either way.
  await page.evaluate(() => { KBDC_REQ_TIMEOUT_MS = 1500; });

  /* A REAL stalled body: 200 OK, the right headers, a Content-Length that
     promises more than is ever sent, then silence with the socket held open.
     route.fulfill() can only serve a complete response, so requests are
     forwarded to this server instead — the browser genuinely sits waiting on
     a half-read body, which is the thing that used to hang for ever. */
  let stall = true;
  const seen = [];
  const held = [];
  const https = require('https');
  const path = require('path');
  const server = https.createServer({
    key: fs.readFileSync(path.join(__dirname, 'fixtures', 'stall-key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'fixtures', 'stall-cert.pem'))
  }, (req, res) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      let p = {}; try { p = JSON.parse(raw || '{}'); } catch (e) {}
      seen.push(p.action || '?');
      if (stall) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '4096',
                             'Access-Control-Allow-Origin': '*' });
        res.write('{"ok":true,"stamps":');   // partial JSON, never finished
        held.push(res);                      // socket kept open, body never ends
        return;
      }
      let body;
      if (p.action === 'getStamps') body = { ok: true, stamps: {}, version: '2026-09-08-1' };
      else if (p.action === 'getBatch') { const dt = {}; (p.sheets || []).forEach(sh => dt[sh] = []); body = { ok: true, data: dt, version: '2026-09-08-1' }; }
      else body = { ok: true, saved: {}, version: '2026-09-08-1' };
      const s = JSON.stringify(body);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s),
                           'Access-Control-Allow-Origin': '*' });
      res.end(s);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port;
  await page.route('**/exec**', route => route.continue({ url: 'https://127.0.0.1:' + PORT + '/exec' }));

  // One request goes out and dies in the stall.
  const stuck = await page.evaluate(() => {
    window.__stuckDone = false;
    kbdcBackendReq('Tasks', 'getStamps', {}).then(
      () => { window.__stuckDone = 'resolved'; },
      e => { window.__stuckDone = 'rejected: ' + (e && e.message); });
    return true;
  });
  ok(stuck, 'a request is sent into a reply that never completes');

  await page.waitForTimeout(8000);
  const stuckState = await page.evaluate(() => window.__stuckDone);
  console.log('  the stalled request ended as:', JSON.stringify(stuckState));
  ok(stuckState && String(stuckState).indexOf('rejected') === 0,
     'it gives up on its own instead of hanging for ever');

  // The queue must have moved on. This is the part that took the whole app
  // down with it: a later request has no timeout while it is still waiting.
  stall = false;
  const after = await page.evaluate(async () => {
    const t0 = Date.now();
    try {
      const r = await kbdcBackendReq('Tasks', 'getStamps', {});
      return { ok: !!(r && r.ok), ms: Date.now() - t0 };
    } catch (e) { return { ok: false, err: String(e && e.message), ms: Date.now() - t0 }; }
  });
  console.log('  the next request:', JSON.stringify(after));
  ok(after.ok, 'the very next request still gets through (' + JSON.stringify(after) + ')');

  /* And a whole sync cycle still runs afterwards. This is what the owner
     actually loses when it breaks: kbdcAutoSyncMain holds a re-entrancy guard
     that is only lowered when the run settles, so one stalled request used to
     leave it raised and every later sync — scheduled, on focus, or from the
     Sync now button — returned on its first line. The status line then sat on
     the same "read N hours ago" until the page was reloaded. */
  const before = seen.length;
  const cycled = await page.evaluate(async () => {
    const t0 = Date.now();
    await kbdcAutoSyncMain();
    return Date.now() - t0;
  });
  console.log('  a full sync after the stall took', cycled, 'ms · requests', before, '→', seen.length);
  ok(seen.length > before, 'a sync after the stall still reaches Google (' + before + ' → ' + seen.length + ')');
  const stamp = await page.evaluate(() => (kbdcGetSyncStatus() || {}).lastOk || '');
  ok(!!stamp && (Date.now() - new Date(stamp).getTime()) < 60000,
     'and the "Sheet read ..." stamp moves to now, instead of staying hours old');

  // kbdcDeadline itself: it must not leave a settled promise hanging, and must
  // pass a real answer straight through.
  const dl = await page.evaluate(async () => {
    const quick = await kbdcDeadline(Promise.resolve('through'), 5000, 'late');
    let late = '';
    try { await kbdcDeadline(new Promise(() => {}), 200, 'gave up'); }
    catch (e) { late = e.message; }
    let failed = '';
    try { await kbdcDeadline(Promise.reject(new Error('real error')), 5000, 'late'); }
    catch (e) { failed = e.message; }
    return { quick, late, failed };
  });
  console.log('  kbdcDeadline:', JSON.stringify(dl));
  ok(dl.quick === 'through', 'a normal answer passes straight through the deadline');
  ok(dl.late === 'gave up', 'a promise that never settles is given up on');
  ok(dl.failed === 'real error', 'and a genuine error is not replaced by the deadline');

  ok(errs.length === 0, 'no JavaScript errors (' + JSON.stringify(errs).slice(0, 200) + ')');
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  await browser.close();
  held.forEach(r => { try { r.destroy(); } catch (e) {} });
  server.close();
  process.exit(failed.length ? 1 : 0);
})();
