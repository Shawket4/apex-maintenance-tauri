import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/cn";

import { parsePosition } from "./lib";

/** A wheel position said in words, with the code kept as a small tag for
 * whoever reads it off the diagram. Unknown codes fall back to the code. */
export function PositionLabel({ code, className }: { code: string | null | undefined; className?: string }) {
  const { t, i18n } = useTranslation();
  if (!code) return null;
  const p = parsePosition(code);
  if (!p) {
    return (
      <bdi dir="ltr" className={className}>
        {code}
      </bdi>
    );
  }
  const n = (v: number) => new Intl.NumberFormat(i18n.language.startsWith("ar") ? "ar-EG" : "en-US").format(v);
  const words =
    p.kind === "spare"
      ? t("tires.pos.spare", { n: n(p.index) })
      : t(`tires.pos.${p.kind}`, {
          n: n(p.axle),
          side: t(`tires.pos.side.${p.side}${p.depth === "outer" ? "Outer" : p.depth === "inner" ? "Inner" : ""}`),
        });
  return (
    <span className={className}>
      {words}{" "}
      <bdi dir="ltr" className="text-xs text-muted-foreground">
        {code}
      </bdi>
    </span>
  );
}

/** A filter chip tall enough for a finger. */
export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm transition pointer-coarse:min-h-11",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/** A section heading people can actually read. */
export function Heading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h2 className="text-base font-bold">{children}</h2>
      {action}
    </div>
  );
}
