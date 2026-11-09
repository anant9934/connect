// Draws each built-in simulation from its settings and the seconds since it was (re)started.
// Pure functions of (params, t), so every screen shows the same picture for the same state.
import type { EngineName, SimParams } from '../liveCanvas';
import { num, readEdges, readProcesses, readValues, str, type Process } from './specs';
import { graphFrames, graphLayout, layoutTree, nodeName, treeFrames } from './structures';

const C = {
  ink: '#17171A', muted: '#5F5F68', faint: '#8B8B93', hairline: '#ECECE6', grid: '#F1F0EC',
  violet: '#7444E8', violetTint: '#F1EBFF', marigold: '#FFC93C', marigoldTint: '#FFF4D1',
  mint: '#2DBE74', mintTint: '#E4F8EB', coral: '#FF6B6B', coralTint: '#FFE9E9', white: '#FFFFFF',
};

export interface Readout { label: string; value: string }
type Ctx = CanvasRenderingContext2D;

const font = (ctx: Ctx, size: number, weight = 500, mono = false) => {
  ctx.font = `${weight} ${size}px ${mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'system-ui, -apple-system, sans-serif'}`;
};
const fmt = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '—');

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------- Projectile ----------
function projectile(ctx: Ctx, w: number, h: number, p: SimParams, t: number): Readout[] {
  const angle = (num(p, 'angle') * Math.PI) / 180;
  const v = num(p, 'speed');
  const g = num(p, 'gravity');
  const h0 = num(p, 'height');
  const vx = v * Math.cos(angle);
  const vy = v * Math.sin(angle);
  const flight = (vy + Math.sqrt(vy * vy + 2 * g * h0)) / g;
  const range = vx * flight;
  const peak = h0 + (vy * vy) / (2 * g);
  const pad = 36;
  const scale = Math.min((w - pad * 2) / Math.max(range, 1), (h - pad * 2) / Math.max(peak, 1));
  const X = (x: number) => pad + x * scale;
  const Y = (y: number) => h - pad - y * scale;

  ctx.strokeStyle = C.hairline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad - 10, Y(0));
  ctx.lineTo(w - pad + 10, Y(0));
  ctx.stroke();
  if (h0 > 0) {
    ctx.fillStyle = C.marigoldTint;
    ctx.fillRect(X(0) - 14, Y(h0), 14, h0 * scale);
  }
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = C.violet;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  for (let i = 0; i <= 80; i++) {
    const s = (flight * i) / 80;
    const x = X(vx * s);
    const y = Y(h0 + vy * s - 0.5 * g * s * s);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const s = Math.min(t % (flight + 1.2), flight);
  const bx = X(vx * s);
  const by = Y(h0 + vy * s - 0.5 * g * s * s);
  // Velocity arrow
  const cvx = vx;
  const cvy = vy - g * s;
  ctx.strokeStyle = C.marigold;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + cvx * 1.6, by - cvy * 1.6);
  ctx.stroke();
  ctx.fillStyle = C.violet;
  ctx.beginPath();
  ctx.arc(bx, by, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = C.muted;
  font(ctx, 12);
  ctx.fillText(`${fmt(range, 1)} m`, X(range) - 20, Y(0) + 18);
  return [
    { label: 'Range', value: `${fmt(range, 1)} m` },
    { label: 'Max height', value: `${fmt(peak, 1)} m` },
    { label: 'Flight time', value: `${fmt(flight, 2)} s` },
    { label: 'Time', value: `${fmt(s, 2)} s` },
  ];
}

