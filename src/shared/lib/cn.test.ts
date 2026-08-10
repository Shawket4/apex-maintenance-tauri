import { describe, expect, it } from "vitest";

import { cn } from "@/shared/lib/cn";

describe("cn", () => {
  it("joins truthy class values and drops falsy ones", () => {
    expect(cn("a", "b")).toBe("a b");
    expect(cn("a", false, null, undefined, "", "c")).toBe("a c");
  });

  it("supports conditional object syntax", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });

  it("merges conflicting Tailwind utilities — the LAST wins", () => {
    // This is the whole reason cn exists over plain clsx: a later padding
    // utility must override an earlier one, not stack.
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm text-muted", "text-lg")).toBe("text-muted text-lg");
  });

  it("keeps non-conflicting utilities and respects logical-property variants", () => {
    // ms-/me- (logical) must not be treated as conflicting with each other.
    expect(cn("ms-2", "me-4")).toBe("ms-2 me-4");
    expect(cn("rounded-full", "border", "px-3")).toBe("rounded-full border px-3");
  });

  it("returns an empty string when given nothing", () => {
    expect(cn()).toBe("");
    expect(cn(false, null, undefined)).toBe("");
  });
});
