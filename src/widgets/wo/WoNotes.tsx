import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pencil } from "lucide-react";

import { commands, unwrap, type WoListRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Section } from "@/widgets/layout/PageShell";

import { SectionTitle, TextArea } from "./parts";

/** A short title and free notes: what the driver complained about, what is
 * still waiting for a part. Editable on a closed order too — notes change
 * nothing else. */
export function WoNotes({ wo }: { wo: WoListRow }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const title = wo.title?.trim() ?? "";
  const notes = wo.notes?.trim() ?? "";
  const empty = !title && !notes;

  return (
    <Section
      title={<SectionTitle>{t("wo.notesTitle")}</SectionTitle>}
      action={
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Pencil />
          {empty ? t("wo.notesAdd") : t("wo.edit")}
        </Button>
      }
    >
      <div className="rounded-xl border bg-card px-4 py-4 shadow-sm">
        {empty ? (
          <p className="text-sm text-muted-foreground">{t("wo.notesEmpty")}</p>
        ) : (
          <div className="space-y-2">
            {title && (
              <div dir="auto" className="break-words text-sm font-semibold">
                {title}
              </div>
            )}
            {notes && (
              <p dir="auto" className="whitespace-pre-wrap break-words text-sm">
                {notes}
              </p>
            )}
          </div>
        )}
      </div>
      {open && <NotesDialog wo={wo} onClose={() => setOpen(false)} />}
    </Section>
  );
}

function NotesDialog({ wo, onClose }: { wo: WoListRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(wo.title ?? "");
  const [notes, setNotes] = useState(wo.notes ?? "");

  const save = useDomainMutation(
    () => unwrap(commands.woSetNotes(wo.id, title.trim() || null, notes.trim() || null)),
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("wo.notesTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!save.isPending) save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="wo-notes-title">{t("wo.notesShort")}</Label>
            <Input
              id="wo-notes-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("wo.notesShortPlaceholder")}
              dir="auto"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wo-notes-body">{t("wo.notesBody")}</Label>
            <TextArea
              id="wo-notes-body"
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("wo.notesBodyPlaceholder")}
              dir="auto"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
