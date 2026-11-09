// A small LaTeX-style math parser for board formulas: fractions, roots, powers, subscripts,
// Greek letters, operators, big sums and integrals, matrices and text. It returns a tree that
// React renders as text nodes, so a formula can never inject markup. Unknown commands show
// as their name rather than failing.

export type MathNode =
  | { t: 'text'; v: string; italic?: boolean }
  | { t: 'sym'; v: string }
  | { t: 'fn'; v: string }
  | { t: 'big'; v: string }
  | { t: 'group'; children: MathNode[] }
  | { t: 'frac'; num: MathNode; den: MathNode }
  | { t: 'sqrt'; body: MathNode; index?: MathNode }
  | { t: 'script'; base: MathNode; sup?: MathNode; sub?: MathNode }
  | { t: 'matrix'; rows: MathNode[][]; open: string; close: string };

export const MAX_MATH_LENGTH = 500;
const MAX_DEPTH = 24;

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const SYMBOLS: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
  equiv: '≡', sim: '∼', propto: '∝', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', iff: '⇔', implies: '⇒', partial: '∂', nabla: '∇', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆',
  supset: '⊃', cup: '∪', cap: '∩', emptyset: '∅', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', ldots: '…',
  cdots: '⋯', dots: '…', circ: '∘', angle: '∠', perp: '⊥', parallel: '∥', degree: '°', prime: '′', '{': '{', '}': '}',
  '%': '%', '&': '&', '#': '#', '$': '$', '_': '_', langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  mid: '∣', vert: '|', ast: '∗', star: '⋆', oplus: '⊕', otimes: '⊗',
};
const BIG: Record<string, string> = { sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮', bigcup: '⋃', bigcap: '⋂' };
const FUNCTIONS = new Set(['log', 'ln', 'lg', 'exp', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'mod', 'deg', 'arg']);
const SPACES: Record<string, string> = { ',': ' ', ';': ' ', ':': ' ', quad: ' ', qquad: '  ', ' ': ' ', '!': '' };
const MATRIX_DELIMS: Record<string, [string, string]> = { matrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''] };

class Parser {
  i = 0;
  depth = 0;
  private s: string;
  constructor(source: string) {
    this.s = source;
  }

  private peek() { return this.s[this.i]; }
  private eof() { return this.i >= this.s.length; }

  private command(): string {
    this.i++; // backslash
    if (this.eof()) return '';
    const ch = this.peek();
    if (!/[A-Za-z]/.test(ch)) {
      this.i++;
      return ch;
    }
    const start = this.i;
    while (!this.eof() && /[A-Za-z]/.test(this.peek())) this.i++;
    return this.s.slice(start, this.i);
  }

  private skipSpaces() {
    while (!this.eof() && this.peek() === ' ') this.i++;
  }

  /** A required argument: {…} or a single atom. */
  private argument(): MathNode {
    this.skipSpaces();
    return this.atom() ?? { t: 'text', v: '' };
  }

  private braced(): string {
    // Raw text up to the matching brace, for \text and \begin names.
    this.skipSpaces();
    if (this.peek() !== '{') return '';
    let level = 0;
    const start = this.i + 1;
    for (; !this.eof(); this.i++) {
      if (this.peek() === '{') level++;
      else if (this.peek() === '}' && --level === 0) {
        const out = this.s.slice(start, this.i);
        this.i++;
        return out;
      }
    }
    return this.s.slice(start);
  }

  private matrix(env: string): MathNode {
    const [open, close] = MATRIX_DELIMS[env] ?? ['', ''];
    const endTag = `\\end{${env}}`;
    const end = this.s.indexOf(endTag, this.i);
    const inner = this.s.slice(this.i, end === -1 ? this.s.length : end);
    this.i = end === -1 ? this.s.length : end + endTag.length;
    const rows = inner.split(/\\\\/).map((r) => r.trim()).filter((r) => r.length).slice(0, 12)
      .map((r) => r.split('&').slice(0, 12).map((cell) => parseMath(cell.trim(), this.depth + 1)));
    return { t: 'matrix', rows, open, close };
  }

