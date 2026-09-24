import type * as React from "react";

import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import type { HandoverParentOutcome } from "@/features/tower/domain/handover";
import type { WorkState } from "@/features/tower/domain/portfolio";
import type { PanelRow } from "@/features/panel/domain/panel";
import { formatRecency } from "@/features/tower/ui/portfolioFormat";
import { clockUtc } from "./panelClock";
import {
  PANEL_GRID,
  PANEL_GRID_NO_HANDOFF,
  type HandoverColumnState,
} from "./panelLayout";

/**
 * Cell literals. Every absence carries text — a blank cell would tell the
 * operator nothing about which of "nothing here", "it broke" or "still loading"
 * they are looking at (D-5) — and a `0` would be a figure the panel cannot
 * support.
 */
const WORK_STATE_TEXT: Record<WorkState, string> = {
  requested: "Solicitado",
  running: "En curso",
  done: "Terminado",
  failed: "Falló",
  cancelled: "Cancelado",
};

/**
 * P3's closed vocabulary (design §1, panel P3): the only values the handoff
 * cell may draw with a healthy read are `done`, `cancelled` and `desconocido`.
 *
 * D4-3 forbids the fourth: «falló el padre» has no producer — the failure
 * branches never publish a handoff — so a parent whose only readable terminal
 * event is an error must not be drawn as a failed parent. The closed vocabulary
 * has no value for it, so `failed` reads as `desconocido`, like an outcome that
 * could not be read at all. Neither asserts a conclusion the source never
 * produced.
 */
const OUTCOME_VALUE: Record<HandoverParentOutcome, string> = {
  done: "done",
  cancelled: "cancelled",
  failed: "desconocido",
  unknown: "desconocido",
};

/** The three drawable values, as the guard test reads them from the DOM. */
export const HANDOVER_DRAWABLE_VALUES = [
  "done",
  "cancelled",
  "desconocido",
] as const;

/** The thread cell's own line when the handoff read failed. */
const UNREADABLE_HANDOVERS = "El registro de relevos no se pudo leer.";

/**
/**
 * The **Espera** cell's provenance line, printed while the section's portfolio
 * read is down over a snapshot (design §2.4, rama B). Without it the preserved
 * snapshot's value — «sin señal de espera registrada» for a row that carried no
 * wait event — would be read as «nothing waits» over a read that never
 * answered. With it the value travels marked as old, and with the hour of the
 * read it came from.
 */
function waitProvenanceLine(lastGoodAt: string | null): string {
  const clock = clockUtc(lastGoodAt);
  const from = clock === null ? "" : `, de las ${clock} UTC`;
  return `Dato de la última lectura buena${from}. La lectura actual falló: esto es un dato viejo, no actual.`;
}

/**
 * The **Resultado del padre** cell's own provenance line, printed while the
 * handoff read is down over a snapshot (design §1.1, decision 1). It names the
 * read it came from («de relevos») because the section can be showing the
 * portfolio's stale line at the same time. Without it a preserved value would
 * read as the value of now, over a read that never answered.
 */
function handoffProvenanceLine(lastSuccessAt: string | null): string {
  const clock = clockUtc(lastSuccessAt);
  const from = clock === null ? "" : `, de las ${clock} UTC`;
  return `Dato de la última lectura de relevos buena${from}. La lectura actual falló: esto es un dato viejo, no actual.`;
}

/**
 * The **Resultado del padre** cell (P3). Its values are the read's closed
 * vocabulary; the cell never names the parent's end as a failure (D4-3), and
 * never turns a read that failed into an absence: with the read down and no
 * snapshot the whole column is retired, so this component is not reached.
 */
