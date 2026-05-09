import { useEffect, useState } from "react";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { useToastStore, Toast as ToastType } from "@/shared/lib/toast-store";
import { cn } from "@/shared/lib/cn";

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <div className="fixed bottom-0 right-0 z-[100] flex flex-col p-4 gap-2 w-full max-w-md pointer-events-none sm:bottom-4 sm:right-4">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: ToastType }) {
  const removeToast = useToastStore((state) => state.removeToast);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Animation entry
    const raf = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    error: <AlertCircle className="h-5 w-5 text-destructive" />,
    info: <Info className="h-5 w-5 text-blue-500" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-500" />,
  };

  const bgClasses = {
    success: "border-emerald-500/20 bg-emerald-50/90 dark:bg-emerald-950/90",
    error: "border-destructive/20 bg-destructive/5 dark:bg-destructive/10",
    info: "border-blue-500/20 bg-blue-50/90 dark:bg-blue-950/90",
    warning: "border-amber-500/20 bg-amber-50/90 dark:bg-amber-950/90",
  };

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full items-center gap-3 rounded-lg border p-4 shadow-lg backdrop-blur-sm transition-all duration-300 ease-out",
        bgClasses[toast.type],
        isVisible ? "translate-y-0 opacity-100 scale-100" : "translate-y-2 opacity-0 scale-95"
      )}
      role="alert"
    >
      <div className="flex-shrink-0">{icons[toast.type]}</div>
      <div className="flex-1 text-sm font-medium leading-relaxed">
        {toast.message}
      </div>
      <button
        onClick={() => {
          setIsVisible(false);
          setTimeout(() => removeToast(toast.id), 300);
        }}
        className="flex-shrink-0 rounded-md p-1 opacity-50 transition-opacity hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
