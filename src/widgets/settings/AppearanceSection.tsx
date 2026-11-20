import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/shared/lib/cn";

import { SettingsCard } from "./parts";

const choice = (on: boolean) =>
  cn(
    "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition sm:flex-none",
    on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
  );

/** Language and light/dark. Both are remembered on this device. */
export function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const themes = [
    { v: "light", icon: Sun, label: t("settings.appearance.light") },
    { v: "dark", icon: Moon, label: t("settings.appearance.dark") },
    { v: "system", icon: Monitor, label: t("settings.appearance.system") },
  ];

  return (
    <SettingsCard id="appearance" title={t("settings.appearance.title")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div id="lang-label" className="text-sm font-semibold">
            {t("settings.appearance.language")}
          </div>
          <div role="group" aria-labelledby="lang-label" className="flex rounded-lg border p-1 sm:inline-flex">
            {(["ar", "en"] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                aria-pressed={i18n.language.startsWith(lng)}
                onClick={() => void i18n.changeLanguage(lng)}
                className={choice(i18n.language.startsWith(lng))}
              >
                {lng === "ar" ? "العربية" : "English"}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div id="theme-label" className="text-sm font-semibold">
            {t("settings.appearance.theme")}
          </div>
          <div role="group" aria-labelledby="theme-label" className="flex rounded-lg border p-1 sm:inline-flex">
            {themes.map(({ v, icon: Icon, label }) => (
              <button key={v} type="button" aria-pressed={theme === v} onClick={() => setTheme(v)} className={choice(theme === v)}>
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}
