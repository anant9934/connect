// Search trees and graph searches as lists of frames, so a renderer can step through them.
// Everything is computed from the settings alone; the same settings give the same frames.
import type { Edge } from './specs';

// ---------------- Trees ----------------

export interface TreeNode { value: number; left: TreeNode | null; right: TreeNode | null; height: number }
export interface TreeFrame {
  root: TreeNode | null;
  /** The value this step is about: inserted, deleted, rotated around or visited. */
  focus: number | null;
  visited: number[];
  caption: string;
}

const height = (n: TreeNode | null) => (n ? n.height : 0);
const node = (value: number, left: TreeNode | null, right: TreeNode | null): TreeNode => ({
  value, left, right, height: 1 + Math.max(height(left), height(right)),
});
const balance = (n: TreeNode) => height(n.left) - height(n.right);
const rotateRight = (n: TreeNode): TreeNode => {
  const l = n.left!;
  return node(l.value, l.left, node(n.value, l.right, n.right));
};
const rotateLeft = (n: TreeNode): TreeNode => {
  const r = n.right!;
  return node(r.value, node(n.value, n.left, r.left), r.right);
};

/** Restores the AVL property at n, naming the rotation it used. */
function rebalance(n: TreeNode, notes: string[]): TreeNode {
  const b = balance(n);
  if (b > 1) {
    if (balance(n.left!) < 0) {
      notes.push(`Left-right rotation at ${n.value}`);
      return rotateRight(node(n.value, rotateLeft(n.left!), n.right));
    }
    notes.push(`Right rotation at ${n.value}`);
    return rotateRight(n);
  }
  if (b < -1) {
    if (balance(n.right!) > 0) {
      notes.push(`Right-left rotation at ${n.value}`);
      return rotateLeft(node(n.value, n.left, rotateRight(n.right!)));
    }
    notes.push(`Left rotation at ${n.value}`);
    return rotateLeft(n);
  }
  return n;
}

export function insert(root: TreeNode | null, value: number, avl: boolean, notes: string[] = []): TreeNode {
  if (!root) return node(value, null, null);
  if (value === root.value) return root;
  const next = value < root.value ? node(root.value, insert(root.left, value, avl, notes), root.right) : node(root.value, root.left, insert(root.right, value, avl, notes));
  return avl ? rebalance(next, notes) : next;
}

export function remove(root: TreeNode | null, value: number, avl: boolean, notes: string[] = []): TreeNode | null {
  if (!root) return null;
  let next: TreeNode | null;
  if (value < root.value) next = node(root.value, remove(root.left, value, avl, notes), root.right);
  else if (value > root.value) next = node(root.value, root.left, remove(root.right, value, avl, notes));
  else if (!root.left || !root.right) next = root.left ?? root.right;
  else {
    // Two children: take the in-order successor's value.
    let successor = root.right;
    while (successor.left) successor = successor.left;
    notes.push(`${value} has two children, so its in-order successor ${successor.value} takes its place`);
    next = node(successor.value, root.left, remove(root.right, successor.value, avl, notes));
  }
  return next && avl ? rebalance(next, notes) : next;
}

export function traverse(root: TreeNode | null, order: string): number[] {
  const out: number[] = [];
  if (order === 'levelorder') {
    const queue = root ? [root] : [];
    while (queue.length) {
      const n = queue.shift()!;
      out.push(n.value);
      if (n.left) queue.push(n.left);
      if (n.right) queue.push(n.right);
    }
    return out;
  }
  const walk = (n: TreeNode | null) => {
    if (!n) return;
    if (order === 'preorder') out.push(n.value);
    walk(n.left);
    if (order === 'inorder') out.push(n.value);
    walk(n.right);
    if (order === 'postorder') out.push(n.value);
  };
  walk(root);
  return out;
}

export function contains(root: TreeNode | null, value: number): boolean {
  let n = root;
  while (n) {
    if (value === n.value) return true;
    n = value < n.value ? n.left : n.right;
  }
  return false;
}

export function treeFrames(values: number[], kind: string, removeValue: number, order: string): TreeFrame[] {
  const avl = kind === 'avl';
  const frames: TreeFrame[] = [{ root: null, focus: null, visited: [], caption: 'Empty tree' }];
  let root: TreeNode | null = null;
  for (const v of values) {
    const notes: string[] = [];
    root = insert(root, v, avl, notes);
    frames.push({ root, focus: v, visited: [], caption: notes.length ? `Insert ${v}. ${notes.join('; ')}` : `Insert ${v}` });
  }
  if (removeValue > 0) {
    if (contains(root, removeValue)) {
      const notes: string[] = [];
      frames.push({ root, focus: removeValue, visited: [], caption: `Delete ${removeValue}` });
      root = remove(root, removeValue, avl, notes);
      frames.push({ root, focus: null, visited: [], caption: `Deleted ${removeValue}${notes.length ? `. ${notes.join('; ')}` : ''}` });
    } else {
      frames.push({ root, focus: null, visited: [], caption: `${removeValue} is not in the tree, so nothing is deleted` });
    }
  }
  if (order !== 'none') {
    const visit = traverse(root, order);
    visit.forEach((v, i) => frames.push({ root, focus: v, visited: visit.slice(0, i + 1), caption: `${order.replace('order', '-order')}: ${visit.slice(0, i + 1).join(', ')}` }));
  }
  return frames;
}

