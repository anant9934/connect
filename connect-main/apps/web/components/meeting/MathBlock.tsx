'use client';

import React, { useMemo } from 'react';
import { mathToText, parseMath, type MathNode } from '@/features/classroom/math';

const serif = { fontFamily: '"Cambria Math", "STIX Two Math", "Latin Modern Math", Cambria, "Times New Roman", serif' };

function Node({ n }: { n: MathNode }): React.ReactElement {
  switch (n.t) {
    case 'text':
      return <span style={n.italic ? { fontStyle: 'italic' } : undefined}>{n.v}</span>;
    case 'sym':
      return <span className="px-[0.15em]">{n.v}</span>;
    case 'fn':
      return <span className="pr-[0.15em]" style={{ fontStyle: 'normal' }}>{n.v}</span>;
    case 'big':
      return <span className="text-[1.6em] leading-none align-middle px-[0.1em]">{n.v}</span>;
    case 'group':
      return <>{n.children.map((c, i) => <Node key={i} n={c} />)}</>;
    case 'frac':
      return (
        <span className="inline-flex flex-col items-center align-middle mx-[0.15em] text-[0.9em]" style={{ verticalAlign: '-0.55em' }}>
          <span className="px-[0.2em] leading-tight"><Node n={n.num} /></span>
          <span className="px-[0.2em] leading-tight border-t border-current w-full text-center"><Node n={n.den} /></span>
        </span>
      );
    case 'sqrt':
      return (
        <span className="inline-flex items-baseline">
          {n.index && <sup className="text-[0.6em] -mr-[0.25em]"><Node n={n.index} /></sup>}
          <span>√</span>
          <span className="border-t border-current pl-[0.1em] pr-[0.15em]"><Node n={n.body} /></span>
        </span>
      );
    case 'script':
      return (
        <span className="inline-flex items-baseline">
          <Node n={n.base} />
          <span className="inline-flex flex-col text-[0.7em] leading-none ml-[0.05em]" style={{ verticalAlign: 'middle' }}>
            {n.sup ? <span className="-translate-y-[0.35em]"><Node n={n.sup} /></span> : null}
            {n.sub ? <span className={n.sup ? '' : 'translate-y-[0.45em]'}><Node n={n.sub} /></span> : null}
          </span>
        </span>
      );
    case 'matrix':
      return (
        <span className="inline-flex items-stretch align-middle mx-[0.15em]">
          {n.open && <span className="flex items-center text-[1.8em] font-light leading-none">{n.open}</span>}
          <span className="inline-grid gap-x-[0.8em] gap-y-[0.15em] px-[0.25em] items-center" style={{ gridTemplateColumns: `repeat(${Math.max(1, ...n.rows.map((r) => r.length))}, auto)` }}>
            {n.rows.flatMap((row, r) => row.map((cell, c) => <span key={`${r}-${c}`} className="text-center"><Node n={cell} /></span>))}
          </span>
          {n.close && <span className="flex items-center text-[1.8em] font-light leading-none">{n.close}</span>}
        </span>
      );
  }
}

// A formula written in LaTeX style, drawn with plain HTML text.
export function MathBlock({ source, className }: { source: string; className?: string }) {
  const tree = useMemo(() => parseMath(source), [source]);
  return (
    <span data-testid="math-render" role="math" aria-label={mathToText(tree)} className={`inline-flex items-center flex-wrap ${className ?? ''}`} style={serif}>
      <Node n={tree} />
    </span>
  );
}
