import type { PortfolioLine } from "@/features/tower/domain/portfolio";
import { orderPortfolioLines } from "./portfolioState";

/**
 * The canvas groups by role, and this is the module that decides what a group
 * is. It is a pure projection of the portfolio: it adds no figure and names no
 * transport.
 *
 * Why role and not depth: depth is the handoff between one job and the next,
 * and nothing in the read the canvas holds says which job was handed off to
 * which — the edge is published by its own reader, which this stage does not
 * draw. So S1 labels the grouping for what it truly is (the role the producer
 * named) and {@link GrafoSection} says in words where depth will come from.
 */

/**
 * The placeholder the adapter already gives a line whose producer named no
 * role. Kept here as well so a blank name is grouped, never dropped: a card
 * without a column would be an invisible unit of work.
 */
export const UNNAMED_ROLE = "Unnamed agent";

/** One column of the canvas: every card that shares one named role. */
export interface GrafoColumn {
  /**
   * The role exactly as the read carried it — matched as a string, so the same
   * agent named two ways (`arquitecto` and `architect`) is two columns rather
   * than a silent merge. The state taxonomy records that split as a known limit
   * of the string identity; the canvas must not hide it.
   */
  role: string;
  /** The cards of this role, in the section's single ordering rule. */
  cards: PortfolioLine[];
}

/** The role a line is grouped under: the read's own name, or the placeholder. */
export function roleOf(line: PortfolioLine): string {
  const named = line.project.name.trim();
  return named.length === 0 ? UNNAMED_ROLE : named;
}

/**
 * Groups the ordered portfolio into one column per role.
 *
 * Columns follow the first card that orders into them, so the column whose
 * leading card is the one the operator should look at first stands leftmost.
 * The order is therefore derived from `orderPortfolioLines` alone — one
 * ordering rule in the section, not two that can disagree.
 */
export function groupByRole(lines: PortfolioLine[]): GrafoColumn[] {
  const columns = new Map<string, GrafoColumn>();
  for (const line of orderPortfolioLines(lines)) {
    const role = roleOf(line);
    const column = columns.get(role);
    if (column) {
      column.cards.push(line);
    } else {
      columns.set(role, { role, cards: [line] });
    }
  }
  return [...columns.values()];
}

/** The canvas's flattened reading order: column by column, card by card. */
export function flattenColumns(columns: GrafoColumn[]): PortfolioLine[] {
  return columns.flatMap((column) => column.cards);
}