  atom(): MathNode | null {
    if (this.eof()) return null;
    if (++this.depth > MAX_DEPTH) {
      this.i = this.s.length;
      return { t: 'text', v: '…' };
    }
    try {
      const ch = this.peek();
      if (ch === '{') {
        this.i++;
        const children = this.sequence('}');
        if (this.peek() === '}') this.i++;
        return { t: 'group', children };
      }
      if (ch === '\\') {
        const name = this.command();
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') return { t: 'frac', num: this.argument(), den: this.argument() };
        if (name === 'sqrt') {
          this.skipSpaces();
          let index: MathNode | undefined;
          if (this.peek() === '[') {
            this.i++;
            index = { t: 'group', children: this.sequence(']') };
            if (this.peek() === ']') this.i++;
          }
          return { t: 'sqrt', body: this.argument(), index };
        }
        if (name === 'text' || name === 'mathrm' || name === 'textrm' || name === 'operatorname') return { t: 'text', v: this.braced() };
        if (name === 'mathbf' || name === 'boldsymbol' || name === 'mathit' || name === 'mathcal') return this.argument();
        if (name === 'begin') return this.matrix(this.braced());
        if (name === 'left' || name === 'right' || name === 'big' || name === 'Big') {
          this.skipSpaces();
          if (this.peek() === '\\') {
            const delim = this.command();
            return { t: 'sym', v: SYMBOLS[delim] ?? (delim === '.' ? '' : delim) };
          }
          const d = this.peek();
          this.i++;
          return { t: 'sym', v: d === '.' ? '' : d };
        }
        if (name in GREEK) return { t: 'text', v: GREEK[name], italic: /^[a-z]/.test(name) };
        if (name in SYMBOLS) return { t: 'sym', v: SYMBOLS[name] };
        if (name in BIG) return { t: 'big', v: BIG[name] };
        if (FUNCTIONS.has(name)) return { t: 'fn', v: name };
        if (name in SPACES) return { t: 'text', v: SPACES[name] };
        return { t: 'text', v: name };
      }
      this.i++;
      if (/[A-Za-z]/.test(ch)) return { t: 'text', v: ch, italic: true };
      if (/[0-9.]/.test(ch)) {
        let digits = ch;
        while (!this.eof() && /[0-9.]/.test(this.peek())) digits += this.s[this.i++];
        return { t: 'text', v: digits };
      }
      if ('+-=<>'.includes(ch)) return { t: 'sym', v: ch === '-' ? '−' : ch };
      if (ch === ' ') return { t: 'text', v: '' };
      if (ch === '~') return { t: 'text', v: ' ' };
      return { t: 'text', v: ch };
    } finally {
      this.depth--;
    }
  }

  sequence(stop?: string): MathNode[] {
    const out: MathNode[] = [];
    while (!this.eof() && this.peek() !== stop) {
      const ch = this.peek();
      if ((ch === '^' || ch === '_') && out.length) {
        this.i++;
        const arg = this.argument();
        const last = out[out.length - 1];
        const script: Extract<MathNode, { t: 'script' }> = last.t === 'script' ? last : { t: 'script', base: last };
        if (ch === '^') script.sup = arg;
        else script.sub = arg;
        out[out.length - 1] = script;
        continue;
      }
      if (ch === '^' || ch === '_') {
        this.i++;
        continue;
      }
      if (stop === undefined && ch === '}') {
        this.i++; // stray closing brace
        continue;
      }
      const node = this.atom();
      if (node && !(node.t === 'text' && node.v === '')) out.push(node);
    }
    return out;
  }
}

/** Parses a formula; input is cut at MAX_MATH_LENGTH characters. */
export function parseMath(source: string, depth = 0): MathNode {
  const p = new Parser(source.slice(0, MAX_MATH_LENGTH));
  p.depth = depth;
  return { t: 'group', children: p.sequence() };
}

/** Plain-text reading of a formula, for screen readers and tests. */
export function mathToText(node: MathNode): string {
  switch (node.t) {
    case 'text': case 'sym': case 'big': return node.v;
    case 'fn': return `${node.v} `;
    case 'group': return node.children.map(mathToText).join('');
    case 'frac': return `(${mathToText(node.num)})/(${mathToText(node.den)})`;
    case 'sqrt': return node.index ? `root${mathToText(node.index)}(${mathToText(node.body)})` : `√(${mathToText(node.body)})`;
    case 'script': return `${mathToText(node.base)}${node.sub ? `_${mathToText(node.sub)}` : ''}${node.sup ? `^${mathToText(node.sup)}` : ''}`;
    case 'matrix': return `${node.open}${node.rows.map((r) => r.map(mathToText).join(', ')).join('; ')}${node.close}`;
  }
}
