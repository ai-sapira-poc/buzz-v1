import type * as React from "react";

import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import type { HandoverParentOutcome } from "@/features/tower/domain/handover";
import type { WorkState } from "@/features/tower/domain/portfolio";
import type { PanelRow } from "@/features/panel/domain/panel";
import { formatRecency } from "@/features/tower/ui/portfolioFormat";
import { PANEL_GRID } from "./panelLayout";

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

const PARENT_OUTCOME_TEXT: Record<HandoverParentOutcome, string> = {
  done: "Terminó el padre",
  failed: "Falló el padre",
  cancelled: "Canceló el padre",
  unknown: "sin resultado registrado",
};

const UNREADABLE_HANDOVERS = "El registro de relevos no se pudo leer.";

/**
 * The **Espera** cell. It is not a blocked column and it is never a figure: it
 * names the recorded reason and its instant, or — when nothing is recorded — it
 * says "sin señal" and says why that is not "nothing waits". The producer of
 * the wait is best-effort, so absence of the event is not evidence of absence
 * of the wait.
 *
 * The cell's two other states — error and loading — are the section's, not the
 * row's: a read that fails, or is still in flight, never draws rows at all, so
 * this cell cannot claim "sin señal" over a read that did not happen.
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
}: {
  waiting: PanelRow["waiting"];
  orphan: boolean;
}) {
  if (waiting === null) {
    return (
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
    </div>
  );
}

type PanelRowProps = {
  row: PanelRow;
  /** True when the handoff read failed: parent/thread cells must say so. */
  handoversUnreadable: boolean;
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
  className,
  ...rest
}: PanelRowProps) => {
  const recency = formatRecency(row.lastEventAt);
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
        `${PANEL_GRID} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`,
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

      {/* De qué encargo viene + resultado del padre — one block, the handoff pattern */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm">
          {row.parent === null
            ? handoversUnreadable
              ? UNREADABLE_HANDOVERS
              : "sin padre registrado"
            : row.parent.jobId}
        </span>
        <span className="text-2xs text-muted-foreground">
          {row.parent === null
            ? handoversUnreadable
              ? "El resultado del padre no se pudo leer."
              : "sin resultado registrado"
            : PARENT_OUTCOME_TEXT[row.parent.outcome]}
        </span>
      </div>

      {/* Espera — a wait with no lifecycle event in the window says so */}
      <WaitingCell
        orphan={row.waiting !== null && row.workState === null}
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
