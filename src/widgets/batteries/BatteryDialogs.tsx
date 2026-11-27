import { useId, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Search } from "lucide-react";

import {
  commands,
  unwrap,
  type BatteryDetailsInput,
  type BatteryFitRow,
  type BatteryRow,
} from "@/shared/api/client";
import { useBatteries, useBatteryHistory, useCatalog, useDomainMutation } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { matches } from "@/shared/lib/normalize";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtKm, fmtNumber, parseIntInput } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { NumberInput } from "@/shared/ui/number-input";
import { ErrorState } from "@/shared/ui/query-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { StatusChip } from "@/shared/ui/status-chip";
import { BatteryProductPicker } from "@/widgets/catalog/pickers";
import { Note, RadioCard } from "@/widgets/diagram/Workbench";

import {
  BATTERY_BADGE,
  BATTERY_OFF_STATUSES,
  BATTERY_REASONS,
  MAX_TEXT,
  REASON_OUTCOME,
  WARRANTY_RANGE,
  batteryKey,
  batteryName,
  batteryRating,
  fmtYmd,
  inRange,
  toSpecInput,
  warrantyPast,
  type BatterySpec,
} from "./lib";

// ── shared fields ────────────────────────────────────────────────────────────

type Details = { serial: string; dateCode: string; warranty: string; notes: string };
const EMPTY_DETAILS: Details = { serial: "", dateCode: "", warranty: "", notes: "" };

const warrantyOk = (d: Details) => {
  if (d.warranty.trim() === "") return true;
  const n = parseIntInput(d.warranty);
  return n != null && inRange(n, WARRANTY_RANGE);
};

function detailsInput(d: Details): BatteryDetailsInput {
  return {
    serial: d.serial.trim() || null,
    date_code: d.dateCode.trim() || null,
    warranty_months: parseIntInput(d.warranty),
    notes: d.notes.trim() || null,
  };
}

/** Serial, date code, warranty (and notes when editing): what is written on
 * this one battery, on top of its type. */
