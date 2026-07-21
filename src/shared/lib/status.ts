// Status → design-token classes. The color tokens live in index.css (@theme);
// the labels live in i18n (due.status.* / tires.status.*). Nothing here is text.

export const DUE_DOT: Record<string, string> = {
  overdue: "bg-status-overdue",
  due_soon: "bg-status-due_soon",
  never_done: "bg-status-never_done",
  ok: "bg-status-ok",
};

export const DUE_BADGE: Record<string, string> = {
  overdue: "bg-status-overdue/15 text-status-overdue",
  due_soon: "bg-status-due_soon/15 text-status-due_soon",
  never_done: "bg-status-never_done/15 text-status-never_done",
  ok: "bg-status-ok/15 text-status-ok",
};

export const TIRE_BADGE: Record<string, string> = {
  mounted: "bg-status-ok/15 text-status-ok",
  in_stock_used: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  in_repair: "bg-status-due_soon/15 text-status-due_soon",
  retreading: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  scrapped: "bg-status-never_done/15 text-status-never_done",
};
