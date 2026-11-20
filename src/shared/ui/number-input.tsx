import * as React from "react";

import { sanitizeNumberTyping } from "@/shared/lib/numbers";
import { Input } from "@/shared/ui/input";

/** A text field for a number. It is a TEXT input on purpose: `type="number"`
 * rejects Arabic-Indic digits and the comma decimal mark, which is how the
 * people using this app type. Parse the value with `parseIntInput` /
 * `parseDecimalInput`. `inputMode` brings up the numeric keyboard on phones. */
export function NumberInput({
  value,
  onValueChange,
  decimal = false,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (v: string) => void;
  decimal?: boolean;
}) {
  return (
    <Input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      dir="ltr"
      value={value}
      onChange={(e) => onValueChange(sanitizeNumberTyping(e.target.value, decimal))}
      {...props}
      className={["text-start tabular", props.className].filter(Boolean).join(" ")}
    />
  );
}