function HandoverCell({
  parent,
  column,
}: {
  parent: PanelRow["parent"];
  column: HandoverColumnState;
}) {
  if (column.state === "loading") {
    return (
      <div
        className="flex min-w-0 flex-col gap-0.5"
        data-testid="panel-handover-cell"
      >
        {/* Visible text, not a bare skeleton: the header and this line are how
            a load is told from an absence (design §1, surface 6). */}
        <span className="text-sm text-muted-foreground">
          Leyendo relevos — aún buscando, no es un vacío
        </span>
      </div>
    );
  }

  const outcome = parent?.outcome ?? null;
  const value =
    outcome === "done" || outcome === "cancelled"
      ? OUTCOME_VALUE[outcome]
      : OUTCOME_VALUE.unknown;
  const why =
    parent !== null && (outcome === "done" || outcome === "cancelled")
      ? `El relevo cerró con el padre en \`${value}\`.`
      : parent === null
        ? "Sin relevo registrado para este encargo: el valor dibujable es `desconocido`."
        : "No hay un desenlace del padre registrado que se pueda dibujar: el valor dibujable es `desconocido`.";

  return (
    <div
      className="flex min-w-0 flex-col gap-0.5"
      data-testid="panel-handover-cell"
    >
      <span className="truncate text-sm">
        {parent === null ? "sin relevo registrado" : parent.jobId}
      </span>
      <Badge
        className="self-start"
        data-testid="panel-handover-outcome"
        variant={
          value === "done"
            ? "success"
            : value === "cancelled"
              ? "secondary"
              : "outline"
        }
      >
        {value}
      </Badge>
      <span className="text-2xs text-muted-foreground">{why}</span>
      {column.state === "stale" ? (
        <span
          className="text-2xs text-amber-600 dark:text-amber-400"
          data-testid="panel-handover-stale"
        >
          {handoffProvenanceLine(column.lastSuccessAt)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The **Espera** cell. It is not a blocked column and it is never a figure: it
 * names the recorded reason and its instant, or — when nothing is recorded — it
 * says "sin señal" and says why that is not "nothing waits". The producer of
 * the wait is best-effort, so absence of the event is not evidence of absence
 * of the wait.
 *
 * The cell's loading state is the section's, not the row's — a read still in
 * flight never draws rows. Its **error** state is not: a fall that keeps a
 * previous snapshot draws the rows and the stale banner, so this cell can be on
 * screen over a read that failed. Both shapes of the cell then mark the
 * snapshot's own value as old (design §2.4, rama B) rather than leaving it
 * bare — the empty one and the one that carries a recorded wait. Without the
 * line a bare «sin señal», or a wait's «Desde <instante>», would be read as the
 * state *now* when the truth is that nobody asked.
 *
 * `orphan` is the case the panel would lose by folding silently: the wait
 * arrived without the job's lifecycle event (a publication that died on the
 * relay leaves exactly that). It is **reported**, not discarded, with the
 * sentence §7 case 5 fixes — so a wait from a job the window never saw is not
 * drawn as the ordinary wait of an active job.
 */
function WaitingCell({
  waiting,
  orphan,
  readFailed,
  lastGoodAt,
}: {
  waiting: PanelRow["waiting"];
  orphan: boolean;
  /** The portfolio read failed: the cell must not claim the current state. */
  readFailed: boolean;
  /** The instant of the last good portfolio read, when there is one. */
  lastGoodAt: string | null;
}) {
  if (waiting === null) {
    return readFailed ? (
      // §2.4 rama B: the snapshot's own value, then the line that marks it old.
      // The healthy empty's caveat («esto no significa que nada espere») is not
      // drawn: it would be a claim about now, which the failed read withholds.
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-muted-foreground">
          Sin señal de espera registrada
        </span>
        <span className="text-2xs text-muted-foreground">
          {waitProvenanceLine(lastGoodAt)}
        </span>
      </div>
    ) : (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-muted-foreground">Sin señal</span>
        <span className="text-2xs text-muted-foreground">
          Sin señal de espera registrada. Esto no significa que nada espere.
        </span>
      </div>
    );
  }
  const cause =
    waiting.reason === "ladder_exhausted"
      ? "El ladder automático se agotó y el siguiente movimiento es del operador."
      : "El encargo necesita una capacidad que el agente no tiene.";
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <Badge variant="warning">Espera registrada</Badge>
      {orphan ? (
        <span className="text-2xs text-muted-foreground">
          Espera registrada para un encargo sin actividad en la ventana.
        </span>
      ) : null}
      <span className="truncate font-mono text-2xs text-muted-foreground">
        {waiting.reason}
      </span>
      <span className="text-2xs text-muted-foreground">{cause}</span>
      <span className="text-2xs text-muted-foreground">Desde {waiting.at}</span>
      {readFailed ? (
        <span className="text-2xs text-muted-foreground">
          {waitProvenanceLine(lastGoodAt)}
        </span>
      ) : null}
    </div>
  );
}

type PanelRowProps = {
  row: PanelRow;
  /** True when the handoff read failed: the thread cell must say so. */
  handoversUnreadable: boolean;
  /** P3's column state for this render, shared by every row. */
  handoverColumn: HandoverColumnState;
  /** True when the portfolio read failed: the wait cell must not claim now. */
  readFailed: boolean;
  /** The instant of the last good portfolio read, when there is one. */
  lastGoodAt: string | null;
} & React.ComponentPropsWithoutRef<"li">;

/**
 * One encargo, read as a sentence: the agent is the actor, the declared task is
 * the object, the recorded wait is the outcome. It is the `PortfolioRow` pattern
 * **without its blocked cell**: this row never renders `blocked`, so it cannot
 * inherit the `0 · observed` figure the Tower row derives from `failed`.
 */
export const PanelRowView = ({
  row,
  handoversUnreadable,
  handoverColumn,
  readFailed,
  lastGoodAt,
  className,
  ...rest
}: PanelRowProps) => {
  const recency = formatRecency(row.lastEventAt);
  const handoffRetired = handoverColumn.state === "retired";
  const eventText = [
    "Último evento publicado",
    row.workState === null ? null : WORK_STATE_TEXT[row.workState],
    recency,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <li
      className={cn(
        `${handoffRetired ? PANEL_GRID_NO_HANDOFF : PANEL_GRID} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`,
        className,
      )}
      data-testid="panel-row"
      {...rest}
    >
      {/* Quién */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{row.role}</span>
        <span className="truncate font-mono text-2xs text-muted-foreground">
          {row.jobId}
        </span>
      </div>

      {/* En qué — the declared task and the last published event, never the interior */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm">
          {row.task ?? "sin tarea declarada"}
        </span>
        <span className="text-2xs text-muted-foreground">
          {row.lastEventAt === null ? "sin actividad registrada" : eventText}
        </span>
      </div>

      {/* De qué encargo viene + resultado del padre — P3's column, the handoff
          pattern. With the read down and no snapshot it is retired whole: the
          absence would otherwise be a cell, and a cell is a claim. */}
      {handoffRetired ? null : (
        <HandoverCell column={handoverColumn} parent={row.parent} />
      )}

      {/* Espera — a wait with no lifecycle event in the window says so */}
      <WaitingCell
        lastGoodAt={lastGoodAt}
        orphan={row.waiting !== null && row.workState === null}
        readFailed={readFailed}
        waiting={row.waiting}
      />

      {/* Instante */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm">{recency ?? "sin actividad registrada"}</span>
        <span className="text-2xs text-muted-foreground">
          {row.lastEventAt ?? "sin actividad registrada"}
        </span>
      </div>

      {/* Hilo */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm">
          {row.thread === null
            ? handoversUnreadable
              ? UNREADABLE_HANDOVERS
              : "sin hilo"
            : row.thread.eventId === null
              ? "el hilo no se pudo abrir"
              : row.thread.channel}
        </span>
        <span className="text-2xs text-muted-foreground">
          {row.thread === null
            ? "no se discutió en un canal legible"
            : row.thread.channel}
        </span>
      </div>
    </li>
  );
};
