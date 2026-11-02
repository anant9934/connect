'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, PenLine, X } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import * as api from '@/features/classroom/api';
import { Deck, loadDeck, PPTX_TYPE } from '@/features/classroom/deck';
import { getDownloadUrl, listFiles, uploadFile } from '@/features/files/api';
import { MeetingFile } from '@/features/files/types';
import { BoardCanvas } from './BoardCanvas';

const POLL_INTERVAL_MS = 4000;
const PRESENTABLE = ['application/pdf', PPTX_TYPE];
const buttonClass = 'px-3 rounded-lg border border-[#E5E7EB] bg-white text-xs font-semibold text-[#1C1C1C] min-h-[40px] inline-flex items-center gap-1.5 disabled:opacity-50';

interface ClassroomBoardProps {
  roomCode: string;
  selfIdentity: string;
  syncTick: number;
  onChanged: () => void;
}

const fetchDeck = async (roomCode: string, fileId: string, contentType: string, identity: string) => {
  const res = await fetch(getDownloadUrl(roomCode, fileId, identity), { credentials: 'include' });
  if (!res.ok) throw new Error('This presentation could not be opened.');
  return loadDeck(await res.arrayBuffer(), contentType);
};

// The shared whiteboard and presentation, over the meeting stage. What is shown comes from stored
// state, so someone joining late or reconnecting lands on the current page with its annotations.
export const ClassroomBoard: React.FC<ClassroomBoardProps> = ({ roomCode, selfIdentity, syncTick, onChanged }) => {
  const [state, setState] = useState<api.ClassroomState | null>(null);
  const [view, setView] = useState<'none' | 'whiteboard' | 'presentation'>('none');
  const [dismissedFile, setDismissedFile] = useState<string | null>(null);
  const [deck, setDeck] = useState<{ fileId: string; deck: Deck } | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [files, setFiles] = useState<MeetingFile[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.getClassroom(roomCode));
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

  const fileId = state?.fileId ?? null;
  const contentType = state?.fileType ?? '';

  // Everyone is brought to a new presentation, once. Closing it leaves them in the meeting.
  useEffect(() => {
    if (fileId && fileId !== dismissedFile) setView('presentation');
    if (!fileId) {
      setDeck(null);
      setDismissedFile(null);
      setView((current) => (current === 'presentation' ? 'none' : current));
    }
  }, [fileId, dismissedFile]);

  useEffect(() => {
    if (!fileId || deck?.fileId === fileId) return;
    let current = true;
    fetchDeck(roomCode, fileId, contentType, selfIdentity)
      .then((loaded) => {
        if (current) setDeck({ fileId, deck: loaded });
      })
      .catch((err) => {
        if (current) setError(err instanceof Error ? err.message : 'This presentation could not be opened.');
      });
    return () => {
      current = false;
    };
  }, [fileId, contentType, deck?.fileId, roomCode, selfIdentity]);

  const page = state?.page ?? 1;

  useEffect(() => {
    const loaded = deck?.deck;
    const canvas = pageRef.current;
    const frame = frameRef.current;
    if (view !== 'presentation' || !loaded || !canvas || !frame) return;
    let current = true;
    (async () => {
      const ratio = await loaded.aspect(page);
      if (!current) return;
      setAspect(ratio);
      await loaded.render(page, canvas, Math.max(320, frame.getBoundingClientRect().width));
    })().catch(() => {
      if (current) setError('This page could not be drawn.');
    });
    return () => {
      current = false;
    };
  }, [deck, page, view]);

  const change = async (update: Parameters<typeof api.updateClassroom>[1]) => {
    setError(null);
    setBusy(true);
    try {
      await api.updateClassroom(roomCode, update);
      onChanged();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  const openChooser = async () => {
    setChoosing(true);
    setError(null);
    try {
      setFiles((await listFiles(roomCode, selfIdentity)).filter((f) => PRESENTABLE.includes(f.mimeType)));
    } catch {
      setError('Could not list the files in this meeting.');
    }
  };

  const present = async (file: MeetingFile) => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await fetchDeck(roomCode, file.id, file.mimeType, selfIdentity);
      setDeck({ fileId: file.id, deck: loaded });
      setChoosing(false);
      setDismissedFile(null);
      await change({ fileId: file.id, pages: loaded.pages });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This presentation could not be opened.');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await present(await uploadFile(roomCode, file, selfIdentity));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This file could not be uploaded.');
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  const launcher = (
    <div className="absolute top-2 right-2 z-10 flex gap-1.5">
      <button type="button" data-testid="open-whiteboard" onClick={() => setView('whiteboard')} className={buttonClass}>
        <PenLine className="w-3.5 h-3.5" aria-hidden="true" /> Whiteboard
      </button>
      {fileId ? (
        <button type="button" data-testid="open-presentation" onClick={() => { setDismissedFile(null); setView('presentation'); }} className={buttonClass}>
          <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Presentation
        </button>
      ) : state.canManage ? (
        <button type="button" data-testid="start-presentation" onClick={openChooser} className={buttonClass}>
          <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Present a file
        </button>
      ) : null}
    </div>
  );

  const chooser = choosing && (
    <div role="dialog" aria-label="Present a file" className="absolute inset-0 z-30 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-4 w-full max-w-md space-y-3 max-h-full overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#1C1C1C]">Present a file</h3>
          <button type="button" aria-label="Close" onClick={() => setChoosing(false)} className="p-1.5 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6]"><X className="w-4 h-4" /></button>
        </div>
        <label className="block text-xs font-semibold text-[#1C1C1C]">
          Upload a PDF or PowerPoint (.pptx)
          <input data-testid="presentation-file" type="file" accept=".pdf,.pptx" disabled={busy} onChange={upload} className="block w-full text-xs mt-1 min-h-[40px]" />
        </label>
        {files.length > 0 && (
          <ul className="space-y-1">
            {files.map((file) => (
              <li key={file.id}>
                <button type="button" disabled={busy} onClick={() => present(file)} className="w-full text-left px-3 min-h-[40px] rounded-lg border border-[#E5E7EB] text-xs text-[#1C1C1C] break-all disabled:opacity-50">
                  {file.originalFilename}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );

  if (view === 'none') {
    return (
      <>
        {launcher}
        {chooser}
      </>
    );
  }

  const close = () => {
    if (view === 'presentation' && fileId) setDismissedFile(fileId);
    setView('none');
  };

  return (
    <div data-testid="classroom-board" className="fixed inset-0 z-40 sm:absolute sm:z-20 bg-[#F3F4F6] flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-1.5 p-2 bg-white border-b border-[#E5E7EB]">
        <p className="text-xs font-semibold text-[#1C1C1C] break-all min-w-0">
          {view === 'whiteboard' ? 'Whiteboard' : state.fileName ?? 'Presentation'}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {view === 'presentation' && (
            <>
              {state.canManage && (
                <button type="button" aria-label="Previous page" disabled={busy || page <= 1} onClick={() => change({ page: page - 1 })} className={buttonClass}><ChevronLeft className="w-4 h-4" /></button>
              )}
              <span data-testid="presentation-page" className="text-xs text-[#1C1C1C]">Page {page} of {state.pages}</span>
              {state.canManage && (
                <button type="button" aria-label="Next page" disabled={busy || page >= state.pages} onClick={() => change({ page: page + 1 })} className={buttonClass}><ChevronRight className="w-4 h-4" /></button>
              )}
              {state.canManage && (
                <button type="button" disabled={busy} onClick={() => change({ stop: true })} className={buttonClass}>Stop presenting</button>
              )}
            </>
          )}
          {state.canManage && (
            <label className="inline-flex items-center gap-1.5 text-xs text-[#1C1C1C] min-h-[40px] px-1">
              <input type="checkbox" data-testid="let-everyone-draw" checked={state.studentsCanDraw} disabled={busy} onChange={(e) => change({ studentsCanDraw: e.target.checked })} />
              Everyone can draw
            </label>
          )}
          <button type="button" aria-label="Close board" onClick={close} className={buttonClass}><X className="w-4 h-4" /></button>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-red-700 bg-red-50 px-3 py-1">{error}</p>}
      {view === 'whiteboard' ? (
        <div className="relative flex-1 min-h-0">
          <BoardCanvas roomCode={roomCode} board="whiteboard" state={state} syncTick={syncTick} onChanged={onChanged} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center p-2 overflow-auto">
          <div ref={frameRef} className="relative bg-white w-full max-h-full" style={{ aspectRatio: String(aspect), maxWidth: `calc((100dvh - 9rem) * ${aspect})` }}>
            <canvas ref={pageRef} data-testid="presentation-page-canvas" className="absolute inset-0 w-full h-full" />
            {deck?.deck.approximate && <p className="absolute right-1 top-1 text-[10px] text-[#6B7280] bg-white/80 px-1 rounded">PowerPoint layout is approximate</p>}
            {fileId && <BoardCanvas key={`${fileId}:${page}`} roomCode={roomCode} board={`slide:${fileId}:${page}`} state={state} syncTick={syncTick} onChanged={onChanged} transparent />}
          </div>
        </div>
      )}
    </div>
  );
};
