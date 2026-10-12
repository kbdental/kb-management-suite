// "It shows version 2026-10-07-1 — guide me how can I update it to the latest
// one."
//
// He had been reloading by hand all afternoon and still running a build from
// five days earlier, while fix after fix went out. The updater only installed
// a new build while the tab was HIDDEN — right on a phone that gets put down,
// useless on a desktop that stays open on one screen all day. It spotted the
// new version, set a variable, and waited silently with nothing on screen to
// say so.
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

  const html = fs.readFileSync(APP, 'utf8');
  const running = (html.match(/KBDC_APP_VERSION = '([^']+)'/) || [])[1];
  // What the server will claim is available: the same page, one version newer.
  const NEWER = '2099-01-01-9';
  const newerHtml = html.replace("KBDC_APP_VERSION = '" + running + "'", "KBDC_APP_VERSION = '" + NEWER + "'");

  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
  await page.route('**/react@18/umd/react.production.min.js', r => r.fulfill({ body: R, contentType: 'application/javascript' }));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r => r.fulfill({ body: RD, contentType: 'application/javascript' }));
  await page.route('**/@babel/standalone/babel.min.js', r => r.fulfill({ body: B, contentType: 'application/javascript' }));
  await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.route('**/exec**', r => r.fulfill({ contentType: 'application/json', body: '{"ok":true,"version":"2026-10-07-1"}' }));

  // The page itself is served normally; the updater's own no-store re-fetch of
  // it is answered with the newer build, which is exactly the real situation.
  let served = 0;
  await page.route(/index\.html(\?|$)/, route => {
    served++;
    return route.fulfill({ contentType: 'text/html', body: served === 1 ? html : newerHtml });
  });

  await page.goto('file://' + APP);
  await page.waitForTimeout(500);
  // The tab is visible — the case that used to wait silently for ever.
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(2500);

  const bar = page.locator('#kbdc-update-bar');
  const shown = await bar.count();
  ok(shown === 1, 'a visible tab is TOLD a newer build is ready (' + shown + ')');
  if (shown) {
    const text = (await bar.innerText()).replace(/\s+/g, ' ');
    console.log('  bar says:', JSON.stringify(text));
    ok(text.indexOf(NEWER) >= 0, 'and names the version waiting');
    ok(/Update now/.test(text), 'with a button to take it');

    // "Later" dismisses it rather than nagging.
    await page.locator('#kbdc-update-bar button:has-text("Later")').click();
    await page.waitForTimeout(300);
    ok(await page.locator('#kbdc-update-bar').count() === 0, '"Later" dismisses it');

    // And "Update now" actually loads a fresh, cache-busted copy.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(2200);
    await page.locator('#kbdc-update-bar button:has-text("Update now")').click();
    await page.waitForTimeout(1200);
    const went = page.url();
    console.log('  pressing it navigates to:', went.slice(-40));
    ok(/\?_v=\d+/.test(went), 'pressing it loads a fresh copy, cache-busted (' + went.slice(-30) + ')');
  }

  // And it must not nag when the running build IS the newest.
  const page2 = await (await browser.newContext()).newPage();
  page2.on('pageerror', e => errs.push(String(e.message).slice(0, 150)));
  for (const [pat, body] of [['**/react@18/**', R], ['**/react-dom@18/**', RD], ['**/@babel/standalone/**', B]])
    await page2.route(pat, r => r.fulfill({ body, contentType: 'application/javascript' }));
  await page2.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page2.route('**/cdnjs.cloudflare.com/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
  await page2.route('**/exec**', r => r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  await page2.route(/index\.html(\?|$)/, route => route.fulfill({ contentType: 'text/html', body: html }));
  await page2.goto('file://' + APP);
  await page2.waitForTimeout(2500);
  ok(await page2.locator('#kbdc-update-bar').count() === 0, 'and says nothing when the build is already current');

  ok(errs.length === 0, 'no script errors (' + JSON.stringify(errs).slice(0, 200) + ')');
  await browser.close();
  console.log('\n==== ' + pass.length + ' passed, ' + failed.length + ' failed ====');
  if (failed.length) failed.forEach(f => console.log('  FAIL: ' + f));
  process.exit(failed.length ? 1 : 0);
})();