function DetailsFields({
  value,
  onChange,
  withNotes = false,
  disabled,
}: {
  value: Details;
  onChange: (d: Details) => void;
  withNotes?: boolean;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const set = (patch: Partial<Details>) => onChange({ ...value, ...patch });
  const bad = !warrantyOk(value);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-serial`}>{t("batteries.field.serial")}</Label>
        <Input
          id={`${uid}-serial`}
          dir="ltr"
          className="text-start"
          autoComplete="off"
          maxLength={MAX_TEXT}
          disabled={disabled}
          value={value.serial}
          onChange={(e) => set({ serial: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-date`}>{t("batteries.field.dateCode")}</Label>
        <Input
          id={`${uid}-date`}
          dir="ltr"
          className="text-start"
          autoComplete="off"
          maxLength={MAX_TEXT}
          disabled={disabled}
          value={value.dateCode}
          onChange={(e) => set({ dateCode: e.target.value })}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${uid}-warranty`}>{t("batteries.field.warranty")}</Label>
        <NumberInput
          id={`${uid}-warranty`}
          disabled={disabled}
          value={value.warranty}
          onValueChange={(v) => set({ warranty: v })}
          aria-invalid={bad || undefined}
          aria-describedby={`${uid}-warranty-note`}
        />
        <div id={`${uid}-warranty-note`}>
          {bad ? (
            <Note tone="error">
              {t("batteries.field.warrantyBad", { max: fmtNumber(WARRANTY_RANGE[1], i18n.language) })}
            </Note>
          ) : (
            <Note>{t("batteries.field.warrantyHint")}</Note>
          )}
        </div>
      </div>
      {withNotes && (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${uid}-notes`}>{t("batteries.field.notes")}</Label>
          <Input
            id={`${uid}-notes`}
            dir="auto"
            maxLength={MAX_TEXT}
            disabled={disabled}
            value={value.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

function OdometerField({
  value,
  onChange,
  fittedAt,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  /** The odometer when it was fitted: a removal below it is refused. */
  fittedAt?: number | null;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const km = parseIntInput(value);
  const backwards = km != null && fittedAt != null && km < fittedAt;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${uid}-odo`}>{t("batteries.field.odometer")}</Label>
      <NumberInput
        id={`${uid}-odo`}
        disabled={disabled}
        value={value}
        onValueChange={onChange}
        aria-invalid={backwards || undefined}
        aria-describedby={`${uid}-odo-note`}
      />
      <div id={`${uid}-odo-note`}>
        {backwards ? (
          <Note tone="error">{t("batteries.field.odometerBackwards", { km: fmtKm(fittedAt, i18n.language) })}</Note>
        ) : km == null ? (
          <Note tone="warn">{t("batteries.field.odometerMissing")}</Note>
        ) : fittedAt != null ? (
          <Note>{t("batteries.field.fittedAt", { km: fmtKm(fittedAt, i18n.language) })}</Note>
        ) : null}
      </div>
    </div>
  );
}

const DIALOG = "sm:max-w-xl";

// ── fit ──────────────────────────────────────────────────────────────────────

type Source = "new" | "used";

/** Fit a battery into an empty slot, under an open work order: a new one from
 * the shelf (it gets its own record now) or a used one that is back in stock.
 * Fitting restarts the truck's battery due date. A type the shelf does not
 * have never blocks the job — the count is corrected afterwards. */
export function FitBatteryDialog({
  vehicleId,
  slot,
  workOrderId,
  defaultOdometer,
  onClose,
}: {
  vehicleId: number;
  slot: number;
  workOrderId: string;
  defaultOdometer: number | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const uid = useId();
  const catalog = useCatalog();
  const usedStock = useBatteries("in_stock_used");

  const [source, setSource] = useState<Source>("new");
  const [spec, setSpec] = useState<BatterySpec | null>(null);
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [usedId, setUsedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [odometer, setOdometer] = useState(defaultOdometer != null ? String(defaultOdometer) : "");
  const km = parseIntInput(odometer);

  // New ones of this type on the shelf: null = not stocked at all;
  // undefined = not known yet.
  const onHand = useMemo(() => {
    if (!spec || !catalog.data) return undefined;
    return catalog.data.battery_products.find((p) => batteryKey(p) === batteryKey(spec))?.on_hand ?? null;
  }, [spec, catalog.data]);

  const done = () => {
    notifySuccess(t("batteries.fit.done", { n: fmtNumber(slot, lang) }));
    onClose();
  };
  const fitNew = useDomainMutation(
    () =>
      unwrap(
        commands.batteryFitNew({
          vehicle_id: vehicleId,
          slot,
          work_order_id: workOrderId,
          spec: toSpecInput(spec!),
          details: detailsInput(details),
          odometer: km,
        }),
      ),
    { onSuccess: done, onError: notifyError },
  );
  const fitUsed = useDomainMutation(
    () =>
      unwrap(
        commands.batteryFitUsed({
          battery_id: usedId!,
          vehicle_id: vehicleId,
          slot,
          work_order_id: workOrderId,
          odometer: km,
        }),
      ),
    { onSuccess: done, onError: notifyError },
  );
  const busy = fitNew.isPending || fitUsed.isPending;

  const usedList = useMemo(
    () =>
      (usedStock.data ?? []).filter((b) =>
        matches(`${b.brand} ${b.model ?? ""} ${batteryRating(b)} ${b.serial ?? ""} ${b.date_code ?? ""}`, search),
      ),
    [usedStock.data, search],
  );

  const newReady = !!spec?.brand.trim() && warrantyOk(details);
  const ready = source === "new" ? newReady : !!usedId;

  const sourceButton = (s: Source) => (
    <button
      type="button"
      role="radio"
      aria-checked={source === s}
      disabled={busy}
      onClick={() => setSource(s)}
      className={cn(
        "min-h-11 flex-1 rounded-md px-2 py-1.5 text-sm font-semibold transition",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        source === s ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {t(s === "new" ? "batteries.fit.fromNew" : "batteries.fit.fromUsed")}
    </button>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className={DIALOG} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t("batteries.fit.title", { n: fmtNumber(slot, lang) })}</DialogTitle>
          <DialogDescription>{t("batteries.fit.subtitle")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready || busy) return;
            if (source === "new") fitNew.mutate();
            else fitUsed.mutate();
          }}
        >
          <div
            role="radiogroup"
            aria-label={t("batteries.fit.sourceLabel")}
            className="flex gap-1 rounded-lg bg-muted p-1"
          >
            {sourceButton("new")}
            {sourceButton("used")}
          </div>

          {source === "new" ? (
            <>
              <div className="space-y-1.5">
                <Label id={`${uid}-type-label`} htmlFor={`${uid}-type`}>
                  {t("batteries.fit.pickType")}
                </Label>
                <BatteryProductPicker
                  id={`${uid}-type`}
                  aria-labelledby={`${uid}-type-label`}
                  showStock
                  disabled={busy}
                  value={spec}
                  onChange={setSpec}
                />
                {!spec && <Note>{t("batteries.fit.typeRequired")}</Note>}
                {spec && onHand === null && <Note tone="warn">{t("batteries.fit.notStocked")}</Note>}
                {spec && onHand != null && onHand <= 0 && <Note tone="warn">{t("batteries.fit.zeroStock")}</Note>}
              </div>
              <DetailsFields value={details} onChange={setDetails} disabled={busy} />
            </>
          ) : usedStock.isError && usedStock.data === undefined ? (
            <ErrorState error={usedStock.error} onRetry={() => void usedStock.refetch()} retrying={usedStock.isFetching} />
          ) : usedStock.isPending ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : (usedStock.data ?? []).length === 0 ? (
            <div className="space-y-1 rounded-lg border border-dashed p-4 text-sm">
              <p className="font-semibold">{t("batteries.fit.noUsed")}</p>
              <p className="leading-relaxed text-muted-foreground">{t("batteries.fit.noUsedHow")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div id={`${uid}-used`} className="text-sm font-semibold">
                {t("batteries.fit.pickUsed")}
              </div>
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  aria-label={t("batteries.fit.searchUsed")}
                  placeholder={t("batteries.fit.searchUsed")}
                  className="ps-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div
                role="radiogroup"
                aria-labelledby={`${uid}-used`}
                className="grid max-h-72 gap-2 overflow-y-auto pe-0.5"
              >
                {usedList.map((b) => (
                  <RadioCard
                    key={b.id}
                    checked={usedId === b.id}
                    onSelect={() => setUsedId(b.id)}
                    disabled={busy}
                    title={
                      <>
                        <bdi>{batteryName(b)}</bdi>
                        {batteryRating(b) && (
                          <>
                            {" · "}
                            <bdi dir="ltr">{batteryRating(b)}</bdi>
                          </>
                        )}
                      </>
                    }
                    description={<BatteryIds battery={b} />}
                  />
                ))}
                {usedList.length === 0 && <Note>{t("batteries.fit.noMatch")}</Note>}
              </div>
            </div>
          )}

          <OdometerField value={odometer} onChange={setOdometer} disabled={busy} />

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy && <Loader2 className="animate-spin" />}
              {source === "new" ? t("batteries.fit.submitNew") : t("batteries.fit.submitUsed")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Serial · date code · warranty, the way the battery itself can be told apart. */
function BatteryIds({ battery: b }: { battery: BatteryRow }) {
  const { t, i18n } = useTranslation();
  const parts: React.ReactNode[] = [];
  parts.push(
    b.serial ? (
      <span key="s">
        {t("batteries.serialShort")} <bdi dir="ltr" className="whitespace-nowrap">{b.serial}</bdi>
      </span>
    ) : (
      <span key="s">{t("batteries.noSerial")}</span>
    ),
  );
  if (b.date_code) {
    parts.push(
      <span key="d">
        {t("batteries.dateCodeShort")} <bdi dir="ltr">{b.date_code}</bdi>
      </span>,
    );
  }
  if (b.warranty_until) {
    parts.push(
      <span key="w" className={warrantyPast(b.warranty_until) ? "font-semibold text-status-overdue" : undefined}>
        {warrantyPast(b.warranty_until)
          ? t("batteries.warrantyEnded", { date: fmtYmd(b.warranty_until, i18n.language) })
          : t("batteries.warrantyUntil", { date: fmtYmd(b.warranty_until, i18n.language) })}
      </span>,
    );
  }
  return (
    <span className="flex flex-wrap gap-x-2">
      {parts.map((p, i) => (
        <span key={i} className="flex gap-x-2">
          {i > 0 && <span aria-hidden>·</span>}
          {p}
        </span>
      ))}
    </span>
  );
}

// ── register ─────────────────────────────────────────────────────────────────

/** First record of a battery that is already on the truck (from before the
 * app). No work order, no stock effect, no due-date restart: nothing was done
 * to it, it is only written down. */
export function RegisterBatteryDialog({
  vehicleId,
  slot,
  defaultOdometer,
  onClose,
}: {
  vehicleId: number;
  slot: number;
  defaultOdometer: number | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const uid = useId();
  const [spec, setSpec] = useState<BatterySpec | null>(null);
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [odometer, setOdometer] = useState(defaultOdometer != null ? String(defaultOdometer) : "");

  const register = useDomainMutation(
    () =>
      unwrap(
        commands.batteryRegister({
          vehicle_id: vehicleId,
          slot,
          spec: toSpecInput(spec!),
          details: detailsInput(details),
          odometer: parseIntInput(odometer),
        }),
      ),
    {
      onSuccess: () => {
        notifySuccess(t("batteries.register.done", { n: fmtNumber(slot, lang) }));
        onClose();
      },
      onError: notifyError,
    },
  );
  const busy = register.isPending;
  const ready = !!spec?.brand.trim() && warrantyOk(details);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className={DIALOG} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t("batteries.register.title", { n: fmtNumber(slot, lang) })}</DialogTitle>
          <DialogDescription>{t("batteries.register.subtitle")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !busy) register.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label id={`${uid}-type-label`} htmlFor={`${uid}-type`}>
              {t("batteries.fit.pickType")}
            </Label>
            <BatteryProductPicker
              id={`${uid}-type`}
              aria-labelledby={`${uid}-type-label`}
              disabled={busy}
              value={spec}
              onChange={setSpec}
            />
            {!spec && <Note>{t("batteries.fit.typeRequired")}</Note>}
          </div>
          <DetailsFields value={details} onChange={setDetails} disabled={busy} />
          <OdometerField value={odometer} onChange={setOdometer} disabled={busy} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy && <Loader2 className="animate-spin" />}
              {t("batteries.register.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── take off ─────────────────────────────────────────────────────────────────

/** Take a battery off: why, and where it went. The reason suggests the place
 * (weak → charging, dead → scrap…) but the person picks; nothing is final —
 * where it is can be changed afterwards, and a wrong removal undone. */
export function RemoveBatteryDialog({
  fit,
  workOrderId,
  defaultOdometer,
  onClose,
}: {
  fit: BatteryFitRow;
  /** The open work order it is recorded under, when there is one. */
  workOrderId: string | null;
  defaultOdometer: number | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const uid = useId();
  const [reason, setReason] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [outcomeChosen, setOutcomeChosen] = useState(false);
  const [odometer, setOdometer] = useState(defaultOdometer != null ? String(defaultOdometer) : "");
  const km = parseIntInput(odometer);
  const backwards = km != null && fit.installed_odometer != null && km < fit.installed_odometer;

  const remove = useDomainMutation(
    () =>
      unwrap(
        commands.batteryRemove({
          install_id: fit.install_id,
          odometer: km,
          reason: reason!,
          outcome: outcome!,
          work_order_id: workOrderId,
        }),
      ),
    {
      onSuccess: () => {
        notifySuccess(t(`batteries.remove.done.${outcome}`));
        onClose();
      },
      onError: notifyError,
    },
  );
  const busy = remove.isPending;
  const ready = reason != null && outcome != null && !backwards;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className={DIALOG} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t("batteries.remove.title", { n: fmtNumber(fit.slot, lang) })}</DialogTitle>
          <DialogDescription>
            <bdi className="font-semibold text-foreground">{batteryName(fit.battery)}</bdi>
            {batteryRating(fit.battery) && (
              <>
                {" · "}
                <bdi dir="ltr">{batteryRating(fit.battery)}</bdi>
              </>
            )}
            {fit.battery.serial && (
              <>
                {" · "}
                {t("batteries.serialShort")} <bdi dir="ltr" className="whitespace-nowrap">{fit.battery.serial}</bdi>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !busy) remove.mutate();
          }}
        >
          <div className="space-y-2">
            <div id={`${uid}-reason`} className="text-sm font-semibold">
              {t("batteries.remove.reasonPrompt")}
            </div>
            <div role="radiogroup" aria-labelledby={`${uid}-reason`} className="grid grid-cols-2 gap-2">
              {BATTERY_REASONS.map((r) => (
                <RadioCard
                  key={r}
                  checked={reason === r}
                  disabled={busy}
                  onSelect={() => {
                    setReason(r);
                    if (!outcomeChosen) setOutcome(REASON_OUTCOME[r] ?? null);
                  }}
                  title={t(`batteries.reason.${r}`)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div id={`${uid}-outcome`} className="text-sm font-semibold">
              {t("batteries.remove.outcomePrompt")}
            </div>
            <div role="radiogroup" aria-labelledby={`${uid}-outcome`} className="grid grid-cols-2 gap-2">
              {BATTERY_OFF_STATUSES.map((o) => (
                <RadioCard
                  key={o}
                  checked={outcome === o}
                  disabled={busy}
                  tone={o === "scrapped" ? "danger" : "default"}
                  onSelect={() => {
                    setOutcome(o);
                    setOutcomeChosen(true);
                  }}
                  title={t(`batteries.outcome.${o}`)}
                />
              ))}
            </div>
            {reason != null && !outcomeChosen && outcome != null && <Note>{t("batteries.remove.suggested")}</Note>}
          </div>

          <OdometerField value={odometer} onChange={setOdometer} fittedAt={fit.installed_odometer} disabled={busy} />

          <Note>{workOrderId ? t("batteries.remove.underWo") : t("batteries.remove.noWo")}</Note>
          {reason == null && <Note>{t("batteries.remove.pickFirst")}</Note>}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={!ready || busy}>
              {busy && <Loader2 className="animate-spin" />}
              {outcome === "scrapped" ? t("batteries.remove.submitScrap") : t("batteries.remove.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── edit ─────────────────────────────────────────────────────────────────────

/** Correct what was written about one battery (serial, date code, warranty,
 * notes). Its type is not edited: a wrong type is a wrong fitting — undo it. */
export function EditBatteryDialog({ battery, onClose }: { battery: BatteryRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<Details>({
    serial: battery.serial ?? "",
    dateCode: battery.date_code ?? "",
    warranty: battery.warranty_months != null ? String(battery.warranty_months) : "",
    notes: battery.notes ?? "",
  });
  const save = useDomainMutation(() => unwrap(commands.batteryUpdate(battery.id, detailsInput(details))), {
    onSuccess: () => {
      notifySuccess(t("batteries.edit.done"));
      onClose();
    },
    onError: notifyError,
  });
  const busy = save.isPending;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className={DIALOG} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t("batteries.edit.title")}</DialogTitle>
          <DialogDescription>
            <bdi className="font-semibold text-foreground">{batteryName(battery)}</bdi>
            {batteryRating(battery) && (
              <>
                {" · "}
                <bdi dir="ltr">{batteryRating(battery)}</bdi>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (warrantyOk(details) && !busy) save.mutate();
          }}
        >
          <DetailsFields value={details} onChange={setDetails} withNotes disabled={busy} />
          <Note>{t("batteries.edit.typeHint")}</Note>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!warrantyOk(details) || busy}>
              {busy && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── history ──────────────────────────────────────────────────────────────────

/** One battery's life: every truck and slot it sat in, how long it ran, why
 * it came off and where it went. */
export function BatteryHistoryDialog({ battery, onClose }: { battery: BatteryRow; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const history = useBatteryHistory(battery.id);
  const [editing, setEditing] = useState(false);
  const b = history.data?.[0]?.battery ?? battery;
  const date = (iso: string | null) => fmtCairo(iso, "YYYY/MM/DD", lang);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={DIALOG}>
        <DialogHeader>
          <DialogTitle>
            <bdi>{batteryName(b)}</bdi>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {batteryRating(b, true) && <bdi dir="ltr">{batteryRating(b, true)}</bdi>}
                <StatusChip tone={BATTERY_BADGE[b.status] ?? "bg-muted"}>{t(`batteries.status.${b.status}`)}</StatusChip>
              </div>
              <BatteryIds battery={b} />
              {b.notes && (
                <p>
                  {t("batteries.notesShown")} <bdi>{b.notes}</bdi>
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <section aria-label={t("batteries.history.title")} className="space-y-2">
          <h3 className="text-sm font-bold">{t("batteries.history.title")}</h3>
          {history.isError && history.data === undefined ? (
            <ErrorState error={history.error} onRetry={() => void history.refetch()} retrying={history.isFetching} />
          ) : history.isPending ? (
            <Skeleton className="h-20 w-full rounded-lg" />
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("batteries.history.empty")}</p>
          ) : (
            <ol className="divide-y rounded-xl border">
              {(history.data ?? []).map((f) => (
                <li key={f.install_id} className="space-y-0.5 px-3.5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                    <Link
                      to="/trucks/$truckId/batteries"
                      params={{ truckId: String(f.vehicle_id) }}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      <bdi>{f.plate ?? `#${f.vehicle_id}`}</bdi>
                    </Link>
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                      {t("batteries.slot", { n: fmtNumber(f.slot, lang) })}
                    </span>
                    {f.pending && (
                      <span className="text-xs font-normal text-status-due_soon">{t("batteries.pending")}</span>
                    )}
                  </div>
                  <p className="text-muted-foreground">
                    {t("batteries.history.fitted", {
                      date: date(f.installed_at),
                      km: f.installed_odometer != null ? fmtKm(f.installed_odometer, lang) : t("batteries.noKm"),
                    })}
                  </p>
                  {f.removed_at ? (
                    <p className="text-muted-foreground">
                      {t("batteries.history.removed", {
                        date: date(f.removed_at),
                        km: f.removed_odometer != null ? fmtKm(f.removed_odometer, lang) : t("batteries.noKm"),
                      })}
                      {f.removal_reason && ` · ${t(`batteries.reason.${f.removal_reason}`)}`}
                      {f.removal_outcome && ` · ${t(`batteries.outcome.${f.removal_outcome}`)}`}
                    </p>
                  ) : (
                    <p className="font-medium text-status-ok">{t("batteries.history.stillOn")}</p>
                  )}
                  {f.km != null && (
                    <p>
                      {f.removed_at
                        ? t("batteries.kmRun", { km: fmtKm(f.km, lang) })
                        : t("batteries.kmSince", { km: fmtKm(f.km, lang) })}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            {t("batteries.edit.open")}
          </Button>
          <Button type="button" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
        {editing && <EditBatteryDialog battery={b} onClose={() => setEditing(false)} />}
      </DialogContent>
    </Dialog>
  );
}
