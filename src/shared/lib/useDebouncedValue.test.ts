import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "@/shared/lib/useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 200));
    expect(result.current).toBe("a");
  });

  it("catches up only after delayMs of stillness", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: "a" },
    });

    rerender({ v: "b" });
    expect(result.current).toBe("a"); // not yet

    act(() => void vi.advanceTimersByTime(199));
    expect(result.current).toBe("a"); // still not

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe("b"); // now
  });

  it("resets the timer on every change — rapid typing only emits the last value", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: "a" },
    });

    rerender({ v: "ab" });
    act(() => void vi.advanceTimersByTime(150));
    rerender({ v: "abc" });
    act(() => void vi.advanceTimersByTime(150)); // 300ms total, but only 150 since last change
    expect(result.current).toBe("a"); // neither intermediate value ever surfaced

    act(() => void vi.advanceTimersByTime(50));
    expect(result.current).toBe("abc"); // the final value, once still
  });
});
