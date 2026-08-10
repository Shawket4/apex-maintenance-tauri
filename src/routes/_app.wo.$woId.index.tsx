import { useRef, useState } from "react";
import { Link, createFileRoute, useCanGoBack, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Check,
  CircleDot,
  Droplets,
  Gauge,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Lock,
} from "lucide-react";

import { commands, unwrap, type WoDetail } from "@/shared/api/client";
import { useCategories, useDomainMutation, useStock, useTruck, useWo } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtAgo, fmtCairo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { EmptyState, ListCard, PageShell, Section } from "@/widgets/layout/PageShell";

export const Route = createFileRoute("/_app/wo/$woId/")({
  component: WoCockpit,
});

/** The cockpit: the screen a mechanic lives in while the truck is in the bay.
 * Design 2026-07-23: breadcrumb, white header card with the odometer block,
 * task list with a docked composer, vehicle facts + due suggestions aside. */
function WoCockpit() {
  const { t, i18n } = useTranslation();
  const { woId } = Route.useParams();
  const wo = useWo(woId);
  const truck = useTruck(wo.data?.wo.vehicle_id ?? 0);

  if (wo.isLoading) {
    return (
      <PageShell>
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </PageShell>
    );
  }
  const d = wo.data;
  if (!d) {
    return (
      <PageShell>
        <EmptyState className="p-10">{t("wo.notFound")}</EmptyState>
      </PageShell>
    );
  }
  const isOpen = d.wo.status === "open";

  return (
    <PageShell>
      <Breadcrumb plate={d.wo.plate} vehicleId={d.wo.vehicle_id} />

      {/* Header card */}
      <div className="flex flex-wrap items-center justify-between gap-5 rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="whitespace-nowrap text-2xl font-bold [word-spacing:0.12em]">{d.wo.plate}</span>
            <Badge
              className={
                isOpen
                  ? "bg-status-ok-soft text-status-ok hover:bg-status-ok-soft"
                  : "bg-muted text-muted-foreground hover:bg-muted"
              }
            >
              {t(`wo.status.${d.wo.status}`)}
            </Badge>
            {d.wo.pending && <Badge variant="outline">{t("wo.pending")}</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t("wo.openedAt")} {fmtAgo(d.wo.opened_at, i18n.language)}
            {d.wo.closed_at &&
              ` · ${t("wo.closedAt")} ${fmtCairo(d.wo.closed_at, "YYYY/MM/DD HH:mm", i18n.language)}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="text-xs text-muted-foreground">{t("wo.odometerAtOpen")}</div>
            <div className="group flex items-center gap-1.5 text-[17px] font-semibold tabular">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              {d.wo.odometer_at_open != null
                ? `${fmtNumber(d.wo.odometer_at_open, i18n.language)} ${t("common.km")}`
                : "—"}
              <EditWoOdometer woId={woId} current={d.wo.odometer_at_open} />
            </div>
          </div>
          {isOpen ? (
            <CloseWoButton woId={woId} undoneCount={d.tasks.filter((x) => !x.is_done).length} />
          ) : (
            <ReopenWoButton woId={woId} />
          )}
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Tasks — list in a card, composer docked at the bottom. */}
          <Section
            title={
              <>
                {t("wo.tasks")} · <span className="tabular">{fmtNumber(d.tasks.length, i18n.language)}</span>
              </>
            }
          >
            <ListCard>
              <TaskList d={d} canEdit={isOpen} />
              {isOpen && <AddTaskInput woId={woId} />}
            </ListCard>
          </Section>

          {/* Oil */}
          <Section
            title={
              <span className="flex items-center gap-2">
                <Droplets className="h-3.5 w-3.5 text-status-due_soon" />
                {t("wo.oil.title")}
              </span>
            }
          >
            <ListCard>
              {d.oil_changes.map((o, i) => (
                <div
                  key={o.id}
                  className={cn(
                    "flex items-center justify-between px-[18px] py-3 text-sm",
                    i > 0 && "border-t",
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-semibold" dir="ltr">
                      {o.oil_type}
                    </span>
                    <span className="tabular">
                      {fmtNumber(o.liters, i18n.language)} {t("common.liters")}
                    </span>
                    {o.flagged && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-status-due_soon text-status-due_soon"
                      >
                        <TriangleAlert className="h-3 w-3" />
                        {t("wo.oil.flaggedBadge")}
                      </Badge>
                    )}
                    {o.pending && <Badge variant="outline">{t("wo.pending")}</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground tabular">
                    {o.odometer != null && `${fmtNumber(o.odometer, i18n.language)} ${t("common.km")}`}
                  </span>
                </div>
              ))}
              {isOpen && (
                <OilForm
                  woId={woId}
                  vehicleId={d.wo.vehicle_id}
                  odometerAtOpen={d.wo.odometer_at_open}
                  hasRows={d.oil_changes.length > 0}
                />
              )}
              {!isOpen && d.oil_changes.length === 0 && (
                <div className="px-[18px] py-4 text-sm text-muted-foreground">
                  {t("common.empty")}
                </div>
              )}
            </ListCard>
          </Section>

          {/* Tire ops */}
          <Section
            title={
              <span className="flex items-center gap-2">
                <CircleDot className="h-3.5 w-3.5 text-primary" />
                {t("wo.tires.title")}
              </span>
            }
            action={
              isOpen ? (
                <Link to="/wo/$woId/tires" params={{ woId }}>
                  <Button size="sm" variant="outline">
                    {t("wo.tires.open")}
                  </Button>
                </Link>
              ) : undefined
            }
          >
            <ListCard>
              {d.tire_ops.length === 0 ? (
                <div className="px-[18px] py-4 text-sm text-muted-foreground">
                  {t("wo.tires.empty")}
                </div>
              ) : (
                d.tire_ops.map((op, i) => (
                  <div
                    key={op.assignment_id}
                    className={cn(
                      "flex items-center justify-between px-[18px] py-3 text-sm",
                      i > 0 && "border-t",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary tabular"
                        dir="ltr"
                      >
                        {op.position_code ?? "—"}
                      </span>
                      <span dir="ltr">{op.dot_code ?? op.brand ?? ""}</span>
                      {op.pending && (
                        <Badge variant="outline" className="text-[10px]">
                          {t("wo.pending")}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {op.dismounted_at ? t("wo.tires.dismounted") : t("wo.tires.mounted")}
                    </span>
                  </div>
                ))
              )}
            </ListCard>
          </Section>
        </div>

        {/* Aside: vehicle facts + due suggestions. */}
        <aside className="space-y-6">
          <Section title={t("wo.vehicle")}>
            <div className="rounded-xl border bg-card px-[18px] py-4 shadow-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-xs text-muted-foreground">{t("trucks.driver")}</dt>
                <dd className="truncate font-semibold">{truck.data?.driver_name ?? "—"}</dd>
                <dt className="text-xs text-muted-foreground">{t("truck.class")}</dt>
                <dd className="truncate font-semibold">
                  {truck.data?.class_name_ar ?? t("trucks.unclassified")}
                </dd>
                <dt className="text-xs text-muted-foreground">{t("truck.odometer")}</dt>
                <dd className="truncate font-semibold tabular">
                  {truck.data?.odometer
                    ? `${fmtNumber(truck.data.odometer.km, i18n.language)} ${t("common.km")} (${t(
                        `truck.odometerSource.${truck.data.odometer.source}`,
                      )})`
                    : "—"}
                </dd>
              </dl>
            </div>
          </Section>

          <Section title={t("wo.due.title")}>
            <DueSuggestions d={d} woId={woId} canAdd={isOpen} />
          </Section>
        </aside>
      </div>
    </PageShell>
  );
}

function Breadcrumb({ plate, vehicleId }: { plate: string; vehicleId: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return (
    <div className="text-xs text-muted-foreground">
      {canGoBack ? (
        <button onClick={() => router.history.back()} className="font-medium hover:text-foreground">
          {t("common.back")}
        </button>
      ) : (
        <Link
          to="/trucks/$truckId"
          params={{ truckId: String(vehicleId) }}
          className="font-medium text-muted-foreground hover:text-foreground"
        >
          {plate}
        </Link>
      )}{" "}
      ‹ <span className="font-semibold text-foreground">{t("wo.title")} {plate}</span>
    </div>
  );
}

function AddTaskInput({ woId }: { woId: string }) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const [category, setCategory] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const categories = useCategories();

  const add = useDomainMutation(
    (payload: { text: string; category: string | null }) =>
      unwrap(commands.woAddTask(woId, payload.category, payload.text)),
    {
      onSuccess: () => {
        setText("");
        inputRef.current?.focus();
      },
      onError: notifyError,
    },
  );

  const submit = () => {
    const v = text.trim();
    if (!v || add.isPending) return; // Enter has no disabled state — guard here
    add.mutate({ text: v, category: category || null });
  };

  return (
    <div className="flex gap-2 border-t bg-background/70 px-4 py-3">
      <Input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder={t("wo.addTaskPlaceholder")}
        autoFocus
        dir="auto"
        className="bg-card"
      />
      <Select value={category} onValueChange={setCategory}>
        <SelectTrigger className="w-40 shrink-0 bg-card">
          <SelectValue placeholder={t("wo.noCategory")} />
        </SelectTrigger>
        <SelectContent>
          {(categories.data ?? []).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {i18n.language.startsWith("ar") ? c.name_ar : c.name_en}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        onClick={submit}
        disabled={!text.trim() || add.isPending}
        size="icon"
        className="shrink-0"
        aria-label={t("wo.addTaskPlaceholder")}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

function TaskList({ d, canEdit }: { d: WoDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const del = useDomainMutation((taskId: string) => unwrap(commands.woDeleteTask(taskId)), {
    onError: notifyError,
  });
  // The checkbox IS the due clock: only checked tasks reset "last done".
  const setDone = useDomainMutation(
    (p: { taskId: string; done: boolean }) => unwrap(commands.woTaskSetDone(p.taskId, p.done)),
    { onError: notifyError },
  );

  const freeTasks = d.tasks.filter((task) => task.kind === "free");
  if (freeTasks.length === 0) {
    return <div className="px-[18px] py-4 text-sm text-muted-foreground">{t("common.empty")}</div>;
  }
  return (
    <ul>
      {freeTasks.map((task, i) => (
        <li
          key={task.id}
          className={cn(
            "group flex items-center justify-between gap-3 px-[18px] py-3 text-sm",
            i > 0 && "border-t",
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              role="checkbox"
              aria-checked={task.is_done}
              aria-label={t("wo.taskDone")}
              disabled={!canEdit}
              onClick={() => setDone.mutate({ taskId: task.id, done: !task.is_done })}
              className={cn(
                "flex h-5 w-5 flex-none items-center justify-center rounded-md border transition",
                task.is_done
                  ? "border-status-ok bg-status-ok text-white"
                  : "bg-card hover:border-border-strong",
                !canEdit && "opacity-60",
              )}
            >
              {task.is_done && <Check className="h-3.5 w-3.5" />}
            </button>
            {task.category_name_ar && (
              <Badge variant="secondary" className="shrink-0">
                {task.category_name_ar}
              </Badge>
            )}
            <span
              className={cn(
                "min-w-0 break-words font-medium",
                task.is_done && "text-muted-foreground line-through decoration-border-strong",
              )}
            >
              {task.description_ar}
            </span>
            {task.pending && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {t("wo.pending")}
              </Badge>
            )}
          </div>
          {canEdit && (
            <button
              title={t("wo.deleteTask")}
              aria-label={t("wo.deleteTask")}
              onClick={() => del.mutate(task.id)}
              className="rounded p-1.5 text-muted-foreground opacity-0 transition focus-visible:opacity-100 hover:bg-destructive/10 hover:text-destructive group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function OilForm({
  woId,
  vehicleId,
  odometerAtOpen,
  hasRows,
}: {
  woId: string;
  vehicleId: number;
  odometerAtOpen: number | null;
  hasRows: boolean;
}) {
  const { t } = useTranslation();
  const stock = useStock();
  const [oilType, setOilType] = useState("");
  const [liters, setLiters] = useState("");
  // Empty mirror (fresh install / offline day one) must never block recording
  // oil — the server tolerates unknown types and the debit is derived anyway.
  const stockEmpty = (stock.data?.oil ?? []).length === 0;

  const add = useDomainMutation(
    () => unwrap(commands.oilAdd(woId, vehicleId, oilType, Number(liters), odometerAtOpen)),
    {
      onSuccess: (res) => {
        if (res.flagged) toast.warning(t("wo.oil.flagged"));
        setLiters("");
      },
      onError: notifyError,
    },
  );

  return (
    <div className={cn("flex flex-wrap items-end gap-2 bg-background/70 px-4 py-3", hasRows && "border-t")}>
      <div className="min-w-36 flex-1 space-y-1">
        <Label className="text-xs">{t("wo.oil.type")}</Label>
        {stockEmpty ? (
          <Input
            dir="ltr"
            className="bg-card"
            placeholder={t("wo.oil.freeTypePlaceholder")}
            value={oilType}
            onChange={(e) => setOilType(e.target.value)}
          />
        ) : (
          <Select value={oilType} onValueChange={setOilType}>
            <SelectTrigger className="bg-card">
              <SelectValue placeholder={t("wo.oil.type")} />
            </SelectTrigger>
            <SelectContent>
              {(stock.data?.oil ?? []).map((o) => (
                <SelectItem key={o.id} value={o.oil_type}>
                  <span dir="ltr">{o.oil_type}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {stockEmpty && (
          <p className="text-[11px] text-muted-foreground">{t("wo.oil.noStockHint")}</p>
        )}
      </div>
      <div className="w-28 space-y-1">
        <Label className="text-xs">{t("wo.oil.liters")}</Label>
        <Input
          inputMode="decimal"
          className="bg-card tabular"
          value={liters}
          onChange={(e) => {
            // digits + at most one decimal point — "1.2.3" → NaN slipped the guard
            const v = e.target.value.replace(/[^0-9.]/g, "");
            const firstDot = v.indexOf(".");
            setLiters(
              firstDot === -1
                ? v
                : v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replaceAll(".", ""),
            );
          }}
        />
      </div>
      <Button
        onClick={() => add.mutate()}
        disabled={!oilType.trim() || !(Number(liters) > 0) || add.isPending}
      >
        {t("wo.oil.record")}
      </Button>
    </div>
  );
}

function DueSuggestions({ d, woId, canAdd }: { d: WoDetail; woId: string; canAdd: boolean }) {
  const { t, i18n } = useTranslation();
  const add = useDomainMutation(
    (payload: { category: string; label: string }) =>
      unwrap(commands.woAddTask(woId, payload.category, payload.label)),
    { onError: notifyError },
  );

  const rows = d.due.filter((r) => r.status !== "ok");
  if (rows.length === 0) {
    return <EmptyState className="p-6">{t("wo.due.empty")}</EmptyState>;
  }
  return (
    <div className="rounded-xl border bg-card p-1.5 shadow-sm">
      {rows.map((row, i) => (
        <div
          key={`${row.vehicle_id}-${row.plan_id}`}
          className={cn(
            "flex items-center justify-between gap-2.5 px-3 py-2.5",
            i > 0 && "border-t border-dashed",
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">
              {i18n.language.startsWith("ar") ? row.category_name_ar : row.category_name_en}
            </div>
            <div className="text-xs text-muted-foreground tabular">
              {row.next_due_km != null
                ? t("due.nextDueKm", { km: fmtNumber(row.next_due_km, i18n.language) })
                : t(`due.status.${row.status}`)}
            </div>
          </div>
          {canAdd && (
            <Button
              size="sm"
              variant="outline"
              className="flex-none"
              disabled={add.isPending}
              onClick={() =>
                // description_ar is STORED DATA on an Arabic-first record —
                // always the Arabic name, whatever the UI language is.
                add.mutate({ category: row.category_id, label: row.category_name_ar })
              }
            >
              {t("wo.due.addAsTask")}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function CloseWoButton({ woId, undoneCount }: { woId: string; undoneCount: number }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = useDomainMutation(() => unwrap(commands.woClose(woId)), {
    onSuccess: () => setOpen(false),
    onError: notifyError,
  });

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Lock className="h-4 w-4" />
        {t("wo.close")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("wo.closeTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("wo.closeBody")}</p>
          {undoneCount > 0 && (
            <p className="rounded-lg bg-status-due_soon-soft px-3 py-2 text-sm text-status-due_soon">
              {t("wo.closeUndone", { n: fmtNumber(undoneCount, i18n.language) })}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={close.isPending} onClick={() => close.mutate()}>
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Escape hatch: a WO closed by mistake used to be unrecoverable. */
function ReopenWoButton({ woId }: { woId: string }) {
  const { t } = useTranslation();
  const reopen = useDomainMutation(() => unwrap(commands.woReopen(woId)), {
    onError: notifyError,
  });
  return (
    <Button variant="secondary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
      <RotateCcw className="h-4 w-4" />
      {t("wo.reopen")}
    </Button>
  );
}

/** odometer_at_open is BOTH an odometer-truth candidate and the due baseline
 * — a fat-fingered digit used to skew next_due_km permanently. */
function EditWoOdometer({ woId, current }: { woId: string; current: number | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current != null ? String(current) : "");
  const save = useDomainMutation(
    () => unwrap(commands.woSetOdometer(woId, value ? Number(value) : null)),
    { onSuccess: () => setOpen(false), onError: notifyError },
  );
  return (
    <>
      <button
        aria-label={t("wo.editOdo")}
        title={t("wo.editOdo")}
        onClick={() => {
          setValue(current != null ? String(current) : "");
          setOpen(true);
        }}
        className="rounded p-1 text-muted-foreground opacity-0 transition focus-visible:opacity-100 hover:bg-accent hover:text-foreground group-hover:opacity-100"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("wo.editOdo")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{t("wo.editOdoHint")}</p>
          <Input
            inputMode="numeric"
            className="tabular"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
