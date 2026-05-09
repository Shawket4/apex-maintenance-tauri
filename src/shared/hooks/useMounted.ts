import { useEffect, useState } from "react";

/** Returns `true` after the component has mounted. Used by theme + locale
 *  toggles to avoid rendering the wrong icon on the very first paint, when
 *  next-themes hasn't yet resolved the system preference. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
