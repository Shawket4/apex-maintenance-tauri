import * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Printer, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/shared/ui/button";

interface PrintButtonProps extends ButtonProps {
  onPrint: () => Promise<void>;
}

export function PrintButton({
  onPrint,
  onClick,
  children,
  className = "",
  size = "sm",
  disabled,
  ...props
}: PrintButtonProps) {
  const { t } = useTranslation();
  const [isPrinting, setIsPrinting] = useState(false);

  const handlePrint = async (e: React.MouseEvent<HTMLButtonElement>) => {
    try {
      setIsPrinting(true);
      onClick?.(e);
      await onPrint();
    } catch (error) {
      console.error("Print operation failed:", error);
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Button
      size={size}
      onClick={handlePrint}
      disabled={isPrinting || disabled}
      className={`
        bg-[#2563EB] hover:bg-[#1d55d4] active:bg-[#1a4bbf]
        text-white text-sm font-medium
        border border-[#1a4bbf]
        rounded-md px-3 h-9
        flex items-center gap-2
        transition-colors duration-150
        disabled:opacity-60 disabled:cursor-not-allowed
        ${className}
      `}
      {...props}
    >
      {isPrinting ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
      ) : (
        <Printer className="h-4 w-4 shrink-0" />
      )}
      {children || t("actions.print")}
    </Button>
  );
}