// ---------- Pendulum (small-angle model with damping) ----------
function pendulum(ctx: Ctx, w: number, h: number, p: SimParams, t: number): Readout[] {
  const L = num(p, 'length');
  const g = num(p, 'gravity');
  const amp = (num(p, 'amplitude') * Math.PI) / 180;
  const damping = num(p, 'damping');
  const omega = Math.sqrt(g / L);
  const theta = amp * Math.exp(-damping * t) * Math.cos(omega * t);
  const pivotX = w / 2;
  const pivotY = 40;
  const scale = (h - 100) / 5;
  const len = L * scale;
  const bx = pivotX + len * Math.sin(theta);
  const by = pivotY + len * Math.cos(theta);

  ctx.strokeStyle = C.violetTint;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, len, Math.PI / 2 - amp, Math.PI / 2 + amp);
  ctx.stroke();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pivotX - 60, pivotY);
  ctx.lineTo(pivotX + 60, pivotY);
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.fillStyle = C.marigold;
  ctx.beginPath();
  ctx.arc(bx, by, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  return [
    { label: 'Period', value: `${fmt((2 * Math.PI) / omega, 2)} s` },
    { label: 'Angle', value: `${fmt((theta * 180) / Math.PI, 1)}°` },
    { label: 'Time', value: `${fmt(t, 1)} s` },
    { label: 'Model', value: 'Small-angle' },
  ];
}

// ---------- Function graph ----------
export function evaluateFunction(family: string, a: number, b: number, c: number, x: number): number {
  switch (family) {
    case 'linear': return a * x + b;
    case 'quadratic': return a * x * x + b * x + c;
    case 'cubic': return a * x * x * x + b * x + c;
    case 'sine': return a * Math.sin(b * x + c);
    case 'exponential': return a * Math.exp(b * x) + c;
    case 'logarithm': return b * x > 0 ? a * Math.log(b * x) + c : NaN;
    default: return NaN;
  }
}

const formula = (family: string, a: number, b: number, c: number) => {
  const k = (v: number) => (Math.round(v * 100) / 100).toString();
  switch (family) {
    case 'linear': return `y = ${k(a)}x + ${k(b)}`;
    case 'quadratic': return `y = ${k(a)}x² + ${k(b)}x + ${k(c)}`;
    case 'cubic': return `y = ${k(a)}x³ + ${k(b)}x + ${k(c)}`;
    case 'sine': return `y = ${k(a)}·sin(${k(b)}x + ${k(c)})`;
    case 'exponential': return `y = ${k(a)}·e^(${k(b)}x) + ${k(c)}`;
    default: return `y = ${k(a)}·ln(${k(b)}x) + ${k(c)}`;
  }
};

