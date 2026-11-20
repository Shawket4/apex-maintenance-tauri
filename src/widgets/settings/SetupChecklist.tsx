import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight } from "lucide-react";

import { useClasses, useHome, usePlans, useTrucks } from "@/shared/api/queries";
import { cn } from "@/shared/lib/cn";
import { fmtNumber } from "@/shared/lib/numbers";

/** The four things a new install has to do before the due board means
 * anything, each with where it stands and a link to do it. Disappears once
 * all four are done. */
export function SetupChecklist() {
  const { t, i18n } = useTranslation();
  const classes = useClasses();
  const trucks = useTrucks();
  const plans = usePlans();
  const home = useHome();
  if (!classes.data || !trucks.data || !plans.data || !home.data) return null;

  const n = (v: number) => fmtNumber(v, i18n.language);
  const classCount = classes.data.length;
  const noClass = trucks.data.filter((tr) => !tr.class_id).length;
  const activePlans = plans.data.filter((p) => p.is_active);
  const classesWithoutPlan = classes.data.filter((c) => !activePlans.some((p) => p.class_id === c.id)).length;
  const neverDone = home.data.due_counts.never_done;

  const steps = [
    {
      key: "classes",
      done: classCount > 0,
      title: t("settings.setup.classes"),
      state: t("settings.setup.classesState", { n: n(classCount) }),
      hash: "classes",
    },
    {
      key: "trucks",
      done: trucks.data.length > 0 && noClass === 0,
      title: t("settings.setup.trucks"),
      state:
        trucks.data.length === 0
          ? t("settings.setup.trucksNone")
          : noClass === 0
            ? t("settings.setup.trucksAll")
            : t("settings.setup.trucksState", { n: n(noClass) }),
      hash: "truck-classes",
    },
    {
      key: "plans",
      done: activePlans.length > 0 && classesWithoutPlan === 0,
      title: t("settings.setup.plans"),
      state:
        classesWithoutPlan > 0 && activePlans.length > 0
          ? t("settings.setup.plansMissing", { n: n(activePlans.length), missing: n(classesWithoutPlan) })
          : t("settings.setup.plansState", { n: n(activePlans.length) }),
      hash: "plans",
    },
    {
      key: "baseline",
      done: activePlans.length > 0 && noClass < trucks.data.length && neverDone === 0,
      title: t("settings.setup.baseline"),
      state: neverDone > 0 ? t("settings.setup.baselineState", { n: n(neverDone) }) : t("settings.setup.baselineNone"),
      hash: null,
    },
  ];
  if (steps.every((s) => s.done)) return null;

  const row = "flex min-h-14 items-center gap-3 px-4 py-3 transition hover:bg-primary/[0.03]";
  return (
    <section id="setup" aria-labelledby="setup-title" className="scroll-mt-20 rounded-xl border border-primary/30 bg-card shadow-sm">
      <div className="px-4 pb-2 pt-4 sm:px-5">
        <h2 id="setup-title" className="text-base font-bold">
          {t("settings.setup.title")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("settings.setup.intro")}</p>
      </div>
      <ol className="divide-y border-t">
        {steps.map((s, i) => {
          const body = (
            <>
              <span
                className={cn(
                  "grid h-8 w-8 flex-none place-items-center rounded-full text-sm font-bold tabular",
                  s.done ? "bg-status-ok-soft text-status-ok" : "bg-primary/10 text-primary",
                )}
              >
                {s.done ? <Check className="h-4 w-4" aria-label={t("settings.setup.done")} /> : n(i + 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{s.title}</span>
                <span className="block text-sm text-muted-foreground tabular">{s.state}</span>
              </span>
              <ChevronRight className="h-4 w-4 flex-none text-muted-foreground rtl:-scale-x-100" />
            </>
          );
          return (
            <li key={s.key}>
              {s.hash ? (
                <Link to="/settings" hash={s.hash} className={row}>
                  {body}
                </Link>
              ) : (
                <Link to="/due" className={row}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
