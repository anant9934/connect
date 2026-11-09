'use client';

import React, { useMemo } from 'react';
import { layoutDiagram, type Diagram, type PlacedNode } from '@/features/classroom/diagramLayout';

const STYLE = {
  rect: { fill: '#F1EBFF', stroke: '#7444E8', text: '#3F1F9E' },
  diamond: { fill: '#FFF4D1', stroke: '#E0A800', text: '#6B4E00' },
  pill: { fill: '#7444E8', stroke: '#5A2FC7', text: '#FFFFFF' },
  cylinder: { fill: '#E4F8EB', stroke: '#2DBE74', text: '#1F6B3B' },
} as const;

function Shape({ n }: { n: PlacedNode }) {
  const s = STYLE[n.shape];
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const common = { fill: s.fill, stroke: s.stroke, strokeWidth: 2 };
  let body: React.ReactNode;
  if (n.shape === 'diamond') body = <polygon {...common} points={`${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}`} />;
  else if (n.shape === 'pill') body = <rect {...common} x={n.x} y={n.y} width={n.w} height={n.h} rx={n.h / 2} />;
  else if (n.shape === 'cylinder') {
    const ry = 9;
    body = (
      <g>
        <path {...common} d={`M ${n.x} ${n.y + ry} L ${n.x} ${n.y + n.h - ry} A ${n.w / 2} ${ry} 0 0 0 ${n.x + n.w} ${n.y + n.h - ry} L ${n.x + n.w} ${n.y + ry}`} />
        <ellipse {...common} cx={cx} cy={n.y + ry} rx={n.w / 2} ry={ry} />
      </g>
    );
  } else body = <rect {...common} x={n.x} y={n.y} width={n.w} height={n.h} rx={12} />;
  return (
    <g data-testid="diagram-node" data-shape={n.shape}>
      {body}
      <text x={cx} y={n.shape === 'cylinder' ? cy + 6 : cy} textAnchor="middle" dominantBaseline="middle" fill={s.text} fontSize={14} fontWeight={600} fontFamily="system-ui, sans-serif">
        {n.label}
      </text>
    </g>
  );
}

// A flowchart, state machine or block diagram drawn as SVG from nodes and edges.
export function DiagramView({ diagram }: { diagram: Diagram }) {
  const layout = useMemo(() => layoutDiagram(diagram), [diagram]);
  return (
    <svg data-testid="diagram-svg" viewBox={`0 0 ${layout.width + 60} ${layout.height}`} className="w-full h-full max-h-full" role="img"
      aria-label={`Diagram: ${diagram.nodes.map((n) => n.label).join(', ')}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker id="tc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#5F5F68" />
        </marker>
      </defs>
      {layout.edges.map((e, i) => (
        <g key={i} data-testid="diagram-edge">
          <path d={e.path} fill="none" stroke={e.back ? '#B8860B' : '#5F5F68'} strokeWidth={2} strokeDasharray={e.back ? '6 4' : undefined} markerEnd="url(#tc-arrow)" />
          {e.label && (
            <g>
              <rect x={e.labelX - e.label.length * 3.6 - 6} y={e.labelY - 10} width={e.label.length * 7.2 + 12} height={20} rx={10} fill="#FFFFFF" stroke="#ECECE6" />
              <text x={e.labelX} y={e.labelY + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill="#17171A" fontFamily="system-ui, sans-serif">{e.label}</text>
            </g>
          )}
        </g>
      ))}
      {layout.nodes.map((n) => <Shape key={n.id} n={n} />)}
    </svg>
  );
}
