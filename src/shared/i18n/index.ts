import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { env } from "@/shared/config/env";
import ar from "./ar.json";
import en from "./en.json";

// Screens keep their own strings next to the shared file:
//   locales/<area>.ar.json + locales/<area>.en.json  →  keys under "<area>.*"
// (parity.test.ts checks every pair has the same keys).
const areaFiles = import.meta.glob<Record<string, unknown>>("./locales/*.json", { eager: true, import: "default" });

function withAreas(base: Record<string, unknown>, lang: "ar" | "en") {
  const out: Record<string, unknown> = { ...base };
  for (const [path, content] of Object.entries(areaFiles)) {
    const m = /\/([a-zA-Z0-9_-]+)\.(ar|en)\.json$/.exec(path);
    if (m && m[2] === lang) out[m[1]] = { ...((out[m[1]] as object) ?? {}), ...content };
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
