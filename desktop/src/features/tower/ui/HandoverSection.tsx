import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import type {
  HandoverParentOutcome,
  HandoverRow,
} from "@/features/tower/domain/handover";
import type { HandoverView } from "./handoverState";

/**
 * The handoff section ("el relevo").
 *
 * It answers one decision: can a child's work rest on the parent's conclusion?
 * The row is a class of the activity feed, not a new surface, so the section
 * reuses the module's established shape — a five-column list with its own
 * loading, empty and error branches, kept mutually unreadable.
 *
 * The window is named in text rather than a figure: a `0` would read as "no
 * handoffs", which is a different claim from "the source returned no rows".
 */

const CELL = "px-3 py-2.5 align-top text-sm";

const OUTCOME_LABEL: Record<HandoverParentOutcome, string> = {
  done: "terminó",
  failed: "falló",
  cancelled: "se canceló",
  // Never "no hubo traspaso": the parent's end could not be read.
  unknown: "sin resultado registrado",
};

/** ISO instant to a stable, locale-independent label (no fabricated timezone). */
function formatInstant(iso: string | null): string {
  if (iso === null) return "sin instante registrado";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "sin instante registrado";
  return iso.slice(0, 16).replace("T", " ");
}

function ThreadCell({ row }: { row: HandoverRow }) {
  if (row.thread === null) {
    return <span className="text-muted-foreground">sin hilo</span>;
  }
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate font-mono text-2xs">{row.thread.channel}</span>
      {row.thread.eventId === null ? (
        <span className="text-2xs text-muted-foreground">
          el hilo no se pudo abrir (el id del hilo no se publica)
        </span>
      ) : null}
    </span>
  );
}

function HandoverRowItem({ row }: { row: HandoverRow }) {
  return (
    <tr
      className="border-b border-border/50 last:border-b-0"
      data-testid="tower-handover-row"
    >
      <td className={CELL}>{row.sender.name ?? "Agente sin nombre"}</td>
      <td className={CELL}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate">
            {row.child.name ?? "Rol sin registrar"}
          </span>
          <span className="truncate font-mono text-2xs text-muted-foreground">
            {row.child.jobId}
          </span>
        </span>
      </td>
      <td className={CELL}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate">{row.sender.jobId}</span>
          <span className="text-2xs text-muted-foreground">
            {OUTCOME_LABEL[row.parentOutcome]}
          </span>
        </span>
      </td>
      <td className={CELL}>{formatInstant(row.transferredAt)}</td>
      <td className={CELL}>
        <ThreadCell row={row} />
      </td>
    </tr>
  );
}

function HandoverLoadingState() {
  const rows = ["one", "two", "three"] as const;
  return (
    <div
      aria-busy="true"
      className="overflow-hidden rounded-xl border border-border/70 bg-card/40"
      data-testid="tower-handover-loading"
    >
      {/* The three states are told apart by text, not only by shape: a bare
          skeleton is indistinguishable from a surface that never loaded. */}
      <p className="border-b border-border/50 px-3 py-2.5 text-sm text-muted-foreground">
        Leyendo los relevos…
      </p>
      {rows.map((row) => (
        <div
          className="grid gap-2 border-b border-border/50 px-3 py-2.5 last:border-b-0 sm:grid-cols-5 sm:gap-3"
          key={row}
        >
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      ))}
    </div>
  );
}

function HandoverEmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 px-4 py-12 text-center"
      data-testid="tower-handover-empty"
    >
      <p className="text-sm font-medium">
        No hay ningún relevo en esta ventana
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        La fuente respondió que no hay traspasos registrados en la ventana de la
        sesión. Se deshace solo en cuanto un job padre publique un handoff. Un
        vacío aquí no es un cero, y no es un fallo de lectura.
      </p>
    </div>
  );
}

