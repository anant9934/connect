'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Pencil, Play, Presentation, RotateCcw, Send, Sparkles, Users, X } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import * as api from '@/features/classroom/liveCanvas';
import type { CanvasState, LiveDeck, LiveSimulation, LiveSlide, SimAnswer, SimParams } from '@/features/classroom/liveCanvas';
import { drawSimulation, type Readout } from '@/features/classroom/simulations/engines';
import { ENGINE_SPECS, normalizeParams, RUN_KEY } from '@/features/classroom/simulations/specs';

const POLL_INTERVAL_MS = 4000;
const FRAME_INTERVAL_MS = 33;
const SAVE_INTERVAL_MS = 500;

export interface SimFrame { params: SimParams; from: string; at: number }

interface LiveCanvasProps {
  roomCode: string;
  syncTick: number;
  onChanged: () => void;
  simFrame: SimFrame | null;
  sendSimFrame: (params: SimParams) => void;
}

const pill = 'neu-pill inline-flex items-center justify-center gap-1.5 px-3 min-h-[40px] text-xs font-semibold text-[#17171A] disabled:opacity-50';
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

// ---------------- Slides ----------------

function SlideBody({ slide }: { slide: LiveSlide }) {
  const list = (items: string[] | undefined, numbered = false) =>
    items && items.length > 0 ? (
      numbered ? (
        <ol className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span className="shrink-0 w-7 h-7 rounded-full bg-[#F1EBFF] text-[#5A2FC7] text-sm font-bold flex items-center justify-center">{i + 1}</span>
              <span className="pt-0.5">{item}</span>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-3 items-start">
              <span className="shrink-0 mt-2 w-2 h-2 rounded-full bg-[#FFC93C]" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )
    ) : null;

  switch (slide.layout) {
    case 'title':
      return (
        <div className="h-full flex flex-col justify-center gap-4">
          <span className="self-start rounded-full bg-[#FFF4D1] text-[#6B4E00] text-xs font-bold px-3 py-1">Live in class</span>
          <h2 className="font-heading text-[clamp(1.6rem,4vw,3rem)] font-extrabold tracking-tight text-[#17171A] leading-tight">{slide.title}</h2>
          {slide.subtitle && <p className="text-[clamp(1rem,2vw,1.35rem)] text-[#5F5F68]">{slide.subtitle}</p>}
        </div>
      );
    case 'table':
      return (
        <div className="overflow-auto rounded-2xl border border-[#ECECE6]">
          <table className="w-full text-left text-[clamp(0.75rem,1.4vw,1rem)]">
            {slide.table?.headers?.length ? (
              <thead className="bg-[#F1EBFF] text-[#5A2FC7]">
                <tr>{slide.table.headers.map((h, i) => <th key={i} className="px-3 py-2 font-bold">{h}</th>)}</tr>
              </thead>
            ) : null}
            <tbody>
              {slide.table?.rows.map((row, r) => (
                <tr key={r} className={r % 2 ? 'bg-[#FCFCFA]' : 'bg-white'}>
                  {row.map((cell, c) => <td key={c} className="px-3 py-2 border-t border-[#ECECE6]">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'code':
      return (
        <div className="space-y-3">
          <div className="rounded-2xl bg-[#17171A] text-[#F8F8F5] p-4 overflow-auto">
            {slide.code?.language && <p className="text-[10px] uppercase tracking-wider text-[#FFC93C] font-bold mb-2">{slide.code.language}</p>}
            <pre className="font-mono text-[clamp(0.7rem,1.2vw,0.95rem)] leading-relaxed whitespace-pre">{slide.code?.source}</pre>
          </div>
          {list(slide.bullets)}
        </div>
      );
    case 'steps':
      return list(slide.steps, true);
    case 'comparison':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[slide.left, slide.right].map((col, i) => col && (
            <div key={i} className={`rounded-2xl p-4 ${i === 0 ? 'bg-[#F1EBFF]' : 'bg-[#FFF4D1]'}`}>
              <h3 className={`font-heading font-bold mb-2 ${i === 0 ? 'text-[#5A2FC7]' : 'text-[#6B4E00]'}`}>{col.heading}</h3>
              {list(col.bullets)}
            </div>
          ))}
        </div>
      );
    default:
      return list(slide.bullets);
  }
}

function SlideCard({ slide }: { slide: LiveSlide }) {
  return (
    <div data-testid="live-slide" className="w-full aspect-video max-h-full bg-white rounded-3xl border border-[rgba(23,23,26,0.06)] shadow-card p-[clamp(1rem,3vw,2.5rem)] flex flex-col gap-4 overflow-hidden">
      {slide.layout !== 'title' && (
        <h2 className="font-heading text-[clamp(1.1rem,2.6vw,2rem)] font-extrabold tracking-tight text-[#17171A] leading-tight shrink-0">{slide.title}</h2>
      )}
      <div className="flex-1 min-h-0 overflow-auto text-[clamp(0.85rem,1.6vw,1.2rem)] text-[#17171A] leading-snug">
        <SlideBody slide={slide} />
      </div>
    </div>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** A printable page of every slide; the browser's print dialog saves it as PDF. */
function printDeck(deck: LiveDeck) {
  const items = (xs?: string[]) => (xs ?? []).map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const body = deck.slides.map((s) => {
    let inner = '';
    if (s.layout === 'title') inner = `<p class="sub">${escapeHtml(s.subtitle ?? '')}</p>`;
    else if (s.layout === 'table' && s.table) inner = `<table><tr>${s.table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>${s.table.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    else if (s.layout === 'code' && s.code) inner = `<pre>${escapeHtml(s.code.source)}</pre><ul>${items(s.bullets)}</ul>`;
    else if (s.layout === 'steps') inner = `<ol>${items(s.steps)}</ol>`;
    else if (s.layout === 'comparison') inner = [s.left, s.right].map((c) => c ? `<div class="col"><h3>${escapeHtml(c.heading)}</h3><ul>${items(c.bullets)}</ul></div>` : '').join('');
    else inner = `<ul>${items(s.bullets)}</ul>`;
    return `<section><h2>${escapeHtml(s.title)}</h2>${inner}</section>`;
  }).join('');
  const page = window.open('', '_blank');
  if (!page) return;
  page.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(deck.title)}</title><style>
    @page{size:landscape;margin:0}body{margin:0;font-family:system-ui,sans-serif;color:#17171A}
    section{box-sizing:border-box;width:100vw;height:100vh;padding:48px 64px;page-break-after:always;background:#FCFCFA}
    h2{font-size:34px;margin:0 0 24px}.sub{font-size:22px;color:#5F5F68}li{font-size:20px;margin:8px 0}
    table{border-collapse:collapse;font-size:18px}td,th{border:1px solid #ECECE6;padding:6px 12px;text-align:left}th{background:#F1EBFF}
    pre{background:#17171A;color:#F8F8F5;padding:16px;border-radius:12px;font-size:15px;white-space:pre-wrap}
    .col{display:inline-block;vertical-align:top;width:45%;margin-right:4%}</style></head><body>${body}</body></html>`);
  page.document.close();
  page.focus();
  page.print();
}

function SlideEditor({ slide, onSave, onCancel, busy }: { slide: LiveSlide; onSave: (s: LiveSlide) => void; onCancel: () => void; busy: boolean }) {
  const listKey = slide.layout === 'steps' ? 'steps' : slide.layout === 'title' ? null : 'bullets';
  const [title, setTitle] = useState(slide.title);
  const [subtitle, setSubtitle] = useState(slide.subtitle ?? '');
  const [lines, setLines] = useState(((listKey && slide[listKey]) || []).join('\n'));
  const save = () => {
    const next: LiveSlide = { ...slide, title, subtitle: slide.layout === 'title' ? subtitle : slide.subtitle };
    if (listKey) next[listKey] = lines.split('\n').map((l) => l.trim()).filter(Boolean);
    onSave(next);
  };
  return (
    <div data-testid="slide-editor" className="neu-card p-4 space-y-3 w-full">
      <label className="block text-xs font-semibold text-[#17171A]">Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="mt-1 w-full rounded-xl border border-[#ECECE6] px-3 py-2 text-sm" />
      </label>
      {slide.layout === 'title' ? (
        <label className="block text-xs font-semibold text-[#17171A]">Subtitle
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={240} className="mt-1 w-full rounded-xl border border-[#ECECE6] px-3 py-2 text-sm" />
        </label>
      ) : listKey ? (
        <label className="block text-xs font-semibold text-[#17171A]">{listKey === 'steps' ? 'Steps' : 'Points'}, one per line
          <textarea value={lines} onChange={(e) => setLines(e.target.value)} rows={6} className="mt-1 w-full rounded-xl border border-[#ECECE6] px-3 py-2 text-sm" />
        </label>
      ) : (
        <p className="text-xs text-[#5F5F68]">Only the title of this layout can be edited here.</p>
      )}
      <div className="flex gap-2 justify-end">
        <button type="button" className={pill} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" data-testid="save-slide" className={`${pill} !bg-[#7444E8] !text-white`} onClick={save} disabled={busy || !title.trim()}>Save for everyone</button>
      </div>
    </div>
  );
}

// ---------------- Simulation ----------------

function SimulationStage({ sim, params, runKey }: { sim: LiveSimulation; params: SimParams; runKey: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [readouts, setReadouts] = useState<Readout[]>([]);
  const startRef = useRef(performance.now());

  useEffect(() => {
    startRef.current = performance.now();
  }, [runKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let lastReadout = 0;
    const tick = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (canvas.width !== w * ratio || canvas.height !== h * ratio) {
        canvas.width = w * ratio;
        canvas.height = h * ratio;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const out = drawSimulation(ctx, w, h, sim.engine, paramsRef.current, (now - startRef.current) / 1000);
        if (now - lastReadout > 150) {
          lastReadout = now;
          setReadouts(out);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sim.engine]);

  return (
    <div className="w-full h-full flex flex-col gap-2 min-h-0">
      <canvas ref={canvasRef} data-testid="simulation-canvas" aria-label={`${sim.title} simulation`} className="flex-1 min-h-[220px] w-full rounded-3xl bg-white border border-[rgba(23,23,26,0.06)] shadow-card" />
      <dl className="flex flex-wrap gap-2">
        {readouts.map((r) => (
          <div key={r.label} className="neu-card !rounded-2xl px-3 py-1.5">
            <dt className="text-[10px] uppercase tracking-wide text-[#8B8B93] font-bold">{r.label}</dt>
            <dd className="text-sm font-semibold text-[#17171A] font-mono">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SimControls({ sim, params, disabled, onChange }: { sim: LiveSimulation; params: SimParams; disabled: boolean; onChange: (p: SimParams) => void }) {
  const spec = ENGINE_SPECS[sim.engine];
  const processes = Array.isArray(params.processes) ? (params.processes as { name: string; arrival: number; burst: number }[]) : [];
  return (
    <div data-testid="simulation-controls" className="space-y-3">
      {spec.controls.map((control) => control.kind === 'number' ? (
        control.max - control.min === 1 && control.step === 1 ? (
          <button key={control.key} type="button" disabled={disabled} aria-pressed={Number(params[control.key]) === 1}
            onClick={() => onChange({ ...params, [control.key]: Number(params[control.key]) === 1 ? 0 : 1 })}
            className={`${pill} w-full justify-between`}>
            <span>{control.label}</span><span className="font-mono">{Number(params[control.key])}</span>
          </button>
        ) : (
          <label key={control.key} className="block text-xs font-semibold text-[#17171A]">
            <span className="flex justify-between"><span>{control.label}</span><span className="font-mono text-[#5A2FC7]">{Number(params[control.key])}{control.unit ? ` ${control.unit}` : ''}</span></span>
            <input type="range" min={control.min} max={control.max} step={control.step} value={Number(params[control.key])} disabled={disabled}
              onChange={(e) => onChange({ ...params, [control.key]: Number(e.target.value) })} className="w-full accent-[#7444E8]" />
          </label>
        )
      ) : (
        <label key={control.key} className="block text-xs font-semibold text-[#17171A]">{control.label}
          <select value={String(params[control.key])} disabled={disabled} onChange={(e) => onChange({ ...params, [control.key]: e.target.value })}
            className="mt-1 w-full neu-well !rounded-xl px-3 min-h-[40px] text-sm bg-transparent">
            {control.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
      {spec.processes && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[#17171A]">Jobs (arrival, burst)</p>
          {processes.map((proc, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-8 font-mono font-bold">{proc.name}</span>
              {(['arrival', 'burst'] as const).map((field) => (
                <input key={field} type="number" aria-label={`${proc.name} ${field}`} min={field === 'burst' ? 1 : 0} max={field === 'burst' ? 15 : 20} value={proc[field]} disabled={disabled}
                  onChange={(e) => onChange({ ...params, processes: processes.map((p, j) => j === i ? { ...p, [field]: Number(e.target.value) } : p) })}
                  className="w-16 rounded-lg border border-[#ECECE6] px-2 py-1" />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- The canvas ----------------

export const LiveCanvas: React.FC<LiveCanvasProps> = ({ roomCode, syncTick, onChanged, simFrame, sendSimFrame }) => {
  const [state, setState] = useState<CanvasState | null>(null);
  const [open, setOpen] = useState(false);
  const [seenGeneration, setSeenGeneration] = useState<string | null>(null);
  const [kind, setKind] = useState<'slides' | 'simulation'>('slides');
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useState<SimParams | null>(null);
  const [answers, setAnswers] = useState<SimAnswer[]>([]);
  const [viewing, setViewing] = useState<SimAnswer | null>(null);
  const lastFrameSent = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<SimParams | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.getCanvas(roomCode));
    } catch {
      // The next poll tries again.
    }
  }, [roomCode]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    refresh();
  }, [syncTick, refresh]);

  const canManage = state?.canManage ?? false;
  const sim = state?.kind === 'simulation' ? (state.content as LiveSimulation) : null;
  const deck = state?.kind === 'slides' ? (state.content as LiveDeck) : null;
  const sandbox = state?.simMode === 'sandbox';
  // In sandbox mode students drive their own copy; the presenter's settings stay stored.
  const ownsParams = canManage || sandbox;

  // Everyone is brought to new content once; closing it leaves them in the meeting.
  useEffect(() => {
    if (state?.generation && state.generation !== seenGeneration) {
      setSeenGeneration(state.generation);
      setOpen(true);
      setEditing(false);
      setViewing(null);
      setParams(sim ? normalizeParams(sim.engine, state.simParams) : null);
    }
    if (!state?.kind) {
      setSeenGeneration(null);
      setParams(null);
    }
  }, [state?.generation, state?.kind, state?.simParams, seenGeneration, sim]);

  // Stored settings win whenever this person is not driving them.
  useEffect(() => {
    if (sim && state && (!ownsParams || (canManage && !pendingSave.current && !saveTimer.current))) {
      if (!canManage || Date.now() - lastFrameSent.current > SAVE_INTERVAL_MS * 2) {
        setParams(normalizeParams(sim.engine, state.simParams));
      }
    }
  }, [state?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Presenter frames arrive many times a second; only the stored presenter's are accepted.
  useEffect(() => {
    if (!simFrame || !sim || canManage || sandbox || simFrame.from !== state?.presenter) return;
    setParams(normalizeParams(sim.engine, simFrame.params));
  }, [simFrame]); // eslint-disable-line react-hooks/exhaustive-deps

  // Moderators see answers to the current simulation while sandbox is open.
  useEffect(() => {
    if (!canManage || !sim || !sandbox) {
      setAnswers([]);
      return;
    }
    let current = true;
    api.listAnswers(roomCode).then((list) => current && setAnswers(list)).catch(() => undefined);
    return () => {
      current = false;
    };
  }, [canManage, sim, sandbox, roomCode, syncTick, state?.version]);

  const act = async <T,>(work: () => Promise<T>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (result && typeof result === 'object' && 'version' in (result as object)) setState(result as unknown as CanvasState);
      onChanged();
      return result;
    } catch (err) {
      setError(errorText(err, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    const started = performance.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed((performance.now() - started) / 1000), 100);
    const result = await act(() => api.generateCanvas(roomCode, kind, prompt.trim(), context.trim()), 'Could not generate that. Try again.');
    clearInterval(timer);
    setElapsed(result ? (performance.now() - started) / 1000 : null);
    if (result) setOpen(true);
  };

  const flushSave = useCallback(() => {
    saveTimer.current = null;
    const next = pendingSave.current;
    pendingSave.current = null;
    if (next) api.updateCanvas(roomCode, { params: next }).then(() => onChanged()).catch((err) => setError(errorText(err, 'Could not save the settings.')));
  }, [roomCode, onChanged]);

  const changeParams = (next: SimParams) => {
    if (!sim) return;
    const clean = normalizeParams(sim.engine, next);
    setParams(clean);
    setViewing(null);
    if (!canManage || sandbox) return; // students keep their own copy; hosts in sandbox preview locally
    const now = performance.now();
    if (now - lastFrameSent.current >= FRAME_INTERVAL_MS) {
      lastFrameSent.current = now;
      sendSimFrame(clean);
    }
    pendingSave.current = clean;
    if (!saveTimer.current) saveTimer.current = setTimeout(flushSave, SAVE_INTERVAL_MS);
  };

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const replay = () => {
    if (!sim || !params) return;
    changeParams({ ...params, [RUN_KEY]: Number(params[RUN_KEY] ?? 0) + 1 });
  };

  const slideIndex = Math.max(0, Math.min((deck?.slides.length ?? 1) - 1, (state?.slide ?? 1) - 1));

  useEffect(() => {
    if (!open || !deck || !canManage || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' && slideIndex < deck.slides.length - 1) act(() => api.updateCanvas(roomCode, { slide: slideIndex + 2 }), 'Could not move the slide.');
      if (e.key === 'ArrowLeft' && slideIndex > 0) act(() => api.updateCanvas(roomCode, { slide: slideIndex }), 'Could not move the slide.');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const shownParams = useMemo(() => (viewing && sim ? normalizeParams(sim.engine, viewing.params) : params), [viewing, sim, params]);

  if (!state) return null;
  if (!state.kind && !canManage) return null;

  const launcher = (
    <div className="absolute top-2 left-2 z-10">
      <button type="button" data-testid="open-live-canvas" onClick={() => setOpen(true)}
        className={`${pill} ${state.kind ? '!bg-[#FFC93C]' : ''}`}>
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> {state.kind ? 'Live canvas' : 'AI studio'}
      </button>
    </div>
  );
  if (!open) return launcher;

  const commandBar = canManage && (
    <form data-testid="live-command-bar" className="space-y-2" onSubmit={(e) => { e.preventDefault(); generate(); }}>
      <div role="radiogroup" aria-label="What to generate" className="flex gap-2">
        {(['slides', 'simulation'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)} className={`${pill} flex-1`}>
            {k === 'slides' ? <Presentation className="w-3.5 h-3.5" aria-hidden="true" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />}
            {k === 'slides' ? 'Slides' : 'Simulation'}
          </button>
        ))}
      </div>
      <div className="neu-well flex items-center gap-1 p-1 pl-4">
        <input data-testid="live-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={2000} disabled={busy}
          placeholder={kind === 'slides' ? 'e.g. Compare stacks and queues with C++ code' : 'e.g. Show round robin with quantum 3'}
          className="flex-1 min-w-0 bg-transparent text-sm outline-none py-2 placeholder:text-[#8B8B93]" aria-label="Describe what to generate" />
        <button type="submit" data-testid="live-generate" disabled={busy || !prompt.trim()}
          className="neu-pill !bg-[#7444E8] !text-white inline-flex items-center gap-1.5 px-4 min-h-[40px] text-xs font-bold disabled:opacity-50">
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> {busy && elapsed !== null ? `${elapsed.toFixed(1)}s` : 'Generate'}
        </button>
      </div>
      <button type="button" className="text-xs font-semibold text-[#5A2FC7] underline" onClick={() => setShowContext((v) => !v)}>
        {showContext ? 'Hide lecture context' : 'Add lecture context'}
      </button>
      {showContext && (
        <textarea value={context} onChange={(e) => setContext(e.target.value)} maxLength={6000} rows={4} placeholder="Paste what you have covered so far, so the result builds on it."
          className="w-full rounded-2xl neu-well !rounded-2xl px-3 py-2 text-xs outline-none" aria-label="Lecture context" />
      )}
      {!busy && elapsed !== null && <p className="text-[11px] text-[#5F5F68]">Generated in {elapsed.toFixed(1)}s and shown to the class.</p>}
    </form>
  );

  const stage = deck ? (
    editing ? (
      <SlideEditor slide={deck.slides[slideIndex]} busy={busy} onCancel={() => setEditing(false)}
        onSave={async (slide) => { if (await act(() => api.editSlide(roomCode, slideIndex, slide), 'Could not save the slide.')) setEditing(false); }} />
    ) : (
      <SlideCard slide={deck.slides[slideIndex]} />
    )
  ) : sim && shownParams ? (
    <SimulationStage sim={sim} params={shownParams} runKey={`${state.generation}:${shownParams[RUN_KEY]}:${viewing?.identity ?? ''}`} />
  ) : (
    <div className="w-full aspect-video rounded-3xl border-2 border-dashed border-[#E9E7E1] flex flex-col items-center justify-center gap-2 text-center p-6">
      <Sparkles className="w-8 h-8 text-[#7444E8]" aria-hidden="true" />
      <p className="font-heading font-bold text-[#17171A]">Generate slides or a simulation for the class</p>
      <p className="text-sm text-[#5F5F68] max-w-md">Describe a topic. The result appears on every screen in this meeting, and anyone who joins later sees it too.</p>
    </div>
  );

  return (
    <div data-testid="live-canvas" className="fixed inset-0 z-40 sm:absolute sm:z-20 bg-[#FCFCFA] flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[#ECECE6] bg-white">
        <div className="min-w-0 flex items-center gap-2">
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${state.kind ? 'bg-[#E4F8EB] text-[#1F6B3B]' : 'bg-[#F1EBFF] text-[#5A2FC7]'}`}>
            {state.kind ? 'Live' : 'Teacher only'}
          </span>
          <p className="text-sm font-semibold text-[#17171A] truncate">{deck?.title ?? sim?.title ?? 'AI studio'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {deck && (
            <>
              {canManage && <button type="button" aria-label="Previous slide" className={pill} disabled={busy || slideIndex === 0} onClick={() => act(() => api.updateCanvas(roomCode, { slide: slideIndex }), 'Could not move the slide.')}><ChevronLeft className="w-4 h-4" /></button>}
              <span data-testid="live-slide-number" className="text-xs font-semibold text-[#17171A]">Slide {slideIndex + 1} of {deck.slides.length}</span>
              {canManage && <button type="button" aria-label="Next slide" className={pill} disabled={busy || slideIndex >= deck.slides.length - 1} onClick={() => act(() => api.updateCanvas(roomCode, { slide: slideIndex + 2 }), 'Could not move the slide.')}><ChevronRight className="w-4 h-4" /></button>}
              {canManage && !editing && <button type="button" data-testid="edit-slide" className={pill} disabled={busy} onClick={() => setEditing(true)}><Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit</button>}
              <button type="button" className={pill} onClick={() => printDeck(deck)}><Download className="w-3.5 h-3.5" aria-hidden="true" /> PDF</button>
            </>
          )}
          {canManage && state.kind && (
            <button type="button" data-testid="stop-live-canvas" className={pill} disabled={busy} onClick={() => act(() => api.updateCanvas(roomCode, { stop: true }), 'Could not close the canvas.')}>Stop showing</button>
          )}
          <button type="button" aria-label="Close live canvas" className={pill} onClick={() => setOpen(false)}><X className="w-4 h-4" /></button>
        </div>
      </header>
      {error && <p role="alert" className="text-xs text-[#9F1D1D] bg-[#FFE9E9] px-3 py-1.5">{error}</p>}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 p-3 overflow-auto">
        <main className={`lg:basis-3/4 min-w-0 shrink-0 lg:shrink lg:min-h-0 flex items-center justify-center ${sim ? 'min-h-[480px]' : 'min-h-[260px]'}`}>{stage}</main>
        <aside className="lg:basis-1/4 min-w-0 lg:min-w-[280px] space-y-4 lg:overflow-y-auto">
          {commandBar}
          {sim && (
            <section className="neu-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-heading font-bold text-sm text-[#17171A]">{ENGINE_SPECS[sim.engine].label}</h3>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${sandbox ? 'bg-[#FFF4D1] text-[#6B4E00]' : 'bg-[#F1EBFF] text-[#5A2FC7]'}`}>
                  {sandbox ? 'Try it yourself' : 'Teacher driving'}
                </span>
              </div>
              {sim.explanation && <p className="text-xs text-[#5F5F68] leading-relaxed">{sim.explanation}</p>}
              {sim.observe.length > 0 && <ul className="text-xs text-[#17171A] list-disc pl-4 space-y-1">{sim.observe.map((o, i) => <li key={i}>{o}</li>)}</ul>}
              {canManage && (
                <div className="flex gap-2">
                  {(['presenter', 'sandbox'] as const).map((mode) => (
                    <button key={mode} type="button" data-testid={`sim-mode-${mode}`} aria-pressed={state.simMode === mode} disabled={busy} className={`${pill} flex-1`}
                      onClick={() => act(() => api.updateCanvas(roomCode, { mode }), 'Could not change the mode.')}>
                      {mode === 'presenter' ? 'I drive' : 'Students try'}
                    </button>
                  ))}
                </div>
              )}
              {shownParams && (
                <SimControls sim={sim} params={shownParams} disabled={!ownsParams || busy} onChange={changeParams} />
              )}
              <div className="flex gap-2">
                {ownsParams && <button type="button" className={`${pill} flex-1`} onClick={replay}><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Replay</button>}
                {!canManage && sandbox && params && (
                  <button type="button" data-testid="submit-simulation" className={`${pill} flex-1 !bg-[#7444E8] !text-white`} disabled={busy}
                    onClick={() => act(() => api.submitAnswer(roomCode, params), 'Could not send your answer.')}>
                    <Send className="w-3.5 h-3.5" aria-hidden="true" /> {state.myAnswer ? 'Send again' : 'Send to teacher'}
                  </button>
                )}
              </div>
              {!canManage && !sandbox && <p className="text-[11px] text-[#8B8B93]">Your screen follows the teacher's settings.</p>}
            </section>
          )}
          {canManage && sim && sandbox && (
            <section className="neu-card p-4 space-y-2" data-testid="simulation-answers">
              <h3 className="font-heading font-bold text-sm text-[#17171A] flex items-center gap-1.5"><Users className="w-4 h-4" aria-hidden="true" /> Answers ({answers.length})</h3>
              {answers.length === 0 && <p className="text-xs text-[#5F5F68]">Students&apos; settings appear here when they send them.</p>}
              <ul className="space-y-1">
                {answers.map((a) => (
                  <li key={a.identity}>
                    <button type="button" aria-pressed={viewing?.identity === a.identity} onClick={() => setViewing(viewing?.identity === a.identity ? null : a)} className={`${pill} w-full justify-between`}>
                      <span className="truncate">{a.displayName}</span>
                      <span className="text-[10px] text-[#8B8B93]">{new Date(a.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {viewing && <p className="text-[11px] text-[#5A2FC7]">Showing {viewing.displayName}&apos;s settings on your screen only.</p>}
            </section>
          )}
          {deck && deck.slides[slideIndex]?.notes && canManage && (
            <section className="neu-card p-4">
              <h3 className="text-[11px] uppercase tracking-wide font-bold text-[#8B8B93] mb-1">Teacher notes</h3>
              <p className="text-xs text-[#17171A]">{deck.slides[slideIndex].notes}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
};
