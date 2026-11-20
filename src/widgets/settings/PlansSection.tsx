import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { commands, unwrap, type CategoryRow, type ClassRow, type PlanRow } from "@/shared/api/client";
import { useCategories, useClasses, useDomainMutation, usePlans } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtKm, fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import { NumberInput } from "@/shared/ui/number-input";
import { QueryState } from "@/shared/ui/query-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { EmptyState } from "@/widgets/layout/PageShell";

import { validatePlan, type PlanForm, type PlanValues } from "./lib";
import { useConfigureGate } from "./gate";
import { Note, SettingsCard } from "./parts";

/** "١٨٠ يوم" / "يومين" / "٥ أيام" — the day count as Arabic says it. */
function daysWords(t: TFunction, locale: string, days: number): string {
  return t("settings.plans.days", { count: days, n: fmtNumber(days, locale) });
}

/** A plan in one line: "تغيير زيت كل ١٠٬٠٠٠ كم أو ١٨٠ يوم — تنبيه قبلها بـ ٥٠٠ كم". */
function planSentence(t: TFunction, locale: string, name: string, v: PlanValues): string {
  const km = v.intervalKm != null ? fmtKm(v.intervalKm, locale) : null;
  const days = v.intervalDays != null ? daysWords(t, locale, v.intervalDays) : null;
  let line =
    km && days
      ? t("settings.plans.sentenceBoth", { name, km, days })
      : km
        ? t("settings.plans.sentenceOne", { name, every: km })
        : t("settings.plans.sentenceOne", { name, every: days ?? "" });
  const warnKm = v.leadWarnKm != null && v.leadWarnKm > 0 ? fmtKm(v.leadWarnKm, locale) : null;
  const warnDays = v.leadWarnDays != null && v.leadWarnDays > 0 ? daysWords(t, locale, v.leadWarnDays) : null;
  if (warnKm && warnDays) line += t("settings.plans.warnBoth", { km: warnKm, days: warnDays });
  else if (warnKm || warnDays) line += t("settings.plans.warnOne", { before: warnKm ?? warnDays ?? "" });
  return line;
}

const planValues = (p: PlanRow): PlanValues => ({
  intervalKm: p.interval_km,
  intervalDays: p.interval_days,
  leadWarnKm: p.lead_warn_km,
  leadWarnDays: p.lead_warn_days,
});

type Editing = { cls: ClassRow; plan: PlanRow | null };

/** Maintenance plans, class by class: what is done, every how many km and/or
 * days (due on whichever comes first), and how early the warning starts. */
