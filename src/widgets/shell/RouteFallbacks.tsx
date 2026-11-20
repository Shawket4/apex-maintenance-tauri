import { Link, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Compass } from "lucide-react";

import { errorText } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";

/** A screen crashed. Say so, and offer the two things that help. */
export function RouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  console.error("[apex] route error", error);
  return (
    <div className="grid min-h-[60dvh] place-items-center p-6">
      <div className="max-w-sm text-center" role="alert">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-status-overdue" />
        <h1 className="text-lg font-bold">{t("errors.screenFailed")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{errorText(error)}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              reset?.();
              void router.invalidate();
            }}
          >
            {t("common.retry")}
          </Button>
          <Button variant="outline" asChild>
            <Link to="/">{t("nav.home")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RouteNotFound() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-[60dvh] place-items-center p-6">
      <div className="max-w-sm text-center">
        <Compass className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-bold">{t("errors.pageNotFound")}</h1>
        <Button className="mt-5" asChild>
          <Link to="/">{t("nav.home")}</Link>
        </Button>
      </div>
    </div>
  );
}
