import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { env } from "@/shared/config/env";
import ar from "./ar.json";
import en from "./en.json";

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: env.defaultLanguage,
  fallbackLng: env.fallbackLanguage,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
