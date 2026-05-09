import * as React from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Input, type InputProps } from "./input";
import { cn } from "@/shared/lib/cn";

export interface SearchInputProps extends InputProps {
  onSearch?: (value: string) => void;
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, value, onChange, placeholder, onSearch, ...props }, ref) => {
    const { t } = useTranslation();

    return (
      <div className="relative w-full">
        <Search
          className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"
          aria-hidden="true"
        />
        <Input
          ref={ref}
          type="search"
          value={value}
          onChange={onChange}
          placeholder={placeholder || t("actions.search")}
          className={cn("ps-9 text-start", className)}
          dir="auto"
          {...props}
        />
      </div>
    );
  },
);
SearchInput.displayName = "SearchInput";

export { SearchInput };