function graph(ctx: Ctx, w: number, h: number, p: SimParams, t: number): Readout[] {
  const family = str(p, 'family');
  const a = num(p, 'a');
  const b = num(p, 'b');
  const c = num(p, 'c');
  const R = 10;
  const X = (x: number) => ((x + R) / (2 * R)) * w;
  const Y = (y: number) => h / 2 - (y / R) * (h / 2) * (w / h > 1.4 ? 1 : 1);
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let i = -R; i <= R; i++) {
    ctx.beginPath();
    ctx.moveTo(X(i), 0);
    ctx.lineTo(X(i), h);
    ctx.moveTo(0, Y(i));
    ctx.lineTo(w, Y(i));
    ctx.stroke();
  }
  ctx.strokeStyle = C.faint;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(X(0), 0);
  ctx.lineTo(X(0), h);
  ctx.moveTo(0, Y(0));
  ctx.lineTo(w, Y(0));
  ctx.stroke();

  ctx.strokeStyle = C.violet;
  ctx.lineWidth = 3;
  ctx.beginPath();
  let drawing = false;
  for (let px = 0; px <= w; px += 2) {
    const x = (px / w) * 2 * R - R;
    const y = evaluateFunction(family, a, b, c, x);
    if (!Number.isFinite(y) || Math.abs(y) > R * 4) {
      drawing = false;
      continue;
    }
    if (!drawing) ctx.moveTo(px, Y(y));
    else ctx.lineTo(px, Y(y));
    drawing = true;
  }
  ctx.stroke();

  const tx = ((t * 2) % (2 * R)) - R;
  const ty = evaluateFunction(family, a, b, c, tx);
  if (Number.isFinite(ty) && Math.abs(ty) <= R) {
    ctx.fillStyle = C.marigold;
    ctx.beginPath();
    ctx.arc(X(tx), Y(ty), 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = C.ink;
  font(ctx, 15, 700, true);
  ctx.fillText(formula(family, a, b, c), 14, 24);
  return [
    { label: 'Formula', value: formula(family, a, b, c) },
    { label: 'x', value: fmt(tx, 2) },
    { label: 'y', value: fmt(ty, 2) },
  ];
}

// ---------- CPU scheduling ----------
export interface Slice { name: string; start: number; end: number }
export interface ScheduleResult { slices: Slice[]; rows: { name: string; arrival: number; burst: number; finish: number; waiting: number; turnaround: number }[] }

export function schedule(processes: Process[], algorithm: string, quantum: number): ScheduleResult {
  const jobs = processes.map((p, i) => ({ ...p, i, left: p.burst, finish: 0 }));
  const slices: Slice[] = [];
  const push = (name: string, start: number, end: number) => {
    const last = slices[slices.length - 1];
    if (last && last.name === name && last.end === start) last.end = end;
    else slices.push({ name, start, end });
  };
  let time = 0;
  if (algorithm === 'rr') {
    const order = [...jobs].sort((a, b) => a.arrival - b.arrival || a.i - b.i);
    const queue: typeof jobs = [];
    let next = 0;
    const admit = () => {
      while (next < order.length && order[next].arrival <= time) queue.push(order[next++]);
    };
    admit();
    while (queue.length || next < order.length) {
      if (!queue.length) {
        time = order[next].arrival;
        admit();
        continue;
      }
      const job = queue.shift()!;
      const run = Math.min(quantum, job.left);
      push(job.name, time, time + run);
      time += run;
      job.left -= run;
      admit();
      if (job.left > 0) queue.push(job);
      else job.finish = time;
    }
  } else {
    const pending = [...jobs];
    while (pending.length) {
      const ready = pending.filter((j) => j.arrival <= time);
      if (!ready.length) {
        time = Math.min(...pending.map((j) => j.arrival));
        continue;
      }
      ready.sort((a, b) => (algorithm === 'sjf' ? a.burst - b.burst : 0) || a.arrival - b.arrival || a.i - b.i);
      const job = ready[0];
      push(job.name, time, time + job.burst);
      time += job.burst;
      job.finish = time;
      pending.splice(pending.indexOf(job), 1);
    }
  }
  return {
    slices,
    rows: jobs.map((j) => ({ name: j.name, arrival: j.arrival, burst: j.burst, finish: j.finish, turnaround: j.finish - j.arrival, waiting: j.finish - j.arrival - j.burst })),
  };
}

const LANE_COLORS = [C.violet, C.marigold, C.mint, C.coral, '#9B7BF0', '#F2BD31'];

function scheduling(ctx: Ctx, w: number, h: number, p: SimParams, t: number): Readout[] {
  const processes = readProcesses(p.processes);
  const result = schedule(processes, str(p, 'algorithm'), Math.max(1, num(p, 'quantum')));
  const total = result.slices.length ? result.slices[result.slices.length - 1].end : 1;
  const now = Math.min(total, t * 2);
  const pad = 24;
  const barTop = 40;
  const barH = 44;
  const unit = (w - pad * 2) / total;
  font(ctx, 12, 600);
  result.slices.forEach((s) => {
    if (s.start >= now) return;
    const end = Math.min(s.end, now);
    const color = LANE_COLORS[processes.findIndex((pr) => pr.name === s.name) % LANE_COLORS.length];
    ctx.fillStyle = color;
    roundRect(ctx, pad + s.start * unit, barTop, Math.max(1, (end - s.start) * unit - 2), barH, 6);
    ctx.fill();
    ctx.fillStyle = color === C.marigold ? C.ink : C.white;
    if ((end - s.start) * unit > 24) ctx.fillText(s.name, pad + s.start * unit + 6, barTop + 27);
  });
  ctx.fillStyle = C.muted;
  font(ctx, 11);
  const step = total > 30 ? 5 : total > 15 ? 2 : 1;
  for (let k = 0; k <= total; k += step) ctx.fillText(String(k), pad + k * unit - 3, barTop + barH + 16);
  ctx.strokeStyle = C.ink;
  ctx.beginPath();
  ctx.moveTo(pad + now * unit, barTop - 8);
  ctx.lineTo(pad + now * unit, barTop + barH + 4);
  ctx.stroke();

  // Results table, revealed as each job finishes.
  const tableTop = barTop + barH + 44;
  const cols = ['Job', 'Arrival', 'Burst', 'Finish', 'Waiting', 'Turnaround'];
  const colW = (w - pad * 2) / cols.length;
  font(ctx, 12, 700);
  ctx.fillStyle = C.ink;
  cols.forEach((col, i) => ctx.fillText(col, pad + i * colW, tableTop));
  font(ctx, 12, 500, true);
  result.rows.forEach((r, row) => {
    const y = tableTop + 22 * (row + 1);
    if (y > h - 8) return;
    const done = r.finish <= now;
    const cells = [r.name, r.arrival, r.burst, done ? r.finish : '…', done ? r.waiting : '…', done ? r.turnaround : '…'];
    ctx.fillStyle = done ? C.ink : C.faint;
    cells.forEach((cell, i) => ctx.fillText(String(cell), pad + i * colW, y));
  });
  const avg = (key: 'waiting' | 'turnaround') => result.rows.reduce((s, r) => s + r[key], 0) / Math.max(1, result.rows.length);
  return [
    { label: 'Avg waiting', value: now >= total ? fmt(avg('waiting'), 2) : '…' },
    { label: 'Avg turnaround', value: now >= total ? fmt(avg('turnaround'), 2) : '…' },
    { label: 'Context switches', value: String(Math.max(0, result.slices.length - 1)) },
    { label: 'Clock', value: `${fmt(now, 1)} / ${total}` },
  ];
}

// ---------- Sorting ----------
interface SortStep { values: number[]; compare: number[]; swap: number[]; sorted: number[] }
const sortCache = new Map<string, { steps: SortStep[]; comparisons: number[]; swaps: number[] }>();

export function sortSteps(algorithm: string, size: number, seed: number) {
  const key = `${algorithm}:${size}:${seed}`;
  const cached = sortCache.get(key);
  if (cached) return cached;
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const a = Array.from({ length: size }, () => 1 + Math.floor(rand() * 99));
  const steps: SortStep[] = [];
  const comparisons: number[] = [];
  const swaps: number[] = [];
  let cmp = 0;
  let swp = 0;
  const done = new Set<number>();
  const snap = (compare: number[], swap: number[] = []) => {
    steps.push({ values: [...a], compare, swap, sorted: [...done] });
    comparisons.push(cmp);
    swaps.push(swp);
  };
  const swap = (i: number, j: number) => {
    [a[i], a[j]] = [a[j], a[i]];
    swp++;
    snap([], [i, j]);
  };
  snap([]);
  if (algorithm === 'bubble') {
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size - i - 1; j++) {
        cmp++;
        snap([j, j + 1]);
        if (a[j] > a[j + 1]) swap(j, j + 1);
      }
      done.add(size - i - 1);
    }
  } else if (algorithm === 'insertion') {
    for (let i = 1; i < size; i++) {
      for (let j = i; j > 0; j--) {
        cmp++;
        snap([j - 1, j]);
        if (a[j - 1] > a[j]) swap(j - 1, j);
        else break;
      }
    }
  } else if (algorithm === 'selection') {
    for (let i = 0; i < size; i++) {
      let min = i;
      for (let j = i + 1; j < size; j++) {
        cmp++;
        snap([min, j]);
        if (a[j] < a[min]) min = j;
      }
      if (min !== i) swap(i, min);
      done.add(i);
    }
  } else if (algorithm === 'merge') {
    const merge = (lo: number, hi: number) => {
      if (hi - lo < 1) return;
      const mid = Math.floor((lo + hi) / 2);
      merge(lo, mid);
      merge(mid + 1, hi);
      const left = a.slice(lo, mid + 1);
      const right = a.slice(mid + 1, hi + 1);
      let i = 0;
      let j = 0;
      for (let k = lo; k <= hi; k++) {
        if (j >= right.length || (i < left.length && left[i] <= right[j])) {
          if (j < right.length) cmp++;
          a[k] = left[i++];
        } else {
          cmp++;
          a[k] = right[j++];
        }
        swp++;
        snap([k], [k]);
      }
    };
    merge(0, size - 1);
  } else {
    const quick = (lo: number, hi: number) => {
      if (lo >= hi) {
        if (lo === hi) done.add(lo);
        return;
      }
      const pivot = a[hi];
      let i = lo;
      for (let j = lo; j < hi; j++) {
        cmp++;
        snap([j, hi]);
        if (a[j] < pivot) {
          if (i !== j) swap(i, j);
          i++;
        }
      }
      if (i !== hi) swap(i, hi);
      done.add(i);
      quick(lo, i - 1);
      quick(i + 1, hi);
    };
    quick(0, size - 1);
  }
  for (let i = 0; i < size; i++) done.add(i);
  snap([]);
  const result = { steps, comparisons, swaps };
  if (sortCache.size > 40) sortCache.clear();
  sortCache.set(key, result);
  return result;
}

