import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import type { TowerFailure } from "@/features/tower/ui/portfolioState";
import { clockUtc } from "./panelClock";

/**
 * The panel read failed and there is no previous snapshot. A failed read is
 * never drawn as empty: no figure is shown, and the motive travels with the
 * error — the adapter's own message plus the citable code it produced, when it
 * produced one — so the operator can tell "nothing here" from "it broke".
 * `Alert` already carries `role="alert"` in this design system, so no second
 * role is added.
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
        {/* The citable code the adapter produced. `null` means it supplied
            none: the notice then says nothing rather than coining one. */}
        {failure?.code ? (
          <code className="font-mono text-2xs text-muted-foreground">
            code: {failure.code}
          </code>
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
 * top, that they are old — and which failure produced them, by its citable code.
 * The error never replaces the list with the empty state (D-9).
 *
 * The instant it names is the same `HH:MM` UTC the row's provenance line prints
 * (design §1 asks the notice for «las `<HH:MM>` UTC»): one hour cannot reach the
 * operator in two formats on one screen. An unparseable instant is named without
 * an hour rather than shown as the raw ISO.
 */
export function PanelStaleBanner({
  lastSuccessAt,
  lastGoodWasEmpty = false,
  code,
  onRetry,
}: {
  lastSuccessAt: string | null;
  /**
   * The preserved snapshot held no encargos. The banner then cannot promise
   * rows below it, and must not borrow the empty state's «the source answered»
   * copy — that is the claim a fall withholds.
   */
  lastGoodWasEmpty?: boolean;
  /** The adapter's citable failure code, or `null` when it gave none. */
  code: string | null;
  onRetry: () => void;
}) {
  const clock = clockUtc(lastSuccessAt);
  const from = clock === null ? "" : `, de ${clock} UTC`;
  return (
    <Alert className="flex flex-col gap-1.5" data-testid="panel-stale-banner">
      <AlertTitle>La lectura de encargos falló</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>
          {lastGoodWasEmpty
            ? clock
              ? `La última lectura buena${from}, no encontró encargos. La lectura falló, así que esta pantalla no puede decir si ahora hay alguno ni cuántos.`
              : "La última lectura buena no encontró encargos. La lectura falló, así que esta pantalla no puede decir si ahora hay alguno ni cuántos."
            : clock
              ? `Se muestra la última lectura buena${from}. Las filas de abajo son datos viejos, no actuales.`
              : "Se muestra la última lectura buena. Las filas de abajo son datos viejos, no actuales."}
        </span>
        {code ? (
          <code className="font-mono text-2xs text-muted-foreground">
            code: {code}
          </code>
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
