/**
 * Phase 1 dashboard placeholder.
 *
 * The maintenance / fleet dashboard arrives in Phase 4; right now this page
 * exists to *prove the foundations work*. It calls every Tauri command we
 * registered in Phase 1 and renders the result so the dev (and the human
 * verifying the build) can see at a glance:
 *
 *   - Tauri ↔ Rust IPC is up         (`ping` returns "pong")
 *   - The version is reported back   (`get_app_version`)
 *   - The SQLite pool is alive,
 *     migrations applied, categories
 *     seeded, outbox countable       (`db_health`)
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Database, GitBranch, Inbox, Tag } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { invoke } from "@/shared/api/tauri";
import { useAuth } from "@/shared/api/auth";
import { fmtNumber } from "@/shared/lib/numbers";
import { ExportExcelButton } from "@/shared/ui/ExportExcelButton";
import { TestSyncButton } from "./TestSyncButton";
import { ResetSyncButton } from "./ResetSyncButton";

interface AppVersion {
  name: string;
  version: string;
  tauri_version: string;
}

interface DbHealth {
  ok: boolean;
  migrations_applied: number;
  outbox_pending: number;
  seeded_categories: number;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const locale = i18n.language ?? "ar";

  const ping = useQuery({
    queryKey: ["ping"],
    queryFn: () => invoke<string>("ping"),
  });

  const version = useQuery({
    queryKey: ["version"],
    queryFn: () => invoke<AppVersion>("get_app_version"),
  });

  const health = useQuery({
    queryKey: ["db_health"],
    queryFn: () => invoke<DbHealth>("db_health"),
    refetchInterval: 5_000,
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {t("dashboard.welcome", { name: user?.name || user?.email || "" })}
        </h1>
        <div className="flex items-center gap-2">
          <ResetSyncButton />
          <TestSyncButton />
          <ExportExcelButton
            config={() => ({
            filename: "dashboard_diagnostics",
            sheets: [
              {
                name: "System Health",
                title: t("dashboard.version_title"),
                isRtl: i18n.dir() === "rtl",
                stats: [
                  { label: t("dashboard.migrations_applied"), value: health.data?.migrations_applied ?? 0, type: "integer" },
                  { label: t("dashboard.seeded_categories"), value: health.data?.seeded_categories ?? 0, type: "integer" },
                  { label: t("dashboard.outbox_pending"), value: health.data?.outbox_pending ?? 0, type: "integer" },
                ],
                columns: [
                  { key: "property", header: "Property", width: 25 },
                  { key: "value", header: "Value", width: 25 },
                ],
                rows: [
                  { property: "App Name", value: version.data?.name },
                  { property: "App Version", value: version.data?.version },
                  { property: "Tauri Version", value: version.data?.tauri_version },
                  { property: "Database Status", value: health.data?.ok ? "Healthy" : "Error" },
                  { property: "Ping Response", value: ping.data },
                ],
              },
            ],
          })}
        />
        </div>
      </header>

      <Card className="border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/30">
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <CardTitle className="text-base">
              {t("dashboard.phase1_notice_title")}
            </CardTitle>
            <CardDescription className="mt-1">
              {t("dashboard.phase1_notice_body")}
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<GitBranch className="h-4 w-4" />}
          label={t("dashboard.migrations_applied")}
          value={
            health.isLoading
              ? "…"
              : fmtNumber(health.data?.migrations_applied ?? 0, locale)
          }
        />
        <StatCard
          icon={<Tag className="h-4 w-4" />}
          label={t("dashboard.seeded_categories")}
          value={
            health.isLoading
              ? "…"
              : fmtNumber(health.data?.seeded_categories ?? 0, locale)
          }
        />
        <StatCard
          icon={<Inbox className="h-4 w-4" />}
          label={t("dashboard.outbox_pending")}
          value={
            health.isLoading
              ? "…"
              : fmtNumber(health.data?.outbox_pending ?? 0, locale)
          }
        />
        <StatCard
          icon={<Database className="h-4 w-4" />}
          label={t("dashboard.ping_title")}
          value={ping.data ?? "…"}
          mono
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("dashboard.version_title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {version.isLoading ? (
            <span className="text-muted-foreground">{t("actions.loading")}</span>
          ) : version.data ? (
            <dl
              dir="ltr"
              className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs"
            >
              <dt className="text-muted-foreground">name</dt>
              <dd>{version.data.name}</dd>
              <dt className="text-muted-foreground">version</dt>
              <dd>{version.data.version}</dd>
              <dt className="text-muted-foreground">tauri</dt>
              <dd>{version.data.tauri_version}</dd>
            </dl>
          ) : (
            <span className="text-destructive">—</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  mono,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div
          className={
            "mt-2 text-3xl font-semibold tabular-nums" +
            (mono ? " font-mono text-xl" : "")
          }
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
