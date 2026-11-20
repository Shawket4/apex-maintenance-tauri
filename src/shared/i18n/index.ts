import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { env } from "@/shared/config/env";
import ar from "./ar.json";
import en from "./en.json";

// Screens keep their own strings next to the shared file:
//   locales/<area>.ar.json + locales/<area>.en.json  →  keys under "<area>.*"
// (parity.test.ts checks every pair has the same keys).
const areaFiles = import.meta.glob<Record<string, unknown>>("./locales/*.json", { eager: true, import: "default" });

type Dict = Record<string, unknown>;

/** Deep merge: an area file adds to (and wins over) the shared section, key
 * by key — a nested group in an area file must not wipe its siblings. */
function deepMerge(base: Dict, extra: Dict): Dict {
  const out: Dict = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const b = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b)
        ? deepMerge(b as Dict, v as Dict)
        : v;
  }
  return out;
}

function withAreas(base: Dict, lang: "ar" | "en") {
  let out: Dict = { ...base };
  for (const [path, content] of Object.entries(areaFiles)) {
    const m = /\/([a-zA-Z0-9_-]+)\.(ar|en)\.json$/.exec(path);
    if (m && m[2] === lang) out = deepMerge(out, { [m[1]]: content });
  }
  return out;
}

// The language choice must survive a restart (the theme next to it does).
const LANG_KEY = "apex-lang";
const stored = (() => {
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    return v === "ar" || v === "en" ? v : null;
  } catch {
    return null;
  }
})();

export const resources = {
  ar: { translation: withAreas(ar, "ar") },
  en: { translation: withAreas(en, "en") },
};

void i18n.use(initReactI18next).init({
  resources,
  lng: stored ?? env.defaultLanguage,
  fallbackLng: env.fallbackLanguage,
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on("languageChanged", (lng) => {
  try {
    window.localStorage.setItem(LANG_KEY, lng.startsWith("ar") ? "ar" : "en");
  } catch {
    // storage unavailable — language just won't persist
  }
});

export default i18n;
