import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { commands, unwrap, type TaskRow, type WoDetail } from "@/shared/api/client";
import { useCatalog, useCategories, useDomainMutation } from "@/shared/api/queries";
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
import { Label } from "@/shared/ui/label";
import { JobPicker } from "@/widgets/catalog/pickers";
import { ListCard, Section } from "@/widgets/layout/PageShell";

import { useCategoryName } from "./lib";
import { ClosedNote, PendingBadge, SectionTitle, TaskTypePicker } from "./parts";

/** The mechanic's list. Ticking a task is what restarts that maintenance's
 * clock, so the tick is a large labelled button and says what it does. */
export function WoTasks({ d, woId, canEdit }: { d: WoDetail; woId: string; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  // An oil change and a battery fitting each add a hidden task of their own
  // (it restarts that due date); they are listed under "oil" / "batteries".
  const tasks = d.tasks.filter((task) => task.kind !== "oil" && task.kind !== "battery");

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

/** The type → job pair a task is written with (add form and edit dialog).
 * The type comes first and narrows the jobs to its own; either can be typed. */
function useTaskDraft(init: { text: string; categoryId: string }) {
  const { i18n } = useTranslation();
  const categories = useCategories();
  const catalog = useCatalog();
  const [text, setText] = useState(init.text);
  const [categoryId, setCategoryId] = useState(init.categoryId);
  const [typed, setTyped] = useState("");

  const cat = categoryId ? categories.data?.find((c) => c.id === categoryId) : undefined;
  const typeName = cat
    ? (i18n.language.startsWith("ar") ? cat.name_ar : cat.name_en) || cat.name_ar
    : typed || null;

  const pickType = (id: string, name: string) => {
    // A listed job of another type does not follow the type change (it would
    // count toward the wrong one); a typed job does, and is kept under it.
    const job = catalog.data?.standard_jobs.find((j) => j.name_ar === text.trim());
    if (job?.category_id && job.category_id !== id) setText("");
    setCategoryId(id);
    setTyped(name);
  };
  // With no type chosen every job is listed, and a listed job brings its type.
  const pickJob = (description: string, jobCategory?: string | null) => {
    setText(description);
    if (jobCategory) {
      setCategoryId(jobCategory);
      setTyped("");
    }
  };
  const reset = () => {
    setText("");
    setCategoryId("");
    setTyped("");
  };

  return {
    text,
    categoryId,
    typed,
    typeName,
    pickType,
    pickJob,
    reset,
    /** What JobPicker lists: this type's jobs; none yet for a new type. */
    jobsOf: categoryId || (typed ? null : undefined),
    /** Stored when only a type is given: its Arabic name (the description is
     * stored data on an Arabic-first record). */
    description: text.trim() || (cat ? cat.name_ar : typed.trim()),
    hasType: categoryId !== "" || typed !== "",
  };
}

type TaskInput = { text: string; category: string | null; newType: string | null };

function AddTask({ woId }: { woId: string }) {
  const { t } = useTranslation();
  const d = useTaskDraft({ text: "", categoryId: "" });

  const add = useDomainMutation(
    (p: TaskInput) => unwrap(commands.woAddTask(woId, p.category, p.newType, p.text)),
    {
      // Both fields go back to empty: a type left behind would be saved on
      // the next task and restart the wrong maintenance clock.
      onSuccess: d.reset,
      onError: notifyError,
    },
  );

  const canAdd = d.description.length > 0 && !add.isPending;
  const submit = () => {
    if (!canAdd) return;
    add.mutate({ text: d.description, category: d.categoryId || null, newType: d.typed || null });
  };

  return (
    <form
      className="grid gap-3 bg-background/70 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="min-w-0 space-y-1">
        <Label htmlFor="wo-task-category">{t("wo.taskCategory")}</Label>
        <TaskTypePicker
          id="wo-task-category"
          categoryId={d.categoryId}
          typed={d.typed}
          onChange={d.pickType}
          disabled={add.isPending}
        />
      </div>
      <div className="min-w-0 space-y-1">
        <Label htmlFor="wo-task-text">{t("wo.taskText")}</Label>
        <JobPicker
          id="wo-task-text"
          value={d.text}
          onChange={d.pickJob}
          typeId={d.jobsOf}
          typeName={d.typeName}
          disabled={add.isPending}
        />
      </div>
      <Button type="submit" disabled={!canAdd}>
        {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
        {t("wo.addTask")}
      </Button>
      {d.typed && (
        <p className="text-xs font-medium text-primary sm:col-span-3">{t("wo.typeNewHint", { name: d.typed })}</p>
      )}
      {d.hasType && (
        <p className="text-xs text-muted-foreground sm:col-span-3">{t("wo.addTaskCategoryHint")}</p>
      )}
    </form>
  );
}

function EditTaskDialog({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const { t } = useTranslation();
  const d = useTaskDraft({ text: task.description_ar ?? "", categoryId: task.category_id ?? "" });

  const save = useDomainMutation(
    (p: TaskInput) => unwrap(commands.woTaskUpdate(task.id, p.category, p.newType, p.text)),
    {
      onSuccess: () => {
        notifySuccess(t("wo.saved"));
        onClose();
      },
      onError: notifyError,
    },
  );

  const categoryChanged = (task.category_id ?? "") !== d.categoryId || d.typed !== "";

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
            if (!d.description || save.isPending) return;
            save.mutate({ text: d.description, category: d.categoryId || null, newType: d.typed || null });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="wo-edit-task-category">{t("wo.taskCategory")}</Label>
            <TaskTypePicker
              id="wo-edit-task-category"
              categoryId={d.categoryId}
              typed={d.typed}
              onChange={d.pickType}
              disabled={save.isPending}
            />
            {d.typed && (
              <p className="text-xs font-medium text-primary">{t("wo.typeNewHint", { name: d.typed })}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wo-edit-task-text">{t("wo.taskText")}</Label>
            <JobPicker
              id="wo-edit-task-text"
              value={d.text}
              onChange={d.pickJob}
              typeId={d.jobsOf}
              typeName={d.typeName}
              disabled={save.isPending}
            />
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
            <Button type="submit" disabled={!d.description || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
