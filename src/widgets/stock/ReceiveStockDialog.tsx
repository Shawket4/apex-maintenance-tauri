import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2 } from "lucide-react";

import { commands, isOffline, unwrap, type StockView } from "@/shared/api/client";
import { useDomainMutation, useStock, useSyncStatus } from "@/shared/api/queries";
import { errorText } from "@/shared/lib/notify";
import { fmtLiters, fmtNumber, parseDecimalInput, parseIntInput } from "@/shared/lib/numbers";
import { cn } from "@/shared/lib/cn";
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

// The server's own limits (maint-rust handlers/stock.rs).
const MAX_TIRES = 10_000;
const MAX_LITERS = 100_000;
const MAX_TEXT = 120;

type Kind = "tire" | "oil";
type Step = "form" | "review" | "done";
type Receipt =
  | { kind: "tire"; brand: string; model: string | null; size: string | null; qty: number; note: string | null }
  | { kind: "oil"; oilType: string; liters: number; note: string | null };

const same = (a: string | null, b: string | null) => (a ?? "") === (b ?? "");

/** Receive a shipment of new tires or oil into stock. Online only; the server
 * allows it from permission 4. Three steps — fill, read it back, done —
 * because a receipt cannot be taken back from the app. */
export function ReceiveStockDialog({
  open,
  onOpenChange,
  stock,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stock: StockView;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const uid = useId();
  const qc = useQueryClient();
  const online = useSyncStatus().data?.online;
  const liveStock = useStock().data ?? stock;

  const [kind, setKind] = useState<Kind>("tire");
  const [step, setStep] = useState<Step>("form");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [size, setSize] = useState("");
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

  const errors = {
    brand: kind === "tire" && !trim(brand) ? t("stock.receive.err.brand") : null,
    qty:
      kind === "tire" && (qtyN == null || qtyN < 1 || qtyN > MAX_TIRES)
        ? t("stock.receive.err.qty", { max: fmtNumber(MAX_TIRES, lang) })
        : null,
    oilType: kind === "oil" && !trim(oilType) ? t("stock.receive.err.oilType") : null,
    liters:
      kind === "oil" && (litersN == null || litersN <= 0 || litersN > MAX_LITERS)
        ? t("stock.receive.err.liters", { max: fmtNumber(MAX_LITERS, lang) })
        : null,
  };
  const valid = !errors.brand && !errors.qty && !errors.oilType && !errors.liters;

  const draft: Receipt | null = !valid
    ? null
    : kind === "tire"
      ? { kind, brand: trim(brand), model: orNull(model), size: orNull(size), qty: qtyN!, note: orNull(note) }
      : { kind, oilType: trim(oilType), liters: litersN!, note: orNull(note) };

  const submit = useDomainMutation(
    (r: Receipt) => {
      const id = refId.current ?? crypto.randomUUID();
      refId.current = id;
      return r.kind === "tire"
        ? unwrap(commands.stockCreditTires(r.brand, r.model, r.size, r.qty, id, r.note))
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
    r.kind === "tire"
      ? [r.brand, r.model, r.size].filter(Boolean).join(" ")
      : r.oilType;
  const howMuch = (r: Receipt) =>
    r.kind === "tire" ? t("stock.receive.tiresCount", { n: fmtNumber(r.qty, lang) }) : fmtLiters(r.liters, lang);

  // Is this an item the stock already knows, spelled the same way?
  const known = (r: Receipt) =>
    r.kind === "tire"
      ? stock.tires.some((l) => l.brand === r.brand && same(l.model, r.model) && same(l.size, r.size))
      : stock.oil.some((l) => l.oil_type === r.oilType);
  const nowOnHand = (r: Receipt) => {
    if (r.kind === "tire") {
      const line = liveStock.tires.find((l) => l.brand === r.brand && same(l.model, r.model) && same(l.size, r.size));
      return line ? t("stock.receive.tiresCount", { n: fmtNumber(line.projected_qty, lang) }) : null;
    }
    const line = liveStock.oil.find((l) => l.oil_type === r.oilType);
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
            <div role="group" aria-label={t("stock.receive.what")} className="grid grid-cols-2 gap-2">
              {(["tire", "oil"] as const).map((k) => (
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

            {kind === "tire" ? (
              <>
                {stock.tires.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">{t("stock.receive.pickTire")}</p>
                    <div className="flex flex-wrap gap-2">
                      {stock.tires.map((l) => {
                        const on = l.brand === trim(brand) && same(l.model, orNull(model)) && same(l.size, orNull(size));
                        return (
                          <Button
                            key={l.id}
                            type="button"
                            size="sm"
                            variant={on ? "secondary" : "outline"}
                            aria-pressed={on}
                            className={cn("h-auto min-h-9 whitespace-normal py-1.5 text-start", on && "ring-2 ring-primary")}
                            onClick={() => {
                              refId.current = null;
                              setBrand(l.brand);
                              setModel(l.model ?? "");
                              setSize(l.size ?? "");
                            }}
                          >
                            <bdi>{[l.brand, l.model, l.size].filter(Boolean).join(" ")}</bdi>
                          </Button>
                        );
                      })}
                    </div>
                    <p className="text-sm text-muted-foreground">{t("stock.receive.pickHint")}</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor={field("brand")}>{t("stock.receive.brand")}</Label>
                  <Input
                    id={field("brand")}
                    dir="auto"
                    maxLength={MAX_TEXT}
                    value={brand}
                    onChange={(e) => edit(setBrand)(e.target.value)}
                    aria-invalid={touched && !!errors.brand}
                    aria-describedby={field("brand-err")}
                  />
                  {errorLine(errors.brand, field("brand-err"))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={field("model")}>{t("stock.receive.model")}</Label>
                    <Input
                      id={field("model")}
                      dir="auto"
                      maxLength={MAX_TEXT}
                      value={model}
                      onChange={(e) => edit(setModel)(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={field("size")}>{t("stock.receive.size")}</Label>
                    <Input
                      id={field("size")}
                      dir="ltr"
                      className="text-start"
                      maxLength={MAX_TEXT}
                      placeholder={t("stock.receive.sizeExample")}
                      value={size}
                      onChange={(e) => edit(setSize)(e.target.value)}
                    />
                  </div>
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
                {stock.oil.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">{t("stock.receive.pickOil")}</p>
                    <div className="flex flex-wrap gap-2">
                      {stock.oil.map((l) => {
                        const on = l.oil_type === trim(oilType);
                        return (
                          <Button
                            key={l.id}
                            type="button"
                            size="sm"
                            variant={on ? "secondary" : "outline"}
                            aria-pressed={on}
                            className={cn(on && "ring-2 ring-primary")}
                            onClick={() => edit(setOilType)(l.oil_type)}
                          >
                            <bdi>{l.oil_type}</bdi>
                          </Button>
                        );
                      })}
                    </div>
                    <p className="text-sm text-muted-foreground">{t("stock.receive.pickHint")}</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor={field("oil")}>{t("stock.receive.oilType")}</Label>
                  <Input
                    id={field("oil")}
                    dir="auto"
                    maxLength={MAX_TEXT}
                    value={oilType}
                    onChange={(e) => edit(setOilType)(e.target.value)}
                    aria-invalid={touched && !!errors.oilType}
                    aria-describedby={field("oil-err")}
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
            {!known(draft) && (
              <p className="flex items-start gap-1.5 rounded-lg bg-status-due_soon-soft p-3 text-sm text-status-due_soon">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                <span>{t("stock.receive.newItem")}</span>
              </p>
            )}
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
