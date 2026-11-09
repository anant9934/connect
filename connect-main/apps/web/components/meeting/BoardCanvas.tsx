'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Circle, Hand, Highlighter, Minus, MousePointer2, PenLine, Plus, Sigma, Square, StickyNote, Type } from 'lucide-react';
import { MathBlock } from './MathBlock';
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
type Tool = api.BoardTool | 'laser' | 'pan';

/** The whiteboard's visible area: zoom, and the world point at the top-left corner. */
interface View { zoom: number; x: number; y: number }
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
/** Whiteboard coordinates the API accepts; the first view shows 0-1. */
const WORLD_MIN = -4;
const WORLD_MAX = 5;

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
  if (stroke.points.length === 0 || stroke.tool === 'note' || stroke.tool === 'math') return; // drawn as HTML
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
  { tool: 'math', label: 'Math formula', icon: <Sigma className="w-4 h-4" /> },
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
  const [draft, setDraft] = useState<{ tool: 'text' | 'note' | 'math'; point: Point; text: string } | null>(null);
  // Only the whiteboard pans and zooms; a slide's annotations stay on its page.
  const zoomable = !transparent;
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const panRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ distance: number; view: View; cx: number; cy: number } | null>(null);
  const spaceRef = useRef(false);
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
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const v = viewRef.current;
    context.setTransform(v.zoom, 0, 0, v.zoom, -v.x * canvas.width * v.zoom, -v.y * canvas.height * v.zoom);
    if (zoomable) {
      // A light dot grid shows that the board continues beyond the screen.
      const step = 0.05;
      context.fillStyle = '#E4E1D8';
      const x0 = Math.floor(v.x / step) * step, y0 = Math.floor(v.y / step) * step;
      for (let gx = x0; gx < v.x + 1 / v.zoom; gx += step) {
        for (let gy = y0; gy < v.y + 1 / v.zoom; gy += step) context.fillRect(gx * canvas.width - 1, gy * canvas.height - 1, 2 / v.zoom, 2 / v.zoom);
      }
    }
    for (const stroke of strokesRef.current) drawStroke(context, stroke, canvas.width, canvas.height);
    for (const stroke of pendingRef.current.values()) drawStroke(context, stroke, canvas.width, canvas.height);
    const current = currentRef.current;
    if (current && tool !== 'laser' && tool !== 'pan' && tool !== 'text' && tool !== 'note' && tool !== 'math') {
      drawStroke(context, { tool, color, width: widthFor(tool), points: current }, canvas.width, canvas.height);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    setStrokeCount(strokesRef.current.length + pendingRef.current.size);
    setNotes(strokesRef.current.filter((s) => s.tool === 'note' || s.tool === 'math'));
  }, [color, tool, zoomable]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    paint();
  }, [view, paint]);

  // Space held down turns any tool into panning, as in drawing apps.
  useEffect(() => {
    if (!zoomable) return;
    const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e.target)) { spaceRef.current = true; e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [zoomable]);

  /** Zooms to z keeping the point at screen fraction (fx, fy) still. */
  const zoomTo = useCallback((z: number, fx = 0.5, fy = 0.5) => {
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
      const wx = v.x + fx / v.zoom, wy = v.y + fy / v.zoom;
      return { zoom, x: wx - fx / zoom, y: wy - fy / zoom };
    });
  }, []);

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

  /** The board point under the pointer: screen position through the view, within the board's bounds. */
  const pointFrom = (e: React.PointerEvent<HTMLElement>, element: HTMLElement = e.currentTarget): Point => {
    const rect = element.getBoundingClientRect();
    const v = viewRef.current;
    const [lo, hi] = zoomable ? [WORLD_MIN, WORLD_MAX] : [0, 1];
    const clamp = (n: number) => Math.min(hi, Math.max(lo, n));
    const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height;
    return [Number(clamp(v.x + fx / v.zoom).toFixed(4)), Number(clamp(v.y + fy / v.zoom).toFixed(4))];
  };

  /** Where a board point appears, as CSS percentages of the surface. */
  const screenOf = (p: Point) => ({ left: `${(p[0] - view.x) * view.zoom * 100}%`, top: `${(p[1] - view.y) * view.zoom * 100}%` });

  // Panning (hand tool or Space) and two-finger pinch. Returns true when the event was used.
  const panStart = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!zoomable) return false;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = e.currentTarget.getBoundingClientRect();
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      currentRef.current = null; // a second finger cancels the line the first had started
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), view: viewRef.current, cx: ((a.x + b.x) / 2 - rect.left) / rect.width, cy: ((a.y + b.y) / 2 - rect.top) / rect.height };
      return true;
    }
    if (tool === 'pan' || spaceRef.current) {
      e.currentTarget.setPointerCapture(e.pointerId);
      panRef.current = { x: e.clientX, y: e.clientY, view: viewRef.current };
      return true;
    }
    return false;
  };

  const panMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!zoomable) return false;
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = e.currentTarget.getBoundingClientRect();
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.view.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(pinch.distance, 1))));
      const cx = ((a.x + b.x) / 2 - rect.left) / rect.width, cy = ((a.y + b.y) / 2 - rect.top) / rect.height;
      const wx = pinch.view.x + pinch.cx / pinch.view.zoom, wy = pinch.view.y + pinch.cy / pinch.view.zoom;
      setView({ zoom, x: wx - cx / zoom, y: wy - cy / zoom });
      return true;
    }
    const pan = panRef.current;
    if (pan) {
      setView({ zoom: pan.view.zoom, x: pan.view.x - (e.clientX - pan.x) / rect.width / pan.view.zoom, y: pan.view.y - (e.clientY - pan.y) / rect.height / pan.view.zoom });
      return true;
    }
    return false;
  };

  const panEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (panRef.current) {
      panRef.current = null;
      return true;
    }
    return false;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!zoomable) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomTo(viewRef.current.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    } else {
      const v = viewRef.current;
      setView({ ...v, x: v.x + e.deltaX / rect.width / v.zoom, y: v.y + e.deltaY / rect.height / v.zoom });
    }
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
    if (panStart(e)) return;
    if (tool === 'laser') {
      e.currentTarget.setPointerCapture(e.pointerId);
      currentRef.current = [pointFrom(e)];
      return;
    }
    if (!state.canDraw) return;
    if (tool === 'text' || tool === 'note' || tool === 'math') {
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
    if (panMove(e)) return;
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

  const onPointerUp = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panEnd(e)) return;
    const points = currentRef.current;
    currentRef.current = null;
    if (!points || tool === 'laser' || tool === 'pan' || tool === 'text' || tool === 'note' || tool === 'math') return;
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
          className={`w-full h-full block touch-none ${tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : state.canDraw || tool === 'laser' ? 'cursor-crosshair' : ''}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {notes.map((note) => {
          const at = drag?.id === note.id ? drag.point : note.points[0];
          const isMath = note.tool === 'math';
          return (
            <div
              key={note.id}
              data-testid={isMath ? 'math-block' : 'sticky-note'}
              role={isMath ? undefined : 'note'}
              style={{ ...screenOf(at), backgroundColor: isMath ? 'rgba(255,255,255,0.92)' : note.color, transform: `scale(${view.zoom})`, transformOrigin: 'top left' }}
              className={`absolute ${isMath ? 'px-3 py-2 rounded-xl text-xl text-[#17171A] border border-[#ECECE6] whitespace-nowrap' : 'w-36 min-h-[72px] p-2 rounded-xl text-xs text-[#17171A] whitespace-pre-wrap break-words shadow-[4px_4px_12px_rgba(23,23,26,0.12)] border border-[rgba(23,23,26,0.06)]'} ${canMove(note) ? 'cursor-grab active:cursor-grabbing touch-none' : ''}`}
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
              {isMath ? <MathBlock source={note.body ?? ''} /> : note.body}
            </div>
          );
        })}
        {draft && (
          <div className="absolute z-10 space-y-1" style={screenOf([Math.min(draft.point[0], view.x + 0.7 / view.zoom), Math.min(draft.point[1], view.y + 0.75 / view.zoom)])}>
            <textarea
              ref={draftRef}
              autoFocus
              data-testid="board-draft"
              aria-label={draft.tool === 'note' ? 'Sticky note text' : draft.tool === 'math' ? 'Formula in LaTeX' : 'Text'}
              value={draft.text}
              maxLength={500}
              rows={draft.tool === 'note' ? 3 : 1}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitDraft(); }
                if (e.key === 'Escape') setDraft(null);
              }}
              onBlur={commitDraft}
              placeholder={draft.tool === 'note' ? 'Note… (Enter to place)' : draft.tool === 'math' ? '\\frac{n(n+1)}{2}, then Enter' : 'Type, then Enter'}
              style={{ backgroundColor: draft.tool === 'note' ? noteColor : '#FFFFFF' }}
              className={`${draft.tool === 'math' ? 'w-64 font-mono' : 'w-44'} rounded-xl border-2 border-[#7444E8] p-2 text-xs text-[#17171A] outline-none shadow-card`}
            />
            {draft.tool === 'math' && draft.text.trim() && (
              <div data-testid="math-preview" className="rounded-xl bg-white border border-[#ECECE6] px-3 py-2 text-lg text-[#17171A] shadow-card"><MathBlock source={draft.text} /></div>
            )}
          </div>
        )}
        {laser && laserVisible && (
          <span
            data-testid="laser-dot"
            aria-hidden="true"
            className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-[#FF3B30] shadow-[0_0_12px_4px_rgba(255,59,48,0.55)] pointer-events-none transition-[left,top] duration-75"
            style={screenOf([laser.x, laser.y])}
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
          {zoomable && (
            <button type="button" aria-label="Move around the board (or hold Space)" title="Move around the board (or hold Space)" data-testid="pan-tool" aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}
              className={`${toolButton} ${tool === 'pan' ? 'neu-pressed bg-[#F1EBFF] text-[#5A2FC7]' : ''}`}>
              <Hand className="w-4 h-4" />
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
      {zoomable && (
        <div className="absolute right-2 bottom-2 neu-pill flex items-center gap-0.5 px-1 py-1" data-testid="zoom-control">
          <button type="button" aria-label="Zoom out" disabled={view.zoom <= MIN_ZOOM} onClick={() => zoomTo(view.zoom - 0.25)} className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-40"><Minus className="w-4 h-4" /></button>
          <button type="button" data-testid="zoom-level" title="Back to the start" onClick={() => setView({ zoom: 1, x: 0, y: 0 })} className="min-w-[3.5rem] text-xs font-bold text-[#17171A] tabular-nums">{Math.round(view.zoom * 100)}%</button>
          <button type="button" aria-label="Zoom in" disabled={view.zoom >= MAX_ZOOM} onClick={() => zoomTo(view.zoom + 0.25)} className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-40"><Plus className="w-4 h-4" /></button>
        </div>
      )}
      {error && <p role="alert" className="absolute left-2 top-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">{error}</p>}
    </>
  );
};
