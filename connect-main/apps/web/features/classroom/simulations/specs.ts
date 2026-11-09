// Controls for each built-in simulation. Ranges match the API
// (services/api/internal/livecanvas/simulations.go), which clamps whatever it receives.
import type { EngineName, SimParams } from '../liveCanvas';

export interface NumberControl { kind: 'number'; key: string; label: string; min: number; max: number; step: number; def: number; unit?: string }
export interface ChoiceControl { kind: 'choice'; key: string; label: string; options: { value: string; label: string }[]; def: string }
export type Control = NumberControl | ChoiceControl;
export interface Process { name: string; arrival: number; burst: number }

export const RUN_KEY = '_run';

const n = (key: string, label: string, min: number, max: number, step: number, def: number, unit?: string): NumberControl =>
  ({ kind: 'number', key, label, min, max, step, def, unit });
const c = (key: string, label: string, values: [string, string][], def: string): ChoiceControl =>
  ({ kind: 'choice', key, label, options: values.map(([value, text]) => ({ value, label: text })), def });

export const ENGINE_SPECS: Record<EngineName, { label: string; controls: Control[]; processes?: boolean }> = {
  projectile: {
    label: 'Projectile motion',
    controls: [n('angle', 'Launch angle', 5, 85, 1, 45, '°'), n('speed', 'Speed', 5, 50, 0.5, 20, 'm/s'), n('gravity', 'Gravity', 1, 25, 0.1, 9.8, 'm/s²'), n('height', 'Launch height', 0, 50, 1, 0, 'm')],
  },
  pendulum: {
    label: 'Pendulum',
    controls: [n('length', 'Length', 0.2, 5, 0.1, 1.5, 'm'), n('gravity', 'Gravity', 1, 25, 0.1, 9.8, 'm/s²'), n('amplitude', 'Amplitude', 5, 80, 1, 30, '°'), n('damping', 'Damping', 0, 0.5, 0.01, 0.05)],
  },
  function: {
    label: 'Function graph',
    controls: [
      c('family', 'Family', [['linear', 'Linear'], ['quadratic', 'Quadratic'], ['cubic', 'Cubic'], ['sine', 'Sine'], ['exponential', 'Exponential'], ['logarithm', 'Logarithm']], 'sine'),
      n('a', 'a', -10, 10, 0.1, 1), n('b', 'b', -10, 10, 0.1, 1), n('c', 'c', -10, 10, 0.1, 0),
    ],
  },
  scheduling: {
    label: 'CPU scheduling',
    controls: [c('algorithm', 'Algorithm', [['fcfs', 'First come, first served'], ['sjf', 'Shortest job first'], ['rr', 'Round robin']], 'rr'), n('quantum', 'Time quantum', 1, 8, 1, 2)],
    processes: true,
  },
  sorting: {
    label: 'Sorting',
    controls: [
      c('algorithm', 'Algorithm', [['bubble', 'Bubble'], ['insertion', 'Insertion'], ['selection', 'Selection'], ['merge', 'Merge'], ['quick', 'Quick']], 'bubble'),
      n('size', 'Items', 5, 40, 1, 16), n('speed', 'Steps per second', 1, 10, 0.5, 4), n('seed', 'Shuffle', 1, 999, 1, 7),
    ],
  },
  logic: {
    label: 'Logic circuit',
    controls: [
      c('circuit', 'Circuit', [['and', 'AND'], ['or', 'OR'], ['not', 'NOT'], ['nand', 'NAND'], ['nor', 'NOR'], ['xor', 'XOR'], ['xnor', 'XNOR'], ['half_adder', 'Half adder'], ['full_adder', 'Full adder']], 'xor'),
      n('a', 'Input A', 0, 1, 1, 0), n('b', 'Input B', 0, 1, 1, 1), n('c', 'Input C (carry in)', 0, 1, 1, 0),
    ],
  },
  perceptron: {
    label: 'Perceptron',
    controls: [c('dataset', 'Data', [['and', 'AND'], ['or', 'OR'], ['xor', 'XOR']], 'and'), n('w1', 'Weight w1', -3, 3, 0.05, 1), n('w2', 'Weight w2', -3, 3, 0.05, 1), n('bias', 'Bias', -3, 3, 0.05, -1.5)],
  },
};

const DEFAULT_PROCESSES: Process[] = [{ name: 'P1', arrival: 0, burst: 5 }, { name: 'P2', arrival: 1, burst: 3 }, { name: 'P3', arrival: 2, burst: 8 }, { name: 'P4', arrival: 3, burst: 2 }];

const clampTo = (v: number, min: number, max: number, integer: boolean) => {
  const x = Math.min(max, Math.max(min, v));
  return integer ? Math.round(x) : Math.round(x * 1000) / 1000;
};

export function readProcesses(value: unknown): Process[] {
  if (!Array.isArray(value)) return DEFAULT_PROCESSES.map((p) => ({ ...p }));
  const out: Process[] = [];
  value.slice(0, 6).forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 8) : `P${i + 1}`;
    const arrival = clampTo(Number(p.arrival) || 0, 0, 20, true);
    const burst = clampTo(Number(p.burst) || 1, 1, 15, true);
    out.push({ name, arrival, burst });
  });
  return out.length ? out : DEFAULT_PROCESSES.map((p) => ({ ...p }));
}

/** Known keys only, numbers clamped, choices checked, defaults filled in. */
export function normalizeParams(engine: EngineName, raw: SimParams | null | undefined): SimParams {
  const spec = ENGINE_SPECS[engine];
  const source = raw ?? {};
  const out: SimParams = {};
  for (const control of spec.controls) {
    const value = source[control.key];
    if (control.kind === 'number') {
      const num = typeof value === 'number' && Number.isFinite(value) ? value : control.def;
      out[control.key] = clampTo(num, control.min, control.max, Number.isInteger(control.step));
    } else {
      out[control.key] = control.options.some((o) => o.value === value) ? value : control.def;
    }
  }
  if (spec.processes) out.processes = readProcesses(source.processes);
  const run = Number(source[RUN_KEY]);
  out[RUN_KEY] = Number.isFinite(run) ? clampTo(run, 0, 1e9, true) : 0;
  return out;
}

export const num = (params: SimParams, key: string) => Number(params[key]) || 0;
export const str = (params: SimParams, key: string) => String(params[key] ?? '');
