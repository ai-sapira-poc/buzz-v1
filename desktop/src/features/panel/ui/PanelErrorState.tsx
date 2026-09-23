import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import type { TowerFailure } from "@/features/tower/ui/portfolioState";

/**
 * The panel read failed and there is no previous snapshot. A failed read is
 * never drawn as empty: no figure is shown, and the motive travels with the
 * error so the operator can tell "nothing here" from "it broke". `Alert` already
 * carries `role="alert"` in this design system, so no second role is added.
 */
export function PanelErrorState({
  failure,
  onRetry,
}: {
  failure: TowerFailure | null;
  onRetry: () => void;
}) {
  return (
    <Alert
      className="flex flex-col gap-1.5"
      data-testid="panel-error-state"
      variant="destructive"
    >
      <AlertTitle>No se pudo leer el registro de encargos</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>
          La fuente rechazó la lectura en lugar de devolver una lista vacía. No
          se muestra ninguna cifra.
        </span>
        {failure?.message ? (
          <span>
            Motivo:{" "}
            <code className="font-mono text-2xs">{failure.message}</code>
          </span>
        ) : null}
        <Button
          className="self-start"
          onClick={onRetry}
          type="button"
          variant="outline"
        >
          Reintentar lectura
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * The read failed but a previous one is on screen: keep the rows and say, at the
 * top, that they are old. The error never replaces the list with the empty
 * state (D-9).
 */
export function PanelStaleBanner({
  lastSuccessAt,
  onRetry,
}: {
  lastSuccessAt: string | null;
  onRetry: () => void;
}) {
  return (
    <Alert className="flex flex-col gap-1.5" data-testid="panel-stale-banner">
      <AlertTitle>La lectura de encargos falló</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>
          {lastSuccessAt
            ? `Se muestra la última lectura buena, de ${lastSuccessAt}. Las filas de abajo son datos viejos, no actuales.`
            : "Se muestra la última lectura buena. Las filas de abajo son datos viejos, no actuales."}
        </span>
        <Button
          className="self-start"
          onClick={onRetry}
          type="button"
          variant="outline"
        >
          Reintentar lectura
        </Button>
      </AlertDescription>
    </Alert>
  );
}
