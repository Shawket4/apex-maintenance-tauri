import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Merge, Pencil } from "lucide-react";

import { commands, unwrap, type OilProductOption, type TireProductOption } from "@/shared/api/client";
import { norm } from "@/shared/lib/normalize";
import { notifySuccess } from "@/shared/lib/notify";
import { fmtLiters, fmtNumber } from "@/shared/lib/numbers";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { tireLabel } from "@/widgets/catalog/pickers";

import { useCatalogGate, useCatalogMutation } from "./catalogGate";
import { CatalogList, MergeDialog, RowActions, RowText, SaveButton } from "./catalogParts";
import { Note } from "./parts";

const MAX_NAME = 80;
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

/** The two things a supervisor can do to a type that is spelled wrong or
 * entered twice. A type the server has not confirmed yet has neither. */
function TypeActions({
  confirmed,
  disabled,
  onRename,
  onMerge,
}: {
  confirmed: boolean;
  disabled: boolean;
  onRename: () => void;
  onMerge: () => void;
}) {
  const { t } = useTranslation();
  if (!confirmed) {
    return (
      <Badge variant="outline" className="self-start sm:self-center">
        {t("settings.catalog.unconfirmed")}
      </Badge>
    );
  }
  return (
    <RowActions>
      <Button variant="outline" size="sm" disabled={disabled} onClick={onRename}>
        <Pencil />
        {t("settings.catalog.rename")}
      </Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={onMerge}>
        <Merge />
        {t("settings.catalog.sameAs")}
      </Button>
    </RowActions>
  );
}

/** A warning inside a rename dialog: the corrected spelling is already a
 * type, so saving joins the two. */
function TwinWarning({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <Note tone="warn">
      {t("settings.catalog.renameTwin")} <bdi className="font-semibold">«{name}»</bdi>
    </Note>
  );
}

// ───────────────────────────── tire types ─────────────────────────────

const tireKey = (p: { brand: string; model: string; size: string }) => `${norm(p.brand)}|${norm(p.model)}|${norm(p.size)}`;
type ConfirmedTire = TireProductOption & { id: string };

export function TireTypesList({ rows }: { rows: TireProductOption[] }) {
  const { t, i18n } = useTranslation();
  const gate = useCatalogGate();
  const [renaming, setRenaming] = useState<ConfirmedTire | null>(null);
  const [merging, setMerging] = useState<ConfirmedTire | null>(null);
  const n = (v: number) => fmtNumber(v, i18n.language);

  const merge = useCatalogMutation(
    (p: { id: string; into: string }) => unwrap(commands.catalogMergeTireProduct(p.id, p.into)),
    () => {
      setMerging(null);
      notifySuccess(t("settings.catalog.merge.done"));
    },
  );

  return (
    <>
      <CatalogList
        searchId="catalog-tire-search"
        searchLabel={t("settings.catalog.tires.search")}
        rows={rows}
        rowKey={(p) => p.id ?? `new:${tireKey(p)}`}
        text={tireLabel}
        empty={t("settings.catalog.tires.empty")}
      >
        {(p) => (
          <>
            <RowText
              ltr
              title={tireLabel(p)}
              meta={
                <>
                  {t("settings.catalog.tires.uses", { n: n(p.tires) })}
                  {" · "}
                  {p.on_hand == null
                    ? t("settings.catalog.notInStock")
                    : t("settings.catalog.tires.onHand", { n: n(p.on_hand) })}
                </>
              }
            />
            {(gate.mayManage || p.id == null) && (
              <TypeActions
                confirmed={p.id != null}
                disabled={!gate.canManage}
                onRename={() => p.id != null && setRenaming({ ...p, id: p.id })}
                onMerge={() => p.id != null && setMerging({ ...p, id: p.id })}
              />
            )}
          </>
        )}
      </CatalogList>

      {renaming && (
        <RenameTireDialog key={renaming.id} row={renaming} all={rows} onClose={() => setRenaming(null)} />
      )}
      {merging && (
        <MergeDialog
          key={merging.id}
          title={t("settings.catalog.merge.title")}
          intro={t("settings.catalog.tires.mergeIntro")}
          pickLabel={t("settings.catalog.tires.mergePick")}
          pickPlaceholder={t("settings.catalog.tires.mergePlaceholder")}
          sourceLabel={tireLabel(merging)}
          options={rows
            .filter((p): p is ConfirmedTire => p.id != null && p.id !== merging.id)
            .map((p) => ({
              value: p.id,
              label: tireLabel(p),
              description: t("settings.catalog.tires.uses", { n: n(p.tires) }),
            }))}
          confirmBody={(target) =>
            t("settings.catalog.tires.mergeBody", { n: n(merging.tires), a: tireLabel(merging), b: target.label })
          }
          pending={merge.isPending}
          onMerge={(into) => merge.mutate({ id: merging.id, into })}
          onClose={() => !merge.isPending && setMerging(null)}
        />
      )}
    </>
  );
}

