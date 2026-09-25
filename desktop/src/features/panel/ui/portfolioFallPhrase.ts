/**
 * The portfolio read's fall sentence — the **one** phrase that read has.
 *
 * Design §1.1 rule 2: P1/P2/P4 share the portfolio read, so they share a single
 * fall phrase, whether the operator meets it on the card surface
 * (`TowerStaleBanner`) or in the panel (`PanelStaleBanner`). P3, which reads the
 * handoffs, keeps its own. Before this the card printed the read's raw ISO in
 * English while the panel printed `HH:MM UTC` in Spanish: two sentences about
 * one instant, in two formats.
 *
 * The hour arrives already formatted by {@link clockUtc} — the raw ISO belongs
 * to the cell, never to a sentence, and an instant the platform cannot parse
 * names no hour rather than inventing one.
 *
 * `lastGoodWasEmpty` is the one fact that changes the sentence: a preserved
 * snapshot that held no encargos cannot promise rows below it, and must not
 * borrow the empty state's «the source answered» copy — that is exactly the
 * claim a fall withholds.
 */
export function portfolioFallSentence(
  clock: string | null,
  lastGoodWasEmpty: boolean,
): string {
  const from = clock === null ? "" : `, de ${clock} UTC`;
  if (lastGoodWasEmpty) {
    return clock === null
      ? "La última lectura buena no encontró encargos. La lectura falló, así que esta pantalla no puede decir si ahora hay alguno ni cuántos."
      : `La última lectura buena${from}, no encontró encargos. La lectura falló, así que esta pantalla no puede decir si ahora hay alguno ni cuántos.`;
  }
  return clock === null
    ? "Se muestra la última lectura buena. Las filas de abajo son datos viejos, no actuales."
    : `Se muestra la última lectura buena${from}. Las filas de abajo son datos viejos, no actuales.`;
}
