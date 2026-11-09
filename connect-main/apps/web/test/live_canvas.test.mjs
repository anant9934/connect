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

describe('code slide colouring', async () => {
  const { tokenize } = await import('../features/classroom/highlight.ts');
  const kinds = (src, lang) => tokenize(src, lang).filter((t) => t.kind !== 'plain').map((t) => `${t.kind}:${t.text}`);
  test('C++ keywords, strings, numbers and comments', () => {
    assert.deepStrictEqual(kinds('int x = 42; // answer\nstd::string s = "hi";', 'cpp'),
      ['keyword:int', 'number:42', 'comment:// answer', 'keyword:std', 'keyword:string', 'string:"hi"']);
  });
  test('Python comments use #, SQL is case-insensitive', () => {
    assert.deepStrictEqual(kinds('def f(): # x', 'python'), ['keyword:def', 'comment:# x']);
    assert.deepStrictEqual(kinds('SELECT id FROM t -- note', 'sql'), ['keyword:SELECT', 'keyword:FROM', 'comment:-- note']);
  });
  test('text round-trips exactly and unterminated strings stop at the line end', () => {
    const src = 'printf("unterminated\nnext line); /* open';
    assert.strictEqual(tokenize(src, 'c').map((t) => t.text).join(''), src);
    assert.strictEqual(tokenize('x1 = 2', 'js').find((t) => t.kind === 'number').text, '2');
  });
});

describe('trees and graphs', async () => {
  const st = await import('../features/classroom/simulations/structures.ts');
  test('AVL stays balanced on sorted input where a BST degenerates', () => {
    let bst = null, avl = null;
    for (const v of [10, 20, 30, 40, 50, 60, 70]) { bst = st.insert(bst, v, false); avl = st.insert(avl, v, true); }
    assert.strictEqual(bst.height, 7);
    assert.strictEqual(avl.height, 3);
    assert.deepStrictEqual(st.traverse(avl, 'inorder'), [10, 20, 30, 40, 50, 60, 70]);
    assert.deepStrictEqual(st.traverse(avl, 'levelorder'), [40, 20, 60, 10, 30, 50, 70]);
  });
  test('delete with two children uses the in-order successor', () => {
    let t = null;
    for (const v of [50, 30, 70, 60, 80]) t = st.insert(t, v, false);
    const notes = [];
    t = st.remove(t, 50, false, notes);
    assert.strictEqual(t.value, 60);
    assert.deepStrictEqual(st.traverse(t, 'inorder'), [30, 60, 70, 80]);
    assert.match(notes[0], /successor 60/);
  });
  test('tree frames name rotations and end with the traversal', () => {
    const frames = st.treeFrames([30, 20, 10], 'avl', 0, 'preorder');
    assert.ok(frames.some((f) => /Right rotation at 30/.test(f.caption)));
    assert.deepStrictEqual(frames.at(-1).visited, [20, 10, 30]);
    assert.match(st.treeFrames([1, 2], 'bst', 9, 'none').at(-1).caption, /not in the tree/);
  });
  const edges = [{ from: 0, to: 1, weight: 4 }, { from: 0, to: 2, weight: 1 }, { from: 2, to: 1, weight: 2 }, { from: 1, to: 3, weight: 1 }];
  test('Dijkstra finds the cheaper indirect path', () => {
    const last = st.graphFrames(4, edges, 'dijkstra', 0, 3).at(-1);
    assert.deepStrictEqual(last.path, [0, 2, 1, 3]);
    assert.deepStrictEqual(last.dist, [0, 3, 1, 4]);
  });
  test('BFS visits by layers, DFS goes deep first', () => {
    const tree = [{ from: 0, to: 1, weight: 1 }, { from: 0, to: 2, weight: 1 }, { from: 1, to: 3, weight: 1 }];
    assert.deepStrictEqual(st.graphFrames(4, tree, 'bfs', 0, 3).at(-1).visited, [0, 1, 2, 3]);
    assert.deepStrictEqual(st.graphFrames(4, tree, 'dfs', 0, 3).at(-1).visited, [0, 1, 3, 2]);
  });
  test('unreachable target is reported', () => {
    assert.match(st.graphFrames(4, [{ from: 0, to: 1, weight: 1 }], 'dijkstra', 0, 3).at(-1).caption, /cannot be reached/);
  });
});
