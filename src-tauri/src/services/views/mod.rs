//! Owned-domain READS: typed view-models over the local database.
//!
//! Every screen reads from here — local SQLite is the working truth (mirror ∪
//! local intent, since writes land locally in the same transaction that queues
//! them). Rows that haven't been server-acked yet are surfaced via `pending`
//! flags computed from the outbox, so queued work is visible AS queued.
//!
//! Derived values (grouping, counts, status math, odometer truth) live in SQL
//! or Rust here — never in React.
//!
//! One module per screen family; `common` holds the shared helpers and each
//! shared SQL fragment lives with its owner (ODO_CTE in `odometer`, DUE_TAIL
//! in `due`, TIRE_KM_ACCRUED in `tires`). Everything re-exports flat so
//! callers keep saying `views::X`.

mod common;
mod odometer;
mod due;
mod wo;
mod trucks;
mod home;
mod tires;
mod chassis;
mod reference;
mod search;

pub use chassis::*;
pub use common::*;
pub use due::*;
pub use home::*;
pub use odometer::*;
pub use reference::*;
pub use search::*;
pub use tires::*;
pub use trucks::*;
pub use wo::*;

#[cfg(test)]
mod tests;
