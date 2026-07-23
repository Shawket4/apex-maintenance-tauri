import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { RefreshCw, CloudUpload, Moon, Sun, Monitor } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";
import { useAuth } from "@/shared/api/auth";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  useCategories,
  useClasses,
  useDomainMutation,
  useOutbox,
  usePlans,
  useSyncStatus,
  useTrucks,
} from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { PageShell } from "@/widgets/layout/PageShell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useTranslation();
  return (
    <PageShell title={t("settings.title")}>
      <SyncSection />
      <PlansSection />
      <AppearanceSection />
    </PageShell>
  );
}

/* ── sync & diagnostics ─────────────────────────────────────────────────── */

function SyncSection() {
  const { t, i18n } = useTranslation();
  const status = useSyncStatus();
  const outbox = useOutbox();

  const syncNow = useDomainMutation(() => unwrap(commands.syncNow()), { onError: notifyError });
  const refresh = useDomainMutation(
    async () => {
      await unwrap(commands.referenceRefresh());
      await unwrap(commands.stockRefresh());
      await unwrap(commands.vehiclesRefresh());
      await unwrap(commands.invoicesRefresh());
    },
    { onSuccess: () => notifySuccess(t("settings.sync.refreshed")), onError: notifyError },
  );
  const retry = useDomainMutation((seq: number) => unwrap(commands.outboxRetry(seq)), {
    onError: notifyError,
  });
  const discard = useDomainMutation((seq: number) => unwrap(commands.outboxDiscard(seq)), {
    onError: notifyError,
  });

  const rows = outbox.data ?? [];
  const deadRows = rows.filter((r) => r.status === "dead");
  const activeRows = rows.filter((r) => r.status !== "dead");
  const [confirmDiscard, setConfirmDiscard] = useState<number | null>(null);

  // "tire_assignments · insert" meant nothing to a mechanic — label queue
  // rows in the UI language.
  const opLabel = (r: { entity_type: string; op: string }) =>
    `${t(`settings.sync.entityNames.${r.entity_type}`, { defaultValue: r.entity_type })} · ${t(
      `settings.sync.ops.${r.op}`,
      { defaultValue: r.op },
    )}`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{t("settings.sync.title")}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs",
              status.data?.online
                ? "bg-status-ok/15 text-status-ok"
                : "bg-status-due_soon-soft text-status-due_soon",
            )}
          >
            {status.data?.online ? t("sync.online") : t("sync.offline")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.data?.auth_paused && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-status-overdue-soft px-3 py-2.5 text-sm text-status-overdue">
            <span>{t("settings.sync.authExpiredHint")}</span>
            <Link to="/login" className="font-semibold underline">
              {t("sync.authExpired")}
            </Link>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={syncNow.isPending}
            onClick={() => syncNow.mutate()}
          >
            <CloudUpload className="h-4 w-4" />
            {t("settings.sync.syncNow")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw className={cn("h-4 w-4", refresh.isPending && "animate-spin")} />
            {t("settings.sync.refresh")}
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.sync.queueEmpty")}</p>
        ) : (
          <div className="space-y-3">
            {deadRows.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold text-destructive">
                  {t("settings.sync.deadRows")} ({fmtNumber(deadRows.length, i18n.language)})
                </div>
                <div className="space-y-2">
                  {deadRows.map((r) => (
                    <div key={r.seq} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{opLabel(r)}</span>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => retry.mutate(r.seq)}>
                            {t("common.retry")}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setConfirmDiscard(r.seq)}
                          >
                            {t("common.discard")}
                          </Button>
                        </div>
                      </div>
                      {r.last_error && (
                        <div className="mt-1 break-all text-xs text-muted-foreground" dir="ltr">
                          {r.last_error}
                        </div>
                      )}
                      {r.server_row != null && (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          {t("settings.sync.serverRow")}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {activeRows.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold text-muted-foreground">
                  {t("settings.sync.pendingRows")} ({fmtNumber(activeRows.length, i18n.language)})
                </div>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {activeRows.map((r) => (
                    <div
                      key={r.seq}
                      className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"
                    >
                      <span>{opLabel(r)}</span>
                      <span className="text-muted-foreground tabular">
                        {t("settings.sync.attempts")}: {fmtNumber(r.attempts, i18n.language)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {confirmDiscard != null && (
          <Dialog open onOpenChange={(o) => !o && setConfirmDiscard(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{t("settings.sync.discardTitle")}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">{t("settings.sync.discardBody")}</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDiscard(null)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    discard.mutate(confirmDiscard);
                    setConfirmDiscard(null);
                  }}
                >
                  {t("common.confirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}

/* ── classes & plans ────────────────────────────────────────────────────── */

function PlansSection() {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const { user } = useAuth();
  // Server gates plans/classes at permission >= 3 — rendering the editor to a
  // lower level just meant a raw English 403 at save time.
  const canAdmin = (user?.permission ?? 0) >= 3;
  const trucks = useTrucks();
  const classes = useClasses();
  const plans = usePlans();
  const categories = useCategories();

  const assign = useDomainMutation(
    (p: { vehicleId: number; classId: string }) =>
      unwrap(commands.classAssign(p.vehicleId, p.classId)),
    { onError: notifyError },
  );

  const togglePlan = useDomainMutation(
    (p: {
      classId: string;
      categoryId: string;
      triggerType: string;
      intervalKm: number | null;
      intervalDays: number | null;
      active: boolean;
    }) =>
      unwrap(
        commands.planUpsert(p.classId, p.categoryId, p.triggerType, p.intervalKm, p.intervalDays, p.active),
      ),
    { onError: notifyError },
  );

  const [newClassId, setNewClassId] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const addClass = useDomainMutation(
    () => unwrap(commands.classCreate(newClassId.trim(), newClassName.trim())),
    {
      onSuccess: () => {
        setNewClassId("");
        setNewClassName("");
      },
      onError: notifyError,
    },
  );

  const [classId, setClassId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [trigger, setTrigger] = useState<"mileage" | "time">("mileage");
  const [interval, setInterval] = useState("");

  const upsert = useDomainMutation(
    () =>
      unwrap(
        commands.planUpsert(
          classId,
          categoryId,
          trigger,
          trigger === "mileage" ? Number(interval) : null,
          trigger === "time" ? Number(interval) : null,
          null,
        ),
      ),
    {
      onSuccess: () => {
        setInterval("");
        notifySuccess(t("settings.sync.refreshed"));
      },
      onError: notifyError,
    },
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t("settings.plans.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Class tagging */}
        <div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">
            {t("settings.plans.tagTrucks")}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(trucks.data ?? []).map((tr) => (
              <div key={tr.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                <span className="text-sm font-medium">{tr.plate}</span>
                <Select
                  value={tr.class_id ?? ""}
                  onValueChange={(v) => assign.mutate({ vehicleId: tr.id, classId: v })}
                >
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue placeholder={t("trucks.unclassified")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(classes.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {ar ? c.name_ar : c.name_en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>

        {/* Class creation — a third class used to require psql on the VPS. */}
        {canAdmin && (
          <div>
            <div className="mb-2 text-xs font-semibold text-muted-foreground">
              {t("settings.classes.addTitle")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-36"
                dir="ltr"
                placeholder={t("settings.classes.idPlaceholder")}
                value={newClassId}
                onChange={(e) => setNewClassId(e.target.value)}
              />
              <Input
                className="w-44"
                placeholder={t("settings.classes.namePlaceholder")}
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                dir="auto"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!newClassId.trim() || !newClassName.trim() || addClass.isPending}
                onClick={() => addClass.mutate()}
              >
                {t("settings.classes.add")}
              </Button>
            </div>
          </div>
        )}

        {/* Plans editor */}
        {!canAdmin && (
          <p className="text-xs text-muted-foreground">{t("settings.plans.noPermission")}</p>
        )}
        {canAdmin && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            {t("settings.plans.plansEditor")}
            <span className="font-normal">— {t("settings.plans.onlineNote")}</span>
          </div>
          <div className="mb-3 space-y-1.5">
            {(plans.data ?? []).map((p) => {
              const cls = (classes.data ?? []).find((c) => c.id === p.class_id);
              const cat = (categories.data ?? []).find((c) => c.id === p.category_id);
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
                >
                  <span className={cn(!p.is_active && "text-muted-foreground line-through")}>
                    {ar ? cls?.name_ar : cls?.name_en} · {ar ? cat?.name_ar : cat?.name_en}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground tabular">
                    {p.trigger_type === "mileage"
                      ? `${fmtNumber(p.interval_km, i18n.language)} ${t("common.km")}`
                      : `${fmtNumber(p.interval_days, i18n.language)} ${t("settings.plans.byDays")}`}
                    {canAdmin && (
                      <button
                        onClick={() =>
                          togglePlan.mutate({
                            classId: p.class_id,
                            categoryId: p.category_id,
                            triggerType: p.trigger_type,
                            intervalKm: p.interval_km,
                            intervalDays: p.interval_days,
                            active: !p.is_active,
                          })
                        }
                        className={cn(
                          "rounded-full border px-2 py-0.5 transition",
                          p.is_active
                            ? "border-status-ok/40 text-status-ok hover:bg-status-ok-soft"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {p.is_active ? t("settings.plans.active") : t("settings.plans.paused")}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-36">
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={t("settings.plans.class")} />
                </SelectTrigger>
                <SelectContent>
                  {(classes.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {ar ? c.name_ar : c.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-36">
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={t("settings.plans.category")} />
                </SelectTrigger>
                <SelectContent>
                  {(categories.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {ar ? c.name_ar : c.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-32">
              <Select value={trigger} onValueChange={(v) => setTrigger(v as "mileage" | "time")}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mileage">{t("settings.plans.byKm")}</SelectItem>
                  <SelectItem value="time">{t("settings.plans.byDays")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              className="w-28 tabular"
              inputMode="numeric"
              placeholder={
                trigger === "mileage" ? t("settings.plans.intervalKm") : t("settings.plans.intervalDays")
              }
              value={interval}
              onChange={(e) => setInterval(e.target.value.replace(/[^0-9]/g, ""))}
            />
            <Button
              size="sm"
              disabled={!classId || !categoryId || !interval || upsert.isPending}
              onClick={() => upsert.mutate()}
            >
              {t("settings.plans.save")}
            </Button>
          </div>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── appearance & language ──────────────────────────────────────────────── */

function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t("settings.appearance.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("settings.appearance.language")}</span>
          <div className="flex rounded-lg border p-0.5">
            {(["ar", "en"] as const).map((lng) => (
              <button
                key={lng}
                onClick={() => void i18n.changeLanguage(lng)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm transition",
                  i18n.language.startsWith(lng)
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                {lng === "ar" ? t("settings.appearance.arabic") : t("settings.appearance.english")}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("settings.appearance.theme")}</span>
          <div className="flex rounded-lg border p-0.5">
            {(
              [
                { v: "light", icon: Sun, key: "settings.appearance.light" },
                { v: "dark", icon: Moon, key: "settings.appearance.dark" },
                { v: "system", icon: Monitor, key: "settings.appearance.system" },
              ] as const
            ).map(({ v, icon: Icon, key }) => (
              <button
                key={v}
                onClick={() => setTheme(v)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition",
                  theme === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
