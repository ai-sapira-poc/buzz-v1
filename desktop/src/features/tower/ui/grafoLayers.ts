import type { HandoverRow } from "@/features/tower/domain/handover";
import type { PortfolioLine } from "@/features/tower/domain/portfolio";

/**
 * The canvas layout — D1: layers by depth, computed, never persisted.
 *
 * Depth is the **handoff path** (the handoff edge, parent job → child job), and it is
 * measured **against this window only**. The two reads are bounded on their own
 * (`limit 500` each), so a node with no incoming edge is a root *of the window*,
 * not an absolute root: its parent may sit above the portfolio read's limit. The
 * surface must label the depth as "in this window" — never as an absolute
 * hierarchy (`architecture/tower-grafo-D-decisiones.md` §1.4).
 *
 * The algorithm is D1's: longest directed path from the window roots, computed
 * with Kahn in one pass (O(V+E)) **over the window's own nodes**. A node left
 * unqueued sits in a cycle or downstream of one — its depth is **not guessed**:
 * it is drawn in the trailing band, ordered by `jobId`, and the layout never
 * iterates without a bound.
 *
 * An edge endpoint that is not a node of the portfolio read is an **orphan**
 * (D1 §1.4). It is not dropped and it is not given a depth: a depth is a fact
 * about *this window's* edges, and an orphan is not in this window, so a layer
 * would assert a depth nobody published. It is drawn in the **same trailing
 * band** as the cycles, with the `jobId` it has and no line.
 *
 * Coordinates are derived here from fixed geometry so the edge layer and the
 * cards share one space — the register the viewport preserves. Nothing here
 * names a transport, writes an event, or adds a dependency.
 */

/** Fixed geometry, in px. Cards and edges are positioned from these. */
export const GRAFO_CARD_WIDTH = 256;
export const GRAFO_CARD_HEIGHT = 176;
export const GRAFO_LAYER_GAP = 96;
export const GRAFO_ROW_GAP = 16;
/** The layer heading band that sits above the first card. */
export const GRAFO_LAYER_HEADER_HEIGHT = 32;

/**
 * The placeholder the adapter already gives a subject whose producer named no
 * role — kept as a string so a blank name is drawn, never dropped.
 */
export const UNNAMED_ROLE = "Unnamed agent";

/** The role of a portfolio line: the read's own name, or the placeholder. */
export function roleOf(line: PortfolioLine): string {
  const named = line.project.name.trim();
  return named.length === 0 ? UNNAMED_ROLE : named;
}

/** The role of a node: the line's own name, or the edge read's, or the placeholder. */
export function roleFor(node: GrafoNode): string {
  if (node.line !== null) return roleOf(node.line);
  const named = node.roleHint?.trim() ?? "";
  return named.length === 0 ? UNNAMED_ROLE : named;
}

/** One card's slot. `line` is `null` for an orphan edge endpoint (D1 §1.4). */
export interface GrafoNode {
  jobId: string;
  line: PortfolioLine | null;
  /** The name the edge read carried for an orphan; `null` when it carried none. */
  roleHint: string | null;
  layerKey: string;
  /** Position in the reading order: layer by layer, card by card. */
  index: number;
  x: number;
  y: number;
}

/** One layer: a depth, or the trailing band for nodes with no derivable depth. */
export interface GrafoLayer {
  /** Stable key: `depth:<n>` or `unknown`. */
  key: string;
  depth: number | null;
  depthKnown: boolean;
  nodes: GrafoNode[];
  x: number;
}

/** A drawn edge. Both endpoints are always nodes of the layout. */
export interface GrafoEdge {
  id: string;
  parentJobId: string;
  childJobId: string;
  parentOutcome: HandoverRow["parentOutcome"];
  /** True when either endpoint had no portfolio line in the window. */
  orphan: boolean;
}

export interface GrafoLayout {
  layers: GrafoLayer[];
  /** Reading order: layer by layer, card by card. */
  nodes: GrafoNode[];
  edges: GrafoEdge[];
  width: number;
  height: number;
  /** Cards in the trailing band: the unqueued window nodes and the orphans. */
  unknownDepthCount: number;
  orphanEdgeCount: number;
}

/**
 * Ordering inside a depth layer (D1 §1.2.2): a recorded wait first, then most
 * recent first, then `jobId` ascending by UTF-16 code units.
 *
 * The tiebreak deliberately differs from `orderPortfolioLines`, which falls back
 * to the source array index: that index is an artifact of the order the relay
 * returned events, so two reads of the same set could draw the same graph
 * differently. `jobId` is the unit's stable identity, so ASCII order is
 * reproducible across reads and locales. D1 declares this divergence.
 */
