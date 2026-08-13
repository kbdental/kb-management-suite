/**
 * K.B. Dental Clinic — Management Suite backend
 *
 * What this is: a Google Apps Script that turns a Google Sheet into a simple
 * backend for the app. Every module in the app (Task Management, Leave &
 * Attendance, Inventory, HR, Financial, Appraisals, Achievers Club, etc.)
 * can push its data here, each into its own tab, so everything can be
 * reviewed in one spreadsheet.
 *
 * SETUP (one time):
 *   1. Create a new Google Sheet (or open the one you want to use).
 *   2. Extensions → Apps Script.
 *   3. Delete any starter code in the editor and paste this whole file.
 *   4. Deploy → New deployment → select type "Web app".
 *   5. Execute as: Me. Who has access: Anyone.
 *   6. Click Deploy, approve the permissions Google asks for, then copy
 *      the Web app URL it gives you.
 *   7. In the app: Settings → Data Backend → paste that URL → Save URL →
 *      Test Connection → Push Everything Now.
 *
 * If you ever change the code here, you need to create a new deployment
 * version (Deploy → Manage deployments → Edit → New version) for the
 * changes to take effect — editing the script alone does not update a
 * deployment already in use.
 */

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ ok: false, error: 'Invalid request body: ' + err.message });
  }

  var action = body.action;

  // Optional shared-secret gate. If (and only if) an API_TOKEN Script Property
  // is set on this project (Project Settings → Script Properties), every
  // request must carry a matching body.token or it is rejected. When the
  // property is not set, this check is skipped and the backend behaves exactly
  // as before — so deploying this code changes nothing until a token is
  // configured on both the backend and in the app's Settings → Data Backend.
  try {
    var API_TOKEN = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (API_TOKEN && String(API_TOKEN).length && String(body.token || '') !== String(API_TOKEN)) {
      return respond({ ok: false, error: 'Unauthorized: missing or invalid token.' });
    }
  } catch (authErr) {
    // If Script Properties can't be read for any reason, fail closed only when
    // we were able to determine a token was expected; otherwise allow, to avoid
    // locking a clinic out of its own backend over a transient platform error.
  }

  try {
    if (action === 'ping') {
      return respond({ ok: true, time: new Date().toISOString() });
    }
    if (action === 'saveAll') {
      var sheetName = sanitizeSheetName(body.sheet || 'Data');
      var rows = body.rows || [];
      withWriteLock_(function() { saveAllRows(sheetName, rows); });
      return respond({ ok: true, saved: rows.length });
    }
    if (action === 'getData') {
      var sheetName2 = sanitizeSheetName(body.sheet || 'Data');
      return respond({ ok: true, rows: readAllRows(sheetName2) });
    }
    if (action === 'saveBatch') {
      // Pushes many sheets in one Apps Script execution instead of one
      // execution per module — several devices polling every ~30s all day
      // would otherwise add up to tens of thousands of executions and risk
      // hitting quota limits.
      var modules = body.modules || {};
      var savedCounts = {};
      withWriteLock_(function() {
        Object.keys(modules).forEach(function(name) {
          var sn = sanitizeSheetName(name);
          var mrows = modules[name] || [];
          saveAllRows(sn, mrows);
          savedCounts[name] = mrows.length;
        });
      });
      return respond({ ok: true, saved: savedCounts });
    }
    if (action === 'getBatch') {
      var sheetNames = body.sheets || [];
      var data = {};
      sheetNames.forEach(function(name) {
        var sn2 = sanitizeSheetName(name);
        data[name] = readAllRows(sn2);
      });
      return respond({ ok: true, data: data });
    }
    if (action === 'uploadDoc') {
      // Saves an uploaded file into Google Drive under:
      //   Employees / <Employee or Consultant name> / <file>
      // and returns a link. Requires the one-time Drive authorisation prompt
      // that appears when this deployment is (re)authorised.
      var head = getOrCreateFolder(sanitizeFolderName(body.head || 'Employees'));
      var who = sanitizeFolderName(body.employee || 'Unassigned');
      var empFolder = getOrCreateChildFolder(head, who);
      var fileData = body.fileData || '';
      var bytes = Utilities.base64Decode(fileData);
      var blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', body.fileName || ('document_' + Date.now()));
      var file = empFolder.createFile(blob);
      return respond({ ok: true, fileId: file.getId(), url: file.getUrl(), name: file.getName(), folder: who });
    }
    if (action === 'listDocs') {
      var head2 = getOrCreateFolder(sanitizeFolderName(body.head || 'Employees'));
      var empFolder2 = getChildFolder(head2, sanitizeFolderName(body.employee || ''));
      var files = [];
      if (empFolder2) {
        var it = empFolder2.getFiles();
        while (it.hasNext()) { var f = it.next(); files.push({ id: f.getId(), name: f.getName(), url: f.getUrl() }); }
      }
      return respond({ ok: true, files: files });
    }
    if (action === 'deleteDoc') {
      try { DriveApp.getFileById(body.fileId).setTrashed(true); return respond({ ok: true }); }
      catch (e) { return respond({ ok: false, error: e.message }); }
    }
    return respond({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

function doGet(e) {
  return respond({ ok: true, message: 'K.B. Dental backend is running. Send a POST request from the app.' });
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Serializes writes across all simultaneous executions of this script.
 * Without this, two devices pushing at nearly the same moment can each read
 * the sheet's old content before either has written, so the merge in
 * saveAllRows never sees the other's update and one push's result silently
 * wins over the other's. A short script-wide lock removes that window —
 * only one push actually reads-merges-writes at a time, everyone else queues
 * briefly. If a lock genuinely can't be obtained within the timeout (very
 * unusual — would mean a write has been stuck for 15s), fail loudly rather
 * than silently proceeding without protection.
 */
function withWriteLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Run this ONCE from the Apps Script editor to grant Google Drive access.
 *
 * Deploying a new version does NOT re-ask for permissions — Google only shows
 * the permission screen when you RUN a function here in the editor. So if
 * document uploads fail with "You do not have permission to call
 * DriveApp...", open this project, pick "authorizeDrive" from the function
 * dropdown at the top, click Run, and approve everything Google asks
 * (including "See, edit, create and delete Google Drive files"). After that,
 * uploads from the app will work. This also creates the two head folders.
 */
function authorizeDrive() {
  var emp = getOrCreateFolder('Employees');
  var con = getOrCreateFolder('Consultants');
  return 'Drive access is working. Folders ready: ' +
    emp.getName() + ' (' + emp.getId() + '), ' +
    con.getName() + ' (' + con.getId() + ')';
}

// ── Google Drive document storage ──
function sanitizeFolderName(name) {
  return String(name || 'Unassigned').replace(/[\\\/:*?"<>|]/g, '_').trim().slice(0, 120) || 'Unassigned';
}
function getOrCreateFolder(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
function getOrCreateChildFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function getChildFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

function sanitizeSheetName(name) {
  name = String(name || 'Data').replace(/[\\\/\?\*\[\]:]/g, '_');
  return name.slice(0, 99) || 'Data';
}

function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

/**
 * Identifies a row for merge purposes. Prefers the row's own `id` (the vast
 * majority of modules generate one client-side). Falls back to a composite
 * key for the handful of sheets that don't carry an id (task definitions,
 * daily task-completion log, inventory item catalog). Anything else falls
 * back to a content hash — safe (never causes cross-record data loss) even
 * though it can't recognise an in-place edit of that specific id-less row
 * as "the same record."
 */
function kbdcRowKey_(row) {
  if (row.id !== undefined && row.id !== null && String(row.id).trim() !== '') {
    return 'id:' + row.id;
  }
  if (row.roleCode !== undefined && row.taskCode !== undefined) {
    // Covers Tasks (role+task) and TaskCompletions (role+task+date).
    return 'rt:' + row.roleCode + '|' + row.taskCode + (row.date !== undefined ? '|' + row.date : '');
  }
  if (row.name !== undefined && row.category !== undefined) {
    return 'nc:' + row.name + '|' + row.category; // inventory item catalog
  }
  return 'c:' + JSON.stringify(row);
}

/**
 * Merges incoming rows into whatever the sheet already holds, keyed by
 * kbdcRowKey_. This is the core fix for the multi-device "some records
 * vanish" bug: every push used to be a blind clearContents()+rewrite, so
 * any device pushing from a slightly-stale local pull would silently erase
 * records another device had just added. Now a pushing device can only add
 * or update rows it knows about — everything else already on the sheet
 * survives.
 *
 * Trade-off, deliberate: this cannot tell "a device deleted this row" apart
 * from "a device's local copy just doesn't have this row yet" — both look
 * like "incoming doesn't include it." So it always keeps the existing row
 * rather than risk erasing real data. That means deleting a record (an
 * inventory item, a task) on one device may not remove it from the shared
 * sheet / other devices. Accepted for now because silent data loss (the
 * reported problem) is a far worse failure than a stale row lingering.
 * A real fix for delete-propagation needs an explicit tombstone mechanism —
 * out of scope here.
 */
function kbdcMergeRows_(existingRows, incomingRows) {
  var merged = {};
  var order = [];
  existingRows.forEach(function(row) {
    var k = kbdcRowKey_(row);
    if (!(k in merged)) order.push(k);
    merged[k] = row;
  });
  incomingRows.forEach(function(row) {
    var k = kbdcRowKey_(row);
    var existing = merged[k];
    if (!existing) {
      order.push(k);
      merged[k] = row;
    } else if (row.updatedAt && existing.updatedAt) {
      merged[k] = (String(row.updatedAt) >= String(existing.updatedAt)) ? row : existing;
    } else {
      merged[k] = row; // no timestamp to compare — the freshly-pushed row wins
    }
  });
  return order.map(function(k) { return merged[k]; });
}

/** Merges the given rows into a tab's contents (see kbdcMergeRows_) and rewrites it. */
function saveAllRows(sheetName, rows) {
  var sheet = getOrCreateSheet(sheetName);
  var existingRows = readAllRows(sheetName);
  var mergedRows = kbdcMergeRows_(existingRows, rows || []);

  sheet.clearContents();

  if (!mergedRows.length) {
    sheet.getRange(1, 1).setValue('No data yet — nothing has been pushed from this module.');
    return;
  }

  // Build the column list from every key seen across all rows, in first-seen order,
  // since different records in the same module can have slightly different fields.
  var headers = [];
  var seen = {};
  mergedRows.forEach(function(row) {
    Object.keys(row).forEach(function(k) {
      if (!seen[k]) { seen[k] = true; headers.push(k); }
    });
  });

  var data = [headers];
  mergedRows.forEach(function(row) {
    data.push(headers.map(function(h) {
      var v = row[h];
      return (v === undefined || v === null) ? '' : v;
    }));
  });

  var range = sheet.getRange(1, 1, data.length, headers.length);
  // Force plain-text formatting before writing, so a numeric-looking value
  // (a PIN like "0000", an employee code, a phone number with a leading
  // zero) is never silently turned into a real number and lose its exact
  // form — Sheets applies its "smart" number detection based on the cell's
  // format at write time, so this has to be set before setValues().
  range.setNumberFormat('@');
  range.setValues(data);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

/** Reads a tab back as an array of objects, keyed by its header row. */
function readAllRows(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = values[i][j];
    }
    rows.push(row);
  }
  return rows;
}
