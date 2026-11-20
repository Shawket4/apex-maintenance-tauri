import { describe, expect, it } from "vitest";
import { matches, norm } from "./normalize";

describe("norm", () => {
  // The same pairs as the Rust and server tests: the three must agree.
  it("ignores what people vary", () => {
    expect(norm("315/80R22.5")).toBe(norm(" 315 / 80 r 22.5 "));
    expect(norm("أحمد")).toBe(norm("احمد"));
    expect(norm("٣١٥")).toBe(norm("315"));
    expect(norm("Bridge-Stone")).toBe(norm("bridgestone"));
    expect(norm("  ")).toBe("");
    expect(norm(null)).toBe("");
  });
});

describe("matches", () => {
  it("finds every typed word, in any order", () => {
    expect(matches("Pirelli FR01 315/80R22.5", "315 pirelli")).toBe(true);
    expect(matches("Pirelli FR01 315/80R22.5", "٣١٥")).toBe(true);
    expect(matches("Pirelli FR01", "michelin")).toBe(false);
    expect(matches("تغيير زيت", "تغير")).toBe(false);
    expect(matches("تغيير زيت", "زيت")).toBe(true);
    expect(matches("anything", "   ")).toBe(true);
  });
});
