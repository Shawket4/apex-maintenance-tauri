import { describe, expect, it } from "vitest";

import { DUE_BADGE, DUE_DOT, REASON_STATUS, TIRE_BADGE } from "./status";

// The status vocabularies. These lists are deliberate duplicates of the Rust
// enums — the whole point is that adding a status over there without styling
// it here fails THIS file, not a screen at runtime.
const DUE_STATUSES = ["overdue", "due_soon", "never_done", "ok"] as const;
const TIRE_STATUSES = [
  "mounted",
  "in_stock_used",
  "in_repair",
  "retreading",
  "scrapped",
] as const;

describe("status token maps", () => {
  it("every due status has a dot and a badge", () => {
    for (const s of DUE_STATUSES) {
      expect(DUE_DOT[s], `DUE_DOT.${s}`).toBeTruthy();
      expect(DUE_BADGE[s], `DUE_BADGE.${s}`).toBeTruthy();
    }
    expect(Object.keys(DUE_DOT).sort()).toEqual([...DUE_STATUSES].sort());
    expect(Object.keys(DUE_BADGE).sort()).toEqual([...DUE_STATUSES].sort());
  });

  it("every tire status has a badge", () => {
    for (const s of TIRE_STATUSES) {
      expect(TIRE_BADGE[s], `TIRE_BADGE.${s}`).toBeTruthy();
    }
    expect(Object.keys(TIRE_BADGE).sort()).toEqual([...TIRE_STATUSES].sort());
  });
});

describe("dismount reason → status (drift canary)", () => {
  // Pinned against the Rust derivation in src-tauri services/domain.rs and
  // maint-rust services/side_effects.rs. If the product rule changes, change
  // all three together — this test is the reminder.
  it("matches the Rust rule exactly", () => {
    expect(REASON_STATUS).toEqual({
      worn: "scrapped",
      damaged: "scrapped",
      rotation: "in_stock_used",
      puncture: "in_repair",
      retread: "retreading",
      other: "in_stock_used",
    });
  });

  it("every reason resolves to a styled tire status", () => {
    for (const [reason, status] of Object.entries(REASON_STATUS)) {
      expect(TIRE_BADGE[status], `${reason} → ${status} has no badge`).toBeTruthy();
    }
  });
});
