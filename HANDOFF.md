# K.B. Dental Clinic — Management Suite: continuing work

Paste this file (or point at it) when starting a fresh session, from any account.

## What this is

A live clinic management app used daily by ~10 staff. Owner: viveykm@gmail.com — a
dental clinic owner, not a programmer, who intends to sell this commercially. It is a
single-file React app (`index.html`, ~1.9 MB, React 18 UMD + Babel standalone from CDN)
served from GitHub Pages at https://kbdental.github.io/kb-management-suite/

## Repos

- **`kbdental/kb-management-suite`** — THE LIVE APP. All work happens here, branch `main`.
  If it is not already cloned, attach it and clone to `/home/user/kb-management-suite`.
- **`kbdental/kb-denarts`** — a SEPARATE dental-lab app. **Do not touch it.**
- **`kbdental/kb-nabh`** — NABH, split out of `index.html` on 2026-09-11 into its own repo
  (https://kbdental.github.io/kb-nabh/). All NABH work happens there. `nabh.html` in this
  repo is only a redirect to it. NABH stores scores in the browser only (`kbdc_nabh_*`
  localStorage keys); both apps being on kbdental.github.io is what lets device data carry over.

## Current versions

| Thing | Version |
|---|---|
| App (`KBDC_APP_VERSION`) | **2026-09-22-1** |
| NABH standalone | moved to `kbdental/kb-nabh` |
| `backend/Code.gs` (main + attendance Sheets) | **2026-09-08-1** |
| `backend/Inventory-Code.gs` (inventory Sheet) | **2026-09-22-1 in the repo; live was 2026-09-03-1** — the owner must redeploy it (the app now expects 2026-09-22-1) |

## Inventory Sheet overload loop (found and fixed 2026-09-22)

After the 2026-09-18 load of 205 assets the Inventory script stayed overloaded for days
(about 1 in 6 requests answered HTTP 404, some took 60 s; the app told the owner the URL
was wrong, which it was not). Instrument tabs were rewritten 130–280 times in four days
with identical data. Three compounding causes:
1. The inventory read-failure path re-uploaded EVERY inventory tab on every failed read.
2. `saveBatch` in Inventory-Code.gs bumped each tab's revision on every upload, even when
   nothing was written, so every device re-downloaded those tabs.
3. `kbdcRowsSame_` treated a row with fewer fields as changed (Sheet rows carry every
   column), so identical uploads were rewritten.
Plus echoes (a device re-sending rows it had just pulled) and every device re-sending the
Asset Register after pulling a change.
Fix: `kbdcInvSendPending()` sends only tabs whose sig changed since the last accepted upload
(both paths); echo suppression records a pulled tab as sent when every local row is on the
Sheet at the same updatedAt; the Asset Register is sent only by the device that changed the
register (`kbdc_ins_master_dirty`, set in InstrumentsPage `commit`); `kbdcDiagnose404` does a
plain GET first and says "busy" when the deployment answers. Backend: revision bumped only
when a tab was really written; field-count mismatch no longer counts as a change.
Test: `tests/test-inventory-gentle.js`. The main `Code.gs` has the same unconditional
`kbdcBumpRev_` pattern; not changed yet.

On 2026-09-18 at 2:21 PM everything in the owner's `Desktop\NEW` went to the Recycle Bin
(not by any session command). As of 2026-09-22 only `.claude` and `kubi` were back; the
local clone of this repo was among the deleted items, so this work was done on a fresh clone.

## The three Google Sheets

Readable via the Google Drive connector. **Read them before theorising** — almost every
real diagnosis in this project came from reading the Sheet, not from reading the code.
`read_file_content` returns too much to inline; it saves to a file, so parse that file
with python.

| Sheet | File ID |
|---|---|
| K. B. DENTAL MANAGEMENT SUITE (main) | `1xj07tIzScgv99Jby8w-IDu2MnBP2cOPVrQOF3Dw0OhY` |
| KB Attendance Suite | `1D3v82KfJfU1cd-oD00oYxuly6u98lI-Ouy1XfDQxRQk` |
| K.B. DENTAL INVENTORY (SUITE) | `1sn8m5XQlsTOzGNBxDETAlQ-cCzmZ6rGcdjxJqzIF904` |

Apps Script cannot be called directly from the sandbox — the proxy blocks
`script.google.com`. Read the Sheets through Drive instead.

## Tests (`tests/`, in the repo)

- `tests/syntax-check.js` — validates every inline `<script>`. **Run after every edit.**
- `tests/gas-server.js` — runs the REAL `backend/Code.gs` in Node under a fake Apps
  Script API, so backend logic is tested for real rather than against a stand-in.
- Six Playwright tests, all passing:
  `test-hung-request`, `test-unsent-checkin-visible`, `test-admin-checkin-no-gps`,
  `test-appdata-churn`, `test-appdata-dedupe`, `test-tick-logs-and-pushes`.

Setup:

```
cd tests/vendor && npm install react@18 react-dom@18 @babel/standalone   # gitignored
```

Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
Playwright: `/opt/node22/lib/node_modules/playwright`

An earlier suite of ~77 tests was lost when a container was recycled because it lived in
an ephemeral scratch directory. Keep every new test in `tests/`.

## Working rules the owner expects

1. **Verify before claiming.** Write a test, then "test-the-test": `git stash`, run it,
   confirm it FAILS, `git stash pop`. Unverified claims have cost him days.
2. **Results, not theory.** He has said so explicitly. Keep replies short: what changed,
   what he must do, what to check.
3. Bump `KBDC_APP_VERSION` on every ship; commit and push to `main`.
4. Never call something fixed when only part is verified. Say plainly what was not tested.

## Immediately outstanding

1. **Deploy `backend/Code.gs` 2026-09-08-1** to BOTH the main and attendance Sheets:
   Extensions → Apps Script → paste → Deploy → **Manage deployments** → ✏️ → New version.
   Until then the badge reads "Backend needs redeploy".
   *"New deployment" mints a NEW URL and breaks the app — it must be a new **version** of
   the existing deployment.*
2. **Staff phones must reload** to pick up 2026-09-08-4.
3. **Verify `TaskCompletions` grows.** It has stood at 39 rows since 13 Aug 2026. Manager
   Dashboard → Overview reads 0% for everyone purely because no completion rows have
   reached the owner's device. Ticking a task is proven working end-to-end on the current
   build (`test-tick-logs-and-pushes.js`), so rows should flow once phones are updated.
4. **Attendance intermittently misses 2–4 staff per day.** The current build makes a phone
   holding an unsent check-in name it on screen with a "↑ Send it now" button. Ask the
   owner what that banner says on a phone that fails — that message is the next clue.

## Recently fixed — do not re-break

- **Manager Dashboard did not redraw when ticks arrived** (2026-09-11, app 2026-09-11-5).
  The Sheet was fine (TaskCompletions 1,029 rows); the dashboard just never listened for
  `kbdc-tasks-sync`. It now does, plus `kbdc-staff-sync` and `kbdcWatchLive()`.
  Test: `tests/test-manager-overview-live.js`.
- **Ticks on role cards with nobody assigned were saved as "—"** (DAS, ASD have no entry in
  RoleEmployees and no HR staff with those designations). New ticks record the signed-in
  person. The old "—" rows still count toward the role in the clinic-wide score, but no
  person's row shows them until someone is assigned to DAS / ASD.
- **Task Management → Dashboard was never wired** (literal zeros). Rebuilt 2026-09-11 (app
  2026-09-11-6) on `kbdcTaskDashData`: ticks vs role tasks per period + delegated tasks.
  Test: `tests/test-task-dashboard.js`.
- **Delegated tasks (`kbdc_tasks`) never synced.** Now module `delegated` → main Sheet tab
  `DelegatedTasks` (hot). Finishing stamps `completedAt`. There is no delete in that screen;
  if one is added it needs a tombstone, or the merge will bring deleted tasks back.
- **Two people on one role saw each other's ticks** (the riders, 2026-09-12, app 2026-09-11-7).
  `done` lived on the role's shared list. `TaskListView` now derives done per person from
  `kbdc_task_log` (`kbdcTasksForPerson`); un-tick removes only that person's tick; the shared
  flag means "anyone in the role did it this period". Test: `tests/test-rider-separate-ticks.js`.
- **Un-ticks came back after a sync** (fixed 2026-09-14, app 2026-09-14-1). An un-tick now
  marks the log row `{removed:true, updatedAt}` instead of deleting it; the newer timestamp
  wins both merges (client `kbdcUnionMergeById`, backend `kbdcMergeRows_`). `kbdcLog()` skips
  removed rows; read the log through it, never straight from localStorage.
  Test: `tests/test-untick-stays.js`.
- **Most staff's ticks never reached the Sheet** (found 2026-09-17, app 2026-09-17-1). Live
  data: 8 staff checked in daily on 2026-09-14-1, but only Madhuri and Vishal Tiwari's ticks
  arrived (Saloni's last 20 Aug, Abhimanyu's 14 Aug). Cause: ticks only left inside the
  full main sync, which reads first; on a read failure the fallback pushed every tab as ONE
  request (too big, dropped, error swallowed). Now `kbdcPushTicksNow()` sends unsent ticks
  alone, in 150-row requests, before the read and right after each tick; `kbdc_log_sent`
  remembers what the Sheet accepted; the fallback push is chunked; the role task screen
  shows "N ticks … not reached the Google Sheet" with Send now (`#tick-unsent`).
  Not verified on a real phone. If staff still see that banner, its "Last try:" text is
  the next clue. Test: `tests/test-ticks-reach-sheet.js`.
- **Shared roles get a PIN per person** (2026-09-17): keys `CODE|normalised name` in
  `kbdc_role_pins`; `kbdcRolePin(code, name)` prefers the person's PIN, then the role PIN.
  PINs tab lists each person for roles with 2+ people. Test: `tests/test-shared-role-pins.js`.
- **Instruments import keeps the clinic's asset codes** (2026-09-18, app 2026-09-18-1). A Tag
  column value that is not already in the register now creates the item WITH that tag (the
  clinic labels items `KBDC/DE/DC-01` etc.); a Tag that exists still updates. Rooms and
  categories used by imported items are added to the Lists. The owner's asset list was
  converted to `Desktop/NEW/KB_Assets_Import.xlsx` (sheet "Check these" lists open questions).
  Test: `tests/test-instruments-import.js` (needs `xlsx` in tests/vendor).
- **Bulk Edit tab + master "Asset Register"** (2026-09-18). Bulk Edit (managers) is a grid for
  editing many items; "Apply to ticked" sets one field on ticked rows; Save logs "Bulk edit: …"
  per item. The inventory module `insmaster` (pushOnly) writes a fixed-column copy of the
  register to the Inventory Sheet tab **Asset Register** and is never read back. The owner's
  separate master Google Sheet shows it via IMPORTRANGE. Edit in the app, not on that tab.
  Test: `tests/test-instruments-bulk.js`.
- Instruments & Equipment uses the app's blue `#1357A6` and the `tm-tabs` tab bar (2026-09-14).
- **"Yearly" frequency fell through to Daily** in `kbdcTaskPeriodKey`. Fixed.
- **Role PINs** (2026-09-11): `PinEntry` accepted any 4 digits. Now one PIN per role card plus
  `MGR`, in `kbdc_role_pins`, shared via ClinicSettings key `rolePins`; owner sessions skip
  role PINs; 5 wrong tries lock 60 s. Owner manages them in Manager Dashboard → PINs.
  A role with no PIN is locked. PINs are readable from the Sheet like everything else
  there (see the security note below). Test: `tests/test-role-pins.js`.

- **`fetch` had no timeout.** One hung request left a sync re-entrancy guard raised and the
  device stopped syncing entirely until reload. This was the cause of "it works for two
  days then stops". Now bounded by `KBDC_REQ_TIMEOUT_MS` (45 s).
- **AppData grew to 831 rows of the same 6 keys** — a 22 MB download every cycle, which
  produced the 45-second timeouts and Sheet lock timeouts. Two compounding causes: the
  client stamped a fresh `updatedAt` every cycle, and `kbdcRowKey_` had no identity rule
  for key/value rows so they hashed by whole content. Both fixed; AppData also removed
  from `KBDC_HOT_SHEETS` (it is a monthly-change blob store, still read on the full pass).
- **Admin "Clock In" saved nothing until GPS answered**, which on a laptop may be never.
  Now saves and pushes first, attaches location afterwards.
- **Manager Overview dropped staff** whose designation was not in `KBDC_DESIG_CODE`
  (Lab, Administration, Management, Clinical, Technician, Driver) — 4 of 9 vanished while
  the KPI still counted them. Filters and row-builder now share one rule, plus an
  "Other staff" column.
- **Overview counts completions from `kbdc_task_log`**, not the per-role `done` flags —
  those merge local-wins, so a colleague's tick never flipped them on the manager's device.
- **Inventory must NEVER be written to the main Sheet.** An earlier fallback did exactly
  that and polluted the Management Sheet with stock tabs the owner had just cleaned out.
  That fallback was removed deliberately; do not reintroduce it.
- **Ledger-derived stock was tried and reverted.** The clinic's ledger holds 63 stock-out
  rows against 715 items, so recalculating stock from it would zero almost everything.
  Stock is the figure on the item row. `KBDC_INV_LEDGER_IS_COMPLETE = false` guards this.
  The Manage screen's "Correct Stock" card is the remedy for a wrong figure; it records
  the change as a visible Adjustment and asks for confirmation first.

## Instruments & Equipment (Phase 1 shipped 2026-09-11)

Sidebar app `instr` (`InstrumentsPage` in `index.html`). Reusable items, one record per
physical piece, plus sets and clinic equipment. Owner chose: inside the suite (not
standalone), individual items mostly with some sets, sterilisation tracking wanted,
equipment included.

- Data: `kbdc_ins_assets` / `_sets` / `_log` / `_settings` → Inventory Sheet tabs
  `InstrumentRegister` / `InstrumentSets` / `InstrumentLog` / `InstrumentSettings`, via
  `KBDC_INVENTORY_MODULES`. No backend change was needed: every row carries an `id`.
- Never deleted — items and sets are `Retired` (the merge cannot carry deletions).
- Access: owner, `inv` or `instr` = manage; `invout` = view + report damaged/missing/found.
- Test: `tests/test-instruments.js`.
- **Phase 2 shipped 2026-09-11** (app 2026-09-11-3): tab "Sterilisation", `kbdc_ins_loads` →
  Inventory tab `SterilisationLoads`, test `tests/test-sterilisation.js`. Sterility of a set or
  loose instrument is DERIVED from its latest non-void load (`kbdcInsSterility`), never stored
  on the item — keep it that way. "Mark used" stamps `openedAt` on the set/item.
- **Phase 3 shipped 2026-09-11** (app 2026-09-11-4): "Reports" tab (managers; `kbdcInsReports`)
  and printable QR labels. A label's QR holds `<app url>#ins=TAG`; the App starts on `instr`
  when that hash is present and InstrumentsPage opens the item, then clears the hash. The QR
  library (qrcode-generator 1.4.4, cdnjs) is loaded only when printing. Test:
  `tests/test-instruments-reports.js`.
  Scope of Phase 2 as agreed: sterilisation loads (autoclave cycle, indicators, BI/Bowie-Dick,
  which sets were in the load, pack expiry, failed-load recall). **Phase 3:** reports,
  QR tag labels. The owner has no existing instrument list yet — Excel template/import is
  in the Register tab.

## Known open

- Manager Overview percentages stay 0% until completion rows actually arrive.
- `ClinicSettings` had duplicate rows (`weekOffDays`, `attendanceBackendUrl`,
  `inventoryBackendUrl`). Reads take the newest; the backend fix should stop new ones.
- **Security — unresolved and structural.** The Apps Script deployments are set to
  "Anyone" access and the token `kbdc-live-g01_zGKPi54vzk2zzKey7UST` sits in the public
  `index.html`. Anyone who views source can read and write the whole database: staff PINs,
  salaries, Aadhaar numbers, GPS coordinates. This cannot be fixed while the browser talks
  directly to the Sheet. A Supabase migration was scoped; the owner has not yet decided.

## Where to start

Read the three Sheets to establish the current true state, then ask the owner what he is
seeing today. Do not assume a previous fix landed — check the app version stamped on the
data (attendance rows carry `appVer`) and the Sheet's own contents.
