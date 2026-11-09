'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Circle, Highlighter, MousePointer2, PenLine, Square, StickyNote, Type } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import * as api from '@/features/classroom/api';

const COLORS = ['#1C1C1C', '#E5484D', '#2F6FED', '#2E9E5B'];
/** Sticky note colours: marigold, lavender, mint and blush. */
const NOTE_COLORS = ['#FFC93C', '#EDE9FE', '#D1FAE5', '#FFE4E6'];
const PEN_WIDTH = 3;
const HIGHLIGHTER_WIDTH = 16;
const SHAPE_WIDTH = 4;
const MIN_POINT_DISTANCE = 0.002;
const MAX_POINTS = 2000;
const REFERENCE_WIDTH = 1000;
const POLL_INTERVAL_MS = 4000;
const LASER_INTERVAL_MS = 33;
const LASER_FADE_MS = 1200;

type Point = [number, number];
type Tool = api.BoardTool | 'laser';

/** A laser pointer position from the presenter, in board coordinates. */
export interface LaserFrame { x: number; y: number; at: number }

interface BoardCanvasProps {
  roomCode: string;
  board: string;
  state: api.ClassroomState;
  syncTick: number;
  onChanged: () => void;
  /** A transparent board draws over a page; otherwise it has its own white background. */
  transparent?: boolean;
  /** Offered to the presenter on a presentation; frames go over the data channel, never stored. */
  onLaser?: (x: number, y: number) => void;
  laser?: LaserFrame | null;
  /** Who is viewing, to offer moving only their own notes. */
  selfIdentity?: string;
}

