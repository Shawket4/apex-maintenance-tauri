import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/shared/api/auth";
import { commands } from "@/shared/api/client";

import { CONFIGURE_PERMISSION } from "./gate";
import { SettingsCard } from "./parts";

/** Who is signed in and which version this is — what support asks first. */
export function AboutSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const version = useQuery({
    queryKey: ["app-version"],
    queryFn: () => commands.getAppVersion(),
    staleTime: Infinity,
  });
  const row = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2.5";

  return (
    <SettingsCard id="about" title={t("settings.about.title")}>
      <dl className="divide-y rounded-lg border text-sm">
        <div className={row}>
          <dt className="text-muted-foreground">{t("settings.about.user")}</dt>
          <dd className="min-w-0 text-end font-semibold">
            <bdi>{user?.name || "—"}</bdi>
            {user?.email && (
              <bdi dir="ltr" className="block break-all text-xs font-normal text-muted-foreground">
                {user.email}
              </bdi>
            )}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">{t("settings.about.role")}</dt>
          <dd className="font-semibold">
            {user == null
              ? "—"
              : user.permission >= CONFIGURE_PERMISSION
                ? t("settings.about.roleSupervisor")
                : t("settings.about.roleStaff")}
          </dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">{t("settings.about.version")}</dt>
          <dd className="font-semibold tabular">
            {version.isError ? t("settings.about.versionUnknown") : <bdi dir="ltr">{version.data?.version ?? "…"}</bdi>}
          </dd>
        </div>
      </dl>
    </SettingsCard>
  );
}
