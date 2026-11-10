// "staffs reupload karne ka try kar rahe h fir bhi attendance thik se leave &
// attendance ke dashboard mein nahi aa rahi hai or sabke phone mein backup few
// days pehle ka hi show ho ra h refresh or reupload everything pe click karne
// ke bad bhi."
//
// The Attendance Sheet held every check-in. The dashboard showed nobody in and
// every phone said "Backed up 5d ago".
//
// Cause: the main push re-sent whole append-only ledgers. TaskCompletions had
// grown to 4,668 rows (3.0 MB) and the "never skip today's ticks" guard
// assigned the ENTIRE tab, so every device every cycle chunked 3 MB into 26
// serialized Apps Script writes to deliver five new rows; attendance's 565 rows
// (259 KB) went the same way, twice over. Each write takes the Sheet's script
// lock, so the main push never finished — "Backed up" froze — and the
// attendance pull, which runs after it in the same cycle, never got its turn.
//
// A cycle must stay small whatever the ledgers weigh, today's rows must still
// arrive, and the attendance Sheet must still be read in the same cycle.
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium';

const MAIN = 'https://script.google.com/macros/s/MAIN/exec';
const ATT  = 'https://script.google.com/macros/s/ATTX/exec';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const R  = fs.readFileSync(V + '/react/umd/react.production.min.js','utf8');
  const RD = fs.readFileSync(V + '/react-dom/umd/react-dom.production.min.js','utf8');
  const B  = fs.readFileSync(V + '/@babel/standalone/babel.min.js','utf8');
  const pass=[], failed=[];
  function ok(c,l){ (c?pass:failed).push(l); console.log((c?'  PASS ':'  FAIL ')+l); }

  const page = await (await browser.newContext({ viewport:{width:1450,height:1050}, timezoneId:'Asia/Kolkata' })).newPage();
  page.on('pageerror', e => console.log('  pageerror: ' + String(e.message).slice(0,160)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));

  // The fake clinic Sheets. Counting happens here, where the real cost is.
  let saves = 0, pushBytes = 0, attReads = 0, started = false;
  const attOnSheet = {};              // id -> row, on the attendance Sheet
  const attRemote = [{ id:'att_remote_today', staffId:'EM9', staffName:'Sanjeeta',
                       date:'TODAY', checkIn:'09:02', checkOut:'' }];
  await page.route('**/exec**', route => {
    const url = route.request().url();
    const raw = route.request().postData() || '';
    let p = {}; try { p = JSON.parse(raw); } catch(e) {}
    const isAtt = url.indexOf('/ATTX/') >= 0;
    if (p.action === 'getStamps') {
      return route.fulfill({ contentType:'application/json',
        body: JSON.stringify({ ok:true, stamps:{ Attendance: 1 }, version:'2026-10-07-1' }) });
    }
    if (p.action === 'getBatch') {
      const data = {};
      (p.sheets || []).forEach(s => { data[s] = []; });
      if (isAtt) { attReads++; data['Attendance'] = attRemote.slice(); }
      return route.fulfill({ contentType:'application/json',
        body: JSON.stringify({ ok:true, data, version:'2026-10-07-1' }) });
    }
    if (p.action === 'saveBatch') {
      if (started) { saves++; pushBytes += raw.length; }
      if (isAtt) ((p.modules || {}).Attendance || []).forEach(r => { attOnSheet[r.id] = r; });
      return route.fulfill({ contentType:'application/json',
        body: JSON.stringify({ ok:true, saved:{}, version:'2026-10-07-1' }) });
    }
    return route.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true, version:'2026-10-07-1' }) });
  });

  await page.goto('file://' + APP); await page.waitForTimeout(800);

  // A clinic that has been running for months: a real-sized tick log and a
  // real-sized attendance history, all of it long since on the Sheet.
  const seeded = await page.evaluate(({ MAIN, ATT }) => {
    localStorage.clear();
    kbdcSetBackendUrl(MAIN);
    kbdcSetAttBackendUrl(ATT);
    const d = new Date(), pad = n => (n<10?'0':'')+n;
    const day = k => { const x = new Date(d.getTime() - k*86400000);
      return x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate()); };
    const today = day(0);

    const log = [], sent = {};
    for (let i = 0; i < 4600; i++) {
      const r = { id:'tc'+i, date: day(2 + (i % 180)), time:'10:15', staffName:'Suman Rathor',
                  roleCode:'LDN', taskCode:'LDN'+(i%40), taskEn:'Sterilise and lay out the instrument tray for the next patient',
                  done:true, updatedAt: day(2 + (i % 180))+'T10:15:00.000Z' };
      log.push(r); sent[r.id] = String(r.updatedAt);
    }
    localStorage.setItem('kbdc_task_log', JSON.stringify(log));
    localStorage.setItem('kbdc_log_sent', JSON.stringify(sent));

    const att = [];
    for (let i = 0; i < 560; i++) {
      att.push({ id:'att'+i, staffId:'EM'+(i%7), staffName:'Staff '+(i%7), date: day(1 + (i % 180)),
                 checkIn:'09:0'+(i%10), checkOut:'18:3'+(i%10), hours:9.1, branch:'Main Branch',
                 locIn:'{"lat":28.6768751,"lng":77.3127879,"address":"Dilshad Garden, Delhi","denied":false}',
                 locOut:'{"lat":28.6768751,"lng":77.3127879,"address":"Dilshad Garden, Delhi","denied":false}',
                 lateTag:'', lateMin:0, updatedAt: day(1 + (i % 180))+'T13:00:00.000Z', appVer:'2026-10-21-2' });
    }
    // Today's check-in, made on this phone a moment ago. This is the row whose
    // loss means a present employee is marked absent.
    att.push({ id:'att_today_here', staffId:'EM1', staffName:'Madhuri', date: today,
               checkIn:'08:52', checkOut:'', hours:'', branch:'Main Branch',
               locIn:'{"lat":null,"lng":null,"address":"Location permission denied","denied":true}',
               locOut:'', lateTag:'', lateMin:0, updatedAt:new Date().toISOString(), appVer:KBDC_APP_VERSION });
    localStorage.setItem('kbdc_la_attendance', JSON.stringify(att));

    // The clinic's real task lists. Every row carries its own `done` flag, so
    // one tick used to make all of them look changed.
    const roles = ['LDN','DAS','RCP','HSK','STT','PTC','ASD'];
    roles.forEach(code => {
      const list = [];
      for (let i = 1; i <= 210; i++) list.push({ code: code + i,
        en: code + ' task number ' + i + ' with a realistic description of the work involved',
        hi: 'कार्य ' + i, freq:'Daily', done:false, doneAt:'' });
      localStorage.setItem('kbdc_tasks_' + code, JSON.stringify(list));
    });

    // The attendance backend has already proved itself on this device, so
    // attendance travels on its own Sheet — the live clinic's configuration.
    kbdcSetSyncStatus({ attLastOk: Date.now(), attErr: '' });
    // Six-hourly full pushes have already happened; this is a steady-state cycle.
    localStorage.setItem('kbdc_push_full_at', String(Date.now()));
    localStorage.setItem('kbdc_att_full_at', String(Date.now()));
    return { logRows: log.length, attRows: att.length,
             logBytes: JSON.stringify(log).length, attBytes: JSON.stringify(att).length, today };
  }, { MAIN, ATT });
  console.log('  seeded: ' + seeded.logRows + ' ticks (' + Math.round(seeded.logBytes/1024) + ' KB), ' +
              seeded.attRows + ' attendance rows (' + Math.round(seeded.attBytes/1024) + ' KB)');
  attRemote[0].date = seeded.today;

  // A settling cycle first, with the counters off: a device that has just been
  // updated legitimately introduces itself to the Sheet once. What must be
  // cheap is every cycle after that.
  await page.evaluate(() => kbdcAutoSyncCycle());

  Object.keys(attOnSheet).forEach(k => delete attOnSheet[k]);

  // One ordinary sync cycle, exactly as the 2-minute timer runs it.
  started = true;
  const t0 = Date.now();
  await page.evaluate(() => kbdcAutoSyncCycle());
  const took = Date.now() - t0;
  console.log('  cycle: ' + saves + ' writes, ' + Math.round(pushBytes/1024) + ' KB, ' + took + 'ms');

  // A cycle must not re-upload the archive. Before the fix this was 29 writes
  // and ~3.3 MB; the budget here is generous enough that only a genuine
  // regression trips it.
  ok(saves <= 6, 'a steady-state cycle makes at most 6 writes (made ' + saves + ')');
  ok(pushBytes < 300000, 'a steady-state cycle pushes under 300 KB (pushed ' +
     Math.round(pushBytes/1024) + ' KB)');

  // …and none of that saving may cost the one row that matters.
  ok(!!attOnSheet['att_today_here'],
     "today's check-in made on this phone reached the Attendance Sheet");
  ok(!attOnSheet['att0'] || true, '(older rows may or may not be re-sent — not asserted)');

  // The attendance Sheet must still be READ in the same cycle: starving this
  // read is what left the dashboard empty while the Sheet held everything.
  ok(attReads >= 1, 'the attendance Sheet was read in the same cycle (' + attReads + ' read(s))');
  const sawRemote = await page.evaluate(() =>
    kbdcLsArray('kbdc_la_attendance').some(a => a && a.id === 'att_remote_today'));
  ok(sawRemote, "another device's check-in from the Attendance Sheet landed in this device's list");

  // And the badge must be able to go green: it only does so when the main push
  // ran to the end. "Backed up few days ago" was this never completing.
  const st = await page.evaluate(() => kbdcGetSyncStatus() || {});
  ok(!!st.lastOk && (Date.now() - st.lastOk) < 120000,
     'the main backup completed, so "Backed up" shows just now (lastOk ' +
     (st.lastOk ? Math.round((Date.now()-st.lastOk)/1000)+'s ago' : 'never') + ')');
  ok(!st.err, 'no sync error reported' + (st.err ? ': ' + st.err : ''));

  // --- One tick must not re-upload the task lists -------------------------
  // The Tasks tab carries each task's done flag. Ticking one task made all
  // 1,470 rows look changed, so 765 KB went up in seven writes — on every
  // tick, from every phone, all day.
  const tasksSent = [];
  await page.unroute('**/exec**');
  await page.route('**/exec**', route => {
    const raw = route.request().postData() || '';
    let p = {}; try { p = JSON.parse(raw); } catch(e) {}
    if (p.action === 'getStamps') return route.fulfill({ contentType:'application/json',
      body: JSON.stringify({ ok:true, stamps:{ Attendance:1 }, version:'2026-10-07-1' }) });
    if (p.action === 'getBatch') {
      const data = {}; (p.sheets || []).forEach(s => { data[s] = []; });
      return route.fulfill({ contentType:'application/json',
        body: JSON.stringify({ ok:true, data, version:'2026-10-07-1' }) });
    }
    if (p.action === 'saveBatch') {
      ((p.modules || {}).Tasks || []).forEach(r => tasksSent.push(r));
      return route.fulfill({ contentType:'application/json',
        body: JSON.stringify({ ok:true, saved:{}, version:'2026-10-07-1' }) });
    }
    return route.fulfill({ contentType:'application/json', body: JSON.stringify({ ok:true, version:'2026-10-07-1' }) });
  });

  await page.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('kbdc_tasks_LDN'));
    l[7].done = true; l[7].doneAt = new Date().toISOString();
    localStorage.setItem('kbdc_tasks_LDN', JSON.stringify(l));
  });
  await page.evaluate(() => kbdcAutoSyncCycle());
  console.log('  after one tick: ' + tasksSent.length + ' Tasks row(s) sent');
  ok(tasksSent.length >= 1 && tasksSent.length <= 5,
     'ticking one task sends that row, not the whole task list (sent ' + tasksSent.length + ' of 1470)');
  ok(tasksSent.some(r => r.roleCode === 'LDN' && r.taskCode === 'LDN8' && (r.done === true || r.done === 'true')),
     'the ticked row itself is the one that travelled');

  await browser.close();
  console.log('\n' + pass.length + ' passed, ' + failed.length + ' failed');
  if (failed.length) { failed.forEach(f => console.log('  FAILED: ' + f)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
