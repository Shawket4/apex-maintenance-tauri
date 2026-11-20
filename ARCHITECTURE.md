# How Apex Maintenance works

This describes the code as it is. If it and the code disagree, the code is
right and this file is a bug.

## The pieces

```
React UI ──typed commands (generated bindings)──▶ Rust core ──HTTPS──▶ maint-rust ──▶ Falcon
                                                    │
                                                    └─ SQLite (app data dir)
```

- **UI** (`src/`): routes in `src/routes`, screen parts in `src/widgets`,
  shared pieces in `src/shared`. It never talks to the network and never
  writes SQL. It calls commands and renders view models.
- **Rust core** (`src-tauri/src`):
  - `services/domain.rs` — every write. One user action = one SQLite
    transaction = local change + queued change.
  - `services/outbox.rs` — the queue of changes the server has not confirmed.
  - `services/engine.rs` — sends the queue, pulls server rows, handles
    conflicts and refusals.
  - `services/views/` — every read (view models, due logic, odometer logic).
  - `services/cache_sync.rs`, `refdata.rs`, `stock_movements.rs` — mirrors of
    data the server or Falcon owns (fleet list, service invoices, classes,
    plans, stock, stock movements).
  - `commands/` — the thin command layer the UI calls.
- **maint-rust** is the record of truth for everything the app owns.
  Falcon owns vehicles, drivers, service invoices and stock counts.

## Data on the device

SQLite, migrated on start (`src-tauri/src/migrations`, append-only — never
edit an applied migration).

- Owned tables, same shape as the server's: `work_orders`,
  `work_order_tasks`, `oil_changes`, `tires`, `tire_assignments`,
  `tire_status_events`, `chassis_layouts`, `chassis_axles`,
  `chassis_positions`, `vehicle_class_assignments`,
  `vehicle_odometer_overrides`. Rows are soft-deleted (`deleted_at`) and carry
  the server's `sync_version`.
- Mirrors (replaced by a refresh, never written by the user): `vehicles_cache`,
  `drivers_cache`, `service_invoices_cache` (+ items), `vehicle_classes`,
  `service_plans`, `maintenance_categories`, `tire_stock_cache`,
  `oil_stock_cache`, `stock_movements_cache`.
- Engine tables: `outbox`, `sync_state` (pull cursors), `sync_issues`,
  `sync_refresh`.

The session (token + user) is two files in the app data directory, mode 0600.

## Sync

### Sending changes

1. A write changes the local table and adds a row to `outbox` in the same
   transaction. Inserts queue the row; updates queue only the columns that
   changed. Rows from one action share a `group_id`.
2. The engine sends rows oldest-first to `POST /sync/push`. Each row goes
   with its own `op_id`, so the server applies it at most once however often
   it is sent. A group is applied all-or-nothing.
3. A row that has been sent is never changed. A later edit of the same
   record queues behind it. (Only a row that never left the device absorbs a
   newer edit.)
4. Per-row answers:
   - **applied** — done; rows queued behind it for the same record move to
     the new version.
   - **conflict** — another device changed the record first. The server's row
     is taken, the user's own queued changes are put back on top, and the row
     is retried on the new version. The user's fields win; the other
     device's other fields are kept.
   - **error** — the server refuses the change (a rule, a missing record).
     The change is undone locally: the record is re-read from the server, or
     removed if the server never had it. A `sync_issues` row tells the user
     what was refused and why, with what they had entered.
5. A failed request (no connection, server error, timeout) never counts
   against a row. The engine waits and sends the same rows again.
6. Only the signed-in user's rows are sent. Rows queued by someone else wait
   until that person signs in again.

There is no state in which a row stays stuck forever and holds up the rest.

### Receiving changes

`GET /sync/pull` per table with a `(updated_at, id)` cursor, at start, at
sign-in, every two minutes, and on demand. A row with queued local work is
not overwritten; it is re-read from the server after that work has gone
through. One row that cannot be applied is logged and skipped.

"Load everything again" (`sync_resync`) starts every table from zero and
removes local rows the server does not have and nothing is queued for.

## Rules

These are enforced in `services/domain.rs` (stable codes, translated in
`src/shared/i18n/*.json` under `errors.codes`) and again on the server.

- A work order must be open to add tasks, oil or tire work. A work order with
  oil or tire work cannot be deleted; an empty one can.
- A mount needs a free position on the same vehicle and a tire that is not
  mounted. Positions and tires are checked locally and by the server.
- Tire status is derived, never typed: mounted while it has an open mount;
  after a dismount the reason decides (worn/damaged → scrapped, puncture → in
  repair, retread → at the retreader, rotation/other → used pool); repair,
  retread and scrap steps are recorded as events.
- Undo exists for the mistakes that happen: a mount (`mount_undo`), a
  dismount (`dismount_undo`), a wrong dismount reason (`dismount_set_reason`),
  an oil change (`oil_update` / `oil_delete`), a work order
  (`wo_delete`), a tire's details (`tire_update` / `tire_delete`).
- Stock is debited by the server when a new tire or an oil change arrives,
  and corrected when one is edited or deleted. The app shows server stock
  minus what is still queued.

### Odometer

The current odometer of a vehicle is the highest of: Falcon's fuel reading,
Falcon's mileage, oil-change readings, work-order readings, and a manual
correction. After a manual correction, readings recorded before it are
ignored, and each Falcon reading is ignored until it changes.
(`services/views/odometer.rs`; the server's `v_current_odometer` is the same
rule.)

### What is due

A service plan belongs to a vehicle class and a maintenance category, and has
a km interval, a day interval, or both — due on whichever comes first. A
vehicle with no class has no plans and is shown as "not tracked", not as
fine.

"Last done" is the newest ticked task of that category (the time it was
ticked); the km baseline is the newest one whose work order has an odometer.
Adding a task is planning; ticking it is what restarts the clock.

Statuses: overdue, never recorded, due soon, unknown (a km plan on a vehicle
with no odometer reading), fine. (`services/views/due.rs`; the server's
`v_maintenance_due` is the same rule.)

### Tire km

Starting km (entered when the tire is registered) plus every
mount-to-dismount distance on a road position, plus the open mount up to the
vehicle's current odometer. Spare positions do not count. When a mount is
missing an odometer the total is marked as incomplete.

## UI conventions

- Arabic (Egyptian) first, English second; every string is in both
  (`parity.test.ts`). Screens keep their strings in
  `src/shared/i18n/locales/<area>.<lang>.json`.
- Numbers are typed through `NumberInput` and parsed with
  `parseIntInput` / `parseDecimalInput`, which accept Arabic-Indic digits and
  a comma decimal mark.
- Errors reach the user through `notifyError` / `errorText`, which translate
  the error's code. Raw messages are logged, not shown.
- Reads go through `QueryState`: loading, failed and empty are three
  different things.
- Anything that removes or undoes work asks first (`ConfirmDialog`).
- Layout uses logical CSS properties (start/end), works from 360px wide, and
  has no hover-only controls.
