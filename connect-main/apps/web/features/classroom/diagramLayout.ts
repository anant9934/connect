// Lays out a small flowchart top to bottom: break cycles, put each node one layer below its
// deepest parent, order each layer to reduce crossings, then place nodes and route edges.
// Pure and deterministic, so every screen draws the same diagram.

export type NodeShape = 'rect' | 'diamond' | 'pill' | 'cylinder';
export interface DiagramNode { id: string; label: string; shape: NodeShape }
export interface DiagramEdge { from: string; to: string; label?: string }
export interface Diagram { nodes: DiagramNode[]; edges: DiagramEdge[] }

export interface PlacedNode extends DiagramNode { x: number; y: number; w: number; h: number; layer: number }
export interface RoutedEdge extends DiagramEdge { path: string; labelX: number; labelY: number; back: boolean }
export interface Layout { nodes: PlacedNode[]; edges: RoutedEdge[]; width: number; height: number }

const NODE_H = { rect: 52, diamond: 76, pill: 46, cylinder: 64 } as const;
const LAYER_GAP = 64;
const NODE_GAP = 36;
const MARGIN = 24;

/** Width for a label: roughly 7.4 px per character at 14 px, within limits. */
export const nodeWidth = (label: string, shape: NodeShape) => {
  const base = Math.min(220, Math.max(96, label.length * 7.4 + 32));
  return shape === 'diamond' ? base * 1.35 : base;
};

/** Edges that close a cycle, found by depth-first search; they are drawn as back edges. */
function backEdges(nodes: DiagramNode[], edges: DiagramEdge[]): Set<number> {
  const out = new Map<string, number[]>();
  edges.forEach((e, i) => out.set(e.from, [...(out.get(e.from) ?? []), i]));
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<number>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const i of out.get(id) ?? []) {
      const to = edges[i].to;
      const s = state.get(to) ?? 0;
      if (s === 1) back.add(i);
      else if (s === 0) visit(to);
    }
    state.set(id, 2);
  };
  for (const n of nodes) if ((state.get(n.id) ?? 0) === 0) visit(n.id);
  return back;
}

export function layoutDiagram(diagram: Diagram): Layout {
  const ids = new Set(diagram.nodes.map((n) => n.id));
  const edges = diagram.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const back = backEdges(diagram.nodes, edges);
  const forward = edges.filter((_, i) => !back.has(i));

  // Longest-path layering over the acyclic forward edges.
  const layer = new Map<string, number>(diagram.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < diagram.nodes.length; pass++) {
    let changed = false;
    for (const e of forward) {
      const want = (layer.get(e.from) ?? 0) + 1;
      if (want > (layer.get(e.to) ?? 0)) {
        layer.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const layers: DiagramNode[][] = [];
  for (const n of diagram.nodes) (layers[layer.get(n.id)!] ??= []).push(n);

  // Two sweeps of barycentre ordering: each node moves toward the average position of its parents.
  const position = new Map<string, number>();
  layers.forEach((row) => row.forEach((n, i) => position.set(n.id, i)));
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let l = 1; l < layers.length; l++) {
      const bary = (n: DiagramNode) => {
        const parents = forward.filter((e) => e.to === n.id).map((e) => position.get(e.from) ?? 0);
        return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : position.get(n.id)!;
      };
      layers[l] = [...layers[l]].sort((a, b) => bary(a) - bary(b));
      layers[l].forEach((n, i) => position.set(n.id, i));
    }
  }

  // Place: rows centred horizontally on the widest row.
  const rowWidths = layers.map((row) => row.reduce((w, n) => w + nodeWidth(n.label, n.shape), 0) + NODE_GAP * Math.max(0, row.length - 1));
  const width = Math.max(...rowWidths, 200) + MARGIN * 2;
  const placed = new Map<string, PlacedNode>();
  let y = MARGIN;
  layers.forEach((row, l) => {
    const rowH = Math.max(...row.map((n) => NODE_H[n.shape]));
    let x = (width - rowWidths[l]) / 2;
    for (const n of row) {
      const w = nodeWidth(n.label, n.shape);
      const h = NODE_H[n.shape];
      placed.set(n.id, { ...n, x, y: y + (rowH - h) / 2, w, h, layer: l });
      x += w + NODE_GAP;
    }
    y += rowH + LAYER_GAP;
  });
  const height = y - LAYER_GAP + MARGIN;

  const routed: RoutedEdge[] = edges.map((e, i) => {
    const a = placed.get(e.from)!;
    const b = placed.get(e.to)!;
    const isBack = back.has(i) || b.layer <= a.layer;
    if (isBack) {
      // Around the right-hand side, so it never cuts through the nodes between.
      const sx = a.x + a.w, sy = a.y + a.h / 2, ex = b.x + b.w, ey = b.y + b.h / 2;
      const bulge = Math.max(sx, ex) + 40;
      return { ...e, back: true, path: `M ${sx} ${sy} C ${bulge} ${sy}, ${bulge} ${ey}, ${ex + 4} ${ey}`, labelX: bulge - 6, labelY: (sy + ey) / 2 };
    }
    const sx = a.x + a.w / 2, sy = a.y + a.h, ex = b.x + b.w / 2, ey = b.y - 4;
    const mid = (sy + ey) / 2;
    return { ...e, back: false, path: `M ${sx} ${sy} C ${sx} ${mid}, ${ex} ${mid}, ${ex} ${ey}`, labelX: (sx + ex) / 2, labelY: mid };
  });

  return { nodes: [...placed.values()], edges: routed, width, height };
}
