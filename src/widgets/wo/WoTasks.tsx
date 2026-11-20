import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { commands, unwrap, type TaskRow, type WoDetail } from "@/shared/api/client";
import { useCategories, useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { fmtCairo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
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
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { ListCard, Section } from "@/widgets/layout/PageShell";

import { useCategoryName } from "./lib";
import { CategorySelect, ClosedNote, PendingBadge, SectionTitle } from "./parts";

/** The mechanic's list. Ticking a task is what restarts that maintenance's
 * clock, so the tick is a large labelled button and says what it does. */
export function WoTasks({ d, woId, canEdit }: { d: WoDetail; woId: string; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  // The oil change adds a hidden task of its own; it is listed under "oil".
  const tasks = d.tasks.filter((task) => task.kind !== "oil");

  return (
    <Section
      title={
        <SectionTitle>
          {t("wo.tasks")}
          {d.wo.task_count > 0 && (
            <span className="text-xs font-medium text-muted-foreground tabular">
              {t("wo.taskProgress", {
                done: fmtNumber(d.wo.done_count, i18n.language),
                total: fmtNumber(d.wo.task_count, i18n.language),
              })}
            </span>
          )}
        </SectionTitle>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{t("wo.tasksHint")}</p>
      <ListCard>
        <TaskList tasks={tasks} canEdit={canEdit} />
        {canEdit ? <AddTask woId={woId} /> : <ClosedNote />}
      </ListCard>
    </Section>
  );
}

function TaskList({ tasks, canEdit }: { tasks: TaskRow[]; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const categoryName = useCategoryName();
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [deleting, setDeleting] = useState<TaskRow | null>(null);

  const setDone = useDomainMutation(
    (p: { taskId: string; done: boolean }) => unwrap(commands.woTaskSetDone(p.taskId, p.done)),
    { onError: notifyError },
  );
  const del = useDomainMutation((taskId: string) => unwrap(commands.woDeleteTask(taskId)), {
    onSuccess: () => {
      setDeleting(null);
      notifySuccess(t("wo.taskDeleted"));
    },
    onError: notifyError,
  });

  if (tasks.length === 0) {
    return <div className="px-4 py-4 text-sm text-muted-foreground">{t("wo.tasksEmpty")}</div>;
  }

  return (
    <>
      <ul className="divide-y">
        {tasks.map((task) => {
          const catName = categoryName(task.category_id, task.category_name_ar);
          const text = task.description_ar?.trim() || catName || "—";
          const toggling = setDone.isPending && setDone.variables?.taskId === task.id;
          return (
            <li
              key={task.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    dir="auto"
                    className={cn(
                      "min-w-0 break-words text-sm font-semibold",
                      task.is_done && "text-muted-foreground",
                    )}
                  >
                    {text}
                  </span>
                  {catName && (
                    <Badge variant="secondary" className="shrink-0">
                      {catName}
                    </Badge>
                  )}
                  {task.pending && <PendingBadge />}
                </div>
                {task.is_done ? (
                  <p className="text-xs text-muted-foreground">
                    {task.done_at
                      ? t("wo.taskDoneOn", {
                          date: fmtCairo(task.done_at, "YYYY/MM/DD HH:mm", i18n.language),
                        })
                      : t("wo.taskIsDone")}
                    {catName && ` · ${t("wo.taskClockRestarted")}`}
                  </p>
                ) : (
                  catName && (
                    <p className="text-xs text-status-due_soon">
                      {t("wo.taskClockHint", { name: catName })}
                    </p>
                  )
                )}
              </div>

              <div className="flex flex-none items-center gap-1.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={task.is_done}
                  disabled={!canEdit || toggling}
                  onClick={() => setDone.mutate({ taskId: task.id, done: !task.is_done })}
                  className={cn(
                    "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 sm:flex-none",
                    task.is_done
                      ? "border-status-ok bg-status-ok-soft text-status-ok"
                      : "bg-card hover:border-border-strong hover:bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 flex-none items-center justify-center rounded border",
                      task.is_done ? "border-status-ok bg-status-ok text-white" : "border-border-strong",
                    )}
                  >
                    {toggling ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      task.is_done && <Check className="h-3.5 w-3.5" />
                    )}
                  </span>
                  {task.is_done ? t("wo.taskIsDone") : t("wo.taskMarkDone")}
                </button>
                {canEdit && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("wo.editTask")}
                      title={t("wo.editTask")}
                      onClick={() => setEditing(task)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      aria-label={t("wo.deleteTask")}
                      title={t("wo.deleteTask")}
                      onClick={() => setDeleting(task)}
                    >
                      <Trash2 />
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {editing && (
        <EditTaskDialog key={editing.id} task={editing} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("wo.deleteTaskTitle")}
        description={
          deleting?.is_done && deleting.category_id
            ? t("wo.deleteTaskBodyDone")
            : t("wo.deleteTaskBody")
        }
        confirmLabel={t("wo.deleteTask")}
        destructive
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      >
        {deleting && (
          <p dir="auto" className="rounded-lg bg-muted px-3 py-2 text-sm font-semibold">
            {deleting.description_ar?.trim() ||
              categoryName(deleting.category_id, deleting.category_name_ar) ||
              "—"}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

/** What gets stored when only a category was picked: the Arabic name — the
 * description is stored data on an Arabic-first record. */
function useArabicCategoryName() {
  const categories = useCategories();
  return (id: string) => categories.data?.find((c) => c.id === id)?.name_ar ?? "";
}

function AddTask({ woId }: { woId: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const arabicName = useArabicCategoryName();

  const add = useDomainMutation(
    (p: { text: string; category: string | null }) =>
      unwrap(commands.woAddTask(woId, p.category, p.text)),
    {
      // Both fields go back to empty: a category left behind would be saved
      // on the next task and restart the wrong maintenance clock.
      onSuccess: () => {
        setText("");
        setCategory("");
      },
      onError: notifyError,
    },
  );

  const description = text.trim() || (category ? arabicName(category) : "");
  const canAdd = description.length > 0 && !add.isPending;
  const submit = () => {
    if (!canAdd) return;
    add.mutate({ text: description, category: category || null });
  };

  return (
    <form
      className="grid gap-3 bg-background/70 px-4 py-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="min-w-0 space-y-1">
        <Label htmlFor="wo-task-text">{t("wo.taskText")}</Label>
        <Input
          id="wo-task-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("wo.addTaskPlaceholder")}
          dir="auto"
          className="bg-card"
        />
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor="wo-task-category">{t("wo.taskCategory")}</Label>
        <CategorySelect id="wo-task-category" value={category} onChange={setCategory} />
      </div>
      <Button type="submit" disabled={!canAdd}>
        {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
        {t("wo.addTask")}
      </Button>
      {category && (
        <p className="text-xs text-muted-foreground sm:col-span-3">{t("wo.addTaskCategoryHint")}</p>
      )}
    </form>
  );
}

function EditTaskDialog({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(task.description_ar ?? "");
  const [category, setCategory] = useState(task.category_id ?? "");
  const arabicName = useArabicCategoryName();

  const save = useDomainMutation(
    (p: { text: string; category: string | null }) =>
      unwrap(commands.woTaskUpdate(task.id, p.category, p.text)),
    {
      onSuccess: () => {
        notifySuccess(t("wo.saved"));
        onClose();
      },
      onError: notifyError,
    },
  );

  const description = text.trim() || (category ? arabicName(category) : "");
  const categoryChanged = (task.category_id ?? "") !== category;

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("wo.editTask")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!description || save.isPending) return;
            save.mutate({ text: description, category: category || null });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="wo-edit-task-text">{t("wo.taskText")}</Label>
            <Input
              id="wo-edit-task-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              dir="auto"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wo-edit-task-category">{t("wo.taskCategory")}</Label>
            <CategorySelect id="wo-edit-task-category" value={category} onChange={setCategory} />
          </div>
          {task.is_done && categoryChanged && (
            <p className="rounded-lg bg-status-due_soon-soft px-3 py-2 text-sm text-status-due_soon">
              {t("wo.editTaskCategoryWarn")}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!description || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