function RenameTireDialog({ row, all, onClose }: { row: ConfirmedTire; all: TireProductOption[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [brand, setBrand] = useState(row.brand);
  const [model, setModel] = useState(row.model);
  const [size, setSize] = useState(row.size);
  const next = { brand: tidy(brand), model: tidy(model), size: tidy(size) };
  const unchanged = next.brand === row.brand && next.model === row.model && next.size === row.size;
  const twin = all.find((p) => p.id !== row.id && tireKey(p) === tireKey(next));

  const save = useCatalogMutation(
    () => unwrap(commands.catalogRenameTireProduct(row.id, next.brand, next.model || null, next.size || null)),
    () => {
      notifySuccess(t("settings.catalog.renamed"));
      onClose();
    },
  );
  const blocked = !next.brand || unchanged;

  const field = (key: "brand" | "model" | "size", value: string, set: (v: string) => void) => (
    <div className="space-y-2">
      <Label htmlFor={`catalog-tire-${key}`}>{t(`catalog.tire.${key}`)}</Label>
      <Input
        id={`catalog-tire-${key}`}
        dir="ltr"
        className="text-start"
        maxLength={MAX_NAME}
        placeholder={t(`catalog.tire.${key}Ph`)}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.catalog.tires.renameTitle")}</DialogTitle>
          <DialogDescription>{t("settings.catalog.tires.renameBody")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (blocked || save.isPending) return;
            save.mutate();
          }}
        >
          {field("brand", brand, setBrand)}
          {field("model", model, setModel)}
          {field("size", size, setSize)}
          {twin && <TwinWarning name={tireLabel(twin)} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <SaveButton pending={save.isPending} disabled={blocked} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── oil types ─────────────────────────────

type ConfirmedOil = OilProductOption & { id: string };

export function OilTypesList({ rows }: { rows: OilProductOption[] }) {
  const { t, i18n } = useTranslation();
  const gate = useCatalogGate();
  const [renaming, setRenaming] = useState<ConfirmedOil | null>(null);
  const [merging, setMerging] = useState<ConfirmedOil | null>(null);
  const n = (v: number) => fmtNumber(v, i18n.language);

  const merge = useCatalogMutation(
    (p: { id: string; into: string }) => unwrap(commands.catalogMergeOilProduct(p.id, p.into)),
    () => {
      setMerging(null);
      notifySuccess(t("settings.catalog.merge.done"));
    },
  );

  return (
    <>
      <CatalogList
        searchId="catalog-oil-search"
        searchLabel={t("settings.catalog.oil.search")}
        rows={rows}
        rowKey={(p) => p.id ?? `new:${norm(p.name)}`}
        text={(p) => p.name}
        empty={t("settings.catalog.oil.empty")}
      >
        {(p) => (
          <>
            <RowText
              title={p.name}
              meta={
                <>
                  {t("settings.catalog.oil.uses", { n: n(p.uses) })}
                  {" · "}
                  {p.on_hand == null
                    ? t("settings.catalog.notInStock")
                    : t("settings.catalog.oil.onHand", { liters: fmtLiters(p.on_hand, i18n.language) })}
                </>
              }
            />
            {(gate.mayManage || p.id == null) && (
              <TypeActions
                confirmed={p.id != null}
                disabled={!gate.canManage}
                onRename={() => p.id != null && setRenaming({ ...p, id: p.id })}
                onMerge={() => p.id != null && setMerging({ ...p, id: p.id })}
              />
            )}
          </>
        )}
      </CatalogList>

      {renaming && (
        <RenameOilDialog key={renaming.id} row={renaming} all={rows} onClose={() => setRenaming(null)} />
      )}
      {merging && (
        <MergeDialog
          key={merging.id}
          title={t("settings.catalog.merge.title")}
          intro={t("settings.catalog.oil.mergeIntro")}
          pickLabel={t("settings.catalog.oil.mergePick")}
          pickPlaceholder={t("settings.catalog.oil.mergePlaceholder")}
          sourceLabel={merging.name}
          options={rows
            .filter((p): p is ConfirmedOil => p.id != null && p.id !== merging.id)
            .map((p) => ({
              value: p.id,
              label: p.name,
              description: t("settings.catalog.oil.uses", { n: n(p.uses) }),
            }))}
          confirmBody={(target) =>
            t("settings.catalog.oil.mergeBody", { n: n(merging.uses), a: merging.name, b: target.label })
          }
          pending={merge.isPending}
          onMerge={(into) => merge.mutate({ id: merging.id, into })}
          onClose={() => !merge.isPending && setMerging(null)}
        />
      )}
    </>
  );
}

function RenameOilDialog({ row, all, onClose }: { row: ConfirmedOil; all: OilProductOption[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(row.name);
  const clean = tidy(name);
  const unchanged = clean === row.name;
  const twin = clean ? all.find((p) => p.id !== row.id && norm(p.name) === norm(clean)) : undefined;

  const save = useCatalogMutation(
    () => unwrap(commands.catalogRenameOilProduct(row.id, clean)),
    () => {
      notifySuccess(t("settings.catalog.renamed"));
      onClose();
    },
  );
  const blocked = !clean || unchanged;

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.catalog.oil.renameTitle")}</DialogTitle>
          <DialogDescription>{t("settings.catalog.oil.renameBody")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (blocked || save.isPending) return;
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="catalog-oil-name">{t("settings.catalog.oil.name")}</Label>
            <Input
              id="catalog-oil-name"
              dir="auto"
              maxLength={MAX_NAME}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {twin && <TwinWarning name={twin.name} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <SaveButton pending={save.isPending} disabled={blocked} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
