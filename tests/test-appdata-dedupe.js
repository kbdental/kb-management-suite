// The connection panel read "Largest download: 22294 KB" — 22 MB in one reply,
// every couple of minutes, on every device. The AppData tab held 831 rows of
// the same six keys repeated: payroll bands, the reporting map, the HR config,
// the document register.
//
// Two bugs multiplying. The client stamped every AppData row with a fresh
// updatedAt each cycle, and the backend had no identity rule for key/value
// rows, so they fell through to a content hash — a new timestamp made a
// brand-new row, for ever. Run against the REAL backend/Code.gs.
const { startServer } = require(__dirname + '/gas-server.js');
const GAS = __dirname + '/../backend/Code.gs';
const PORT = 8901;

(async () => {
  const { tabs, server } = await startServer(GAS, PORT);
  const pass=[], failed=[];
  function ok(c,l){ (c?pass:failed).push(l); console.log((c?'  PASS ':'  FAIL ')+l); }
  const tok = 'kbdc-live-g01_zGKPi54vzk2zzKey7UST';
  const post = (obj) => new Promise(res => {
    const body = JSON.stringify(obj);
    const rq = require('http').request({host:'127.0.0.1',port:PORT,path:'/exec',method:'POST',
      headers:{'Content-Type':'text/plain','Content-Length':Buffer.byteLength(body)}},
      r=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>res(JSON.parse(s)));});
    rq.end(body);
  });

  // Ten cycles, each pushing the same six settings with a different timestamp —
  // which is exactly what the clinic's devices were doing all day.
  const keys = ['kbdc_payroll_salaries','kbdc_payroll_settings','kbdc_reporting_map',
                'kbdc_hr_config','kbdc_ach_v1','kbdc_hr_docs'];
  for (let cycle = 0; cycle < 10; cycle++) {
    const rows = keys.map(k => ({ key:k, value:'{"settled":true}',
      // Past timestamps, so the edit made afterwards is genuinely newer.
      updatedAt: new Date(Date.now() - (20 - cycle) * 60000).toISOString() }));
    const r = await post({ token:tok, action:'saveBatch', modules:{ AppData: rows } });
    if (r.ok === false) { console.log('  push rejected:', r.error); break; }
  }

  const rowCount = (tabs['AppData'] || []).length - 1;   // minus the header
  console.log('  AppData rows after ten cycles of the same six settings:', rowCount);
  ok(rowCount === keys.length,
     'one row per setting, not one per push (' + rowCount + ' rows for ' + keys.length + ' keys)');

  // The newest value must win, not the first one written.
  const hdr = (tabs['AppData'] || [])[0] || [];
  const kc = hdr.indexOf('key'), vc = hdr.indexOf('value');
  await post({ token:tok, action:'saveBatch', modules:{ AppData:
    [{ key:'kbdc_hr_config', value:'{"changed":true}', updatedAt:new Date().toISOString() }] } });
  const row = (tabs['AppData']||[]).slice(1).filter(r => r[kc] === 'kbdc_hr_config');
  console.log('  kbdc_hr_config rows:', row.length, '| value:', row[0] && row[0][vc]);
  ok(row.length === 1, 'editing a setting updates its row instead of adding another');
  ok(row[0] && String(row[0][vc]).indexOf('changed') >= 0, 'and the new value is the one kept');

  // ClinicSettings has the same shape and had the same duplicates.
  for (let i = 0; i < 4; i++) {
    await post({ token:tok, action:'saveBatch', modules:{ ClinicSettings:
      [{ key:'weekOffDays', value:'[0]', updatedAt:new Date(Date.now()+i*1000).toISOString() }] } });
  }
  const csRows = (tabs['ClinicSettings'] || []).length - 1;
  console.log('  ClinicSettings rows after four pushes of weekOffDays:', csRows);
  ok(csRows === 1, 'the week-off setting keeps one row too (' + csRows + ')');

  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  server.close();
  process.exit(failed.length?1:0);
})();
