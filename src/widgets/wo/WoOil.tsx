import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Droplets, Loader2, Pencil, Trash2, TriangleAlert } from "lucide-react";

import { commands, unwrap, type OilRow, type WoDetail } from "@/shared/api/client";
import { useCatalog, useDomainMutation, useStock } from "@/shared/api/queries";
import { norm } from "@/shared/lib/normalize";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtKm, fmtLiters, fmtNumber, parseDecimalInput } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import { NumberInput } from "@/shared/ui/number-input";
import { OilProductPicker } from "@/widgets/catalog/pickers";
import { ListCard, Section } from "@/widgets/layout/PageShell";

import { OIL_BAND_MAX, OIL_BAND_MIN, parseOilDraft, type OilDraft } from "./lib";
import { ClosedNote, PendingBadge, SectionTitle } from "./parts";

export function WoOil({ d, woId, canEdit }: { d: WoDetail; woId: string; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState<OilRow | null>(null);
  const [deleting, setDeleting] = useState<OilRow | null>(null);

  const del = useDomainMutation((id: string) => unwrap(commands.oilDelete(id)), {
    onSuccess: () => {
      setDeleting(null);
      notifySuccess(t("wo.oilDeleted"));
    },
    onError: notifyError,
  });

  // The oil form starts from where the truck is NOW — the work order may have
  // been opened days (and kilometres) ago.
  const currentOdometer = d.odometer?.km ?? d.wo.odometer_at_open;

  return (
    <Section
      title={
        <SectionTitle icon={<Droplets className="h-4 w-4 text-status-due_soon" />}>
          {t("wo.oilTitle")}
        </SectionTitle>
      }
    >
      <ListCard>
        {d.oil_changes.length === 0 && !canEdit && (
          <div className="px-4 py-4 text-sm text-muted-foreground">{t("wo.oilEmpty")}</div>
        )}
        {d.oil_changes.map((o) => (
          <div
            key={o.id}
            className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <bdi className="font-semibold">{o.oil_type}</bdi>
                <span className="font-semibold tabular">{fmtLiters(o.liters, i18n.language)}</span>
                {o.flagged && (
                  <Badge
                    variant="outline"
                    className="shrink-0 gap-1 border-status-due_soon text-status-due_soon"
                  >
                    <TriangleAlert className="h-3 w-3" />
                    {t("wo.oilFlaggedBadge")}
                  </Badge>
                )}
                {o.pending && <PendingBadge />}
              </div>
              <div className="text-xs text-muted-foreground tabular">
                {fmtCairo(o.performed_at, "YYYY/MM/DD HH:mm", i18n.language)}
                {" · "}
                {o.odometer != null
                  ? t("wo.oilAtOdometer", { km: fmtKm(o.odometer, i18n.language) })
                  : t("wo.oilNoOdometer")}
              </div>
            </div>
            {canEdit && (
              <div className="flex flex-none items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setEditing(o)}>
                  <Pencil />
                  {t("wo.edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  aria-label={t("wo.oilDelete")}
                  title={t("wo.oilDelete")}
                  onClick={() => setDeleting(o)}
                >
                  <Trash2 />
                </Button>
              </div>
            )}
          </div>
        ))}
        {canEdit ? (
          <AddOilForm woId={woId} currentOdometer={currentOdometer} />
        ) : (
          <ClosedNote />
        )}
      </ListCard>

      {editing && (
        <EditOilDialog key={editing.id} row={editing} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("wo.oilDeleteTitle")}
        description={
          deleting
            ? t("wo.oilDeleteBody", { liters: fmtLiters(deleting.liters, i18n.language) })
            : undefined
        }
        confirmLabel={t("wo.oilDelete")}
        destructive
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </Section>
  );
}

/** The three oil fields plus everything worth knowing before saving: the
 * usual-amount warning and what is left in stock. `original` is the record
 * being corrected (its liters are already taken out of stock). */
function OilFields({
  idPrefix,
  draft,
  onChange,
  original,
}: {
  idPrefix: string;
  draft: OilDraft;
  onChange: (next: OilDraft) => void;
  original?: OilRow;
}) {
  const { t, i18n } = useTranslation();
  const stock = useStock();
  const catalog = useCatalog();
  // The same oil under another spelling is the same oil ("Shell 15W40" /
  // "shell 15w-40"), so types are compared the way the catalog compares them.
  const typeKey = norm(draft.oilType);
  const product = typeKey
    ? catalog.data?.oil_products.find((p) => norm(p.name) === typeKey)
    : undefined;
  const line = typeKey
    ? stock.data?.oil.find((l) => norm(l.oil_type) === typeKey)
    : undefined;
  // What is left of this type: the stock line when this device has one, else
  // the count that came with the catalog. null = this type is not in stock.
  const onHand = line?.projected_liters ?? product?.on_hand ?? null;
  const known = product != null || line != null;

  const liters = parseDecimalInput(draft.liters);
  const outsideBand = liters != null && liters > 0 && (liters < OIL_BAND_MIN || liters > OIL_BAND_MAX);
  // What this save takes out of stock on top of what is already counted.
  const alreadyTaken = original && norm(original.oil_type) === typeKey ? original.liters : 0;
  const extra = liters != null ? liters - alreadyTaken : 0;
  const goesNegative = onHand != null && extra > 0 && onHand - extra < 0;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${idPrefix}-type`}>{t("wo.oilType")}</Label>
          <OilProductPicker
            id={`${idPrefix}-type`}
            value={draft.oilType}
            onChange={(name) => onChange({ ...draft, oilType: name })}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${idPrefix}-liters`}>{t("wo.oilLiters")}</Label>
          <NumberInput
            id={`${idPrefix}-liters`}
            decimal
            className="bg-card"
            value={draft.liters}
            onValueChange={(v) => onChange({ ...draft, liters: v })}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${idPrefix}-odo`}>{t("wo.oilOdometer")}</Label>
          <NumberInput
            id={`${idPrefix}-odo`}
            className="bg-card"
            value={draft.odometer}
            onValueChange={(v) => onChange({ ...draft, odometer: v })}
          />
        </div>
      </div>

      {onHand != null ? (
        <p className="text-sm text-muted-foreground">
          {t("wo.oilStockOnHand", { liters: fmtLiters(onHand, i18n.language) })}
        </p>
      ) : (
        typeKey !== "" && (
          <p className="text-sm text-muted-foreground">
            {known ? t("wo.oilNotInStock") : t("wo.oilNewTypeHint")}
          </p>
        )
      )}
      {goesNegative && (
        <p className="flex items-start gap-2 rounded-lg bg-status-due_soon-soft px-3 py-2 text-sm text-status-due_soon">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" />
          {t("wo.oilStockShort")}
        </p>
      )}
      {outsideBand && (
        <p className="flex items-start gap-2 rounded-lg bg-status-due_soon-soft px-3 py-2 text-sm text-status-due_soon">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" />
          {t("wo.oilBandWarn", {
            min: fmtNumber(OIL_BAND_MIN, i18n.language),
            max: fmtNumber(OIL_BAND_MAX, i18n.language),
          })}
        </p>
      )}
    </div>
  );
}

function AddOilForm({ woId, currentOdometer }: { woId: string; currentOdometer: number | null }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<OilDraft>({
    oilType: "",
    liters: "",
    odometer: currentOdometer != null ? String(currentOdometer) : "",
  });
  const parsed = parseOilDraft(draft);

  const add = useDomainMutation(
    (p: { oilType: string; liters: number; odometer: number | null }) =>
      unwrap(commands.oilAdd(woId, p.oilType, p.liters, p.odometer)),
    {
      onSuccess: () => {
        notifySuccess(t("wo.oilRecorded"));
        setDraft((prev) => ({ ...prev, liters: "" }));
      },
      onError: notifyError,
    },
  );

  return (
    <form
      className="space-y-3 bg-background/70 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed && !add.isPending) add.mutate(parsed);
      }}
    >
      <OilFields idPrefix="wo-oil-add" draft={draft} onChange={setDraft} />
      <Button type="submit" className="w-full sm:w-auto" disabled={!parsed || add.isPending}>
        {add.isPending ? <Loader2 className="animate-spin" /> : <Droplets />}
        {t("wo.oilRecord")}
      </Button>
    </form>
  );
}

function EditOilDialog({ row, onClose }: { row: OilRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<OilDraft>({
    oilType: row.oil_type,
    liters: String(row.liters),
    odometer: row.odometer != null ? String(row.odometer) : "",
  });
  const parsed = parseOilDraft(draft);

  const save = useDomainMutation(
    (p: { oilType: string; liters: number; odometer: number | null }) =>
      unwrap(commands.oilUpdate(row.id, p.oilType, p.liters, p.odometer)),
    {
      onSuccess: () => {
        notifySuccess(t("wo.saved"));
        onClose();
      },
      onError: notifyError,
    },
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("wo.oilEditTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (parsed && !save.isPending) save.mutate(parsed);
          }}
        >
          <p className="text-sm text-muted-foreground">{t("wo.oilEditHint")}</p>
          <OilFields idPrefix="wo-oil-edit" draft={draft} onChange={setDraft} original={row} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!parsed || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
