import { buildPanelRows, type PanelRow } from "@/features/panel/domain/panel";
import type { HandoverView } from "@/features/tower/ui/handoverState";
import type { PortfolioView } from "@/features/tower/ui/portfolioState";
import { PanelEmptyState } from "./PanelEmptyState";
import { PanelErrorState, PanelStaleBanner } from "./PanelErrorState";
import {
  PanelHandoverFallNotice,
  PanelHandoverStaleNotice,
} from "./PanelHandoverNotice";
import { PanelList } from "./PanelList";
import { PanelLoadingState } from "./PanelLoadingState";
import type { HandoverColumnState } from "./panelLayout";

/**
 * P3's column state, derived from the handoff read alone. The read's three
 * branches map to the column's: answered → the closed vocabulary; still in
 * flight → the cells say so; failed with a snapshot → the last good values,
 * marked old; failed with nothing → the column is retired whole.
 */
function handoverColumnOf(view: HandoverView): HandoverColumnState {
  if (view.phase === "unreachable") {
    return view.lines === null
      ? { state: "retired" }
      : { state: "stale", lastSuccessAt: view.lastSuccessAt };
  }
  if (view.phase === "loading") return { state: "loading" };
  return { state: "live" };
}

function announcementFor(
  portfolio: PortfolioView,
  rows: PanelRow[] | null,
): string {
  if (portfolio.phase === "loading") {
    return rows === null
      ? "Leyendo los encargos — aún buscando, no es un vacío"
      : "Encargos leídos";
  }
  if (portfolio.phase === "unreachable") {
    if (rows === null) return "No se pudo leer el registro de encargos";
    // A fall whose last good read was empty shows no row at all: announcing
    // "se muestran datos viejos" would name rows the screen is not drawing.
    return rows.length === 0
      ? "La lectura de encargos falló; la última lectura buena no encontró encargos"
      : "La lectura de encargos falló; se muestran datos viejos";
  }
  if (rows === null || rows.length === 0) {
    return "No hay encargos en este periodo";
  }
  return rows.length === 1 ? "1 encargo" : `${rows.length} encargos`;
}

/**
 * El panel — the workforce view. It is an extension of the Tower sections, not
 * a screen of its own: it reads through the **same** {@link TowerSource} and
 * reuses the **same** reads the page already holds, so the panel can never
 * disagree with Tower about which encargos exist.
 *
 * Four surface states, each with visible text: leyendo (header kept, D-8),
 * vacío (window named, D-7), error (motive, never drawn as empty D-6), and
 * error with previous rows (the rows kept under a stale banner, D-9). The
 * module draws no `blocked` cell and no figure of its own.
 */
export function PanelSection({
  portfolio,
  handovers,
}: {
  portfolio: PortfolioView;
  handovers: HandoverView;
}) {
  const lines = portfolio.lines;
  const rows =
    lines === null ? null : buildPanelRows(lines, handovers.lines ?? []);
  const handoversUnreadable = handovers.phase === "unreachable";
  const handoverColumn = handoverColumnOf(handovers);
  const hasRows = rows !== null && rows.length > 0;
  const showingStale = portfolio.phase === "unreachable" && lines !== null;
  // A stale read whose last good result was empty: the empty state's copy
  // asserts the source answered, which is exactly what a fall withholds.
  const lastGoodWasEmpty = lines !== null && lines.length === 0 && showingStale;
  // The handoff column only exists when the panel is drawing encargos: its fall
  // notice is about a column that is retired or preserved, so with no rows
  // there is nothing the notice would explain.
  const handoffColumnSpeaks = hasRows && handoversUnreadable;

  return (
    <section
      aria-label="El panel — encargos en la ventana"
      className="flex flex-col gap-3"
      data-testid="panel-section"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">El panel · encargos</h2>
        <p className="text-2xs text-muted-foreground">
          Quién trabaja, en qué, de qué encargo viene y qué tiene una espera
          registrada. Donde no hay dato, la celda lo dice; no dice cero.
        </p>
      </div>
      <p
        aria-live="polite"
        className="sr-only"
        data-testid="panel-status-announcement"
      >
        {announcementFor(portfolio, rows)}
      </p>
      {showingStale ? (
        <PanelStaleBanner
          code={portfolio.failure?.code ?? null}
          lastGoodWasEmpty={lastGoodWasEmpty}
          lastSuccessAt={portfolio.lastSuccessAt}
          onRetry={portfolio.retry}
        />
      ) : null}
      {handoffColumnSpeaks && handoverColumn.state === "retired" ? (
        <PanelHandoverFallNotice
          failure={handovers.failure}
          onRetry={handovers.retry}
        />
      ) : null}
      {handoffColumnSpeaks && handoverColumn.state === "stale" ? (
        <PanelHandoverStaleNotice
          failure={handovers.failure}
          lastSuccessAt={handoverColumn.lastSuccessAt}
          onRetry={handovers.retry}
        />
      ) : null}
      {portfolio.phase === "loading" && lines === null ? (
        <PanelLoadingState />
      ) : null}
      {/* Keyed on the snapshot, not on `ready`: a stale read whose last good
          result was empty must still explain itself — but under the stale
          banner, never with the empty state's «the source answered» copy, which
          is false while the read is failing. */}
      {!showingStale && lines !== null && lines.length === 0 ? (
        <PanelEmptyState />
      ) : null}
      {portfolio.phase === "unreachable" && lines === null ? (
        <PanelErrorState
          failure={portfolio.failure}
          onRetry={portfolio.retry}
        />
      ) : null}
      {hasRows && rows !== null ? (
        <PanelList
          handoverColumn={handoverColumn}
          handoversUnreadable={handoversUnreadable}
          lastGoodAt={showingStale ? portfolio.lastSuccessAt : null}
          readFailed={showingStale}
          refreshing={portfolio.refreshing}
          rows={rows}
        />
      ) : null}
    </section>
  );
}