function sorting(ctx: Ctx, w: number, h: number, p: SimParams, t: number): Readout[] {
  const { steps, comparisons, swaps } = sortSteps(str(p, 'algorithm'), Math.round(num(p, 'size')), Math.round(num(p, 'seed')));
  const index = Math.min(steps.length - 1, Math.floor(t * num(p, 'speed')));
  const step = steps[index];
  const pad = 20;
  const gap = 3;
  const barW = (w - pad * 2) / step.values.length;
  step.values.forEach((v, i) => {
    const bh = (v / 100) * (h - pad * 2 - 20);
    ctx.fillStyle = step.swap.includes(i) ? C.marigold : step.compare.includes(i) ? C.violet : step.sorted.includes(i) ? C.mint : '#D9D6CE';
    roundRect(ctx, pad + i * barW + gap / 2, h - pad - bh, Math.max(2, barW - gap), bh, 4);
    ctx.fill();
  });
  return [
    { label: 'Step', value: `${index} / ${steps.length - 1}` },
    { label: 'Comparisons', value: String(comparisons[index]) },
    { label: str(p, 'algorithm') === 'merge' ? 'Writes' : 'Swaps', value: String(swaps[index]) },
  ];
}

// ---------- Logic circuits ----------
export function logicOutputs(circuit: string, a: number, b: number, c: number): { label: string; value: number }[] {
  const A = a === 1;
  const B = b === 1;
  const Cin = c === 1;
  const v = (x: boolean) => (x ? 1 : 0);
  switch (circuit) {
    case 'and': return [{ label: 'Q', value: v(A && B) }];
    case 'or': return [{ label: 'Q', value: v(A || B) }];
    case 'not': return [{ label: 'Q', value: v(!A) }];
    case 'nand': return [{ label: 'Q', value: v(!(A && B)) }];
    case 'nor': return [{ label: 'Q', value: v(!(A || B)) }];
    case 'xor': return [{ label: 'Q', value: v(A !== B) }];
    case 'xnor': return [{ label: 'Q', value: v(A === B) }];
    case 'half_adder': return [{ label: 'Sum', value: v(A !== B) }, { label: 'Carry', value: v(A && B) }];
    default: return [{ label: 'Sum', value: v((A !== B) !== Cin) }, { label: 'Carry', value: v((A && B) || (Cin && A !== B)) }];
  }
}

