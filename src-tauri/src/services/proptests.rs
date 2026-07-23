//! Property-based tests for the client's pure functions — the Madar-style
//! "invariants hold for ALL inputs, not just the examples" layer. Each block
//! states the property the function must never violate, then proptest hunts a
//! counterexample across thousands of generated inputs.

#![cfg(test)]

use proptest::prelude::*;

use serde_json::Value;

use crate::services::cache_sync::sanitize_fts5_query;
use crate::services::chassis_plan::{plan_chassis, PlanConfig};
use crate::services::engine::to_sql;
use crate::services::outbox::{backoff_ms, K_BACKOFF_CAP_MS};
use crate::services::views::normalize_digits;

proptest! {
    /// Backoff is monotonic non-decreasing in attempts, always capped, and
    /// deterministic — the thundering-herd + runaway-retry guarantees.
    #[test]
    fn backoff_is_monotonic_capped_and_deterministic(
        seq in 0i64..1_000_000,
        a in 1i64..12,
    ) {
        let x = backoff_ms(a, seq);
        let y = backoff_ms(a + 1, seq);
        prop_assert!(x <= y, "backoff decreased from attempt {a} to {}", a + 1);
        // cap + max jitter (< 1000).
        prop_assert!(x <= K_BACKOFF_CAP_MS + 1000, "backoff {x} exceeds cap");
        prop_assert!(x >= 0);
        prop_assert_eq!(backoff_ms(a, seq), x, "not deterministic");
    }

    /// Digit normalization never panics, preserves char count, and maps every
    /// Arabic-Indic / Eastern digit to its ASCII equivalent (idempotent).
    #[test]
    fn normalize_digits_preserves_length_and_is_idempotent(s in ".*") {
        let once = normalize_digits(&s);
        prop_assert_eq!(once.chars().count(), s.chars().count(), "char count changed");
        prop_assert_eq!(normalize_digits(&once), once.clone(), "not idempotent");
        // No Arabic-Indic digit survives.
        prop_assert!(
            !once.chars().any(|c| ('\u{0660}'..='\u{0669}').contains(&c)
                || ('\u{06F0}'..='\u{06F9}').contains(&c)),
            "an Arabic-Indic digit survived"
        );
    }

    /// The chassis planner never panics and — for every legal config —
    /// produces unique codes and a position count matching the formula. (The
    /// exhaustive grid lives in chassis_plan's own tests; this hits the
    /// rejection path and the boundaries with random input.)
    #[test]
    fn chassis_planner_never_panics_and_codes_are_unique(
        drive in -3i64..8,
        trailer in -3i64..12,
        spares in -3i64..10,
        single in any::<bool>(),
    ) {
        let cfg = PlanConfig {
            drive_axles: drive,
            trailer_axles: trailer,
            spares,
            single_trailer_axles: single,
        };
        match plan_chassis(&cfg) {
            Ok(plan) => {
                use std::collections::HashSet;
                let uniq: HashSet<&str> = plan.positions.iter().map(|p| p.code.as_str()).collect();
                prop_assert_eq!(uniq.len(), plan.positions.len(), "duplicate code");
                let expected = 2
                    + (drive as usize) * 4
                    + (trailer as usize) * (if single { 2 } else { 4 })
                    + (spares as usize);
                prop_assert_eq!(plan.positions.len(), expected);
            }
            Err(_) => {
                // Rejection is only allowed for out-of-range/illegal configs.
                prop_assert!(
                    drive < 1 || trailer < 0 || spares < 0
                        || drive > 4 || trailer > 8 || spares > 6,
                    "rejected a legal config: {drive},{trailer},{spares}"
                );
            }
        }
    }

    /// The FTS5 sanitizer never panics on arbitrary Unicode and never emits a
    /// bare FTS5 operator — every token comes out as a quoted prefix match, so
    /// a mechanic's `"; DROP` or `foo:bar*(` degrades to a harmless search.
    #[test]
    fn fts_sanitizer_output_is_always_safe(s in ".*") {
        let out = sanitize_fts5_query(&s);
        for tok in out.split(' ').filter(|t| !t.is_empty()) {
            prop_assert!(tok.starts_with('"'), "unquoted token: {tok:?}");
            prop_assert!(tok.ends_with("\"*"), "missing prefix wildcard: {tok:?}");
            // No raw quote inside the token body (would break the FTS5 parse).
            prop_assert!(!tok[1..tok.len() - 2].contains('"'), "inner quote: {tok:?}");
        }
    }

    /// to_sql never panics and never loses a composite value to NULL (the
    /// attachments-wiped bug): arrays/objects become canonical JSON text.
    #[test]
    fn to_sql_never_drops_composites(
        // A grab-bag of JSON shapes.
        pick in 0u8..6,
        n in any::<i64>(),
        f in any::<f64>(),
        s in ".*",
    ) {
        let v: Value = match pick {
            0 => Value::Null,
            1 => Value::Bool(n & 1 == 0),
            2 => Value::from(n),
            3 => if f.is_finite() { Value::from(f) } else { Value::from(0.0) },
            4 => Value::from(s.clone()),
            _ => serde_json::json!({ "arr": [n, s], "nested": { "k": f.is_finite() } }),
        };
        let out = to_sql(Some(&v));
        if v.is_array() || v.is_object() {
            prop_assert!(!matches!(out, rusqlite::types::Value::Null), "composite → NULL");
        }
    }
}