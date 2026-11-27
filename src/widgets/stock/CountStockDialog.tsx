import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, CloudOff, Info, Loader2 } from "lucide-react";

import {
  commands,
  isOffline,
  unwrap,
  type CountResult,
  type StockBatteryLine,
  type StockOilLine,
  type StockTireLine,
} from "@/shared/api/client";
import { useDomainMutation, useStock, useSyncStatus } from "@/shared/api/queries";
import { errorText } from "@/shared/lib/notify";
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
import { batteryLabel, specOf, toSpecInput } from "@/widgets/batteries/lib";

// The server's own limits (maint-rust handlers/stock.rs).
const MAX_TIRES = 100_000;
const MAX_LITERS = 1_000_000;
const MAX_NOTE = 120;

export type CountTarget =
  | { kind: "tire"; line: StockTireLine }
  | { kind: "oil"; line: StockOilLine }
  | { kind: "battery"; line: StockBatteryLine };

type Step = "form" | "review" | "done";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Stock count: "the book says 12, the shelf has 10" — the book figure becomes
 * what was counted. Online only; the server allows it from permission 4.
 * Three steps — type the count, read back what will change, the result. */
export function CountStockDialog({ target, onClose }: { target: CountTarget; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const uid = useId();
  const qc = useQueryClient();
  const online = useSyncStatus().data?.online;
  const stock = useStock().data;

  // Tires and batteries are counted in whole pieces, oil in liters.
  const isTire = target.kind !== "oil";
  const isBattery = target.kind === "battery";
  // The line as it is NOW (a refresh may have landed since the dialog opened).
  const live =
    target.kind === "tire"
      ? (stock?.tires.find((l) => l.id === target.line.id) ?? target.line)
      : target.kind === "battery"
        ? (stock?.batteries.find((l) => l.id === target.line.id) ?? target.line)
        : (stock?.oil.find((l) => l.id === target.line.id) ?? target.line);
  // The book figure is the fleet system's own number — NOT the projected one,
  // which also subtracts work this device has not sent yet.
  const book = "snapshot_qty" in live ? live.snapshot_qty : round2(live.snapshot_liters);
  const unsent = "pending_debits" in live ? live.pending_debits : live.pending_liters;

  const [step, setStep] = useState<Step>("form");
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<CountResult | null>(null);

  // One id per submission attempt: a retry of the SAME count reuses it, so the
  // server applies it once even if the first answer was lost on the way. Any
  // edit makes it a different count, which gets a fresh id.
  const refId = useRef<string | null>(null);

  const parsed = isTire ? parseIntInput(typed) : parseDecimalInput(typed);
  const counted = parsed == null ? null : isTire ? parsed : round2(parsed);
  const max = isTire ? MAX_TIRES : MAX_LITERS;
  const valid = counted != null && counted >= 0 && counted <= max;
  const diff = counted == null ? 0 : round2(counted - book);

  const amount = (n: number) =>
    isBattery
      ? t("stock.receive.batteriesCount", { n: fmtNumber(n, lang) })
      : isTire
        ? t("stock.receive.tiresCount", { n: fmtNumber(n, lang) })
        : fmtLiters(n, lang);
  const itemName =
    target.kind === "tire"
      ? [target.line.brand, target.line.model, target.line.size].filter(Boolean).join(" ")
      : target.kind === "battery"
        ? batteryLabel(target.line)
        : target.line.oil_type;

  const submit = useDomainMutation(
    (n: number) => {
      const id = refId.current ?? crypto.randomUUID();
      refId.current = id;
      const noteOrNull = note.trim() || null;
      if (target.kind === "battery") {
        return unwrap(commands.stockCountBatteries(toSpecInput(specOf(target.line)), n, id, noteOrNull));
      }
      return target.kind === "tire"
        ? unwrap(
            commands.stockCountTires(target.line.brand, target.line.model, target.line.size, n, id, noteOrNull),
          )
        : unwrap(commands.stockCountOil(target.line.oil_type, n, id, noteOrNull));
    },
    {
      onSuccess: (r) => {
        refId.current = null;
        void qc.invalidateQueries({ queryKey: ["stock-movements"] });
        setResult(r);
        setStep("done");
      },
    },
  );

  const close = () => {
    if (!submit.isPending) onClose();
  };

  const field = (name: string) => `${uid}-${name}`;

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("stock.count.title")}</DialogTitle>
          {step === "form" && <DialogDescription>{t("stock.count.subtitle")}</DialogDescription>}
        </DialogHeader>

        {step !== "done" && (
          <div className="rounded-xl border bg-card p-4">
            <p className="font-semibold">
              <bdi>{itemName}</bdi>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("stock.count.bookFigure")}{" "}
              <bdi className="text-base font-bold text-foreground tabular">{amount(book)}</bdi>
            </p>
            {unsent > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-status-due_soon">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                <span>{t("stock.count.unsentNotIncluded", { n: amount(unsent) })}</span>
              </p>
            )}
          </div>
        )}

        {step === "form" && (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setTouched(true);
              if (valid) setStep("review");
            }}
          >
            <p className="flex items-start gap-1.5 rounded-lg bg-info-soft p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 flex-none text-info" />
              <span>{t("stock.count.notReceiving")}</span>
            </p>

            {online === false && (
              <p className="flex items-start gap-1.5 rounded-lg bg-status-due_soon-soft p-3 text-sm text-status-due_soon">
                <CloudOff className="mt-0.5 h-4 w-4 flex-none" />
                <span>{t("stock.count.needsOnline")}</span>
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={field("counted")}>
                {isBattery
                  ? t("stock.count.askBatteries")
                  : isTire
                    ? t("stock.count.askTires")
                    : t("stock.count.askOil")}
              </Label>
              <NumberInput
                id={field("counted")}
                decimal={!isTire}
                value={typed}
                onValueChange={(v) => {
                  refId.current = null;
                  setTyped(v);
                }}
                aria-invalid={touched && !valid}
                aria-describedby={`${field("counted-hint")} ${field("counted-err")}`}
              />
              <p id={field("counted-hint")} className="text-sm text-muted-foreground">
                {t("stock.count.zeroHint")}
              </p>
              {touched && !valid && (
                <p id={field("counted-err")} className="text-sm text-status-overdue">
                  {isBattery
                    ? t("stock.count.err.batteries", { max: fmtNumber(max, lang) })
                    : isTire
                      ? t("stock.count.err.tires", { max: fmtNumber(max, lang) })
                      : t("stock.count.err.oil", { max: fmtNumber(max, lang) })}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={field("note")}>{t("stock.count.note")}</Label>
              <Input
                id={field("note")}
                dir="auto"
                maxLength={MAX_NOTE}
                placeholder={t("stock.count.notePlaceholder")}
                value={note}
                onChange={(e) => {
                  refId.current = null;
                  setNote(e.target.value);
                }}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button type="submit">{t("stock.count.review")}</Button>
            </DialogFooter>
          </form>
        )}

        {step === "review" && counted != null && (
          <div className="space-y-4">
            <div className="space-y-1 rounded-xl border bg-card p-4">
              <p className="text-sm">
                {t("stock.count.youCounted")}{" "}
                <bdi className="text-base font-bold tabular">{amount(counted)}</bdi>
              </p>
              <p className="text-lg font-bold">
                {diff === 0 ? (
                  t("stock.count.same")
                ) : (
                  <span className={diff < 0 ? "text-status-overdue" : "text-status-ok"}>
                    {t(diff < 0 ? "stock.count.willRemove" : "stock.count.willAdd", {
                      n: amount(Math.abs(diff)),
                    })}
                  </span>
                )}
              </p>
              {diff !== 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("stock.count.willBecome", { n: amount(counted) })}
                </p>
              )}
              {note.trim() && (
                <p className="pt-1 text-sm text-muted-foreground">
                  {t("stock.count.noteShown")} <bdi>{note.trim()}</bdi>
                </p>
              )}
            </div>

            {diff !== 0 && <p className="text-sm text-muted-foreground">{t("stock.count.fixLater")}</p>}

            {submit.isError && (
              <p
                role="alert"
                className="flex items-start gap-1.5 rounded-lg bg-status-overdue-soft p-3 text-sm text-status-overdue"
              >
                {isOffline(submit.error) ? (
                  <CloudOff className="mt-0.5 h-4 w-4 flex-none" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                )}
                <span>
                  {errorText(submit.error)} {t("stock.count.retrySafe")}
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
                {t("stock.count.backToEdit")}
              </Button>
              {diff === 0 ? (
                <Button type="button" onClick={close}>
                  {t("stock.count.finish")}
                </Button>
              ) : (
                <Button type="button" disabled={submit.isPending} onClick={() => submit.mutate(counted)}>
                  {submit.isPending && <Loader2 className="animate-spin" />}
                  {submit.isError ? t("common.retry") : t("stock.count.confirm")}
                </Button>
              )}
            </DialogFooter>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4">
            <div role="status" className="rounded-xl bg-status-ok-soft p-5 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-status-ok" />
              <p className="font-bold">{t("stock.count.doneTitle")}</p>
              <p className="mt-1 text-sm">
                <bdi>{itemName}</bdi>
              </p>
              <p className="mt-2 text-sm">
                {t("stock.count.doneWas")} <bdi className="font-semibold tabular">{amount(result.before)}</bdi>
                {" — "}
                {t("stock.count.doneNow")} <bdi className="font-semibold tabular">{amount(result.after)}</bdi>
              </p>
              <p className="mt-1 text-sm font-semibold">
                {result.change === 0
                  ? t("stock.count.doneSame")
                  : t(result.change < 0 ? "stock.count.doneRemoved" : "stock.count.doneAdded", {
                      n: amount(Math.abs(result.change)),
                    })}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" onClick={close}>
                {t("stock.count.finish")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
