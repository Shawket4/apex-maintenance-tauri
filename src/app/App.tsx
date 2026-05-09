import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Providers } from "./providers";
import { Router } from "./routes";
import { Toaster } from "@/shared/ui/toaster";

export function App() {
  return (
    <Providers>
      <DirectionSync />
      <Router />
      <Toaster />
    </Providers>
  );
}

/** Keeps `<html dir>` and `<html lang>` in sync with the current i18n locale.
 *  Per architecture §12.2 — RTL is set via `dir`, not via Tailwind classes. */
function DirectionSync() {
  const { i18n } = useTranslation();

  const dir = useMemo(
    () => (i18n.language?.startsWith("ar") ? "rtl" : "ltr"),
    [i18n.language],
  );

  useEffect(() => {
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", i18n.language);
  }, [dir, i18n.language]);

  return null;
}
