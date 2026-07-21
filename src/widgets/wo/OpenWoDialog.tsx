import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";

import { commands, unwrap, type OdoTruth } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

const schema = z.object({
  odometer: z
    .string()
    .min(1, "common.requiredField")
    .regex(/^[0-9٠-٩۰-۹]+$/, "common.requiredField"),
});
type FormValues = z.infer<typeof schema>;

function toAsciiDigits(s: string): number {
  const ascii = s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
  return Number(ascii);
}

/** Opening a WO always captures the odometer — it feeds the odometer-truth
 * view that the whole due engine leans on. Prefilled from the best reading. */
export function OpenWoDialog({
  vehicleId,
  odometer,
  trigger,
}: {
  vehicleId: number;
  odometer: OdoTruth | null | undefined;
  trigger?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: { odometer: odometer ? String(odometer.km) : "" },
  });

  const mutation = useDomainMutation(
    (values: FormValues) => unwrap(commands.woOpen(vehicleId, toAsciiDigits(values.odometer))),
    {
      onSuccess: (id) => {
        setOpen(false);
        void navigate({ to: "/wo/$woId", params: { woId: id } });
      },
      onError: notifyError,
    },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4" />
            {t("truck.openWo")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("truck.openWoTitle")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.stopPropagation();
            void handleSubmit((v) => mutation.mutate(v))(e);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="odometer">{t("truck.odometerPrompt")}</Label>
            <Input id="odometer" inputMode="numeric" autoFocus className="tabular" {...register("odometer")} />
            {odometer && (
              <p className="text-xs text-muted-foreground">
                {t("truck.odometerHint", {
                  km: fmtNumber(odometer.km, i18n.language),
                  source: t(`truck.odometerSource.${odometer.source}`),
                })}
              </p>
            )}
            {errors.odometer?.message && (
              <p className="text-xs text-destructive">{t(errors.odometer.message)}</p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {t("truck.openWo")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