function recencyValue(line: PortfolioLine | null): number {
  if (line === null || line.recency.lastSpanAt === null) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(line.recency.lastSpanAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function waitingRank(node: GrafoNode): number {
  return node.line !== null && node.line.waiting !== null ? 0 : 1;
}

function compareJobIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareInLayer(a: GrafoNode, b: GrafoNode): number {
  const wait = waitingRank(a) - waitingRank(b);
  if (wait !== 0) return wait;
  const recency = recencyValue(b.line) - recencyValue(a.line);
  if (recency !== 0) return recency;
  return compareJobIds(a.jobId, b.jobId);
}

/**
 * Which nodes get a **depth**, computed over the window's own nodes only.
 *
 * An edge touching an orphan carries no depth: the orphan is not a node of the
 * window, so the path it would extend is not this window's path. Excluding it
 * is what keeps a layer meaning "depth in this window" rather than "depth
 * somewhere above the read's limit".
 */
function depthsOverWindow(
  windowNodes: GrafoNode[],
  edges: GrafoEdge[],
): { depth: Map<string, number>; processed: Set<string> } {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of windowNodes) {
    adjacency.set(node.jobId, []);
    indegree.set(node.jobId, 0);
  }
  for (const edge of edges) {
    const out = adjacency.get(edge.parentJobId);
    if (out === undefined || !adjacency.has(edge.childJobId)) continue;
    out.push(edge.childJobId);
    indegree.set(edge.childJobId, (indegree.get(edge.childJobId) ?? 0) + 1);
  }

  // Kahn, longest path. Deterministic queue order so the layout is reproducible.
  const depth = new Map<string, number>();
  const remaining = new Map(indegree);
  const queue: string[] = [];
  for (const [jobId, degree] of remaining) {
    if (degree === 0) {
      depth.set(jobId, 0);
      queue.push(jobId);
    }
  }
  queue.sort(compareJobIds);
  for (let head = 0; head < queue.length; head += 1) {
    const jobId = queue[head];
    const base = depth.get(jobId) ?? 0;
    const children = [...(adjacency.get(jobId) ?? [])].sort(compareJobIds);
    for (const child of children) {
      const next = base + 1;
      if ((depth.get(child) ?? -1) < next) depth.set(child, next);
      const left = (remaining.get(child) ?? 0) - 1;
      remaining.set(child, left);
      if (left === 0) queue.push(child);
    }
  }
  return { depth, processed: new Set(queue) };
}

function buildLayers(
  windowNodes: GrafoNode[],
  orphanNodes: GrafoNode[],
  edges: GrafoEdge[],
): {
  layers: GrafoLayer[];
  width: number;
  height: number;
  unknownDepthCount: number;
} {
  const { depth, processed } = depthsOverWindow(windowNodes, edges);

  const byDepth = new Map<number, GrafoNode[]>();
  const unknown: GrafoNode[] = [];
  for (const node of windowNodes) {
    if (!processed.has(node.jobId)) {
      unknown.push(node);
      continue;
    }
    const nodeDepth = depth.get(node.jobId) ?? 0;
    const bucket = byDepth.get(nodeDepth);
    if (bucket === undefined) byDepth.set(nodeDepth, [node]);
    else bucket.push(node);
  }
  // The band is one group: a cycle is no more "this window's depth" than an
  // orphan is, so both are ordered by the only stable identity they share.
  unknown.push(...orphanNodes);
  unknown.sort((a, b) => compareJobIds(a.jobId, b.jobId));

  const layers: GrafoLayer[] = [];
  let maxRows = 0;
  const pushLayer = (
    key: string,
    layerDepth: number | null,
    depthKnown: boolean,
    members: GrafoNode[],
  ) => {
    const x = layers.length * (GRAFO_CARD_WIDTH + GRAFO_LAYER_GAP);
    const ordered = orderedFor(members, depthKnown);
    ordered.forEach((node, row) => {
      node.layerKey = key;
      node.x = x;
      node.y =
        GRAFO_LAYER_HEADER_HEIGHT + row * (GRAFO_CARD_HEIGHT + GRAFO_ROW_GAP);
    });
    layers.push({ key, depth: layerDepth, depthKnown, nodes: ordered, x });
    maxRows = Math.max(maxRows, ordered.length);
  };

  for (const [layerDepth, members] of [...byDepth.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    pushLayer(`depth:${layerDepth}`, layerDepth, true, members);
  }
  if (unknown.length > 0) pushLayer("unknown", null, false, unknown);

  const width =
    layers.length === 0
      ? 0
      : (layers.length - 1) * (GRAFO_CARD_WIDTH + GRAFO_LAYER_GAP) +
        GRAFO_CARD_WIDTH;
  const height =
    maxRows === 0
      ? 0
      : GRAFO_LAYER_HEADER_HEIGHT +
        (maxRows - 1) * (GRAFO_CARD_HEIGHT + GRAFO_ROW_GAP) +
        GRAFO_CARD_HEIGHT;
  return { layers, width, height, unknownDepthCount: unknown.length };
}

/** A depth layer keeps D1's ordering; the band is already ordered by `jobId`. */
function orderedFor(members: GrafoNode[], depthKnown: boolean): GrafoNode[] {
  return depthKnown ? [...members].sort(compareInLayer) : members;
}

/**
 * The whole layout: nodes, layers, edges and the world size.
 *
 * `lines` is the portfolio window (the only node source), `handovers` the edge
 * read folded by `foldHandoffEdges`. Both are treated as data: a malformed row
 * is skipped rather than guessed at.
 */
export function computeGrafoLayout(
  lines: readonly PortfolioLine[],
  handovers: readonly HandoverRow[],
): GrafoLayout {
  const lineById = new Map<string, PortfolioLine>(
    lines.map((l) => [l.project.id, l]),
  );

  const edges: GrafoEdge[] = [];
  const seen = new Set<string>();
  /** The name the edge read carried for an endpoint outside the window. */
  const orphanRoleHint = new Map<string, string | null>();
  for (const row of handovers) {
    const parent = row?.sender?.jobId;
    const child = row?.child?.jobId;
    // An edge with one end missing is not an edge; never draw a half row.
    if (typeof parent !== "string" || typeof child !== "string") continue;
    if (parent.length === 0 || child.length === 0) continue;
    // A job handing off to itself is not a handoff; skip it rather than draw a
    // loop or a one-node cycle.
    if (parent === child) continue;
    const id = typeof row.id === "string" ? row.id : `${parent}->${child}`;
    if (seen.has(id)) continue;
    seen.add(id);
    // D1 §1.4: an endpoint outside the portfolio window is an orphan, drawn with
    // the id it has and no line — never discarded.
    for (const [jobId, actor] of [
      [parent, row.sender] as const,
      [child, row.child] as const,
    ]) {
      if (lineById.has(jobId)) continue;
      const named = typeof actor?.name === "string" ? actor.name : null;
      // First non-null name wins: a later row that carries no name must not
      // erase a role an earlier row did carry.
      if (!orphanRoleHint.has(jobId) || orphanRoleHint.get(jobId) === null) {
        orphanRoleHint.set(jobId, named);
      }
    }
    edges.push({
      id,
      parentJobId: parent,
      childJobId: child,
      parentOutcome: row.parentOutcome,
      orphan: !lineById.has(parent) || !lineById.has(child),
    });
  }

  const windowNodes: GrafoNode[] = [...lineById.values()].map((line) => ({
    jobId: line.project.id,
    line,
    roleHint: null,
    layerKey: "",
    index: 0,
    x: 0,
    y: 0,
  }));
  const orphanNodes: GrafoNode[] = [...orphanRoleHint.entries()]
    .map(([jobId, roleHint]) => ({
      jobId,
      line: null,
      roleHint,
      layerKey: "",
      index: 0,
      x: 0,
      y: 0,
    }))
    .sort((a, b) => compareJobIds(a.jobId, b.jobId));

  const { layers, width, height, unknownDepthCount } = buildLayers(
    windowNodes,
    orphanNodes,
    edges,
  );
  const nodes = layers.flatMap((layer) => layer.nodes);
  nodes.forEach((node, index) => {
    node.index = index;
  });

  return {
    layers,
    nodes,
    edges,
    width,
    height,
    unknownDepthCount,
    orphanEdgeCount: edges.filter((edge) => edge.orphan).length,
  };
}

/** The label of a layer. Depth is stated as the window's, never absolute. */
export function layerLabel(layer: GrafoLayer): string {
  return layer.depthKnown && layer.depth !== null
    ? `Depth ${layer.depth}`
    : "No depth";
}
