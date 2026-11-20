import { cn } from "@/shared/lib/cn";

/** A plate number, isolated from the sentence around it so its letters and
 * digits keep their own order in both Arabic and English layouts. */
export function Plate({ children, className }: { children: React.ReactNode; className?: string }) {
  return <bdi className={cn("whitespace-nowrap", className)}>{children}</bdi>;
}