function HandoverErrorState({
  code,
  onRetry,
}: {
  code: string | null;
  onRetry: () => void;
}) {
  return (
    <Alert
      className="flex flex-col gap-1.5"
      data-testid="tower-handover-error"
      variant="destructive"
    >
      <AlertTitle>No se pudo leer el registro de relevos</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>
          El origen no respondió, así que no se sabe si hay relevos. Un fallo de
          lectura no se dibuja como una lista vacía.
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
          Reintentar
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * A rejection after a previous read (design spec §3, R6): the failure stays
 * visible above the old rows instead of borrowing the empty state's meaning.
 * Kept local rather than reusing the portfolio's banner because this section's
 * copy is Spanish, like its rows and its other two branches.
 */
function HandoverStaleNotice({
  lastSuccessAt,
  onRetry,
}: {
  lastSuccessAt: string | null;
  onRetry: () => void;
}) {
  const readAt =
    lastSuccessAt === null
      ? null
      : lastSuccessAt.slice(0, 16).replace("T", " ");
  return (
    <Alert className="flex flex-col gap-1.5" data-testid="tower-handover-stale">
      <AlertTitle>El registro de relevos no responde</AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        <span>
          {readAt === null
            ? "Se muestra la última lectura; no es actual, y no se sabe si hay relevos nuevos."
            : `Se muestra la lectura de ${readAt}; no es actual, y no se sabe si hay relevos nuevos.`}
        </span>
        <Button
          className="self-start"
          onClick={onRetry}
          type="button"
          variant="outline"
        >
          Reintentar
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function announcementFor(view: HandoverView): string {
  if (view.phase === "loading") {
    return view.lines === null ? "Leyendo los relevos" : "Relevos actualizados";
  }
  if (view.phase === "unreachable") {
    return "No se pudo leer el registro de relevos";
  }
  if (view.lines === null || view.lines.length === 0) {
    return "No hay relevos en esta ventana";
  }
  return `${view.lines.length} relevos`;
}

export function HandoverSection({ view }: { view: HandoverView }) {
  const { lines } = view;
  const hasRows = lines !== null && lines.length > 0;
  // A rejection after a previous read keeps the failure visible: it never
  // borrows the empty state's meaning (design spec §3, R6).
  const showingStale = view.phase === "unreachable" && lines !== null;

  return (
    <section aria-label="El relevo" className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">El relevo</h2>
      <p className="text-sm text-muted-foreground">
        Quién pasó qué encargo a quién, cuándo, con el resultado terminal del
        job padre.
      </p>
      <p
        aria-live="polite"
        className="sr-only"
        data-testid="tower-handover-announcement"
      >
        {announcementFor(view)}
      </p>
      {showingStale ? (
        <HandoverStaleNotice
          lastSuccessAt={view.lastSuccessAt}
          onRetry={view.retry}
        />
      ) : null}
      {view.phase === "loading" && lines === null ? (
        <HandoverLoadingState />
      ) : null}
      {lines !== null && lines.length === 0 ? <HandoverEmptyState /> : null}
      {view.phase === "unreachable" && lines === null ? (
        <HandoverErrorState
          code={view.failure?.code ?? null}
          onRetry={view.retry}
        />
      ) : null}
      {hasRows && lines !== null ? (
        <div
          className="overflow-x-auto rounded-xl border border-border/70 bg-card/40"
          data-testid="tower-handover-table"
        >
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Relevos recientes: emisor, encargo hijo, job padre y su resultado,
              instante e hilo.
            </caption>
            <thead>
              <tr className="border-b border-border/50 bg-muted/40 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className={CELL} scope="col">
                  Quién entregó
                </th>
                <th className={CELL} scope="col">
                  A quién / encargo hijo
                </th>
                <th className={CELL} scope="col">
                  Sobre qué encargo / resultado del padre
                </th>
                <th className={CELL} scope="col">
                  Cuándo
                </th>
                <th className={CELL} scope="col">
                  Dónde se discutió
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((row) => (
                <HandoverRowItem key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