export function PlansSection() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const ar = locale.startsWith("ar");
  const gate = useConfigureGate();
  const classes = useClasses();
  const plans = usePlans();
  const categories = useCategories();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<PlanRow | null>(null);

  const className = (c: ClassRow) => (ar ? c.name_ar : c.name_en || c.name_ar);
  const catName = (c: CategoryRow | undefined) => (c ? (ar ? c.name_ar : c.name_en || c.name_ar) : t("settings.plans.unknownType"));
  const catOf = (id: string) => (categories.data ?? []).find((c) => c.id === id);
  const active = (plans.data ?? []).filter((p) => p.is_active);

  const remove = useDomainMutation((id: string) => unwrap(commands.planDelete(id)), {
    onSuccess: () => {
      setRemoving(null);
      notifySuccess(t("settings.plans.removed"));
    },
    onError: notifyError,
  });

  return (
    <SettingsCard id="plans" title={t("settings.plans.title")} description={t("settings.plans.intro")}>
      {gate.reason && <Note>{gate.reason}</Note>}

      <QueryState query={classes}>
        {(classRows) => (
          <QueryState query={plans}>
            {() =>
              classRows.length === 0 ? (
                <EmptyState>
                  {t("settings.plans.noClasses")}{" "}
                  <Link to="/settings" hash="classes" className="font-semibold text-primary underline">
                    {t("settings.plans.goClasses")}
                  </Link>
                </EmptyState>
              ) : (
                <div className="space-y-4">
                  {classRows.map((cls) => {
                    const rows = active.filter((p) => p.class_id === cls.id);
                    const freeTypes = (categories.data ?? []).filter((c) => !rows.some((p) => p.category_id === c.id));
                    return (
                      <div key={cls.id} className="rounded-lg border">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2.5">
                          <h3 className="text-sm font-bold" dir="auto">
                            {className(cls)}
                          </h3>
                          {gate.allowed && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!gate.canEdit || freeTypes.length === 0}
                              onClick={() => setEditing({ cls, plan: null })}
                            >
                              <Plus />
                              {t("settings.plans.add")}
                            </Button>
                          )}
                        </div>
                        {rows.length === 0 ? (
                          <p className="px-3 py-3 text-sm text-muted-foreground">{t("settings.plans.emptyClass")}</p>
                        ) : (
                          <ul className="divide-y">
                            {rows.map((p) => (
                              <li key={p.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                                <span className="min-w-0 text-sm leading-6 tabular">
                                  {planSentence(t, locale, catName(catOf(p.category_id)), planValues(p))}
                                </span>
                                {gate.allowed && (
                                  <span className="flex flex-none gap-2">
                                    <Button size="sm" variant="outline" disabled={!gate.canEdit} onClick={() => setEditing({ cls, plan: p })}>
                                      <Pencil />
                                      {t("settings.plans.edit")}
                                    </Button>
                                    <Button size="sm" variant="outline" disabled={!gate.canEdit} onClick={() => setRemoving(p)}>
                                      <Trash2 />
                                      {t("settings.plans.remove")}
                                    </Button>
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            }
          </QueryState>
        )}
      </QueryState>

      {editing && (
        <PlanDialog
          key={`${editing.cls.id}-${editing.plan?.id ?? "new"}`}
          cls={editing.cls}
          plan={editing.plan}
          className={className(editing.cls)}
          types={(categories.data ?? []).filter(
            (c) => !active.some((p) => p.class_id === editing.cls.id && p.category_id === c.id),
          )}
          typeName={catName}
          fixedType={editing.plan ? catOf(editing.plan.category_id) : undefined}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={removing != null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("settings.plans.removeTitle")}
        description={
          removing
            ? t("settings.plans.removeBody", {
                plan: planSentence(t, locale, catName(catOf(removing.category_id)), planValues(removing)),
                cls: (() => {
                  const c = (classes.data ?? []).find((x) => x.id === removing.class_id);
                  return c ? className(c) : "";
                })(),
              })
            : undefined
        }
        confirmLabel={t("settings.plans.removeConfirm")}
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </SettingsCard>
  );
}

function PlanDialog({
  cls,
  plan,
  className,
  types,
  typeName,
  fixedType,
  onClose,
}: {
  cls: ClassRow;
  plan: PlanRow | null;
  className: string;
  /** Maintenance types this class has no plan for yet (adding only). */
  types: CategoryRow[];
  typeName: (c: CategoryRow | undefined) => string;
  fixedType: CategoryRow | undefined;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const num = (v: number | null | undefined) => (v != null && v > 0 ? String(v) : "");
  const [categoryId, setCategoryId] = useState(plan?.category_id ?? "");
  const [form, setForm] = useState<PlanForm>({
    km: num(plan?.interval_km),
    days: num(plan?.interval_days),
    // A stored 0 means "no early warning" and must stay 0, not turn into the default.
    warnKm: plan?.interval_km != null && plan.lead_warn_km != null ? String(plan.lead_warn_km) : "",
    warnDays: plan?.interval_days != null && plan.lead_warn_days != null ? String(plan.lead_warn_days) : "",
  });
  const [tried, setTried] = useState(false);
  const set = (k: keyof PlanForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const checked = validatePlan(form);
  const empty = form.km.trim() === "" && form.days.trim() === "";
  const type = plan ? fixedType : types.find((c) => c.id === categoryId);
  // While the form is still untouched there is nothing to complain about.
  const error = !checked.ok && (tried || !empty) ? t(`settings.plans.err.${checked.error}`) : null;
  const missingType = !plan && categoryId === "";

  const save = useDomainMutation(
    (v: PlanValues) =>
      unwrap(commands.planUpsert(cls.id, categoryId, v.intervalKm, v.intervalDays, v.leadWarnKm, v.leadWarnDays)),
    {
      onSuccess: () => {
        notifySuccess(t("settings.plans.saved"));
        onClose();
      },
      onError: notifyError,
    },
  );

  const submit = () => {
    setTried(true);
    if (!checked.ok || missingType || save.isPending) return;
    save.mutate(checked.values);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plan ? t("settings.plans.editTitle") : t("settings.plans.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("settings.plans.forClass")} <bdi className="font-semibold text-foreground">{className}</bdi>
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="plan-type">{t("settings.plans.type")}</Label>
            {plan ? (
              <div id="plan-type" className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm font-semibold">
                {typeName(fixedType)}
              </div>
            ) : (
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="plan-type" className="h-11 w-full" aria-invalid={tried && missingType}>
                  <SelectValue placeholder={t("settings.plans.typePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {types.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {typeName(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {tried && missingType && (
              <p role="alert" className="text-sm text-status-overdue">
                {t("settings.plans.err.needType")}
              </p>
            )}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">{t("settings.plans.everyTitle")}</legend>
            <p className="text-sm leading-6 text-muted-foreground">{t("settings.plans.everyHint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plan-km">{t("settings.plans.everyKm")}</Label>
                <NumberInput id="plan-km" value={form.km} onValueChange={set("km")} placeholder={t("settings.plans.kmExample")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-days">{t("settings.plans.everyDays")}</Label>
                <NumberInput id="plan-days" value={form.days} onValueChange={set("days")} placeholder={t("settings.plans.daysExample")} />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">{t("settings.plans.warnTitle")}</legend>
            <p className="text-sm leading-6 text-muted-foreground">{t("settings.plans.warnHint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plan-warn-km">{t("settings.plans.warnKmLabel")}</Label>
                <NumberInput
                  id="plan-warn-km"
                  value={form.warnKm}
                  onValueChange={set("warnKm")}
                  disabled={form.km.trim() === ""}
                  placeholder={t("settings.plans.warnKmExample")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-warn-days">{t("settings.plans.warnDaysLabel")}</Label>
                <NumberInput
                  id="plan-warn-days"
                  value={form.warnDays}
                  onValueChange={set("warnDays")}
                  disabled={form.days.trim() === ""}
                  placeholder={t("settings.plans.warnDaysExample")}
                />
              </div>
            </div>
          </fieldset>

          {error ? (
            <p role="alert" className="rounded-lg bg-status-overdue-soft px-3 py-2.5 text-sm text-status-overdue">
              {error}
            </p>
          ) : (
            checked.ok && (
              <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm leading-6">
                <div className="text-xs text-muted-foreground">{t("settings.plans.previewLabel")}</div>
                <div className="font-semibold tabular">
                  {planSentence(t, i18n.language, type ? typeName(type) : t("settings.plans.previewNoType"), checked.values)}
                </div>
              </div>
            )
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {t("settings.plans.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
