import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Search } from "lucide-react";

import { commands, unwrap, type ClassRow, type TruckRow } from "@/shared/api/client";
import { useClasses, useDomainMutation, useTrucks } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { QueryState } from "@/shared/ui/query-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { EmptyState } from "@/widgets/layout/PageShell";

import { plateKey } from "./lib";
import { Note, SettingsCard } from "./parts";

/** Radix Select cannot hold an empty value — this stands for "no class". */
const NO_CLASS = "__none__";
/** Rows rendered before "show more" (each row carries a dropdown). */
const PAGE = 40;

type Change = { truck: TruckRow; classId: string | null };

/** The whole fleet, one row per truck, with its class. A first assignment is
 * saved at once; moving a truck to another class, or clearing its class, asks
 * first because it changes which maintenance is tracked for it. This is a
 * normal change: it works without a connection and goes out later. */
export function TruckClassesSection() {
  const { t, i18n } = useTranslation();
  const trucks = useTrucks();
  const classes = useClasses();
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [confirm, setConfirm] = useState<Change | null>(null);

  const nameOf = (c: ClassRow) => (i18n.language.startsWith("ar") ? c.name_ar : c.name_en || c.name_ar);
  const classById = (id: string | null) => (classes.data ?? []).find((c) => c.id === id) ?? null;

  const save = useDomainMutation(
    (c: Change) =>
      c.classId == null
        ? unwrap(commands.classUnassign(c.truck.id))
        : unwrap(commands.classAssign(c.truck.id, c.classId)),
    {
      onSuccess: (_d, c) => {
        setConfirm(null);
        const cls = classById(c.classId);
        notifySuccess(
          cls
            ? t("settings.fleet.saved", { plate: c.truck.plate, name: nameOf(cls) })
            : t("settings.fleet.cleared", { plate: c.truck.plate }),
        );
      },
      onError: notifyError,
    },
  );

  const choose = (truck: TruckRow, value: string) => {
    const classId = value === NO_CLASS ? null : value;
    if (classId === (truck.class_id ?? null) || save.isPending) return;
    // Nothing to lose on a first assignment; anything else asks first.
    if (truck.class_id == null && classId != null) save.mutate({ truck, classId });
    else setConfirm({ truck, classId });
  };

  const all = useMemo(() => trucks.data ?? [], [trucks.data]);
  const missing = all.filter((tr) => !tr.class_id).length;
  const filtered = useMemo(() => {
    const key = plateKey(q);
    return all.filter((tr) => (!onlyMissing || !tr.class_id) && (key === "" || plateKey(tr.plate).includes(key)));
  }, [all, q, onlyMissing]);
  const shown = filtered.slice(0, limit);
  const noClasses = classes.data != null && classes.data.length === 0;
  const fromClass = confirm ? classById(confirm.truck.class_id) : null;
  const toClass = confirm ? classById(confirm.classId) : null;

  return (
    <SettingsCard id="truck-classes" title={t("settings.fleet.title")} description={t("settings.fleet.intro")}>
      <QueryState query={trucks}>
        {() => (
          <>
            {all.length > 0 && (
              <p className="text-sm font-semibold tabular" role="status">
                {missing > 0 ? (
                  <span className="text-status-due_soon">
                    {t("settings.fleet.missing", {
                      n: fmtNumber(missing, i18n.language),
                      total: fmtNumber(all.length, i18n.language),
                    })}
                  </span>
                ) : (
                  <span className="text-status-ok">{t("settings.fleet.allSet", { total: fmtNumber(all.length, i18n.language) })}</span>
                )}
              </p>
            )}
            {noClasses && <Note tone="warn">{t("settings.fleet.noClasses")}</Note>}

            {all.length === 0 ? (
              <EmptyState>{t("settings.fleet.empty")}</EmptyState>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="space-y-2 sm:w-72">
                    <Label htmlFor="fleet-search">{t("settings.fleet.searchLabel")}</Label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="fleet-search"
                        className="ps-9"
                        dir="auto"
                        inputMode="search"
                        placeholder={t("settings.fleet.searchPlaceholder")}
                        value={q}
                        onChange={(e) => {
                          setQ(e.target.value);
                          setLimit(PAGE);
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex min-h-11 items-center gap-2.5">
                    <Checkbox
                      id="fleet-only-missing"
                      className="size-5"
                      checked={onlyMissing}
                      onCheckedChange={(v) => {
                        setOnlyMissing(v === true);
                        setLimit(PAGE);
                      }}
                    />
                    <Label htmlFor="fleet-only-missing" className="leading-6">
                      {t("settings.fleet.onlyMissing")}
                    </Label>
                  </div>
                </div>

                {filtered.length === 0 ? (
                  <EmptyState>
                    {q.trim() ? (
                      <>
                        {t("settings.fleet.noMatch")} <bdi>«{q.trim()}»</bdi>
                      </>
                    ) : (
                      t("settings.fleet.noneMissing")
                    )}
                  </EmptyState>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {shown.map((tr) => {
                      const saving = save.isPending && save.variables?.truck.id === tr.id;
                      const labelId = `fleet-plate-${tr.id}`;
                      return (
                        <li key={tr.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0" id={labelId}>
                            <bdi className="text-sm font-bold">{tr.plate}</bdi>
                            {tr.car_type && <span className="ms-2 text-sm text-muted-foreground">{tr.car_type}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            {saving && <Loader2 className="h-4 w-4 flex-none animate-spin text-muted-foreground" />}
                            <Select
                              value={tr.class_id ?? NO_CLASS}
                              onValueChange={(v) => choose(tr, v)}
                              disabled={save.isPending}
                            >
                              <SelectTrigger className="h-11 w-full sm:w-60" aria-labelledby={labelId}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NO_CLASS}>{t("settings.fleet.notSet")}</SelectItem>
                                {(classes.data ?? []).map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {nameOf(c)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {filtered.length > shown.length && (
                  <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
                    {t("settings.fleet.showMore", { n: fmtNumber(filtered.length - shown.length, i18n.language) })}
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </QueryState>

      <ConfirmDialog
        open={confirm != null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.classId == null
            ? t("settings.fleet.clearTitle", { plate: confirm?.truck.plate ?? "" })
            : t("settings.fleet.moveTitle", { plate: confirm?.truck.plate ?? "" })
        }
        description={
          confirm?.classId == null
            ? t("settings.fleet.clearBody", { from: fromClass ? nameOf(fromClass) : "" })
            : t("settings.fleet.moveBody", {
                from: fromClass ? nameOf(fromClass) : "",
                to: toClass ? nameOf(toClass) : "",
              })
        }
        confirmLabel={confirm?.classId == null ? t("settings.fleet.clearConfirm") : t("settings.fleet.moveConfirm")}
        destructive={confirm?.classId == null}
        pending={save.isPending}
        onConfirm={() => confirm && save.mutate(confirm)}
      />
    </SettingsCard>
  );
}
