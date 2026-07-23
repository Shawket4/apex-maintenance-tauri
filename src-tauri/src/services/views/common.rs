//! Shared helpers: digit normalization + the outbox pending-id sets
//! every view uses to surface queued work AS queued.

use std::collections::HashSet;

use rusqlite::{params, Connection};

use crate::AppResult;


/// Normalize Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits to
/// ASCII so a mechanic typing ٨٣٥١ finds plate "… 8351".
pub fn normalize_digits(q: &str) -> String {
    q.chars()
        .map(|c| match c {
            '\u{0660}'..='\u{0669}' => char::from(b'0' + (c as u32 - 0x0660) as u8),
            '\u{06F0}'..='\u{06F9}' => char::from(b'0' + (c as u32 - 0x06F0) as u8),
            _ => c,
        })
        .collect()
}

pub(crate) fn pending_ids(conn: &Connection, entity: &str) -> AppResult<HashSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT entity_id FROM outbox
          WHERE entity_type = ?1 AND status IN ('pending','inflight','dead')",
    )?;
    let ids = stmt
        .query_map(params![entity], |r| r.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(ids)
}

/// Like pending_ids, but INSERT ops only. Stock projection needs this: a later
/// status update queued for a long-acked shipment tire is not a stock debit.
pub(crate) fn pending_insert_ids(conn: &Connection, entity: &str) -> AppResult<HashSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT entity_id FROM outbox
          WHERE entity_type = ?1 AND op = 'insert' AND status IN ('pending','inflight','dead')",
    )?;
    let ids = stmt
        .query_map(params![entity], |r| r.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(ids)
}

