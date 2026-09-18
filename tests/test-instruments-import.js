// Importing the clinic's asset list. Each row already has the clinic's own
// asset code (KBDC/DE/DC-01) on a label: the import must keep it as the tag,
// one item per code, add the file's rooms and categories to the Lists, bring
// condemned items in as Retired, and a second import must update, not copy.
// Needs the xlsx package in the vendor folder:
//   cd tests/vendor && npm install xlsx@0.18.5
// Paths default to the Linux sandbox; override with PW_MODULE / PW_CHROME /
// KB_VENDOR to run elsewhere.
const { chromium } = require(process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const APP = process.env.KB_APP || __dirname + '/../index.html';
const V = process.env.KB_VENDOR || __dirname + '/vendor/node_modules';
const CHROME = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const XLSX = require(V + '/xlsx');

function workbook(rows) {
  const head = ['Type','Name','Category','Brand','Model','Serial No','Quantity','Location','Status','Condition','Purchase Date','Price',
                'Vendor','Warranty Until','Service Interval (months)','Last Service','AMC Vendor','AMC Expiry','Set','Notes','Tag'];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(rows.map(r => head.map(h => r[h] == null ? '' : r[h])))), 'Items');
  return XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
}

(async () => {
  const browser = await chromium.launch({ executablePath:CHROME });
  const R  = fs.readFileSync(V + '/react/umd/react.production.min.js','utf8');
  const RD = fs.readFileSync(V + '/react-dom/umd/react-dom.production.min.js','utf8');
  const B  = fs.readFileSync(V + '/@babel/standalone/babel.min.js','utf8');
  const X  = fs.readFileSync(V + '/xlsx/dist/xlsx.full.min.js','utf8');
  const pass=[], failed=[];
  function ok(c,l){ (c?pass:failed).push(l); console.log((c?'  PASS ':'  FAIL ')+l); }

  const page = await (await browser.newContext({ viewport:{width:1400,height:1000}, timezoneId:'Asia/Kolkata' })).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e.message).slice(0,150)));
  await page.route('**/react@18/umd/react.production.min.js', r=>r.fulfill({body:R,contentType:'application/javascript'}));
  await page.route('**/react-dom@18/umd/react-dom.production.min.js', r=>r.fulfill({body:RD,contentType:'application/javascript'}));
  await page.route('**/@babel/standalone/babel.min.js', r=>r.fulfill({body:B,contentType:'application/javascript'}));
  await page.route('**/fonts.googleapis.com/**', r=>r.fulfill({body:'',contentType:'text/css'}));
  await page.route('**/cdnjs.cloudflare.com/**', r=>r.fulfill({body:'',contentType:'application/javascript'}));
  await page.route('**/xlsx/0.18.5/xlsx.full.min.js', r=>r.fulfill({body:X,contentType:'application/javascript'}));
  await page.route('**/exec**', route => route.fulfill({contentType:'application/json',
    body:JSON.stringify({ok:true,stamps:{},data:{},saved:{},version:'2026-09-08-1'})}));

  await page.goto('file://' + APP); await page.waitForTimeout(800);
  await page.evaluate(() => {
    kbdcSetBackendUrl('https://script.google.com/macros/s/MAIN/exec'); kbdcSetInvBackendUrl('https://script.google.com/macros/s/INV/exec');
    ['kbdc_ins_assets','kbdc_ins_sets','kbdc_ins_log','kbdc_ins_settings','kbdc_ins_loads'].forEach(k => localStorage.removeItem(k));
  });
  await page.reload(); await page.waitForTimeout(1200);
  await page.click('text=Admin Override').catch(()=>{}); await page.waitForTimeout(300);
  await page.fill('input[type="password"]','kbdc@admin').catch(()=>{});
  await page.click('button:has-text("Enter")').catch(()=>{}); await page.waitForTimeout(900);
  await page.locator('.nav', { hasText:'INSTRUMENTS & EQUIPMENT' }).first().click(); await page.waitForTimeout(800);
  await page.click('#ins-tab-reg'); await page.waitForTimeout(300);

  const rows = [
    { Type:'Equipment', Name:'Chamundi Dental Chair', Category:'Dental Chair', Brand:'Confident', Location:'Clinic 1', Status:'In use', Tag:'KBDC/DE/DC-01', Quantity:1 },
    { Type:'Equipment', Name:'Lead Apron', Category:'Radiation Protection', Brand:'Uniray', Location:'Changing Room', Status:'In use', Tag:'KBDC/DE/LA-40', Quantity:1 },
    { Type:'Instrument', Name:'Air Motor', Category:'Handpiece', Brand:'NSK', Location:'Clinic 1', Status:'In use', Tag:'KBDC/DE/AM-51', Quantity:1 },
    { Type:'Equipment', Name:'Portable X-Ray', Category:'X-ray / Imaging', Brand:'Genoray', Status:'Retired', Notes:'Condemned sheet: Decommision', Quantity:1 },
  ];
  const input = page.locator('input[type="file"][accept*=".xlsx"]');
  await input.setInputFiles({ name:'KB_Assets_Import.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer:workbook(rows) });
  await page.waitForTimeout(1200);
  let a = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_assets') || '[]'));
  const tags = a.map(x => x.tag).sort();
  console.log('  tags:', JSON.stringify(tags));
  ok(a.length === 4, 'four rows make four items (' + a.length + ')');
  ok(['KBDC/DE/AM-51','KBDC/DE/DC-01','KBDC/DE/LA-40'].every(t => tags.indexOf(t) >= 0), 'the clinic’s own asset codes are kept as the tags');
  ok(tags.indexOf('EQP-0001') >= 0, 'an item with no code gets an app tag (EQP-0001)');
  const xr = a.find(x => x.name === 'Portable X-Ray') || {};
  ok(xr.status === 'Retired' && /Decommision/.test(xr.notes || ''), 'a condemned item comes in as Retired, with the reason');
  ok((a.find(x => x.tag === 'KBDC/DE/AM-51') || {}).kind === 'Instrument', 'the air motor comes in as an instrument');

  const lists = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('kbdc_ins_settings') || '[]');
    return { locs:kbdcInsList(s, 'locations'), eqp:kbdcInsList(s, 'eqpCats'), ins:kbdcInsList(s, 'insCats') }; });
  ok(lists.locs.indexOf('Clinic 1') >= 0 && lists.locs.indexOf('Changing Room') >= 0, 'the file’s rooms join the Location list');
  ok(lists.locs.indexOf('Operatory 1') >= 0, 'and the existing rooms stay');
  ok(lists.eqp.indexOf('Radiation Protection') >= 0, 'new equipment categories join the list');
  ok(lists.ins.filter(x => x === 'Handpiece').length === 1, 'an existing category is not added twice');
  ok(/KBDC\/DE\/DC-01/.test(await page.locator('#ins-table').innerText().catch(()=> '')), 'the Register shows the asset codes');

  // Importing again (with a price added) updates the same items.
  rows[0].Price = 185000; rows[0]['Service Interval (months)'] = 6;
  await input.setInputFiles({ name:'KB_Assets_Import.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer:workbook(rows.slice(0, 3)) });
  await page.waitForTimeout(1200);
  a = await page.evaluate(() => JSON.parse(localStorage.getItem('kbdc_ins_assets') || '[]'));
  const chair = a.filter(x => x.tag === 'KBDC/DE/DC-01');
  ok(a.length === 4 && chair.length === 1, 'importing again does not make copies (' + a.length + ' items)');
  ok(chair[0] && chair[0].price === 185000 && Number(chair[0].serviceMonths) === 6, 'and it fills in what was added (price, service interval)');

  ok(errs.length===0, 'no JavaScript errors ('+JSON.stringify(errs).slice(0,200)+')');
  console.log('\n==== '+pass.length+' passed, '+failed.length+' failed ====');
  if(failed.length) failed.forEach(f=>console.log('  FAIL: '+f));
  await browser.close();
  process.exit(failed.length?1:0);
})();
