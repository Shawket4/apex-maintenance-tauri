import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pencil, Plus } from "lucide-react";

import { commands, unwrap, type ClassRow } from "@/shared/api/client";
import { useClasses, useDomainMutation, usePlans, useTrucks } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { QueryState } from "@/shared/ui/query-state";
import { EmptyState } from "@/widgets/layout/PageShell";

import { nameKey, slugForClass } from "./lib";
import { useConfigureGate } from "./gate";
import { Note, SettingsCard } from "./parts";

const MAX_NAME = 60;

class DuplicateClassName extends Error {}

/** Truck classes ("تريلا مرسيدس", "قلاب"…): a class is only a name. Its
 * internal id is made here from the name, so the user is never asked for a
 * code; a name that already exists is refused instead of renaming it. */
export function ClassesSection() {
  const { t, i18n } = useTranslation();
  const gate = useConfigureGate();
  const classes = useClasses();
  const trucks = useTrucks();
  const plans = usePlans();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<ClassRow | null>(null);

  const all = classes.data ?? [];
  const taken = (candidate: string, exceptId?: string) =>
    all.some((c) => c.id !== exceptId && (nameKey(c.name_ar) === nameKey(candidate) || nameKey(c.name_en) === nameKey(candidate)));

  const add = useDomainMutation(
    async (className: string) => {
      // Another device may have added classes since this one last looked: read
      // the list again first, so the new id cannot land on an existing class
      // (the server would rename that class instead of adding one).
      await unwrap(commands.referenceRefresh());
      const fresh = await unwrap(commands.classesList());
      if (fresh.some((c) => nameKey(c.name_ar) === nameKey(className) || nameKey(c.name_en) === nameKey(className))) {
        throw new DuplicateClassName();
      }
      await unwrap(commands.classCreate(slugForClass(className, fresh.map((c) => c.id)), className));
    },
    {
      onSuccess: (_d, className) => {
        setName("");
        notifySuccess(t("settings.classes.added", { name: className }));
      },
      onError: (e) => {
        if (e instanceof DuplicateClassName) {
          // The refreshed list now holds the name: the inline message appears.
          void classes.refetch();
          return;
        }
        notifyError(e);
      },
    },
  );

  const clean = name.trim().replace(/\s+/g, " ");
  const duplicate = clean !== "" && taken(clean);
  const className = (c: ClassRow) => (i18n.language.startsWith("ar") ? c.name_ar : c.name_en || c.name_ar);

  return (
    <SettingsCard id="classes" title={t("settings.classes.title")} description={t("settings.classes.intro")}>
      {gate.reason && <Note>{gate.reason}</Note>}

      <QueryState query={classes}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState>{t("settings.classes.empty")}</EmptyState>
          ) : (
            <ul className="divide-y rounded-lg border">
              {rows.map((c) => {
                const truckCount = (trucks.data ?? []).filter((tr) => tr.class_id === c.id).length;
                const planCount = (plans.data ?? []).filter((p) => p.class_id === c.id && p.is_active).length;
                return (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold" dir="auto">
                        {className(c)}
                      </div>
                      <div className="text-sm text-muted-foreground tabular">
                        {t("settings.classes.counts", {
                          trucks: fmtNumber(truckCount, i18n.language),
                          plans: fmtNumber(planCount, i18n.language),
                        })}
                      </div>
                    </div>
                    {gate.allowed && (
                      <Button variant="outline" size="sm" disabled={!gate.canEdit} onClick={() => setRenaming(c)}>
                        <Pencil />
                        {t("settings.classes.rename")}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        }
      </QueryState>

      {gate.allowed && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!clean || duplicate || !gate.canEdit || add.isPending) return;
            add.mutate(clean);
          }}
        >
          <Label htmlFor="new-class-name">{t("settings.classes.newLabel")}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="new-class-name"
              className="sm:max-w-sm"
              dir="auto"
              maxLength={MAX_NAME}
              placeholder={t("settings.classes.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!gate.canEdit}
              aria-invalid={duplicate}
              aria-describedby={duplicate ? "new-class-error" : undefined}
            />
            <Button type="submit" disabled={!clean || duplicate || !gate.canEdit || add.isPending}>
              {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("settings.classes.add")}
            </Button>
          </div>
          {duplicate && (
            <p id="new-class-error" role="alert" className="text-sm text-status-overdue">
              {t("settings.classes.duplicate")}
            </p>
          )}
        </form>
      )}

      {renaming && (
        <RenameDialog
          key={renaming.id}
          row={renaming}
          taken={(candidate) => taken(candidate, renaming.id)}
          onClose={() => setRenaming(null)}
        />
      )}
    </SettingsCard>
  );
}

function RenameDialog({
  row,
  taken,
  onClose,
}: {
  row: ClassRow;
  taken: (candidate: string) => boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(row.name_ar);
  const clean = name.trim().replace(/\s+/g, " ");
  const duplicate = clean !== "" && taken(clean);
  const unchanged = clean === row.name_ar;
  // Same id + a new name is how the server renames a class.
  const save = useDomainMutation(() => unwrap(commands.classCreate(row.id, clean)), {
    onSuccess: () => {
      notifySuccess(t("settings.classes.renamed"));
      onClose();
    },
    onError: notifyError,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.classes.renameTitle")}</DialogTitle>
          <DialogDescription>{t("settings.classes.renameBody")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!clean || duplicate || unchanged || save.isPending) return;
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="rename-class">{t("settings.classes.newLabel")}</Label>
            <Input
              id="rename-class"
              dir="auto"
              maxLength={MAX_NAME}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={duplicate}
            />
            {duplicate && (
              <p role="alert" className="text-sm text-status-overdue">
                {t("settings.classes.duplicate")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!clean || duplicate || unchanged || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
