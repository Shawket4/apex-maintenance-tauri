import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { PositionRow } from "@/shared/api/client";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";

/**
 * Guards the selection while a form has typed-in data: choosing another
 * wheel or closing the inspector asks first instead of silently discarding.
 * `go` skips the question (used after a successful save).
 */
export function useSelectionGuard(selectedId: string | null, select: (p: PositionRow | null) => void) {
  const { t } = useTranslation();
  const [dirty, setDirty] = useState(false);
  const [wanted, setWanted] = useState<{ p: PositionRow | null } | null>(null);

  const go = (p: PositionRow | null) => {
    setDirty(false);
    setWanted(null);
    select(p);
  };
  const request = (p: PositionRow | null) => {
    if ((p?.id ?? null) === selectedId) return;
    if (dirty) setWanted({ p });
    else go(p);
  };
  const dialog = (
    <ConfirmDialog
      open={wanted != null}
      onOpenChange={(open) => !open && setWanted(null)}
      title={t("diagram.discard.title")}
      description={t("diagram.discard.body")}
      confirmLabel={t("diagram.discard.confirm")}
      destructive
      onConfirm={() => wanted && go(wanted.p)}
    />
  );
  return { request, go, setDirty, dialog };
}