const drawArrowHead = (context: CanvasRenderingContext2D, from: Point, to: Point, size: number) => {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  context.beginPath();
  context.moveTo(to[0], to[1]);
  context.lineTo(to[0] - size * Math.cos(angle - Math.PI / 6), to[1] - size * Math.sin(angle - Math.PI / 6));
  context.lineTo(to[0] - size * Math.cos(angle + Math.PI / 6), to[1] - size * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
};

function drawStroke(context: CanvasRenderingContext2D, stroke: Pick<api.Stroke, 'tool' | 'color' | 'width' | 'points' | 'body'>, width: number, height: number) {
  if (stroke.points.length === 0 || stroke.tool === 'note') return; // notes are cards, drawn as HTML
  const pts = stroke.points.map(([x, y]) => [x * width, y * height] as Point);
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1;
  // Widths are relative to the board, so a line looks the same on a phone and a monitor.
  context.lineWidth = Math.max(1, (stroke.width * width) / REFERENCE_WIDTH);
  if (stroke.tool === 'text') {
    const size = Math.max(12, (22 * width) / REFERENCE_WIDTH);
    context.font = `600 ${size}px system-ui, sans-serif`;
    context.textBaseline = 'top';
    (stroke.body ?? '').split('\n').forEach((line, i) => context.fillText(line, pts[0][0], pts[0][1] + i * size * 1.25));
  } else if (stroke.tool === 'rect' && pts.length === 2) {
    context.strokeRect(Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.abs(pts[1][0] - pts[0][0]), Math.abs(pts[1][1] - pts[0][1]));
  } else if (stroke.tool === 'circle' && pts.length === 2) {
    context.beginPath();
    context.ellipse((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2, Math.abs(pts[1][0] - pts[0][0]) / 2, Math.abs(pts[1][1] - pts[0][1]) / 2, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (stroke.tool === 'arrow' && pts.length === 2) {
    context.beginPath();
    context.moveTo(pts[0][0], pts[0][1]);
    context.lineTo(pts[1][0], pts[1][1]);
    context.stroke();
    drawArrowHead(context, pts[0], pts[1], Math.max(10, context.lineWidth * 4));
  } else {
    context.beginPath();
    context.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) context.lineTo(x, y);
    if (pts.length === 1) {
      context.arc(pts[0][0], pts[0][1], context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.stroke();
    }
  }
  context.restore();
}

const TOOLS: { tool: Tool; label: string; icon: React.ReactNode }[] = [
  { tool: 'pen', label: 'Pen', icon: <PenLine className="w-4 h-4" /> },
  { tool: 'highlighter', label: 'Highlighter', icon: <Highlighter className="w-4 h-4" /> },
  { tool: 'text', label: 'Text', icon: <Type className="w-4 h-4" /> },
  { tool: 'rect', label: 'Rectangle', icon: <Square className="w-4 h-4" /> },
  { tool: 'circle', label: 'Circle', icon: <Circle className="w-4 h-4" /> },
  { tool: 'arrow', label: 'Arrow', icon: <ArrowUpRight className="w-4 h-4" /> },
  { tool: 'note', label: 'Sticky note', icon: <StickyNote className="w-4 h-4" /> },
];

// Draws what is stored and sends each finished item. Others pick items up from the server, on a
// hint or a poll, so a dropped hint only delays them.
export const BoardCanvas: React.FC<BoardCanvasProps> = ({ roomCode, board, state, syncTick, onChanged, transparent, onLaser, laser, selfIdentity }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<api.Stroke[]>([]);
  const pendingRef = useRef<Map<string, api.NewStroke>>(new Map());
  const currentRef = useRef<Point[] | null>(null);
  const counterRef = useRef(0);
  const generationRef = useRef(0);
  const lastLaserRef = useRef(0);
  const [color, setColor] = useState(COLORS[0]);
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
  const [tool, setTool] = useState<Tool>('pen');
  const [strokeCount, setStrokeCount] = useState(0);
  const [notes, setNotes] = useState<api.Stroke[]>([]);
  const [draft, setDraft] = useState<{ tool: 'text' | 'note'; point: Point; text: string } | null>(null);
  const [drag, setDrag] = useState<{ id: string; point: Point } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [laserVisible, setLaserVisible] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const draftOpen = draft !== null;

  const widthFor = (t: api.BoardTool) => (t === 'highlighter' ? HIGHLIGHTER_WIDTH : t === 'pen' ? PEN_WIDTH : SHAPE_WIDTH);
  const drawColor = (t: api.BoardTool) => (t === 'note' ? noteColor : color);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokesRef.current) drawStroke(context, stroke, canvas.width, canvas.height);
    for (const stroke of pendingRef.current.values()) drawStroke(context, stroke, canvas.width, canvas.height);
    const current = currentRef.current;
    if (current && tool !== 'laser' && tool !== 'text' && tool !== 'note') {
      drawStroke(context, { tool, color, width: widthFor(tool), points: current }, canvas.width, canvas.height);
    }
    setStrokeCount(strokesRef.current.length + pendingRef.current.size);
    setNotes(strokesRef.current.filter((s) => s.tool === 'note'));
  }, [color, tool]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Undo, clear and moves raise the version, which new items alone cannot show, so they redraw from the start.
  useEffect(() => {
    strokesRef.current = [];
    sync(true);
  }, [board, state.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // A hint is only a hint: polling keeps a dropped one from hiding an item for good.
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

  useEffect(() => {
    if (!draftOpen) return;
    const frame = requestAnimationFrame(() => draftRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [draftOpen]);

  // The presenter's laser shows for a moment after each move, then fades.
  useEffect(() => {
    if (!laser) return;
    setLaserVisible(true);
    const timer = setTimeout(() => setLaserVisible(false), LASER_FADE_MS);
    return () => clearTimeout(timer);
  }, [laser]);

  const pointFrom = (e: React.PointerEvent<HTMLElement>, element: HTMLElement = e.currentTarget): Point => {
    const rect = element.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return [Number(clamp((e.clientX - rect.left) / rect.width).toFixed(4)), Number(clamp((e.clientY - rect.top) / rect.height).toFixed(4))];
  };

  const save = async (stroke: api.NewStroke) => {
    pendingRef.current.set(stroke.clientStrokeId, stroke);
    paint();
    setError(null);
    try {
      await api.postStroke(roomCode, stroke);
      await sync(false);
      pendingRef.current.delete(stroke.clientStrokeId);
      paint();
      onChanged();
    } catch (err) {
      pendingRef.current.delete(stroke.clientStrokeId);
      paint();
      setError(err instanceof ApiError ? err.message : 'That could not be saved.');
    }
  };

  const newId = () => {
    counterRef.current += 1;
    return `${Date.now().toString(36)}-${counterRef.current}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'laser') {
      e.currentTarget.setPointerCapture(e.pointerId);
      currentRef.current = [pointFrom(e)];
      return;
    }
    if (!state.canDraw) return;
    if (tool === 'text' || tool === 'note') {
      // Without this the click moves focus off the new text box, which would close it at once.
      e.preventDefault();
      setDraft({ tool, point: pointFrom(e), text: '' });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    currentRef.current = [pointFrom(e)];
    paint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointFrom(e);
    if (tool === 'laser') {
      const now = performance.now();
      if (currentRef.current && onLaser && now - lastLaserRef.current >= LASER_INTERVAL_MS) {
        lastLaserRef.current = now;
        onLaser(point[0], point[1]);
      }
      return;
    }
    const current = currentRef.current;
    if (!current || current.length >= MAX_POINTS) return;
    if (tool === 'rect' || tool === 'circle' || tool === 'arrow') {
      currentRef.current = [current[0], point];
      paint();
      return;
    }
    const last = current[current.length - 1];
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) < MIN_POINT_DISTANCE) return;
    current.push(point);
    paint();
  };

  const onPointerUp = async () => {
    const points = currentRef.current;
    currentRef.current = null;
    if (!points || tool === 'laser' || tool === 'text' || tool === 'note') return;
    if ((tool === 'rect' || tool === 'circle' || tool === 'arrow') && points.length < 2) {
      paint();
      return; // a click without a drag makes no shape
    }
    await save({ clientStrokeId: newId(), board, tool, color, width: widthFor(tool), points });
  };

  const commitDraft = async () => {
    if (!draft) return;
    const text = draft.text.trim();
    setDraft(null);
    if (!text) return;
    await save({ clientStrokeId: newId(), board, tool: draft.tool, color: drawColor(draft.tool), width: SHAPE_WIDTH, points: [draft.point], body: text.slice(0, 500) });
  };

  // The server allows a note's author or a moderator to move it; the UI offers the same.
  const canMove = (note: api.Stroke) => state.canDraw && (state.canManage || note.authorIdentity === selfIdentity);

  const endDrag = async () => {
    if (!drag) return;
    const { id, point } = drag;
    setDrag(null);
    try {
      await api.moveStroke(roomCode, id, point);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That could not be moved.');
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

  const toolButton = 'w-9 h-9 rounded-lg flex items-center justify-center text-[#1C1C1C]';
  return (
    <>
      <div className={`absolute inset-0 ${transparent ? '' : 'bg-white'}`} data-testid="board-surface">
        <canvas
          ref={canvasRef}
          data-testid="board-canvas"
          data-strokes={strokeCount}
          aria-label={state.canDraw ? 'Drawing board' : 'Drawing board, view only'}
          className={`w-full h-full block touch-none ${state.canDraw || tool === 'laser' ? 'cursor-crosshair' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {notes.map((note) => {
          const at = drag?.id === note.id ? drag.point : note.points[0];
          return (
            <div
              key={note.id}
              data-testid="sticky-note"
              role="note"
              style={{ left: `${at[0] * 100}%`, top: `${at[1] * 100}%`, backgroundColor: note.color }}
              className={`absolute w-36 min-h-[72px] p-2 rounded-xl text-xs text-[#17171A] whitespace-pre-wrap break-words shadow-[4px_4px_12px_rgba(23,23,26,0.12)] border border-[rgba(23,23,26,0.06)] ${canMove(note) ? 'cursor-grab active:cursor-grabbing touch-none' : ''}`}
              onPointerDown={(e) => {
                if (!canMove(note)) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag({ id: note.id, point: note.points[0] });
              }}
              onPointerMove={(e) => {
                if (drag?.id !== note.id) return;
                const surface = e.currentTarget.parentElement!;
                setDrag({ id: note.id, point: pointFrom(e, surface) });
              }}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {note.body}
            </div>
          );
        })}
        {draft && (
          <div className="absolute z-10" style={{ left: `${Math.min(draft.point[0], 0.7) * 100}%`, top: `${Math.min(draft.point[1], 0.8) * 100}%` }}>
            <textarea
              ref={draftRef}
              autoFocus
              data-testid="board-draft"
              aria-label={draft.tool === 'note' ? 'Sticky note text' : 'Text'}
              value={draft.text}
              maxLength={500}
              rows={draft.tool === 'note' ? 3 : 1}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitDraft(); }
                if (e.key === 'Escape') setDraft(null);
              }}
              onBlur={commitDraft}
              placeholder={draft.tool === 'note' ? 'Note… (Enter to place)' : 'Type, then Enter'}
              style={{ backgroundColor: draft.tool === 'note' ? noteColor : '#FFFFFF' }}
              className="w-44 rounded-xl border-2 border-[#7444E8] p-2 text-xs text-[#17171A] outline-none shadow-card"
            />
          </div>
        )}
        {laser && laserVisible && (
          <span
            data-testid="laser-dot"
            aria-hidden="true"
            className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-[#FF3B30] shadow-[0_0_12px_4px_rgba(255,59,48,0.55)] pointer-events-none transition-[left,top] duration-75"
            style={{ left: `${laser.x * 100}%`, top: `${laser.y * 100}%` }}
          />
        )}
      </div>
      {(state.canDraw || onLaser) && (
        <div className="absolute left-2 bottom-2 flex flex-wrap items-center gap-1 p-1.5 rounded-2xl neu-surface max-w-[calc(100%-1rem)]" data-testid="board-toolbar">
          {state.canDraw && TOOLS.map((t) => (
            <button key={t.tool} type="button" aria-label={t.label} title={t.label} aria-pressed={tool === t.tool} onClick={() => setTool(t.tool)}
              className={`${toolButton} ${tool === t.tool ? 'neu-pressed bg-[#F1EBFF] text-[#5A2FC7]' : ''}`}>
              {t.icon}
            </button>
          ))}
          {onLaser && (
            <button type="button" aria-label="Laser pointer" title="Laser pointer" data-testid="laser-tool" aria-pressed={tool === 'laser'} onClick={() => setTool('laser')}
              className={`${toolButton} ${tool === 'laser' ? 'neu-pressed bg-[#FFE9E9] text-[#C2261C]' : ''}`}>
              <MousePointer2 className="w-4 h-4" />
            </button>
          )}
          {state.canDraw && <span className="w-px h-6 bg-[#E5E7EB] mx-0.5" aria-hidden="true" />}
          {state.canDraw && (tool === 'note' ? NOTE_COLORS : COLORS).map((value) => {
            const selected = tool === 'note' ? noteColor === value : color === value;
            return (
              <button key={value} type="button" aria-label={`Color ${value}`} aria-pressed={selected}
                onClick={() => (tool === 'note' ? setNoteColor(value) : setColor(value))}
                style={{ backgroundColor: value }}
                className={`w-7 h-7 rounded-full border-2 ${selected ? 'border-[#7444E8]' : 'border-white'}`} />
            );
          })}
          {state.canDraw && (
            <>
              <button type="button" onClick={() => remove(false)} className="px-2 min-h-[36px] rounded-lg text-xs font-semibold text-[#1C1C1C]">Undo</button>
              {state.canManage && (
                <button type="button" onClick={() => remove(true)} className="px-2 min-h-[36px] rounded-lg text-xs font-semibold text-[#1C1C1C]">Clear</button>
              )}
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="absolute left-2 top-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">{error}</p>}
    </>
  );
};
