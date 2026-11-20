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

/// Fold text for searching: digits to ASCII, Arabic letter variants to one
/// form (أ إ آ ٱ → ا, ة → ه, ى → ي, ؤ → و, ئ → ي), tatweel/diacritics and
/// all spaces removed, Latin upper-cased. A plate is stored as letters
/// separated by spaces ("ن ص ر 1234") and people type it without them.
pub fn fold_search(q: &str) -> String {
    normalize_digits(q)
        .chars()
        .filter_map(|c| match c {
            'أ' | 'إ' | 'آ' | 'ٱ' => Some('ا'),
            'ة' => Some('ه'),
            'ى' => Some('ي'),
            'ؤ' => Some('و'),
            'ئ' => Some('ي'),
            'ـ' => None,
            '\u{064B}'..='\u{0652}' => None,
            c if c.is_whitespace() || c == '-' || c == '_' => None,
            c => Some(c),
        })
        .flat_map(char::to_uppercase)
        .collect()
}

pub(crate) fn pending_ids(conn: &Connection, entity: &str) -> AppResult<HashSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT entity_id FROM outbox
          WHERE entity_type = ?1 AND status IN ('pending','inflight')",
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
          WHERE entity_type = ?1 AND op = 'insert' AND status IN ('pending','inflight')",
    )?;
    let ids = stmt
        .query_map(params![entity], |r| r.get::<_, String>(0))?
        .collect::<Result<HashSet<_>, _>>()?;
    Ok(ids)
}

