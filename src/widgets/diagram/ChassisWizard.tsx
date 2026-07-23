import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";

import { commands, unwrap } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError } from "@/shared/lib/notify";
import { fmtNumber } from "@/shared/lib/numbers";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

/** No chassis yet: pick the configuration and generate it (client Rust owns
 * the geometry/codes; the server receives the rows through the outbox). */
export function ChassisWizard({ vehicleId }: { vehicleId: number }) {
  const { t, i18n } = useTranslation();
  const [driveAxles, setDriveAxles] = useState(2);
  const [trailerAxles, setTrailerAxles] = useState(4);
  const [spares, setSpares] = useState(2);

  const create = useDomainMutation(
    () =>
      unwrap(
        commands.chassisCreate(vehicleId, {
          drive_axles: driveAxles,
          trailer_axles: trailerAxles,
          spares,
          single_trailer_axles: null,
        }),
      ),
    { onError: notifyError },
  );

  const counter = (
    label: string,
    value: number,
    set: (n: number) => void,
    min: number,
    max: number,
  ) => (
    <div className="flex items-center justify-between rounded-xl border p-4">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={value <= min}
          onClick={() => set(value - 1)}
          aria-label={t("chassis.decrement", { label })}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-6 text-center text-lg font-bold tabular">
          {fmtNumber(value, i18n.language)}
        </span>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={value >= max}
          onClick={() => set(value + 1)}
          aria-label={t("chassis.increment", { label })}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="text-base">{t("diagram.onboard.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("truck.chassisMissing")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="mb-1 text-xs font-semibold text-muted-foreground">
          {t("diagram.onboard.config")}
        </div>
        {counter(t("diagram.onboard.driveAxles"), driveAxles, setDriveAxles, 1, 2)}
        {counter(t("diagram.onboard.trailerAxles"), trailerAxles, setTrailerAxles, 0, 5)}
        {counter(t("diagram.onboard.spares"), spares, setSpares, 0, 2)}
        <Button className="w-full" disabled={create.isPending} onClick={() => create.mutate()}>
          {t("diagram.onboard.create")}
        </Button>
      </CardContent>
    </Card>
  );
}
