import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { commands, unwrap, type LegacyTireInput } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtNumber, parseIntInput } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
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

const MAX_ROWS = 200; // the app refuses more in one go
const MAX_KM = 5_000_000;

type Row = { key: number; brand: string; model: string; size: string; dot: string; km: string };

const isBlank = (r: Row) => !r.brand.trim() && !r.model.trim() && !r.size.trim() && !r.dot.trim() && !r.km.trim();

/** Register used tires that are already lying in the workshop, one record per
 * tire, so they can be fitted later. This does NOT add to the new-tire stock:
 * that is "receive stock". */
export function LegacyIntakeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const uid = useId();
  const nextKey = useRef(1);
  const blank = (): Row => ({ key: nextKey.current++, brand: "", model: "", size: "", dot: "", km: "" });
  const [rows, setRows] = useState<Row[]>(() => [{ key: 0, brand: "", model: "", size: "", dot: "", km: "" }]);
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const set = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // A card left completely empty is ignored; a card with anything typed in it
  // must have a brand and a sensible km.
  const filled = rows.filter((r) => !isBlank(r));
  const brandMissing = (r: Row) => !isBlank(r) && !r.brand.trim();
  const kmBad = (r: Row) => {
    if (!r.km.trim()) return false;
    const n = parseIntInput(r.km);
    return n == null || n > MAX_KM;
  };
  const valid = filled.length > 0 && filled.length <= MAX_ROWS && !filled.some((r) => brandMissing(r) || kmBad(r));

  const payload = (): LegacyTireInput[] =>
    filled.map((r) => ({
      brand: r.brand.trim(),
      model: r.model.trim() || null,
      size: r.size.trim() || null,
      dot_code: r.dot.trim() || null,
      estimated_km: parseIntInput(r.km),
    }));

  const submit = useDomainMutation(() => unwrap(commands.intakeLegacy(payload())), {
    onSuccess: (ids) => {
      notifySuccess(t("tires.intake.doneCount", { n: fmtNumber(ids.length, lang) }));
      setConfirming(false);
      onOpenChange(false);
    },
    onError: (e) => {
      setConfirming(false);
      notifyError(e);
    },
  });

  // Same make again: copy the last card's brand/model/size, not its DOT or km.
  const addRow = () =>
    setRows((rs) => {
      const last = rs[rs.length - 1];
      return [...rs, { ...blank(), brand: last?.brand ?? "", model: last?.model ?? "", size: last?.size ?? "" }];
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !submit.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("tires.intake.title")}</DialogTitle>
          <DialogDescription>{t("tires.intake.subtitle")}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (valid) setConfirming(true);
          }}
        >
          <ol className="space-y-3">
            {rows.map((row, i) => {
              const id = (name: string) => `${uid}-${row.key}-${name}`;
              const noBrand = touched && brandMissing(row);
              const badKm = touched && kmBad(row);
              return (
                <li key={row.key} className="rounded-xl border bg-card p-3.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {t("tires.intake.rowTitle", { n: fmtNumber(i + 1, lang) })}
                    </span>
                    {rows.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("tires.intake.removeRow", { n: fmtNumber(i + 1, lang) })}
                        onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={id("brand")}>{t("tires.intake.brand")}</Label>
                      <Input
                        id={id("brand")}
                        dir="auto"
                        value={row.brand}
                        onChange={(e) => set(row.key, { brand: e.target.value })}
                        aria-invalid={noBrand}
                        aria-describedby={id("brand-err")}
                      />
                      {noBrand && (
                        <p id={id("brand-err")} className="text-sm text-status-overdue">
                          {t("tires.intake.brandRequired")}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={id("model")}>{t("tires.form.model")}</Label>
                      <Input
                        id={id("model")}
                        dir="auto"
                        value={row.model}
                        onChange={(e) => set(row.key, { model: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={id("size")}>{t("tires.form.size")}</Label>
                      <Input
                        id={id("size")}
                        dir="ltr"
                        className="text-start"
                        value={row.size}
                        onChange={(e) => set(row.key, { size: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={id("dot")}>{t("tires.form.dot")}</Label>
                      <Input
                        id={id("dot")}
                        dir="ltr"
                        className="text-start"
                        value={row.dot}
                        onChange={(e) => set(row.key, { dot: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor={id("km")}>{t("tires.intake.km")}</Label>
                      <NumberInput
                        id={id("km")}
                        value={row.km}
                        onValueChange={(v) => set(row.key, { km: v })}
                        aria-invalid={badKm}
                        aria-describedby={id("km-err")}
                      />
                      {badKm && (
                        <p id={id("km-err")} className="text-sm text-status-overdue">
                          {t("tires.form.kmBad")}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {rows.length < MAX_ROWS && (
            <Button type="button" variant="outline" onClick={addRow}>
              <Plus />
              {t("tires.intake.addRow")}
            </Button>
          )}

          {touched && filled.length === 0 && (
            <p role="alert" className="text-sm text-status-overdue">
              {t("tires.intake.nothing")}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="animate-spin" />}
              {t("tires.intake.submit", { n: fmtNumber(filled.length, lang) })}
            </Button>
          </DialogFooter>
        </form>

        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t("tires.intake.confirmTitle", { n: fmtNumber(filled.length, lang) })}
          description={t("tires.intake.confirmBody")}
          confirmLabel={t("tires.intake.confirm")}
          pending={submit.isPending}
          onConfirm={() => submit.mutate()}
        />
      </DialogContent>
    </Dialog>
  );
}
