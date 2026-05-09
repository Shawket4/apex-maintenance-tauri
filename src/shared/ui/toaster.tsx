import * as React from "react";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";
import { useToastStore } from "@/shared/lib/toast-store";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Bridges the existing toast-store into Sonner
function ToastStoreBridge() {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  useEffect(() => {
    toasts.forEach((t) => {
      const method =
        t.type === "success" ? sonnerToast.success :
        t.type === "error"   ? sonnerToast.error   :
        t.type === "warning" ? sonnerToast.warning  :
        t.type === "info"    ? sonnerToast.info     :
        sonnerToast;

      method(t.message, {
        id: t.id,
        onDismiss: () => removeToast(t.id),
        onAutoClose: () => removeToast(t.id),
      });
    });
  }, [toasts, removeToast]);

  return null;
}

export function Toaster(props: ToasterProps) {
  const { theme = "system" } = useTheme();

  return (
    <>
      <ToastStoreBridge />
      <Sonner
        theme={theme as ToasterProps["theme"]}
        position="top-right"
        richColors
        closeButton
        className="toaster group"
        toastOptions={{
          classNames: {
            toast:
              "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
            description: "group-[.toast]:text-muted-foreground",
            actionButton:
              "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
            cancelButton:
              "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          },
        }}
        {...props}
      />
    </>
  );
}

interface ToastPayload {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: "default" | "destructive" | "success";
}

export const toast = (
  message: string | React.ReactNode | ToastPayload,
  options?: any,
) => {
  if (typeof message === "object" && message !== null && "title" in message) {
    const { title, description, variant, ...rest } = message as ToastPayload;

    const method =
      variant === "destructive" ? sonnerToast.error :
      variant === "success"     ? sonnerToast.success :
      sonnerToast;

    return method(title, { description, ...rest, ...options });
  }

  return sonnerToast(message as any, options);
};

toast.success  = sonnerToast.success;
toast.error    = sonnerToast.error;
toast.info     = sonnerToast.info;
toast.warning  = sonnerToast.warning;
toast.loading  = sonnerToast.loading;
toast.promise  = sonnerToast.promise;
toast.dismiss  = sonnerToast.dismiss;
toast.custom   = sonnerToast.custom;