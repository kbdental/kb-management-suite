// Two things in the owner's screenshots that were wrong on screen rather than
// wrong in the data:
//
// 1. "Inventory backend — Reachable, but running version 2026-09-22-1 — this
//    app expects 2026-09-08-1. Re-publish a new deployment version." The
//    Inventory script is a SEPARATE deployment on its own version, and it was
//    correct. Every backend was being measured against the main script's
//    version, so he was told to redeploy a backend that was already right.
//
// 2. A red "Stock changes are not reaching the Google Sheet" banner sitting
//    under a green "✓ Backed up just now". The header badge subscribes to the
//    sync status; the banner only read it while rendering, so it kept showing
//    an error that had already cleared — and would have missed a new one.
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

  // Each backend answers with ITS OWN correct version, exactly as the clinic's
  // three deployments do.
  let invFails = false;
  await page.route('**/exec**', route => {
    const inv = route.request().url().indexOf('/INV/') >= 0;
    let p = {}; try { p = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    const version = '2026-10-07-1';
    // The real failure from the owner's screenshot: the redirected request is
    // answered with the script's greeting page instead of the data.
    if (inv && invFails && p.action === 'getBatch') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(
        { ok: true, message: 'K.B. Dental backend is running. Send a POST request from the app.', version }) });
    }
    if (p.action === 'getBatch') { const dt = {}; (p.sheets || []).forEach(sh => dt[sh] = []);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: dt, version }) }); }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, stamps: {}, saved: {}, version }) });
  });

  await page.goto('file://' + APP); await page.waitForTimeout(900);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/MAIN/exec');
    kbdcSetInvBackendUrl('https://script.google.com/macros/s/INV/exec');
  });

  // ---- 1. Each backend judged against its own expected version ------------
  const probes = await page.evaluate(async () => {
    const main = await kbdcProbeBackend(kbdcBackendUrl(), 'Main backend');
    const inv  = await kbdcProbeBackend(kbdcInvBackendUrl(), 'Inventory backend', kbdcInvExpectedVersion());
    return { main: main.result, inv: inv.result, expects: kbdcInvExpectedVersion() };
  });
  console.log('  main:', probes.main);
  console.log('  inventory:', probes.inv);
  ok(/^OK —/.test(probes.main), 'the main backend reads OK');
  ok(/^OK —/.test(probes.inv), 'the inventory backend reads OK, not "re-publish a new deployment"');

  // An inventory script that really IS behind must still be reported.
  const stale = await page.evaluate(async () => {
    const r = await kbdcProbeBackend(kbdcInvBackendUrl(), 'Inventory backend', '2099-01-01-9');
    return r.result;
  });
  console.log('  when genuinely behind:', stale);
  ok(/Re-publish a new deployment/.test(stale) && stale.indexOf('2099-01-01-9') > 0,
     'a genuinely out-of-date script is still reported, against its OWN expected version');

  // ---- 2. The banner and the badge must agree -----------------------------
  await page.click('text=Admin Override').catch(() => {}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]', 'kbdc@admin').catch(() => {});
  await page.click('button:has-text("Enter")').catch(() => {}); await page.waitForTimeout(1200);
  await page.locator('.nav', { hasText: 'INVENTORY' }).first().click().catch(() => {});
  await page.waitForTimeout(1200);

  const shown = async () => ({
    banner: await page.locator('text=Stock changes are not reaching').count(),
    badge: (await page.locator('text=/Backed up|Backup issue/').first().innerText().catch(() => '')) || ''
  });

  // The Sheet starts answering the redirected read with its greeting page,
  // while this screen is open. The app must say so, in both places.
  invFails = true;
  await page.evaluate(() => kbdcAutoSyncInventory());
  await page.waitForTimeout(4000);
  const withErr = await shown();
  console.log('  while the inventory read is failing — banner:', withErr.banner, '· badge:', JSON.stringify(withErr.badge));
  ok(withErr.banner === 1, 'a failure that begins while this page is open is shown, not missed');
  ok(/Backup issue/.test(withErr.badge), 'and the header badge says so too, rather than a green tick');

  // It starts working again. The banner must clear WITHOUT the screen being
  // touched — this is the red banner under the green tick in the screenshot.
  invFails = false;
  await page.evaluate(() => kbdcAutoSyncInventory());
  await page.waitForTimeout(4000);
  const cleared = await shown();
  console.log('  once it recovers — banner:', cleared.banner, '· badge:', JSON.stringify(cleared.badge));
  ok(cleared.banner === 0, 'the banner clears on its own, instead of sitting there under a green badge');
  ok(/Backed up/.test(cleared.badge), 'and the badge goes green');

  // Arriving on the screen with a failure already in progress must show it too.
  invFails = true;
  await page.evaluate(() => kbdcAutoSyncInventory());
  await page.waitForTimeout(4000);
  await page.locator('.nav', { hasText: 'HOME' }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.locator('.nav', { hasText: 'INVENTORY' }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const onArrival = await shown();
  console.log('  arriving with it already failing — banner:', onArrival.banner, '· badge:', JSON.stringify(onArrival.badge));
  ok(onArrival.banner === 1, 'opening the screen during a failure shows the banner straight away');

  ok(errs.length === 0, 'no JavaScript errors (' + JSON.stringify(errs).slice(0, 200) + ')');
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
