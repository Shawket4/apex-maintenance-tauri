import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { commands, unwrap, type JobOption } from "@/shared/api/client";
import { useCategories } from "@/shared/api/queries";
import { norm } from "@/shared/lib/normalize";
import { notifySuccess } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

import { useCatalogGate, useCatalogMutation } from "./catalogGate";
import { CatalogList, RowActions, RowText, SaveButton } from "./catalogParts";

const MAX_NAME = 120;
const NO_TYPE = "__none__";
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

/** The jobs the garage does again and again. Picking one in a work order
 * writes its name and sets the maintenance type it counts toward. */
export function JobsList({ rows }: { rows: JobOption[] }) {
  const { t, i18n } = useTranslation();
  const gate = useCatalogGate();
  const categories = useCategories();
  const [editing, setEditing] = useState<JobOption | "new" | null>(null);
  const [removing, setRemoving] = useState<JobOption | null>(null);
  const ar = i18n.language.startsWith("ar");

  const typeName = (id: string | null) => {
    const c = id ? categories.data?.find((x) => x.id === id) : undefined;
    return c ? (ar ? c.name_ar : c.name_en || c.name_ar) : null;
  };
  const jobName = (j: JobOption) => (ar ? j.name_ar : j.name_en || j.name_ar);

  const remove = useCatalogMutation(
    (id: string) => unwrap(commands.catalogRemoveJob(id)),
    () => {
      setRemoving(null);
      notifySuccess(t("settings.catalog.jobs.removed"));
    },
  );

  return (
    <>
      {gate.mayAddJob && (
        <Button className="w-full sm:w-auto" disabled={!gate.canAddJob} onClick={() => setEditing("new")}>
          <Plus />
          {t("settings.catalog.jobs.add")}
        </Button>
      )}

      <CatalogList
        searchId="catalog-job-search"
        searchLabel={t("settings.catalog.jobs.search")}
        rows={rows}
        rowKey={(j) => j.id}
        text={(j) => `${j.name_ar} ${j.name_en ?? ""} ${typeName(j.category_id) ?? ""}`}
        empty={t("settings.catalog.jobs.empty")}
      >
        {(j) => {
          const type = typeName(j.category_id);
          const other = ar ? j.name_en : j.name_en ? j.name_ar : null;
          return (
            <>
              <RowText
                title={jobName(j)}
                meta={
                  <>
                    {other && (
                      <>
                        <bdi>{other}</bdi>
                        {" · "}
                      </>
                    )}
                    {type ? t("settings.catalog.jobs.countsToward", { name: type }) : t("settings.catalog.jobs.noType")}
                    {" · "}
                    {t("settings.catalog.jobs.uses", { n: fmtNumber(j.uses, i18n.language) })}
                  </>
                }
              />
              {gate.mayManage && (
                <RowActions>
                  <Button variant="outline" size="sm" disabled={!gate.canManage} onClick={() => setEditing(j)}>
                    <Pencil />
                    {t("settings.catalog.jobs.edit")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={!gate.canManage}
                    onClick={() => setRemoving(j)}
                  >
                    <Trash2 />
                    {t("settings.catalog.jobs.remove")}
                  </Button>
                </RowActions>
              )}
            </>
          );
        }}
      </CatalogList>

      {editing && (
        <JobDialog
          key={editing === "new" ? "new" : editing.id}
          job={editing === "new" ? null : editing}
          all={rows}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={removing != null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("settings.catalog.jobs.removeTitle")}
        description={t("settings.catalog.jobs.removeBody")}
        confirmLabel={t("settings.catalog.jobs.remove")}
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      >
        {removing && (
          <p dir="auto" className="rounded-lg bg-muted px-3 py-2 text-sm font-semibold">
            {jobName(removing)}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

function JobDialog({ job, all, onClose }: { job: JobOption | null; all: JobOption[]; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const categories = useCategories();
  const [nameAr, setNameAr] = useState(job?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(job?.name_en ?? "");
  const [type, setType] = useState(job?.category_id ?? "");
  const ar = i18n.language.startsWith("ar");

  const cleanAr = tidy(nameAr);
  const cleanEn = tidy(nameEn);
  const duplicate = cleanAr !== "" && all.some((j) => j.id !== job?.id && norm(j.name_ar) === norm(cleanAr));
  const unchanged =
    job != null && cleanAr === job.name_ar && cleanEn === (job.name_en ?? "") && type === (job.category_id ?? "");
  // A type this device does not know (not loaded, or removed since) must
  // still show as chosen, not silently turn into "none" on save.
  const unknownType = type !== "" && categories.data != null && !categories.data.some((c) => c.id === type);

  const save = useCatalogMutation(
    () => unwrap(commands.catalogSaveJob(job?.id ?? null, cleanAr, cleanEn || null, type || null)),
    () => {
      notifySuccess(job ? t("settings.catalog.jobs.saved") : t("settings.catalog.jobs.added"));
      onClose();
    },
  );
  const blocked = !cleanAr || duplicate || unchanged;

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{job ? t("settings.catalog.jobs.editTitle") : t("settings.catalog.jobs.addTitle")}</DialogTitle>
          <DialogDescription>
            {job ? t("settings.catalog.jobs.editBody") : t("settings.catalog.jobs.addBody")}
          </DialogDescription>
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
            <Label htmlFor="catalog-job-ar">{t("settings.catalog.jobs.nameAr")}</Label>
            <Input
              id="catalog-job-ar"
              dir="auto"
              maxLength={MAX_NAME}
              placeholder={t("settings.catalog.jobs.nameArPh")}
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              aria-invalid={duplicate}
              aria-describedby={duplicate ? "catalog-job-duplicate" : undefined}
            />
            {duplicate && (
              <p id="catalog-job-duplicate" role="alert" className="text-sm text-status-overdue">
                {t("settings.catalog.jobs.duplicate")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-job-en">{t("settings.catalog.jobs.nameEn")}</Label>
            <Input
              id="catalog-job-en"
              dir="ltr"
              className="text-start"
              maxLength={MAX_NAME}
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-job-type">{t("settings.catalog.jobs.type")}</Label>
            <Select value={type || NO_TYPE} onValueChange={(v) => setType(v === NO_TYPE ? "" : v)}>
              <SelectTrigger id="catalog-job-type" className="w-full data-[size=default]:h-10 pointer-coarse:min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TYPE}>{t("settings.catalog.jobs.typeNone")}</SelectItem>
                {unknownType && <SelectItem value={type}>{t("settings.catalog.jobs.typeUnknown")}</SelectItem>}
                {(categories.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {ar ? c.name_ar : c.name_en || c.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm leading-6 text-muted-foreground">{t("settings.catalog.jobs.typeHint")}</p>
          </div>
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
