import { useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowRight,
  CircleDot,
  Droplets,
  Gauge,
  Plus,
  Trash2,
  TriangleAlert,
  Lock,
} from "lucide-react";

import { commands, unwrap, type WoDetail } from "@/shared/api/client";
import { useCategories, useDomainMutation, useStock, useWo } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtAgo, fmtCairo } from "@/shared/lib/time";
import { DueList } from "@/widgets/due/DueList";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
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

export const Route = createFileRoute("/_app/wo/$woId/")({
  component: WoCockpit,
});

/** The cockpit: the screen a mechanic lives in while the truck is in the bay.
 * Enter-to-add tasks, structured oil form, tire ops, due suggestions. */
function WoCockpit() {
  const { t, i18n } = useTranslation();
  const { woId } = Route.useParams();
  const wo = useWo(woId);

  if (wo.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  const d = wo.data;
  if (!d) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("wo.notFound")}
        </div>
      </div>
    );
  }
  const isOpen = d.wo.status === "open";

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <Link
        to="/trucks/$truckId"
        params={{ truckId: String(d.wo.vehicle_id) }}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowRight className="h-4 w-4 ltr:rotate-180" /> {d.wo.plate}
      </Link>

      {/* Header */}
      <div className="rounded-2xl border bg-gradient-to-br from-primary/5 to-transparent p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold tracking-wide">{d.wo.plate}</span>
              <Badge
                className={
                  isOpen
                    ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15"
                    : "bg-muted text-muted-foreground hover:bg-muted"
                }
              >
                {t(`wo.status.${d.wo.status}`)}
              </Badge>
              {d.wo.pending && <Badge variant="outline">{t("wo.pending")}</Badge>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                {t("wo.openedAt")} {fmtAgo(d.wo.opened_at, i18n.language)}
              </span>
              {d.wo.odometer_at_open != null && (
                <span className="flex items-center gap-1 tabular">
                  <Gauge className="h-3.5 w-3.5" />
                  {fmtNumber(d.wo.odometer_at_open, i18n.language)} {t("common.km")}
                </span>
              )}
              {d.wo.closed_at && (
                <span>
                  {t("wo.closedAt")} {fmtCairo(d.wo.closed_at, "YYYY/MM/DD HH:mm", i18n.language)}
                </span>
              )}
            </div>
          </div>
          {isOpen && <CloseWoButton woId={woId} />}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_290px]">
        <div className="space-y-6">
          {/* Tasks */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("wo.tasks")}</h2>
            {isOpen && <AddTaskInput woId={woId} />}
            <TaskList d={d} canEdit={isOpen} />
          </section>

          {/* Oil */}
          <section>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Droplets className="h-4 w-4 text-amber-500" />
                  {t("wo.oil.title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {d.oil_changes.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium" dir="ltr">
                        {o.oil_type}
                      </span>
                      <span className="tabular">
                        {fmtNumber(o.liters, i18n.language)} {t("common.liters")}
                      </span>
                      {o.flagged && (
                        <Badge variant="outline" className="gap-1 border-status-due_soon text-status-due_soon">
                          <TriangleAlert className="h-3 w-3" />
                          {t("wo.oil.flaggedBadge")}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground tabular">
                      {o.odometer != null && `${fmtNumber(o.odometer, i18n.language)} ${t("common.km")}`}
                    </span>
                  </div>
                ))}
                {isOpen && <OilForm woId={woId} vehicleId={d.wo.vehicle_id} odometerAtOpen={d.wo.odometer_at_open} />}
              </CardContent>
            </Card>
          </section>

          {/* Tire ops */}
          <section>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <CircleDot className="h-4 w-4 text-primary" />
                    {t("wo.tires.title")}
                  </span>
                  {isOpen && (
                    <Link to="/wo/$woId/tires" params={{ woId }}>
                      <Button size="sm" variant="secondary">
                        {t("wo.tires.open")}
                      </Button>
                    </Link>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {d.tire_ops.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("wo.tires.empty")}</p>
                ) : (
                  <div className="space-y-2">
                    {d.tire_ops.map((op) => (
                      <div
                        key={op.assignment_id}
                        className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-background px-1.5 py-0.5 text-xs font-bold tabular" dir="ltr">
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
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>

        {/* Due suggestions */}
        <aside>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("wo.due.title")}</h2>
          <DueSuggestions d={d} woId={woId} canAdd={isOpen} />
        </aside>
      </div>
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
    if (!v) return;
    add.mutate({ text: v, category: category || null });
  };

  return (
    <div className="mb-3 flex gap-2">
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
      />
      <Select value={category} onValueChange={setCategory}>
        <SelectTrigger className="w-40 shrink-0">
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
      <Button onClick={submit} disabled={!text.trim() || add.isPending} size="icon" className="shrink-0">
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

  const freeTasks = d.tasks.filter((task) => task.kind === "free");
  if (freeTasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        {t("common.empty")}
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {freeTasks.map((task) => (
        <li
          key={task.id}
          className="group flex items-center justify-between rounded-xl border bg-card p-3 text-sm"
        >
          <div className="flex min-w-0 items-center gap-2">
            {task.category_name_ar && (
              <Badge variant="secondary" className="shrink-0">
                {task.category_name_ar}
              </Badge>
            )}
            <span className="min-w-0 break-words">{task.description_ar}</span>
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
              className="rounded p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
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
}: {
  woId: string;
  vehicleId: number;
  odometerAtOpen: number | null;
}) {
  const { t } = useTranslation();
  const stock = useStock();
  const [oilType, setOilType] = useState("");
  const [liters, setLiters] = useState("");

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
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-36 flex-1 space-y-1">
        <Label className="text-xs">{t("wo.oil.type")}</Label>
        <Select value={oilType} onValueChange={setOilType}>
          <SelectTrigger>
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
      </div>
      <div className="w-28 space-y-1">
        <Label className="text-xs">{t("wo.oil.liters")}</Label>
        <Input
          inputMode="decimal"
          className="tabular"
          value={liters}
          onChange={(e) => setLiters(e.target.value.replace(/[^0-9.]/g, ""))}
        />
      </div>
      <Button
        onClick={() => add.mutate()}
        disabled={!oilType || !liters || Number(liters) <= 0 || add.isPending}
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
  return (
    <DueList
      rows={rows}
      emptyText={t("wo.due.empty")}
      action={
        canAdd
          ? (row) => (
              <Button
                size="sm"
                variant="outline"
                disabled={add.isPending}
                onClick={() =>
                  add.mutate({
                    category: row.category_id,
                    label: i18n.language.startsWith("ar")
                      ? row.category_name_ar
                      : row.category_name_en,
                  })
                }
              >
                {t("wo.due.addAsTask")}
              </Button>
            )
          : undefined
      }
    />
  );
}

function CloseWoButton({ woId }: { woId: string }) {
  const { t } = useTranslation();
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
