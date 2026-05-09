import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { useMounted } from "@/shared/hooks/useMounted";

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const { t } = useTranslation();
  const mounted = useMounted();

  if (!mounted) {
    return <Button variant="ghost" size="icon" aria-hidden />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("settings.theme")}>
          <Sun className="h-4 w-4 scale-100 rotate-0 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 scale-0 rotate-90 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="h-4 w-4" />
          {t("settings.themeLight")}
          {theme === "light" && <span className="ms-auto text-xs">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="h-4 w-4" />
          {t("settings.themeDark")}
          {theme === "dark" && <span className="ms-auto text-xs">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="h-4 w-4" />
          {t("settings.themeSystem")}
          {theme === "system" && <span className="ms-auto text-xs">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
