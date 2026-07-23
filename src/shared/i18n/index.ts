import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { env } from "@/shared/config/env";
import ar from "./ar.json";
import en from "./en.json";

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

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
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
