import { useTranslation } from "react-i18next";
import { Printer } from "lucide-react";

import type { WoDetail } from "@/shared/api/client";
import { fmtKm, fmtLiters } from "@/shared/lib/numbers";
import { fmtCairo, nowUtcIso } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";

import { canPrint, printPage, useCategoryName } from "./lib";

export function PrintButton() {
  const { t } = useTranslation();
  if (!canPrint()) return null;
  return (
    <Button variant="outline" className="w-full sm:w-auto" onClick={() => void printPage(t("wo.print.action"))}>
      <Printer />
      {t("wo.print.action")}
    </Button>
  );
}

const DATE = "YYYY/MM/DD HH:mm";

/** The work order as a paper sheet. Invisible on screen; when printing it is
 * the ONLY thing on the page (the screen version carries `print:hidden`).
 * Print rules live in index.css under `@media print`, keyed on `data-print`:
 * "sheet" = this sheet, "row" = a row that must not be cut across pages. */
export function WoPrintSheet({ d }: { d: WoDetail }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const categoryName = useCategoryName();
  const wo = d.wo;
  // The oil change adds a hidden task of its own; it is listed under "oil".
  const tasks = d.tasks.filter((task) => task.kind !== "oil");
  const title = wo.title?.trim();
  const notes = wo.notes?.trim();

  return (
    <div data-print="sheet" className="hidden print:block">
      <header className="flex items-end justify-between gap-4 border-b-2 border-black pb-2">
        <div>
          <div className="text-sm">{t("app.name")}</div>
          <h1 className="text-2xl font-bold">{t("wo.print.sheetTitle")}</h1>
        </div>
        <div className="text-end">
          <div className="text-sm">{t("wo.print.plate")}</div>
          <div className="text-2xl font-bold [word-spacing:0.12em]">
            <bdi>{wo.plate}</bdi>
          </div>
        </div>
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
        <Fact label={t("wo.print.status")}>
          {wo.status === "open" ? t("wo.statusOpen") : t("wo.statusClosed")}
        </Fact>
        <Fact label={t("wo.odometerAtOpen")}>
          {wo.odometer_at_open != null ? fmtKm(wo.odometer_at_open, lang) : t("wo.odoMissing")}
        </Fact>
        <Fact label={t("wo.print.opened")}>{fmtCairo(wo.opened_at, DATE, lang)}</Fact>
        <Fact label={t("wo.print.closed")}>
          {wo.closed_at ? fmtCairo(wo.closed_at, DATE, lang) : t("wo.print.notClosed")}
        </Fact>
        {title && (
          <div className="col-span-2 flex gap-2">
            <dt className="flex-none">{t("wo.print.subject")}:</dt>
            <dd dir="auto" className="min-w-0 break-words font-semibold">
              {title}
            </dd>
          </div>
        )}
      </dl>

      <SheetSection title={t("wo.tasks")}>
        {tasks.length === 0 ? (
          <None />
        ) : (
          <table>
            <thead>
              <tr>
                <th className="w-[4.5rem]">{t("wo.print.colDone")}</th>
                <th>{t("wo.print.colTask")}</th>
                <th className="w-[22%]">{t("wo.print.colType")}</th>
                <th className="w-[22%]">{t("wo.print.colDoneAt")}</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const catName = categoryName(task.category_id, task.category_name_ar);
                return (
                  <tr key={task.id} data-print="row">
                    <td>
                      <span
                        aria-hidden
                        className="inline-flex h-5 w-5 items-center justify-center border-2 border-black text-sm font-bold leading-none"
                      >
                        {task.is_done ? "✓" : ""}
                      </span>
                      <span className="sr-only">{task.is_done ? t("wo.taskIsDone") : t("wo.print.notDone")}</span>
                    </td>
                    <td dir="auto" className="break-words font-semibold">
                      {task.description_ar?.trim() || catName || "—"}
                    </td>
                    <td>{catName ?? "—"}</td>
                    <td>
                      {task.is_done
                        ? task.done_at
                          ? fmtCairo(task.done_at, DATE, lang)
                          : t("wo.taskIsDone")
                        : t("wo.print.notDone")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SheetSection>

      <SheetSection title={t("wo.oilTitle")}>
        {d.oil_changes.length === 0 ? (
          <None />
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t("wo.print.colOilType")}</th>
                <th className="w-[20%]">{t("wo.print.colLiters")}</th>
                <th className="w-[24%]">{t("wo.print.colDate")}</th>
                <th className="w-[22%]">{t("wo.print.colOdometer")}</th>
              </tr>
            </thead>
            <tbody>
              {d.oil_changes.map((o) => (
                <tr key={o.id} data-print="row">
                  <td className="font-semibold">
                    <bdi>{o.oil_type}</bdi>
                  </td>
                  <td>{fmtLiters(o.liters, lang)}</td>
                  <td>{fmtCairo(o.performed_at, DATE, lang)}</td>
                  <td>{o.odometer != null ? fmtKm(o.odometer, lang) : t("wo.odoMissing")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SheetSection>

      <SheetSection title={t("wo.tireTitle")}>
        {d.tire_ops.length === 0 ? (
          <None />
        ) : (
          <table>
            <thead>
              <tr>
                <th className="w-[18%]">{t("wo.print.colPosition")}</th>
                <th>{t("wo.print.colTire")}</th>
                <th className="w-[24%]">{t("wo.print.colWhat")}</th>
              </tr>
            </thead>
            <tbody>
              {d.tire_ops.map((op) => (
                <tr key={op.assignment_id} data-print="row">
                  <td>
                    <bdi dir="ltr">{op.position_code ?? "—"}</bdi>
                  </td>
                  <td className="font-semibold">
                    <bdi>{op.dot_code ?? op.brand ?? t("wo.tireUnnamed")}</bdi>
                  </td>
                  <td>{op.dismounted_at ? t("wo.tireDismounted") : t("wo.tireMounted")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SheetSection>

      <SheetSection title={t("wo.notesTitle")}>
        {notes ? (
          <p dir="auto" className="whitespace-pre-wrap break-words text-sm">
            {notes}
          </p>
        ) : (
          <None />
        )}
      </SheetSection>

      <p className="mt-6 border-t border-black pt-1 text-xs">
        {t("wo.print.printedOn", { date: fmtCairo(nowUtcIso(), DATE, lang) })}
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="flex-none">{label}:</dt>
      <dd className="min-w-0 font-semibold tabular">{children}</dd>
    </div>
  );
}

function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-1 text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

function None() {
  const { t } = useTranslation();
  return <p className="text-sm">{t("wo.print.none")}</p>;
}
