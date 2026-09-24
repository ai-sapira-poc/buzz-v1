import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import type { TowerFailure } from "@/features/tower/ui/portfolioState";
import { clockUtc } from "./panelClock";

/**
 * P3's fall notices. They belong to the **handoff read**, never to the
 * portfolio's: the two reads fail independently, so the handoff column cannot
 * borrow the portfolio's phrase (design §1.1 rule 2). One sentence per read.
 *
 * Both notices print the hour through {@link clockUtc}, the panel's one UTC
 * clock: the cell's provenance line, this notice and the portfolio's stale
 * banner name the same instant the same way.
 */

/**
 * The handoff read failed with nothing to preserve. The column is retired
 * whole, so this notice is the only place the operator can learn that the
 * absence of the column means a dead read, not "nothing was registered". The
 * citable code travels when the adapter produced one — never coined when it did
 * not (design §1.1 rule 3).
 */
export function PanelHandoverFallNotice({
  failure,
  onRetry,
}: {
  failure: TowerFailure | null;
  onRetry: () => void;
}) {
  const code = failure?.code ?? null;
  return (
    <Alert
      className="flex flex-col gap-1.5"
      data-testid="panel-handover-fall"
      variant="destructive"
    >
      <AlertTitle>No se pudo leer la fuente de relevos</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>
          {code === null
            ? "Motivo: el adaptador no expuso un código de fallo. "
            : null}
          {"La columna «Resultado del padre» no se muestra: esto no significa "}
          {"«sin padre registrado». Un relevo de la fuente nunca se convierte "}
          {"en lista vacía."}
        </span>
        {code === null ? null : (
          <code className="font-mono text-2xs text-muted-foreground">
            code: {code}
          </code>
        )}
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
 * The handoff read failed over a previous good one: the rows stay and this
 * notice says so, naming the failure and the last good read. Each cell of the
 * column then carries its own provenance line, so a preserved value cannot be
 * read as the value of now (design §1.1, decision 1).
 */
export function PanelHandoverStaleNotice({
  failure,
  lastSuccessAt,
  onRetry,
}: {
  failure: TowerFailure | null;
  lastSuccessAt: string | null;
  onRetry: () => void;
}) {
  const code = failure?.code ?? null;
  const good = clockUtc(lastSuccessAt);
  return (
    <Alert className="flex flex-col gap-1.5" data-testid="panel-handover-stale">
      <AlertTitle>La lectura de relevos falló</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>
          {good === null
            ? "«Resultado del padre» muestra la última lectura buena: datos viejos, no actuales."
            : `«Resultado del padre» muestra la última lectura buena, de las ${good} UTC: datos viejos, no actuales.`}
        </span>
        {code === null ? null : (
          <code className="font-mono text-2xs text-muted-foreground">
            code: {code}
          </code>
        )}
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
