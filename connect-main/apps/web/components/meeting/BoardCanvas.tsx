'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import * as api from '@/features/classroom/api';

const COLORS = ['#1C1C1C', '#E5484D', '#2F6FED', '#2E9E5B'];
const PEN_WIDTH = 3;
const HIGHLIGHTER_WIDTH = 16;
const MIN_POINT_DISTANCE = 0.002;
const MAX_POINTS = 2000;
const REFERENCE_WIDTH = 1000;
const POLL_INTERVAL_MS = 4000;

type Point = [number, number];

interface BoardCanvasProps {
  roomCode: string;
  board: string;
  state: api.ClassroomState;
  syncTick: number;
  onChanged: () => void;
  /** A transparent board draws over a page; otherwise it has its own white background. */
  transparent?: boolean;
}

function drawStroke(context: CanvasRenderingContext2D, stroke: Pick<api.Stroke, 'tool' | 'color' | 'width' | 'points'>, width: number, height: number) {
  if (stroke.points.length === 0) return;
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1;
  // Widths are relative to the board, so a line looks the same on a phone and a monitor.
  context.lineWidth = Math.max(1, (stroke.width * width) / REFERENCE_WIDTH);
  context.beginPath();
  context.moveTo(stroke.points[0][0] * width, stroke.points[0][1] * height);
  for (const [x, y] of stroke.points.slice(1)) context.lineTo(x * width, y * height);
  if (stroke.points.length === 1) {
    context.arc(stroke.points[0][0] * width, stroke.points[0][1] * height, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.stroke();
  }
  context.restore();
}

// Draws what is stored and sends each finished line. Others pick lines up from the server, on a
// hint or a poll, so a dropped hint only delays them.
export const BoardCanvas: React.FC<BoardCanvasProps> = ({ roomCode, board, state, syncTick, onChanged, transparent }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<api.Stroke[]>([]);
  const pendingRef = useRef<Map<string, api.NewStroke>>(new Map());
  const currentRef = useRef<Point[] | null>(null);
  const counterRef = useRef(0);
  const generationRef = useRef(0);
  const [color, setColor] = useState(COLORS[0]);
  const [tool, setTool] = useState<'pen' | 'highlighter'>('pen');
  const [strokeCount, setStrokeCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokesRef.current) drawStroke(context, stroke, canvas.width, canvas.height);
    for (const stroke of pendingRef.current.values()) drawStroke(context, stroke, canvas.width, canvas.height);
    if (currentRef.current) {
      drawStroke(context, { tool, color, width: tool === 'highlighter' ? HIGHLIGHTER_WIDTH : PEN_WIDTH, points: currentRef.current }, canvas.width, canvas.height);
    }
    setStrokeCount(strokesRef.current.length + pendingRef.current.size);
  }, [color, tool]);

  const sync = useCallback(async (reset: boolean) => {
    // A redraw outdates anything still on its way, which could bring back a removed line.
    if (reset) generationRef.current += 1;
    const generation = generationRef.current;
    try {
      const after = reset ? 0 : strokesRef.current.at(-1)?.seq ?? 0;
      const fresh = await api.listStrokes(roomCode, board, after);
      if (generation !== generationRef.current) return;
      const known = new Set(reset ? [] : strokesRef.current.map((s) => s.seq));
      const added = fresh.filter((s) => !known.has(s.seq));
      strokesRef.current = reset ? added : [...strokesRef.current, ...added];
      for (const [id, pending] of pendingRef.current) {
        if (fresh.some((s) => s.points.length === pending.points.length && s.color === pending.color && s.points[0]?.[0] === pending.points[0]?.[0] && s.points[0]?.[1] === pending.points[0]?.[1])) {
          pendingRef.current.delete(id);
        }
      }
      paint();
    } catch {
      // The next poll tries again.
    }
  }, [roomCode, board, paint]);

  // Undo and clear raise the version, which strokes alone cannot show, so they redraw from the start.
  useEffect(() => {
    strokesRef.current = [];
    sync(true);
  }, [board, state.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // A hint is only a hint: polling keeps a dropped one from hiding a line for good.
  useEffect(() => {
    sync(false);
    const timer = setInterval(() => sync(false), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [syncTick, sync]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas?.parentElement) return;
    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width));
      canvas.height = Math.max(1, Math.round(rect.height));
      paint();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, [paint]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return [Number(clamp((e.clientX - rect.left) / rect.width).toFixed(4)), Number(clamp((e.clientY - rect.top) / rect.height).toFixed(4))];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!state.canDraw) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    currentRef.current = [pointFrom(e)];
    paint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const current = currentRef.current;
    if (!current || current.length >= MAX_POINTS) return;
    const point = pointFrom(e);
    const last = current[current.length - 1];
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) < MIN_POINT_DISTANCE) return;
    current.push(point);
    paint();
  };

  const onPointerUp = async () => {
    const points = currentRef.current;
    currentRef.current = null;
    if (!points) return;
    counterRef.current += 1;
    const clientStrokeId = `${Date.now().toString(36)}-${counterRef.current}-${Math.random().toString(36).slice(2, 8)}`;
    const stroke: api.NewStroke = { clientStrokeId, board, tool, color, width: tool === 'highlighter' ? HIGHLIGHTER_WIDTH : PEN_WIDTH, points };
    pendingRef.current.set(clientStrokeId, stroke);
    paint();
    setError(null);
    try {
      await api.postStroke(roomCode, stroke);
      await sync(false);
      pendingRef.current.delete(clientStrokeId);
      paint();
      onChanged();
    } catch (err) {
      pendingRef.current.delete(clientStrokeId);
      paint();
      setError(err instanceof ApiError ? err.message : 'That line could not be saved.');
    }
  };

  const remove = async (all: boolean) => {
    setError(null);
    try {
      await api.removeStrokes(roomCode, board, all);
      onChanged();
      await sync(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The board could not be changed.');
    }
  };

  return (
    <>
      <div className={`absolute inset-0 ${transparent ? '' : 'bg-white'}`}>
        <canvas
          ref={canvasRef}
          data-testid="board-canvas"
          data-strokes={strokeCount}
          aria-label={state.canDraw ? 'Drawing board' : 'Drawing board, view only'}
          className={`w-full h-full block touch-none ${state.canDraw ? 'cursor-crosshair' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
      {state.canDraw && (
        <div className="absolute left-2 bottom-2 flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl bg-white/95 border border-[#E5E7EB] shadow-sm max-w-[calc(100%-1rem)]">
          {COLORS.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Color ${value}`}
              aria-pressed={color === value}
              onClick={() => setColor(value)}
              style={{ backgroundColor: value }}
              className={`w-8 h-8 rounded-full border-2 ${color === value ? 'border-[#7658E8]' : 'border-white'}`}
            />
          ))}
          <button type="button" aria-pressed={tool === 'highlighter'} onClick={() => setTool(tool === 'pen' ? 'highlighter' : 'pen')} className="px-2 min-h-[36px] rounded-lg border border-[#E5E7EB] text-xs font-semibold text-[#1C1C1C]">
            {tool === 'pen' ? 'Pen' : 'Highlighter'}
          </button>
          <button type="button" onClick={() => remove(false)} className="px-2 min-h-[36px] rounded-lg border border-[#E5E7EB] text-xs font-semibold text-[#1C1C1C]">Undo</button>
          {state.canManage && (
            <button type="button" onClick={() => remove(true)} className="px-2 min-h-[36px] rounded-lg border border-[#E5E7EB] text-xs font-semibold text-[#1C1C1C]">Clear</button>
          )}
        </div>
      )}
      {error && <p role="alert" className="absolute left-2 top-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">{error}</p>}
    </>
  );
};