/** x from in-order position (0-1), y from depth, for drawing. */
export function layoutTree(root: TreeNode | null): { value: number; x: number; depth: number; parent: number | null }[] {
  const order = traverse(root, 'inorder');
  const out: { value: number; x: number; depth: number; parent: number | null }[] = [];
  const walk = (n: TreeNode | null, depth: number, parent: number | null) => {
    if (!n) return;
    out.push({ value: n.value, x: (order.indexOf(n.value) + 0.5) / order.length, depth, parent });
    walk(n.left, depth + 1, n.value);
    walk(n.right, depth + 1, n.value);
  };
  walk(root, 0, null);
  return out;
}

// ---------------- Graphs ----------------

export interface GraphFrame {
  current: number | null;
  visited: number[];
  /** Nodes waiting to be visited (queue, stack or open set). */
  frontier: number[];
  /** Dijkstra's best known distance per node; Infinity when unknown. */
  dist: number[];
  /** The edge just used, as [from, to]. */
  edge: [number, number] | null;
  /** Shortest path to the target, shown on the last frame. */
  path: number[];
  caption: string;
}

export const nodeName = (i: number) => String.fromCharCode(65 + i);

function neighbours(nodes: number, edges: Edge[]): { to: number; weight: number }[][] {
  const adj: { to: number; weight: number }[][] = Array.from({ length: nodes }, () => []);
  for (const e of edges) {
    adj[e.from].push({ to: e.to, weight: e.weight });
    adj[e.to].push({ to: e.from, weight: e.weight });
  }
  adj.forEach((list) => list.sort((a, b) => a.to - b.to));
  return adj;
}

export function graphFrames(nodes: number, edges: Edge[], algorithm: string, start: number, target: number): GraphFrame[] {
  const adj = neighbours(nodes, edges);
  const empty = Array<number>(nodes).fill(Infinity);
  const frames: GraphFrame[] = [];
  const name = nodeName;

  if (algorithm === 'dijkstra') {
    const dist = [...empty];
    const prev = Array<number | null>(nodes).fill(null);
    const done = new Set<number>();
    dist[start] = 0;
    frames.push({ current: null, visited: [], frontier: [start], dist: [...dist], edge: null, path: [], caption: `Start at ${name(start)} with distance 0` });
    while (done.size < nodes) {
      let u = -1;
      for (let i = 0; i < nodes; i++) if (!done.has(i) && dist[i] !== Infinity && (u === -1 || dist[i] < dist[u])) u = i;
      if (u === -1) break;
      done.add(u);
      frames.push({ current: u, visited: [...done], frontier: [], dist: [...dist], edge: null, path: [], caption: `Visit ${name(u)}, the closest unvisited node (${dist[u]})` });
      for (const { to, weight } of adj[u]) {
        if (done.has(to)) continue;
        if (dist[u] + weight < dist[to]) {
          dist[to] = dist[u] + weight;
          prev[to] = u;
          frames.push({ current: u, visited: [...done], frontier: [to], dist: [...dist], edge: [u, to], path: [], caption: `${name(to)} is reachable for ${dist[to]} through ${name(u)}` });
        }
      }
    }
    const path: number[] = [];
    if (dist[target] !== Infinity) for (let at: number | null = target; at !== null; at = prev[at]) path.unshift(at);
    frames.push({
      current: null, visited: [...done], frontier: [], dist: [...dist], edge: null, path,
      caption: path.length ? `Shortest path ${path.map(name).join(' → ')} costs ${dist[target]}` : `${name(target)} cannot be reached from ${name(start)}`,
    });
    return frames;
  }

  // BFS uses a queue, DFS a stack; both mark a node when it is first taken off.
  const visited: number[] = [];
  const parent = Array<number | null>(nodes).fill(null);
  const frontier = [start];
  const seen = new Set([start]);
  frames.push({ current: null, visited: [], frontier: [...frontier], dist: [...empty], edge: null, path: [], caption: `Start at ${name(start)}` });
  while (frontier.length) {
    const u = algorithm === 'dfs' ? frontier.pop()! : frontier.shift()!;
    if (algorithm === 'dfs' && visited.includes(u)) continue;
    visited.push(u);
    const via = parent[u];
    frames.push({ current: u, visited: [...visited], frontier: [...frontier], dist: [...empty], edge: via === null ? null : [via, u], path: [], caption: `Visit ${name(u)}` });
    const next = adj[u].map((n) => n.to);
    for (const to of algorithm === 'dfs' ? [...next].reverse() : next) {
      if (algorithm === 'bfs' ? seen.has(to) : visited.includes(to)) continue;
      seen.add(to);
      parent[to] = u;
      frontier.push(to);
    }
  }
  const path: number[] = [];
  if (visited.includes(target)) for (let at: number | null = target; at !== null; at = parent[at]) path.unshift(at);
  frames.push({
    current: null, visited: [...visited], frontier: [], dist: [...empty], edge: null, path,
    caption: `Visit order ${visited.map(name).join(', ')}${path.length ? `. Path to ${name(target)}: ${path.map(name).join(' → ')}` : ''}`,
  });
  return frames;
}

/** Nodes on a circle, for drawing. */
export const graphLayout = (nodes: number) =>
  Array.from({ length: nodes }, (_, i) => ({ x: 0.5 + 0.38 * Math.cos((2 * Math.PI * i) / nodes - Math.PI / 2), y: 0.5 + 0.38 * Math.sin((2 * Math.PI * i) / nodes - Math.PI / 2) }));
