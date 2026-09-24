/**
 * The panel's one column layout, shared by the header, the loading skeleton and
 * the rows, so a load can never draw a skeleton without the header the product
 * decision requires to stay visible (D-8), and a row can never drift out of the
 * column count the header claims.
 *
 * The third column — «De qué encargo viene · resultado del padre» — is the P3
 * handoff column. When its read fails with nothing to preserve the column is
 * retired whole (design §6.2), so the layout carries a second, five-cell form
 * that drops exactly that column rather than blanking a cell inside it.
 */
export const PANEL_GRID =
  "grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(9rem,1.2fr)_minmax(11rem,1.8fr)_minmax(9rem,1.2fr)_minmax(9rem,1.2fr)_minmax(7rem,0.9fr)_minmax(8rem,1.1fr)] sm:gap-3";

/** The layout without the P3 handoff column: same order, third cell removed. */
export const PANEL_GRID_NO_HANDOFF =
  "grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(9rem,1.2fr)_minmax(11rem,1.8fr)_minmax(9rem,1.2fr)_minmax(7rem,0.9fr)_minmax(8rem,1.1fr)] sm:gap-3";

/** The six cells, in the order the product decision reads them. */
export const PANEL_COLUMNS = [
  "Quién",
  "En qué",
  "De qué encargo viene · resultado del padre",
  "Espera",
  "Instante",
  "Hilo",
] as const;

/** The five cells drawn when the P3 handoff column is retired. */
export const PANEL_COLUMNS_NO_HANDOFF = [
  "Quién",
  "En qué",
  "Espera",
  "Instante",
  "Hilo",
] as const;

/**
 * The state of P3's handoff column («Resultado del padre»). It is the **read's**
 * state, not a row's: every row in one render shares it, and the column is drawn
 * or retired as a unit — the fall phrase is the read's, not the cell's.
 *
 * - `live` — the handoff read answered; the cells carry its closed vocabulary.
 * - `loading` — the read is still in flight; the cells say so and assert no
 *   absence.
 * - `stale` — the read failed over a previous good one; the cells keep the last
 *   good values, each marked with the instant of the read it came from.
 * - `retired` — the read failed with nothing to preserve; the column is removed
 *   whole, header and cells. The absence is of the column, never a cell with a
 *   dash, a `0`, or the healthy empty's value (design §6.2).
 */
export type HandoverColumnState =
  | { state: "live" }
  | { state: "loading" }
  | { state: "stale"; lastSuccessAt: string | null }
  | { state: "retired" };
