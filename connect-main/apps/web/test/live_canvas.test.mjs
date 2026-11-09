// Logic of the live canvas simulations, run directly from TypeScript (Node strips the types).
import { register } from 'node:module';
import { test, describe } from 'node:test';
import assert from 'node:assert';

// Resolve the extensionless relative imports the app uses to their .ts files.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\\.[a-z]+$/.test(specifier)) {
    try { return await next(specifier + '.ts', context); } catch {}
  }
  return next(specifier, context);
}`)
);

const specs = await import('../features/classroom/simulations/specs.ts');
const engines = await import('../features/classroom/simulations/engines.ts');

describe('simulation settings', () => {
  test('clamps, defaults and drops unknown keys like the API', () => {
    const p = specs.normalizeParams('projectile', { angle: 400, speed: 'fast', evil: '<script>', _run: 3 });
    assert.strictEqual(p.angle, 85);
    assert.strictEqual(p.speed, 20);
    assert.strictEqual(p._run, 3);
    assert.ok(!('evil' in p));
    assert.strictEqual(specs.normalizeParams('logic', { circuit: 'rm -rf' }).circuit, 'xor');
    const procs = specs.normalizeParams('scheduling', { processes: Array(9).fill({ name: 'a-very-long-name', arrival: -4, burst: 99 }) }).processes;
    assert.strictEqual(procs.length, 6);
    assert.deepStrictEqual(procs[0], { name: 'a-very-l', arrival: 0, burst: 15 });
  });
});

describe('CPU scheduling', () => {
  const procs = [{ name: 'P1', arrival: 0, burst: 5 }, { name: 'P2', arrival: 1, burst: 3 }, { name: 'P3', arrival: 2, burst: 1 }];
  test('first come, first served', () => {
    const r = engines.schedule(procs, 'fcfs', 2);
    assert.deepStrictEqual(r.slices.map((s) => [s.name, s.start, s.end]), [['P1', 0, 5], ['P2', 5, 8], ['P3', 8, 9]]);
    assert.deepStrictEqual(r.rows.map((x) => x.waiting), [0, 4, 6]);
  });
  test('shortest job first picks the shortest ready job', () => {
    const r = engines.schedule(procs, 'sjf', 2);
    assert.deepStrictEqual(r.slices.map((s) => s.name), ['P1', 'P3', 'P2']);
  });
  test('round robin rotates by quantum and admits arrivals before requeueing', () => {
    const r = engines.schedule(procs, 'rr', 2);
    assert.deepStrictEqual(r.slices.map((s) => [s.name, s.start, s.end]), [['P1', 0, 2], ['P2', 2, 4], ['P3', 4, 5], ['P1', 5, 7], ['P2', 7, 8], ['P1', 8, 9]]);
    assert.strictEqual(r.rows.reduce((s, x) => s + x.turnaround, 0), 9 + 7 + 3);
  });
  test('idle gaps wait for the next arrival', () => {
    const r = engines.schedule([{ name: 'A', arrival: 4, burst: 2 }], 'rr', 2);
    assert.deepStrictEqual(r.slices, [{ name: 'A', start: 4, end: 6 }]);
  });
});

describe('sorting', () => {
  for (const algorithm of ['bubble', 'insertion', 'selection', 'merge', 'quick']) {
    test(`${algorithm} ends sorted and is deterministic`, () => {
      const { steps } = engines.sortSteps(algorithm, 20, 42);
      const last = steps[steps.length - 1].values;
      assert.deepStrictEqual(last, [...last].sort((a, b) => a - b));
      assert.deepStrictEqual(steps[0].values, engines.sortSteps(algorithm, 20, 42).steps[0].values);
      assert.strictEqual(steps[steps.length - 1].sorted.length, 20);
    });
  }
});

describe('logic and perceptron', () => {
  test('full adder truth table', () => {
    for (let n = 0; n < 8; n++) {
      const [a, b, c] = [(n >> 2) & 1, (n >> 1) & 1, n & 1];
      const [sum, carry] = engines.logicOutputs('full_adder', a, b, c).map((o) => o.value);
      assert.strictEqual(sum + 2 * carry, a + b + c);
    }
  });
  test('a single line separates AND but never all of XOR', () => {
    assert.strictEqual(engines.perceptronAccuracy('and', 1, 1, -1.5), 4);
    let best = 0;
    for (let w1 = -3; w1 <= 3; w1 += 0.5) for (let w2 = -3; w2 <= 3; w2 += 0.5) for (let b = -3; b <= 3; b += 0.5) best = Math.max(best, engines.perceptronAccuracy('xor', w1, w2, b));
    assert.strictEqual(best, 3);
  });
  test('function families', () => {
    assert.strictEqual(engines.evaluateFunction('quadratic', 1, 0, -4, 2), 0);
    assert.ok(Number.isNaN(engines.evaluateFunction('logarithm', 1, 1, 0, -1)));
  });
});

describe('join input', async () => {
  const { parseJoinInput, isMeetingNumber } = await import('../features/rooms/joinTarget.ts');
  test('accepts codes, numbers and links', () => {
    assert.deepStrictEqual(parseJoinInput(' abcd efgh jk '), { kind: 'code', code: 'ABCD-EFGH-JK' });
    assert.deepStrictEqual(parseJoinInput('ABCD-EFGH-JO'), { kind: 'code', code: 'ABCD-EFGH-J0' });
    assert.deepStrictEqual(parseJoinInput('842 9103 8417'), { kind: 'number', number: '84291038417' });
    assert.deepStrictEqual(parseJoinInput('842-9103-8417'), { kind: 'number', number: '84291038417' });
    assert.deepStrictEqual(parseJoinInput('https://connect-alpha-seven.vercel.app/room/ABCD-EFGH-JK/preview?x=1'), { kind: 'code', code: 'ABCD-EFGH-JK' });
    assert.deepStrictEqual(parseJoinInput('https://x.app/room/84291038417'), { kind: 'number', number: '84291038417' });
  });
  test('rejects junk', () => {
    for (const bad of ['', '   ', '<script>', 'abc', 'ÄÖÜ-1234']) assert.strictEqual(parseJoinInput(bad).kind, 'invalid', bad);
    assert.ok(isMeetingNumber('84291038417'));
    assert.ok(!isMeetingNumber('ABCD-EFGH-JK'));
    assert.ok(!isMeetingNumber('1234567890'));
  });
});
