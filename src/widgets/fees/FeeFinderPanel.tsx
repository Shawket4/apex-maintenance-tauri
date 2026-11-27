import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { mountFeeFinder, type FeeFinder } from "apex-fee-finder";
import "apex-fee-finder/style.css";

import { commands } from "@/shared/api/client";

/** The finder's requests name this base; the Rust side sends them on to the
 * fee service with this user's FalconGo token (the page cannot reach another
 * origin itself, and the token never has to live in the page). */
const API_BASE = "/fees-api";

async function transport(url: string): Promise<Response> {
  const path = url.startsWith(API_BASE) ? url.slice(API_BASE.length) : url;
  const r = await commands.feeApi(path);
  // Offline or a refused path: let the finder show its own error and retry.
  if (r.status === "error") throw new Error(r.error.message);
  return new Response(r.data.body, {
    status: r.data.status,
    headers: { "content-type": "application/json" },
  });
}

/** The shared route fee lookup (apex-fee-finder): pickers, the route section
 * (our trucks' best trip vs the truck route), the result card. Whether fees
 * are shown is the fee service's decision (permission 3 and above); the
 * finder is told so it can say "withheld" rather than "not recorded". */
export function FeeFinderPanel({ feesWithheld }: { feesWithheld: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const finder = useRef<FeeFinder | null>(null);
  const { i18n } = useTranslation();
  const { resolvedTheme } = useTheme();
  const lang: "ar" | "en" = i18n.language.startsWith("ar") ? "ar" : "en";
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";

  // Mount once; language and theme changes re-render in place.
  const initial = useRef({ lang, theme, feesWithheld });
  useEffect(() => {
    if (!host.current) return;
    const f = mountFeeFinder(host.current, {
      apiBase: API_BASE,
      fetch: transport,
      lang: initial.current.lang,
      theme: initial.current.theme,
      feesWithheld: initial.current.feesWithheld,
    });
    finder.current = f;
    return () => {
      f.destroy();
      finder.current = null;
    };
  }, []);
  useEffect(() => finder.current?.setLang(lang), [lang]);
  useEffect(() => finder.current?.setTheme(theme), [theme]);

  return <div ref={host} className="min-w-0" />;
}