function logic(ctx: Ctx, w: number, h: number, p: SimParams): Readout[] {
  const circuit = str(p, 'circuit');
  const inputs = circuit === 'not' ? ['a'] : circuit === 'full_adder' ? ['a', 'b', 'c'] : ['a', 'b'];
  const values = inputs.map((k) => num(p, k));
  const outputs = logicOutputs(circuit, num(p, 'a'), num(p, 'b'), num(p, 'c'));
  const boxW = Math.min(180, w * 0.28);
  const boxH = 54 + 34 * Math.max(inputs.length, outputs.length);
  const left = w * 0.08;
  const boxX = w * 0.36 - boxW / 2;
  const boxY = Math.max(20, h * 0.42 - boxH / 2);
  const wire = (on: number) => (on ? C.mint : '#C9C6BD');
  inputs.forEach((k, i) => {
    const y = boxY + 40 + i * 34;
    ctx.strokeStyle = wire(values[i]);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(left + 18, y);
    ctx.lineTo(boxX, y);
    ctx.stroke();
    ctx.fillStyle = values[i] ? C.mint : C.white;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(left, y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.ink;
    font(ctx, 13, 700);
    ctx.fillText(`${k.toUpperCase()}=${values[i]}`, left - 14, y - 22);
  });
  ctx.fillStyle = C.violetTint;
  ctx.strokeStyle = C.violet;
  ctx.lineWidth = 2;
  roundRect(ctx, boxX, boxY, boxW, boxH, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.violet;
  font(ctx, 16, 800);
  const name = circuit.replace('_', ' ').toUpperCase();
  ctx.fillText(name, boxX + boxW / 2 - ctx.measureText(name).width / 2, boxY + 26);
  outputs.forEach((o, i) => {
    const y = boxY + 40 + i * 34;
    const lampX = boxX + boxW + 80;
    ctx.strokeStyle = wire(o.value);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(boxX + boxW, y);
    ctx.lineTo(lampX - 18, y);
    ctx.stroke();
    ctx.fillStyle = o.value ? C.marigold : C.white;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(lampX, y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.ink;
    font(ctx, 13, 700);
    ctx.fillText(`${o.label}=${o.value}`, lampX + 26, y + 5);
  });

  // Truth table with the current row marked.
  const tx = w * 0.72;
  const header = [...inputs.map((k) => k.toUpperCase()), ...outputs.map((o) => o.label)];
  const rowH = 20;
  const colW = Math.min(52, (w - tx - 10) / header.length);
  font(ctx, 12, 700);
  ctx.fillStyle = C.ink;
  header.forEach((cell, i) => ctx.fillText(cell, tx + i * colW, 30));
  font(ctx, 12, 500, true);
  for (let row = 0; row < 1 << inputs.length; row++) {
    const bits = inputs.map((_, i) => (row >> (inputs.length - 1 - i)) & 1);
    const vals = { a: bits[0] ?? 0, b: bits[1] ?? 0, c: bits[2] ?? 0 };
    const outs = logicOutputs(circuit, vals.a, vals.b, vals.c).map((o) => o.value);
    const y = 30 + rowH * (row + 1);
    if (bits.every((bit, i) => bit === values[i])) {
      ctx.fillStyle = C.marigoldTint;
      ctx.fillRect(tx - 6, y - 14, colW * header.length + 6, rowH);
    }
    ctx.fillStyle = C.ink;
    [...bits, ...outs].forEach((cell, i) => ctx.fillText(String(cell), tx + i * colW, y));
  }
  return outputs.map((o) => ({ label: o.label, value: String(o.value) }));
}

// ---------- Perceptron ----------
const DATASETS: Record<string, [number, number, number][]> = {
  and: [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 1]],
  or: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]],
  xor: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]],
};

