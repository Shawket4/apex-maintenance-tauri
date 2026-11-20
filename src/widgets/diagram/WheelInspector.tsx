import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ClipboardList, Loader2, Undo2 } from "lucide-react";

import { commands, unwrap, type AxleRow, type PositionRow } from "@/shared/api/client";
import { useDomainMutation } from "@/shared/api/queries";
import { notifyError, notifySuccess } from "@/shared/lib/notify";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Skeleton } from "@/shared/ui/skeleton";
import { tireName } from "@/widgets/TruckDiagram/layout";

import { DismountForm } from "./DismountSheet";
import { MountForm } from "./MountSheet";
import { OnboardForm } from "./OnboardCard";
import { InspectorShell, RadioCard, TireSummary } from "./Workbench";

/** Where the inspector is being used:
 *  - on the truck's tire tab (no work order in hand; `openWoId` is the
 *    truck's open work order, if it has one);
 *  - inside a work order (tire work is allowed only while it is open). */
export type InspectorMode =
  | { kind: "truck"; openWoId: string | null; /** Still looking the open work order up. */ checking: boolean }
  | { kind: "wo"; woId: string; open: boolean };

type Intent = "fit" | "register";

/**
 * Everything that can be done with ONE wheel, the same on both screens.
 *
 * An empty wheel always offers the two intents by name — register a tire
 * that is already on the truck (no stock change) or fit a tire (work order,
 * stock) — so the same click never silently means different things.
 * An occupied wheel always shows the tire and its ways out: dismount, or
 * cancel a mount that was a mistake.
 */
