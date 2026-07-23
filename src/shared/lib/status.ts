// Status → design-token classes. The color tokens live in index.css (@theme),
// synced from the Claude Design project: deep tone for text/dots, paired
// `-soft` tint for fills. The labels live in i18n. Nothing here is text.

export const DUE_DOT: Record<string, string> = {
  overdue: "bg-status-overdue",
  due_soon: "bg-status-due_soon",
  never_done: "bg-status-never_done",
  ok: "bg-status-ok",
};

export const DUE_BADGE: Record<string, string> = {
  overdue: "bg-status-overdue-soft text-status-overdue",
  due_soon: "bg-status-due_soon-soft text-status-due_soon",
  never_done: "bg-status-never_done-soft text-status-never_done",
  ok: "bg-status-ok-soft text-status-ok",
};

export const TIRE_BADGE: Record<string, string> = {
  mounted: "bg-status-ok-soft text-status-ok",
  in_stock_used: "bg-info-soft text-info",
  in_repair: "bg-status-due_soon-soft text-status-due_soon",
  retreading: "bg-violet-soft text-violet",
  scrapped: "bg-status-never_done-soft text-status-never_done",
};
