import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { useSyncStore, ConflictRecord } from "@/shared/api/sync";
import { Card } from "@/shared/ui/card";
import { ArrowRight, Check } from "lucide-react";
import { fmtCairo } from "@/shared/lib/time";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConflictDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const { resolveConflict } = useSyncStore();

  const load = async () => {
    setLoading(true);
    try {
      const res = await invoke<ConflictRecord[]>("sync_list_conflicts");
      setConflicts(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open]);

  const handleResolve = async (id: number, action: "accept_server" | "keep_mine") => {
    try {
      await resolveConflict(id, action);
      setConflicts((prev) => prev.filter((c) => c.id !== id));
      if (conflicts.length <= 1) {
        onOpenChange(false);
      }
    } catch (e) {
      alert("Failed to resolve conflict: " + e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>{t("sync.conflicts_title")}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6">
          <div className="space-y-4 py-4">
            {conflicts.map((c) => (
              <Card key={c.id} className="p-4 border-amber-200 bg-amber-50/30 dark:bg-amber-950/10">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-amber-600">
                    {c.entity_type} #{c.entity_id}
                  </div>
                  <div className="text-[10px] text-muted-foreground italic">
                    {fmtCairo(c.created_at)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase">{t("sync.local_version")}</div>
                    <pre className="text-[10px] bg-background border p-2 rounded max-h-32 overflow-auto whitespace-pre-wrap">
                      {JSON.stringify(c.local_row, null, 2)}
                    </pre>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase">{t("sync.server_version")}</div>
                    <pre className="text-[10px] bg-background border p-2 rounded max-h-32 overflow-auto whitespace-pre-wrap">
                      {JSON.stringify(c.server_row, null, 2)}
                    </pre>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => handleResolve(c.id, "accept_server")}
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t("sync.action_accept_server")}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => handleResolve(c.id, "keep_mine")}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    {t("sync.action_keep_mine")}
                  </Button>
                </div>
              </Card>
            ))}

            {!loading && conflicts.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm italic">
                {t("sync.no_conflicts")}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
