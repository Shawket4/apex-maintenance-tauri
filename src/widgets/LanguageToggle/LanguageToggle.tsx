import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

const SUPPORTED_LANGUAGES = ["ar", "en"] as const;

const LANG_LABELS: Record<string, string> = {
  en: "English",
  ar: "العربية",
};

export function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const current = i18n.language?.split("-")[0] ?? "ar";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("settings.language")}>
          <Languages className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LANGUAGES.map((lng) => (
          <DropdownMenuItem key={lng} onClick={() => void i18n.changeLanguage(lng)}>
            <span>{LANG_LABELS[lng] ?? lng}</span>
            {current === lng && <span className="ms-auto text-xs">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
