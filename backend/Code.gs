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
      saveAllRows(sheetName, rows);
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
      // hitting quota limits. Each sheet's own write is locked individually
      // (inside saveAllRows) rather than locking the whole batch — a device
      // writing Attendance and a device writing Tasks at the same moment
      // don't touch the same sheet, so there's no reason to make one wait
      // on the other.
      // Each tab is saved independently. Previously one tab throwing aborted
      // the whole batch, so every module after it in the loop was silently
      // dropped and the reply still looked like a normal failure with no clue
      // which data never landed. Isolate them, keep going, and name whatever
      // failed so it cannot go unnoticed.
      var modules = body.modules || {};
      var savedCounts = {};
      var failures = [];
      Object.keys(modules).forEach(function(name) {
        var sn = sanitizeSheetName(name);
        var mrows = modules[name] || [];
        try {
          saveAllRows(sn, mrows);
          savedCounts[name] = mrows.length;
        } catch (perSheetErr) {
          failures.push(name + ': ' + (perSheetErr && perSheetErr.message ? perSheetErr.message : perSheetErr));
        }
      });
      if (failures.length) {
        return respond({ ok: false, saved: savedCounts,
                         error: 'Some modules did not save — ' + failures.join(' | ') });
      }
      return respond({ ok: true, saved: savedCounts });
    }
    if (action === 'getStamps') {
      // Deliberately tiny: one read of the SyncMeta tab, no row data at all.
      // A device calls this every cycle and only downloads the tabs whose
      // revision has moved since it last read them.
      return respond({ ok: true, stamps: kbdcReadRevs_() });
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

/**
 * Version of THIS script, stamped onto every reply.
 *
 * Editing this file does nothing until a NEW deployment version is published
 * (Deploy → Manage deployments → Edit → New version). That gap has been the
 * most expensive source of confusion in this project: the app gets fixed, the
 * deployed script silently stays on old code, and the same bug "comes back"
 * the next day with no way to tell from the app which code actually answered.
 * The app compares this string against the version it expects and says so
 * plainly when the deployed script is out of date.
 *
 * Bump this whenever this file changes.
 */
var KBDC_BACKEND_VERSION = '2026-08-19-2';

function respond(obj) {
  if (obj && typeof obj === 'object' && obj.version === undefined) {
    obj.version = KBDC_BACKEND_VERSION;
  }
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
  // Name+category identity, matching the client's kbdcMergeInvItemsByNameCat()
  // exactly — the field is `cat` (NOT `category`), trimmed and lowercased.
  // Rows that miss this fall through to the content-hash branch below, where
  // any edit reads as a brand-new record, so the old row is never replaced.
  var cat = (row.cat !== undefined) ? row.cat : row.category;
  if (row.name !== undefined && cat !== undefined) {
    return 'nc:' + String(row.name).trim().toLowerCase() + '|' + String(cat).trim().toLowerCase();
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

/** Builds the rows and cell matrix a push would write, keeping the rows it
 *  read so callers can compare without going back to the sheet again. */
function kbdcBuildSheetData_(sheetName, rows) {
  var existingRows = readAllRows(sheetName);
  var mergedRows = kbdcMergeRows_(existingRows, rows || []);
  if (!mergedRows.length) return { existingRows: existingRows, mergedRows: [], headers: [], data: null };

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
  return { existingRows: existingRows, mergedRows: mergedRows, headers: headers, data: data };
}

/**
 * True when merging changed nothing, compared against the rows already read
 * rather than by re-reading the sheet.
 *
 * This distinction matters more than it looks. The previous version compared
 * by calling getDataRange().getValues() again, which meant a sheet that had
 * actually changed was read FOUR times per push: once to build the plan,
 * once to compare, then both again inside the lock. Across the ~20 tabs in a
 * single batch that is a great deal of Apps Script time, and an execution
 * that exceeds the platform's six-minute cap is killed part-way through —
 * the tabs handled up to that point are saved and the rest are silently
 * dropped. That is what "some records reach the Sheet but not all" was.
 */
function kbdcRowsSame_(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    var ka = Object.keys(a[i]), kb = Object.keys(b[i]);
    if (ka.length !== kb.length) return false;
    for (var j = 0; j < ka.length; j++) {
      var k = ka[j];
      var va = a[i][k], vb = b[i][k];
      va = (va === undefined || va === null) ? '' : String(va);
      vb = (vb === undefined || vb === null) ? '' : String(vb);
      if (va !== vb) return false;
    }
  }
  return true;
}

/**
 * Merges the given rows into a tab (see kbdcMergeRows_) and rewrites it.
 *
 * Fast path first, deliberately OUTSIDE the lock: if this push would not
 * change anything, skip the lock and the write entirely. Most pushes are
 * exactly that — several devices re-sending identical data every 30 seconds.
 * The fast path is only an optimisation and cannot cause a lost update: when
 * something HAS changed the authoritative read-merge-write still happens
 * inside the lock, which re-checks there.
 */
function saveAllRows(sheetName, rows) {
  var plan = kbdcBuildSheetData_(sheetName, rows);
  if (plan.data && kbdcRowsSame_(plan.mergedRows, plan.existingRows)) return;
  withWriteLock_(function() { saveAllRowsLocked_(sheetName, rows); });
}

function saveAllRowsLocked_(sheetName, rows) {
  var sheet = getOrCreateSheet(sheetName);
  var wasEmpty = sheet.getLastRow() === 0;
  var plan = kbdcBuildSheetData_(sheetName, rows);

  if (!plan.data) {
    if (!wasEmpty) {
      sheet.clearContents();
      sheet.getRange(1, 1).setValue('No data yet — nothing has been pushed from this module.');
    }
    return;
  }
  if (kbdcRowsSame_(plan.mergedRows, plan.existingRows)) return; // re-check under the lock

  kbdcBumpRev_(sheetName); // a real write — let devices know this tab moved
  sheet.clearContents();
  var range = sheet.getRange(1, 1, plan.data.length, plan.headers.length);
  // Force plain-text formatting before writing, so a numeric-looking value
  // (a PIN like "0000", an employee code, a phone number with a leading
  // zero) is never silently turned into a real number and lose its exact
  // form — Sheets applies its "smart" number detection based on the cell's
  // format at write time, so this has to be set before setValues().
  range.setNumberFormat('@');
  range.setValues(plan.data);
  sheet.setFrozenRows(1);
  // autoResizeColumns is expensive and used to run on every push. Column
  // widths persist, so sizing once when the tab is first populated is enough.
  if (wasEmpty) sheet.autoResizeColumns(1, plan.headers.length);
}

/** Reads a tab back as an array of objects, keyed by its header row. */
/**
 * Bumps a per-tab revision number in a small 'SyncMeta' tab, called only when
 * a write actually changed something.
 *
 * Devices used to re-download every tab in full every 30 seconds — on a
 * clinic-sized Sheet that is over a megabyte per device per cycle, which on a
 * phone means both roughly 124 MB of mobile data an hour and an outright
 * "Failed to fetch" when the reply is too big to complete. With these numbers
 * a device can ask what moved (one tiny read of this tab) and download only
 * those tabs. Rows are [sheetName, revision].
 */
function kbdcBumpRev_(sheetName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var meta = ss.getSheetByName('SyncMeta');
    if (!meta) { meta = ss.insertSheet('SyncMeta'); meta.appendRow(['sheet', 'rev']); }
    var vals = meta.getDataRange().getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === String(sheetName)) {
        meta.getRange(i + 1, 2).setValue((Number(vals[i][1]) || 0) + 1);
        return;
      }
    }
    meta.appendRow([sheetName, 1]);
  } catch (e) {
    // Never let bookkeeping break a real save. A missed bump only means a
    // device re-reads that tab on its next full pass.
  }
}

/** Current revision of every tab, as one small reply. */
function kbdcReadRevs_() {
  var out = {};
  try {
    var meta = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SyncMeta');
    if (!meta) return out;
    meta.getDataRange().getValues().forEach(function(r) {
      if (r[0] && String(r[0]) !== 'sheet') out[String(r[0])] = Number(r[1]) || 0;
    });
  } catch (e) {}
  return out;
}

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
