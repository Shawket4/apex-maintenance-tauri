import { useEffect, useState } from "react";

/**
 * Returns a value that lags behind `input` by `delayMs`. Each new `input`
 * starts a fresh timer; if `input` changes again before the timer fires,
 * the previous timer is cancelled. The returned value only catches up
 * after `delayMs` of stillness.
 *
 * Used in the invoice search box so we don't fire a Tauri command on
 * every keystroke.
 */
export function useDebouncedValue<T>(input: T, delayMs: number): T {
  const [value, setValue] = useState(input);

  useEffect(() => {
    const handle = window.setTimeout(() => setValue(input), delayMs);
    return () => window.clearTimeout(handle);
  }, [input, delayMs]);

  return value;
}
