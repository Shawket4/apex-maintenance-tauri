import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/shared/ui/button";
import { exportToExcel, type ExcelExportConfig } from "@/shared/lib/excel";

interface ExportExcelButtonProps extends Omit<ButtonProps, "config"> {
  config: ExcelExportConfig | (() => ExcelExportConfig | Promise<ExcelExportConfig>);
  filename?: string;
}

export function ExportExcelButton({
  config,
  onClick,
  children,
  className = "",
  size = "sm",
  disabled,
  ...props
}: ExportExcelButtonProps) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (e: React.MouseEvent<HTMLButtonElement>) => {
    try {
      setIsExporting(true);
      onClick?.(e);
      const finalConfig = typeof config === "function" ? await config() : config;
      await exportToExcel(finalConfig);
    } catch (error) {
      console.error("Excel export failed:", error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      size={size}
      onClick={handleExport}
      disabled={isExporting || disabled}
      className={`
        bg-[#107C41] hover:bg-[#0e6b38] active:bg-[#0b5c31]
        text-white text-sm font-medium
        border border-[#0b5c31]
        rounded-md px-3 h-9
        flex items-center gap-2
        transition-colors duration-150
        disabled:opacity-60 disabled:cursor-not-allowed
        ${className}
      `}
      {...props}
    >
      {isExporting ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
      ) : (
        <FileSpreadsheet className="h-4 w-4 shrink-0" />
      )}
      {children || t("actions.export")}
    </Button>
  );
}