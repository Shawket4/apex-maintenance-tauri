import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2 } from "lucide-react";

import { commands, isOffline, unwrap, type BatterySpecInput, type StockView } from "@/shared/api/client";
import { useDomainMutation, useStock, useSyncStatus } from "@/shared/api/queries";
import { errorText } from "@/shared/lib/notify";
import { norm } from "@/shared/lib/normalize";
import { fmtLiters, fmtNumber, parseDecimalInput, parseIntInput } from "@/shared/lib/numbers";
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
import { batteryKey, batteryLabel, toSpecInput, type BatterySpec } from "@/widgets/batteries/lib";
import {
  BatteryProductPicker,
  OilProductPicker,
  TireProductPicker,
  tireLabel,
  type TireSpec,
} from "@/widgets/catalog/pickers";

// The server's own limits (maint-rust handlers/stock.rs).
const MAX_TIRES = 10_000;
const MAX_LITERS = 100_000;
const MAX_TEXT = 120;

type Kind = "tire" | "oil" | "battery";
const KINDS: readonly Kind[] = ["tire", "oil", "battery"];
type Step = "form" | "review" | "done";
type Receipt =
  | { kind: "tire"; brand: string; model: string | null; size: string | null; qty: number; note: string | null }
  | { kind: "oil"; oilType: string; liters: number; note: string | null }
  | { kind: "battery"; spec: BatterySpecInput; qty: number; note: string | null };

/** Receive a shipment of new tires, oil or batteries into stock. Online
 * only; the server allows it from permission 4. Three steps — fill, read it
 * back, done — because a receipt cannot be taken back from the app. */
