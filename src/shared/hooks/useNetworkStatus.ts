import { useEffect, useState } from "react";

/**
 * Browser online/offline indicator. The Rust core has its own concept of
 * "can I reach maint-rust" (sync engine in Phase 3); this hook only reflects
 * `navigator.onLine` for header chrome purposes.
 */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return online;
}