export function perceptronAccuracy(dataset: string, w1: number, w2: number, bias: number) {
  const points = DATASETS[dataset] ?? DATASETS.and;
  return points.filter(([x, y, label]) => (w1 * x + w2 * y + bias > 0 ? 1 : 0) === label).length;
}

function perceptron(ctx: Ctx, w: number, h: number, p: SimParams): Readout[] {
  const dataset = str(p, 'dataset');
  const w1 = num(p, 'w1');
  const w2 = num(p, 'w2');
  const bias = num(p, 'bias');
  const size = Math.min(w, h) - 60;
  const ox = (w - size) / 2;
  const oy = (h - size) / 2;
  const lo = -0.5;
  const hi = 1.5;
  const X = (x: number) => ox + ((x - lo) / (hi - lo)) * size;
  const Y = (y: number) => oy + size - ((y - lo) / (hi - lo)) * size;
  // Shade the region the perceptron calls 1.
  const cells = 40;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = lo + ((i + 0.5) / cells) * (hi - lo);
      const y = lo + ((j + 0.5) / cells) * (hi - lo);
      ctx.fillStyle = w1 * x + w2 * y + bias > 0 ? C.mintTint : C.coralTint;
      ctx.fillRect(X(lo + (i / cells) * (hi - lo)), Y(lo + ((j + 1) / cells) * (hi - lo)), size / cells + 1, size / cells + 1);
    }
  }
  ctx.strokeStyle = C.hairline;
  ctx.strokeRect(ox, oy, size, size);
  // Decision boundary w1 x + w2 y + b = 0.
  ctx.strokeStyle = C.violet;
  ctx.lineWidth = 3;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, size, size);
  ctx.clip();
  ctx.beginPath();
  if (Math.abs(w2) > 1e-6) {
    ctx.moveTo(X(lo), Y((-bias - w1 * lo) / w2));
    ctx.lineTo(X(hi), Y((-bias - w1 * hi) / w2));
  } else if (Math.abs(w1) > 1e-6) {
    ctx.moveTo(X(-bias / w1), Y(lo));
    ctx.lineTo(X(-bias / w1), Y(hi));
  }
  ctx.stroke();
  ctx.restore();
  for (const [x, y, label] of DATASETS[dataset] ?? DATASETS.and) {
    const correct = (w1 * x + w2 * y + bias > 0 ? 1 : 0) === label;
    ctx.fillStyle = label ? C.mint : C.coral;
    ctx.strokeStyle = correct ? C.ink : C.marigold;
    ctx.lineWidth = correct ? 1.5 : 4;
    ctx.beginPath();
    ctx.arc(X(x), Y(y), 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.ink;
    font(ctx, 11, 600);
    ctx.fillText(`(${x},${y})→${label}`, X(x) + 15, Y(y) - 10);
  }
  const correct = perceptronAccuracy(dataset, w1, w2, bias);
  return [
    { label: 'Correct', value: `${correct} / 4` },
    { label: 'Boundary', value: `${fmt(w1)}x + ${fmt(w2)}y + ${fmt(bias)} = 0` },
    ...(dataset === 'xor' ? [{ label: 'Note', value: 'No single line separates XOR' }] : []),
  ];
}