export function ReceiveStockDialog({
  open,
  onOpenChange,
  stock,
  initialKind = "tire",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stock: StockView;
  initialKind?: Kind;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const uid = useId();
  const qc = useQueryClient();
  const online = useSyncStatus().data?.online;
  const liveStock = useStock().data ?? stock;

  const [kind, setKind] = useState<Kind>(initialKind);
  const [step, setStep] = useState<Step>("form");
  const [tire, setTire] = useState<TireSpec | null>(null);
  const [battery, setBattery] = useState<BatterySpec | null>(null);
  const [qty, setQty] = useState("");
  const [oilType, setOilType] = useState("");
  const [liters, setLiters] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [received, setReceived] = useState<Receipt | null>(null);

  // One id per submission attempt: a retry of the SAME receipt reuses it, so
  // the server counts it once even if the first answer was lost on the way.
  // Any edit makes it a different receipt, which gets a fresh id.
  const refId = useRef<string | null>(null);
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    refId.current = null;
    set(v);
  };

  const trim = (s: string) => s.trim();
  const orNull = (s: string) => trim(s) || null;
  const qtyN = parseIntInput(qty);
  const litersN = parseDecimalInput(liters);

  const tooLong = (...texts: string[]) => texts.some((x) => trim(x).length > MAX_TEXT);
  const errors = {
    tire:
      kind !== "tire"
        ? null
        : !tire?.brand.trim()
          ? t("stock.receive.err.brand")
          : tooLong(tire.brand, tire.model, tire.size)
            ? t("stock.receive.err.tooLong", { max: fmtNumber(MAX_TEXT, lang) })
            : null,
    battery:
      kind !== "battery"
        ? null
        : !battery?.brand.trim()
          ? t("stock.receive.err.battery")
          : tooLong(battery.brand, battery.model)
            ? t("stock.receive.err.tooLong", { max: fmtNumber(MAX_TEXT, lang) })
            : null,
    qty:
      kind !== "oil" && (qtyN == null || qtyN < 1 || qtyN > MAX_TIRES)
        ? t("stock.receive.err.qty", { max: fmtNumber(MAX_TIRES, lang) })
        : null,
    oilType:
      kind !== "oil"
        ? null
        : !trim(oilType)
          ? t("stock.receive.err.oilType")
          : tooLong(oilType)
            ? t("stock.receive.err.tooLong", { max: fmtNumber(MAX_TEXT, lang) })
            : null,
    liters:
      kind === "oil" && (litersN == null || litersN <= 0 || litersN > MAX_LITERS)
        ? t("stock.receive.err.liters", { max: fmtNumber(MAX_LITERS, lang) })
        : null,
  };
  const valid = !errors.tire && !errors.battery && !errors.qty && !errors.oilType && !errors.liters;

  const draft: Receipt | null = !valid
    ? null
    : kind === "tire"
      ? { kind, brand: trim(tire!.brand), model: orNull(tire!.model), size: orNull(tire!.size), qty: qtyN!, note: orNull(note) }
      : kind === "battery"
        ? { kind, spec: toSpecInput(battery!), qty: qtyN!, note: orNull(note) }
        : { kind, oilType: trim(oilType), liters: litersN!, note: orNull(note) };

  const submit = useDomainMutation(
    (r: Receipt) => {
      const id = refId.current ?? crypto.randomUUID();
      refId.current = id;
      return r.kind === "tire"
        ? unwrap(commands.stockCreditTires(r.brand, r.model, r.size, r.qty, id, r.note))
        : r.kind === "battery"
          ? unwrap(commands.stockCreditBatteries(r.spec, r.qty, id, r.note))
          : unwrap(commands.stockCreditOil(r.oilType, r.liters, id, r.note));
    },
    {
      onSuccess: (_d, r) => {
        refId.current = null;
        void qc.invalidateQueries({ queryKey: ["stock-movements"] });
        setReceived(r);
        setStep("done");
      },
    },
  );

  const what = (r: Receipt) =>
    r.kind === "tire" ? tireLabel(r) : r.kind === "battery" ? batteryLabel(r.spec) : r.oilType;
  const howMuch = (r: Receipt) =>
    r.kind === "tire"
      ? t("stock.receive.tiresCount", { n: fmtNumber(r.qty, lang) })
      : r.kind === "battery"
        ? t("stock.receive.batteriesCount", { n: fmtNumber(r.qty, lang) })
        : fmtLiters(r.liters, lang);

  // The stock line the receipt went to: the server files a name under the
  // spelling it already has, so compare the way it does.
  const nowOnHand = (r: Receipt) => {
    if (r.kind === "tire") {
      const line = liveStock.tires.find(
        (l) => norm(l.brand) === norm(r.brand) && norm(l.model) === norm(r.model) && norm(l.size) === norm(r.size),
      );
      return line ? t("stock.receive.tiresCount", { n: fmtNumber(line.projected_qty, lang) }) : null;
    }
    if (r.kind === "battery") {
      const line = liveStock.batteries.find((l) => batteryKey(l) === batteryKey(r.spec));
      return line ? t("stock.receive.batteriesCount", { n: fmtNumber(line.projected_qty, lang) }) : null;
    }
    const line = liveStock.oil.find((l) => norm(l.oil_type) === norm(r.oilType));
    return line ? fmtLiters(line.projected_liters, lang) : null;
  };

  const startAnother = () => {
    refId.current = null;
    submit.reset();
    setQty("");
    setLiters("");
    setNote("");
    setTouched(false);
    setReceived(null);
    setStep("form");
  };

  const close = (o: boolean) => {
    if (submit.isPending) return;
    onOpenChange(o);
  };

  const field = (name: string) => `${uid}-${name}`;
  const errorLine = (msg: string | null, id: string) =>
    touched && msg ? (
      <p id={id} className="text-sm text-status-overdue">
        {msg}
      </p>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("stock.receive.title")}</DialogTitle>
          {step === "form" && <DialogDescription>{t("stock.receive.subtitle")}</DialogDescription>}
        </DialogHeader>

        {step === "form" && (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (valid) setStep("review");
            }}
          >
            <div role="group" aria-label={t("stock.receive.what")} className="grid grid-cols-3 gap-2">
              {KINDS.map((k) => (
                <Button
                  key={k}
                  type="button"
                  variant={kind === k ? "default" : "outline"}
                  aria-pressed={kind === k}
                  onClick={() => {
                    refId.current = null;
                    setKind(k);
                    setTouched(false);
                  }}
                >
                  {t(`stock.receive.kind.${k}`)}
                </Button>
              ))}
            </div>

            {online === false && (
              <p className="flex items-start gap-1.5 rounded-lg bg-status-due_soon-soft p-3 text-sm text-status-due_soon">
                <CloudOff className="mt-0.5 h-4 w-4 flex-none" />
                <span>{t("stock.receive.needsOnline")}</span>
              </p>
            )}

            {kind === "battery" ? (
              <>
                <div className="space-y-1.5">
                  <Label id={field("battery-label")} htmlFor={field("battery")}>
                    {t("stock.receive.batteryType")}
                  </Label>
                  <BatteryProductPicker
                    id={field("battery")}
                    aria-labelledby={field("battery-label")}
                    showStock
                    value={battery}
                    onChange={edit(setBattery)}
                  />
                  {errorLine(errors.battery, field("battery-err"))}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={field("bqty")}>{t("stock.receive.qty")}</Label>
                  <NumberInput
                    id={field("bqty")}
                    value={qty}
                    onValueChange={edit(setQty)}
                    aria-invalid={touched && !!errors.qty}
                    aria-describedby={field("bqty-err")}
                  />
                  {errorLine(errors.qty, field("bqty-err"))}
                </div>
              </>
            ) : kind === "tire" ? (
              <>
                <div className="space-y-1.5">
                  <Label id={field("tire-label")} htmlFor={field("tire")}>
                    {t("stock.receive.tireType")}
                  </Label>
                  <TireProductPicker
                    id={field("tire")}
                    aria-labelledby={field("tire-label")}
                    showStock
                    value={tire}
                    onChange={edit(setTire)}
                  />
                  {errorLine(errors.tire, field("tire-err"))}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={field("qty")}>{t("stock.receive.qty")}</Label>
                  <NumberInput
                    id={field("qty")}
                    value={qty}
                    onValueChange={edit(setQty)}
                    aria-invalid={touched && !!errors.qty}
                    aria-describedby={field("qty-err")}
                  />
                  {errorLine(errors.qty, field("qty-err"))}
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label id={field("oil-label")} htmlFor={field("oil")}>
                    {t("stock.receive.oilType")}
                  </Label>
                  <OilProductPicker
                    id={field("oil")}
                    aria-labelledby={field("oil-label")}
                    value={oilType}
                    onChange={edit(setOilType)}
                  />
                  {errorLine(errors.oilType, field("oil-err"))}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={field("liters")}>{t("stock.receive.liters")}</Label>
                  <NumberInput
                    id={field("liters")}
                    decimal
                    value={liters}
                    onValueChange={edit(setLiters)}
                    aria-invalid={touched && !!errors.liters}
                    aria-describedby={field("liters-err")}
                  />
                  {errorLine(errors.liters, field("liters-err"))}
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={field("note")}>{t("stock.receive.note")}</Label>
              <Input
                id={field("note")}
                dir="auto"
                maxLength={MAX_TEXT}
                placeholder={t("stock.receive.notePlaceholder")}
                value={note}
                onChange={(e) => edit(setNote)(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit">{t("stock.receive.review")}</Button>
            </DialogFooter>
          </form>
        )}

        {step === "review" && draft && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">{t("stock.receive.reviewLead")}</p>
              <p className="mt-1 text-lg font-bold">
                <bdi>{howMuch(draft)}</bdi>
              </p>
              <p className="font-semibold">
                <bdi>{what(draft)}</bdi>
              </p>
              {draft.note && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("stock.receive.noteShown")} <bdi>{draft.note}</bdi>
                </p>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{t("stock.receive.noUndo")}</p>
            {submit.isError && (
              <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-status-overdue-soft p-3 text-sm text-status-overdue">
                {isOffline(submit.error) ? (
                  <CloudOff className="mt-0.5 h-4 w-4 flex-none" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                )}
                <span>
                  {errorText(submit.error)} {t("stock.receive.retrySafe")}
                </span>
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={submit.isPending}
                onClick={() => {
                  submit.reset();
                  setStep("form");
                }}
              >
                {t("stock.receive.backToEdit")}
              </Button>
              <Button type="button" disabled={submit.isPending} onClick={() => submit.mutate(draft)}>
                {submit.isPending && <Loader2 className="animate-spin" />}
                {submit.isError ? t("common.retry") : t("stock.receive.confirm")}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "done" && received && (
          <div className="space-y-4">
            <div role="status" className="rounded-xl bg-status-ok-soft p-5 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-status-ok" />
              <p className="font-bold">{t("stock.receive.doneTitle")}</p>
              <p className="mt-1 text-sm">
                <bdi>{howMuch(received)}</bdi> {t("stock.receive.doneOf")} <bdi>{what(received)}</bdi>
              </p>
              {nowOnHand(received) && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("stock.receive.doneNow")} <bdi className="font-semibold text-foreground">{nowOnHand(received)}</bdi>
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={startAnother}>
                {t("stock.receive.another")}
              </Button>
              <Button type="button" onClick={() => close(false)}>
                {t("stock.receive.finish")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