export function WheelInspector({
  position,
  axles,
  positions,
  vehicleId,
  truckOdometer,
  mode,
  preferredSize,
  previousTireId,
  recentTireIds,
  onClose,
  onSaved,
  onDirtyChange,
}: {
  position: PositionRow;
  axles: AxleRow[];
  positions: PositionRow[];
  vehicleId: number;
  truckOdometer: number | null;
  mode: InspectorMode;
  /** The size this wheel most likely takes (its axle's / the truck's other tires). */
  preferredSize: string | null;
  /** The tire last taken off THIS wheel in this work order, if any. */
  previousTireId: string | null;
  /** Tires taken off this truck in this work order. */
  recentTireIds: readonly string[];
  /** The close button (asks first if a form has typed-in data). */
  onClose: () => void;
  /** After a successful save: close without asking. */
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const woId = mode.kind === "wo" && mode.open ? mode.woId : null;
  // Inside an open work order "fit" is the expected job, so it starts chosen
  // (still labelled, still switchable). On the truck tab nothing is assumed.
  const [intent, setIntent] = useState<Intent | null>(woId ? "fit" : null);

  const choose = (i: Intent) => {
    if (i === intent) return;
    onDirtyChange(false); // the other form's typed data goes with it
    setIntent(i);
  };

  const emptyRoad = positions.filter((p) => !p.tire_id && !p.is_spare);

  return (
    <InspectorShell position={position} axles={axles} onClose={onClose}>
      {position.tire_id ? (
        <>
          <TireSummary position={position} currentKm={truckOdometer} />
          <Link
            to="/tires/$tireId"
            params={{ tireId: position.tire_id }}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            {t("diagram.tire.file")}
            <ArrowLeft aria-hidden className="h-4 w-4 ltr:-scale-x-100" />
          </Link>

          {position.assignment_id && (
            <>
              <section className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-bold">{t("diagram.dismount.title")}</h3>
                {woId ? (
                  <DismountForm
                    key={position.assignment_id}
                    position={position}
                    workOrderId={woId}
                    defaultOdometer={truckOdometer}
                    onDone={onSaved}
                    onDirtyChange={onDirtyChange}
                  />
                ) : (
                  <NeedWorkOrder mode={mode} vehicleId={vehicleId} positionId={position.id} action="dismount" />
                )}
              </section>

              <section className="space-y-2 border-t pt-4">
                <h3 className="text-sm font-bold">{t("diagram.undoMount.heading")}</h3>
                <UndoMount position={position} onDone={onSaved} />
              </section>
            </>
          )}
        </>
      ) : (
        <>
          <div className="space-y-2">
            <div id="wheel-intent" className="text-sm font-semibold">
              {t("diagram.intent.prompt")}
            </div>
            <div role="radiogroup" aria-labelledby="wheel-intent" className="grid gap-2">
              <RadioCard
                checked={intent === "fit"}
                onSelect={() => choose("fit")}
                title={t("diagram.intent.fit")}
                description={t("diagram.intent.fitDesc")}
              />
              <RadioCard
                checked={intent === "register"}
                onSelect={() => choose("register")}
                title={t("diagram.intent.register")}
                description={t("diagram.intent.registerDesc")}
              />
            </div>
          </div>

          {intent === "fit" && (
            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-bold">{t("diagram.intent.fit")}</h3>
              {woId ? (
                <MountForm
                  key={position.id}
                  position={position}
                  vehicleId={vehicleId}
                  workOrderId={woId}
                  defaultOdometer={truckOdometer}
                  preferredSize={preferredSize}
                  previousTireId={previousTireId}
                  recentTireIds={recentTireIds}
                  onDone={onSaved}
                  onDirtyChange={onDirtyChange}
                />
              ) : (
                <NeedWorkOrder mode={mode} vehicleId={vehicleId} positionId={position.id} action="fit" />
              )}
            </section>
          )}

          {intent === "register" && (
            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-bold">{t("diagram.intent.register")}</h3>
              <OnboardForm
                key={position.id}
                position={position}
                vehicleId={vehicleId}
                emptyRoadPositions={emptyRoad}
                defaultOdometer={truckOdometer}
                onDone={onSaved}
                onDirtyChange={onDirtyChange}
              />
            </section>
          )}
        </>
      )}
    </InspectorShell>
  );
}

/** Fitting and dismounting need an open work order. Say so, and give the
 * way there: the truck's open work order at this wheel, the truck page to
 * open one, or reopening this closed work order. */
function NeedWorkOrder({
  mode,
  vehicleId,
  positionId,
  action,
}: {
  mode: InspectorMode;
  vehicleId: number;
  positionId: string;
  action: "fit" | "dismount";
}) {
  const { t } = useTranslation();
  const reopen = useDomainMutation(
    () => unwrap(commands.woReopen(mode.kind === "wo" ? mode.woId : "")),
    { onSuccess: () => notifySuccess(t("diagram.needWo.reopened")), onError: notifyError },
  );

  const box = "space-y-3 rounded-lg border border-status-due_soon/40 bg-status-due_soon-soft p-3";
  const lead = (text: string) => (
    <p className="flex items-start gap-2 text-sm leading-relaxed">
      <ClipboardList aria-hidden className="mt-0.5 h-4 w-4 flex-none text-status-due_soon" />
      <span>{text}</span>
    </p>
  );

  if (mode.kind === "wo") {
    return (
      <div className={box}>
        {lead(t("diagram.needWo.closed"))}
        <Button className="w-full" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
          {reopen.isPending && <Loader2 className="animate-spin" />}
          {t("diagram.needWo.reopen")}
        </Button>
      </div>
    );
  }

  if (mode.checking) return <Skeleton className="h-24 w-full rounded-lg" />;

  if (mode.openWoId) {
    return (
      <div className={box}>
        {lead(t(action === "fit" ? "diagram.needWo.hasOpenFit" : "diagram.needWo.hasOpenDismount"))}
        <Button asChild className="h-auto min-h-11 w-full whitespace-normal py-2">
          <Link to="/wo/$woId/tires" params={{ woId: mode.openWoId }} search={{ pos: positionId }}>
            {t("diagram.needWo.goOpen")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={box}>
      {lead(t(action === "fit" ? "diagram.needWo.noneFit" : "diagram.needWo.noneDismount"))}
      <Button asChild className="h-auto min-h-11 w-full whitespace-normal py-2">
        <Link to="/trucks/$truckId" params={{ truckId: String(vehicleId) }}>
          {t("diagram.needWo.goTruck")}
        </Link>
      </Button>
    </div>
  );
}

/** "This was fitted by mistake": removes the mount as if it never happened.
 * What happens to the tire depends on where it came from, and is said
 * before confirming. */
function UndoMount({ position, onDone }: { position: PositionRow; onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const undo = useDomainMutation(() => unwrap(commands.mountUndo(position.assignment_id!)), {
    onSuccess: () => {
      setOpen(false);
      notifySuccess(t("diagram.undoMount.done"));
      onDone();
    },
    onError: (e) => {
      setOpen(false);
      notifyError(e);
    },
  });
  const outcome =
    position.mount_reason === "new" ? "backToNew" : position.mount_reason === "onboard" ? "forget" : "backToUsed";

  return (
    <>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("diagram.undoMount.explain")}</p>
      <Button
        variant="outline"
        className="h-auto min-h-11 w-full whitespace-normal py-2 text-destructive hover:text-destructive"
        disabled={undo.isPending}
        onClick={() => setOpen(true)}
      >
        {undo.isPending ? <Loader2 className="animate-spin" /> : <Undo2 aria-hidden />}
        {t("diagram.undoMount.button")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("diagram.undoMount.title")}
        description={t(`diagram.undoMount.${outcome}`, {
          tire: tireName(position) || t("diagram.tire.unknownBrand"),
        })}
        confirmLabel={t("diagram.undoMount.confirm")}
        destructive
        pending={undo.isPending}
        onConfirm={() => undo.mutate()}
      />
    </>
  );
}
