import { cn } from "@/shared/lib/cn";

/** The one status chip. `tone` is a class pair from the status token maps
 * (DUE_BADGE / TIRE_BADGE in shared/lib/status) — soft fill + deep text. */
export function StatusChip({
  tone,
  size = "sm",
  className,
  children,
}: {
  tone: string;
  size?: "sm" | "md";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full font-semibold",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
        tone,
        className,
      )}
    >
      {children}
    </span>
  );
}
