// A small tokenizer for code slides: keywords, strings, comments, numbers and the rest. It
// colours common languages well enough to read at a glance; it is not a full parser.
export type TokenKind = 'keyword' | 'string' | 'comment' | 'number' | 'plain';
export interface Token { kind: TokenKind; text: string }

const KEYWORDS: Record<string, string[]> = {
  c: ['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'int', 'long', 'register', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', 'include', 'define'],
  cpp: ['class', 'public', 'private', 'protected', 'virtual', 'override', 'template', 'typename', 'namespace', 'using', 'new', 'delete', 'this', 'true', 'false', 'nullptr', 'bool', 'try', 'catch', 'throw', 'std', 'string', 'vector', 'cout', 'cin', 'endl', 'friend', 'operator', 'inline', 'explicit'],
  java: ['class', 'public', 'private', 'protected', 'static', 'final', 'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'extends', 'implements', 'interface', 'abstract', 'import', 'package', 'this', 'super', 'null', 'true', 'false', 'String'],
  python: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'pass', 'break', 'continue', 'lambda', 'yield', 'None', 'True', 'False', 'self', 'print', 'range', 'len', 'global', 'nonlocal'],
  javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'this', 'null', 'undefined', 'true', 'false', 'async', 'await', 'import', 'export', 'from', 'default', 'try', 'catch', 'finally', 'throw', 'typeof', 'of', 'in'],
  sql: ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'drop', 'alter', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by', 'order', 'having', 'limit', 'and', 'or', 'not', 'null', 'primary', 'key', 'foreign', 'references', 'as', 'distinct', 'count', 'sum', 'avg', 'min', 'max', 'union', 'is', 'in', 'like', 'between'],
};

const family = (language: string) => {
  const l = language.toLowerCase();
  if (['c++', 'cpp', 'cc', 'c', 'h', 'hpp'].includes(l)) return 'cpp';
  if (['js', 'ts', 'typescript', 'javascript', 'jsx', 'tsx'].includes(l)) return 'javascript';
  if (['py', 'python', 'python3'].includes(l)) return 'python';
  if (['sql', 'postgres', 'mysql', 'sqlite'].includes(l)) return 'sql';
  if (['java', 'kotlin'].includes(l)) return 'java';
  return 'javascript';
};

export function tokenize(source: string, language: string): Token[] {
  const fam = family(language);
  const words = new Set([...(fam === 'cpp' ? [...KEYWORDS.c, ...KEYWORDS.cpp] : KEYWORDS[fam])]);
  const caseInsensitive = fam === 'sql';
  const lineComment = fam === 'python' ? '#' : fam === 'sql' ? '--' : '//';
  const blockComments = fam !== 'python';
  const out: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind === 'plain') last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    if (rest.startsWith(lineComment)) {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      push('comment', source.slice(i, stop));
      i = stop;
      continue;
    }
    if (blockComments && rest.startsWith('/*')) {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      push('comment', source.slice(i, stop));
      i = stop;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || (ch === '`' && fam === 'javascript')) {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      push('string', source.slice(i, Math.min(j + 1, source.length)));
      i = j + 1;
      continue;
    }
    const num = rest.match(/^(0x[0-9a-f]+|\d+(\.\d+)?)/i);
    if (num && !/[A-Za-z_]/.test(source[i - 1] ?? '')) {
      push('number', num[0]);
      i += num[0].length;
      continue;
    }
    const word = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (word) {
      push(words.has(caseInsensitive ? word[0].toLowerCase() : word[0]) ? 'keyword' : 'plain', word[0]);
      i += word[0].length;
      continue;
    }
    push('plain', ch);
    i++;
  }
  return out;
}

/** Text colours on the dark code panel, from the brand palette. */
export const TOKEN_COLORS: Record<TokenKind, string> = {
  keyword: '#B9A2FF',
  string: '#FFC93C',
  comment: '#8B8B93',
  number: '#86E3A8',
  plain: '#F8F8F5',
};