// ---------- Search trees ----------
function tree(ctx: Ctx, w: number, h: number, p: SimParams, t: number): Readout[] {
  const frames = treeFrames(readValues(p.values), str(p, 'kind'), Math.round(num(p, 'remove')), str(p, 'traversal'));
  const index = Math.min(frames.length - 1, Math.floor(t * num(p, 'speed')));
  const frame = frames[index];
  const nodes = layoutTree(frame.root);
  const depth = Math.max(1, ...nodes.map((n) => n.depth + 1));
  const top = 56;
  const rowH = Math.min(80, (h - top - 30) / depth);
  const pos = new Map(nodes.map((n) => [n.value, { x: 24 + n.x * (w - 48), y: top + n.depth * rowH }]));
  ctx.strokeStyle = '#C9C6BD';
  ctx.lineWidth = 2;
  for (const n of nodes) {
    if (n.parent === null) continue;
    const a = pos.get(n.parent)!;
    const b = pos.get(n.value)!;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  const r = Math.max(14, Math.min(22, (w - 48) / (nodes.length + 1) / 2.2));
  for (const n of nodes) {
    const { x, y } = pos.get(n.value)!;
    const focus = frame.focus === n.value;
    ctx.fillStyle = focus ? C.marigold : frame.visited.includes(n.value) ? C.mint : C.violetTint;
    ctx.strokeStyle = focus ? C.ink : C.violet;
    ctx.lineWidth = focus ? 3 : 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.ink;
    font(ctx, 13, 700);
    const label = String(n.value);
    ctx.fillText(label, x - ctx.measureText(label).width / 2, y + 4.5);
  }
  ctx.fillStyle = C.ink;
  font(ctx, 14, 600);
  ctx.fillText(frame.caption.slice(0, Math.floor(w / 7.5)), 16, 28);
  const hgt = nodes.length ? Math.max(...nodes.map((n) => n.depth)) + 1 : 0;
  return [
    { label: 'Step', value: `${index} / ${frames.length - 1}` },
    { label: 'Nodes', value: String(nodes.length) },
    { label: 'Height', value: String(hgt) },
    ...(frame.visited.length ? [{ label: 'Visited', value: frame.visited.join(' ') }] : []),
  ];
}

// ---------- Graph searches ----------
function graphSearch(ctx: Ctx, w: number, h: number, p: SimParams, t: number): Readout[] {
  const nodes = Math.round(num(p, 'nodes'));
  const edges = readEdges(p.edges, nodes);
  const algorithm = str(p, 'algorithm');
  const start = Math.round(num(p, 'start'));
  const target = Math.round(num(p, 'target'));
  const frames = graphFrames(nodes, edges, algorithm, start, target);
  const index = Math.min(frames.length - 1, Math.floor(t * num(p, 'speed')));
  const frame = frames[index];
  const size = Math.min(w, h - 40);
  const ox = (w - size) / 2;
  const oy = 40;
  const pts = graphLayout(nodes).map((q) => ({ x: ox + q.x * size, y: oy + q.y * size }));
  const onPath = (a: number, b: number) => {
    const i = frame.path.indexOf(a);
    return i !== -1 && (frame.path[i + 1] === b || frame.path[i - 1] === b);
  };
  for (const e of edges) {
    const a = pts[e.from];
    const b = pts[e.to];
    const active = frame.edge && ((frame.edge[0] === e.from && frame.edge[1] === e.to) || (frame.edge[0] === e.to && frame.edge[1] === e.from));
    ctx.strokeStyle = onPath(e.from, e.to) ? C.marigold : active ? C.violet : '#D9D6CE';
    ctx.lineWidth = onPath(e.from, e.to) ? 6 : active ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (algorithm === 'dijkstra') {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.fillStyle = C.white;
      roundRect(ctx, mx - 11, my - 10, 22, 18, 6);
      ctx.fill();
      ctx.fillStyle = C.muted;
      font(ctx, 11, 700);
      const label = String(e.weight);
      ctx.fillText(label, mx - ctx.measureText(label).width / 2, my + 3);
    }
  }
  pts.forEach((q, i) => {
    const current = frame.current === i;
    ctx.fillStyle = current ? C.marigold : frame.visited.includes(i) ? C.mint : frame.frontier.includes(i) ? C.violetTint : C.white;
    ctx.strokeStyle = i === target ? C.coral : current ? C.ink : C.violet;
    ctx.lineWidth = i === target || current ? 3 : 2;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.ink;
    font(ctx, 14, 800);
    ctx.fillText(nodeName(i), q.x - 5, q.y + 5);
    if (algorithm === 'dijkstra') {
      font(ctx, 11, 600, true);
      ctx.fillStyle = C.muted;
      const d = frame.dist[i];
      ctx.fillText(d === Infinity ? '∞' : String(d), q.x - 6, q.y + 36);
    }
  });
  ctx.fillStyle = C.ink;
  font(ctx, 14, 600);
  ctx.fillText(frame.caption.slice(0, Math.floor(w / 7.5)), 16, 24);
  return [
    { label: 'Step', value: `${index} / ${frames.length - 1}` },
    { label: 'Visited', value: frame.visited.map(nodeName).join(' ') || '—' },
    { label: algorithm === 'dfs' ? 'Stack' : algorithm === 'bfs' ? 'Queue' : 'Updated', value: frame.frontier.map(nodeName).join(' ') || '—' },
  ];
}

/** Draws one frame and returns the numbers to show beside it. */
export function drawSimulation(ctx: Ctx, w: number, h: number, engine: EngineName, params: SimParams, t: number): Readout[] {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, w, h);
  switch (engine) {
    case 'projectile': return projectile(ctx, w, h, params, t);
    case 'pendulum': return pendulum(ctx, w, h, params, t);
    case 'function': return graph(ctx, w, h, params, t);
    case 'scheduling': return scheduling(ctx, w, h, params, t);
    case 'sorting': return sorting(ctx, w, h, params, t);
    case 'logic': return logic(ctx, w, h, params);
    case 'perceptron': return perceptron(ctx, w, h, params);
    case 'tree': return tree(ctx, w, h, params, t);
    case 'graph': return graphSearch(ctx, w, h, params, t);
    default: return [];
  }
}
