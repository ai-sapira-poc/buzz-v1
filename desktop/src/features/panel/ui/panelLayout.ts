/**
 * The panel's one column layout, shared by the header, the loading skeleton and
 * the rows, so a load can never draw a skeleton without the header the product
 * decision requires to stay visible (D-8), and a row can never drift out of the
 * column count the header claims.
 */
export const PANEL_GRID =
  "grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(9rem,1.2fr)_minmax(11rem,1.8fr)_minmax(9rem,1.2fr)_minmax(9rem,1.2fr)_minmax(7rem,0.9fr)_minmax(8rem,1.1fr)] sm:gap-3";

/** The six cells, in the order the product decision reads them. */
export const PANEL_COLUMNS = [
  "Quién",
  "En qué",
  "De qué encargo viene · resultado del padre",
  "Espera",
  "Instante",
  "Hilo",
] as const;
