// Runs the REAL backend/Code.gs in Node behind an HTTP server, under a fake
// Apps Script API. Tests then exercise the actual deployed logic rather than a
// hand-written stand-in — which is how the AppData duplication was proved to
// live in kbdcRowKey_ and not in the app.
//
// Kept in the repo: the previous copy lived in a scratch directory and was
// lost when the container was recycled.
const fs = require('fs');
const http = require('http');

function makeSheet(name, tabs) {
  if (!tabs[name]) tabs[name] = [];
  const rowsOf = () => tabs[name];
  const api = {
    getName: () => name,
    getLastRow: () => rowsOf().length,
    getLastColumn: () => rowsOf().reduce((m, r) => Math.max(m, r.length), 0),
    appendRow: (row) => { rowsOf().push(row.slice()); },
    clear: () => { tabs[name] = []; },
    clearContents: () => { tabs[name] = []; },
    getDataRange: () => ({
      getValues: () => rowsOf().map(r => r.slice()),
      clearContent: () => { tabs[name] = []; },
    }),
    getRange: (r, c, nr, nc) => ({
      // Formatting calls are chainable no-ops here: the tests care about the
      // VALUES the real Code.gs writes, not how it paints them.
      setNumberFormat: function(){ return this; },
      setNumberFormats: function(){ return this; },
      setFontWeight: function(){ return this; },
      setFontColor: function(){ return this; },
      setBackground: function(){ return this; },
      setHorizontalAlignment: function(){ return this; },
      setWrap: function(){ return this; },
      setFontSize: function(){ return this; },
      setBorder: function(){ return this; },
      clearFormat: function(){ return this; },
      setValues: (vals) => {
        const rows = rowsOf();
        vals.forEach((v, i) => {
          const ri = r - 1 + i;
          while (rows.length <= ri) rows.push([]);
          const row = rows[ri];
          v.forEach((cell, j) => { row[c - 1 + j] = cell; });
        });
      },
      setValue: (val) => {
        const rows = rowsOf();
        while (rows.length < r) rows.push([]);
        rows[r - 1][c - 1] = val;
      },
      getValues: () => {
        const rows = rowsOf();
        const out = [];
        for (let i = 0; i < (nr || 1); i++) {
          const row = rows[r - 1 + i] || [];
          out.push(row.slice(c - 1, c - 1 + (nc || row.length)));
        }
        return out;
      },
    }),
    setFrozenRows: () => {},
    autoResizeColumns: () => {},
    deleteRows: (start, howMany) => { rowsOf().splice(start - 1, howMany); },
  };
  return api;
}

function startServer(gasPath, port) {
  const tabs = {};
  const props = {};
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => (tabs[n] ? makeSheet(n, tabs) : null),
        insertSheet: (n) => { tabs[n] = []; return makeSheet(n, tabs); },
        getSheets: () => Object.keys(tabs).map(n => makeSheet(n, tabs)),
      }),
      flush: () => {},
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {}, tryLock: () => true }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null,
                                                        setProperty: (k, v) => { props[k] = v; } }) },
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }), getContent: () => t }),
      MimeType: { JSON: 'application/json' },
    },
    Utilities: { sleep: () => {}, formatDate: (d) => String(d) },
    Logger: { log: () => {} },
    console: console,
    Date: Date, JSON: JSON, Math: Math, String: String, Number: Number,
    Object: Object, Array: Array, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
  };
  const src = fs.readFileSync(gasPath, 'utf8');
  const vm = require('vm');
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx, { filename: gasPath });

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let out;
      try {
        const e = { postData: { contents: body } };
        const r = ctx.doPost(e);
        out = (r && typeof r.getContent === 'function') ? r.getContent() : JSON.stringify(r);
      } catch (err) {
        out = JSON.stringify({ ok: false, error: String(err && err.message || err) });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(out);
    });
  });
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => resolve({ tabs, props, server, ctx }));
  });
}

module.exports = { startServer };
