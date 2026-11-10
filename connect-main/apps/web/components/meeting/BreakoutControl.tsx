'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Users, X } from 'lucide-react';
import { useEscapeKey } from '@/lib/accessibility/useEscapeKey';
import { ApiError } from '@/lib/api/client';
import * as api from '@/features/classroom/api';

const POLL_INTERVAL_MS = 4000;
const MAX_GROUPS = 20;
const inputClass = 'w-full px-3 py-2 rounded-xl border border-[#E5E7EB] bg-[#FAFAF8] text-[16px] sm:text-xs text-[#1C1C1C] min-h-[40px]';
const primaryClass = 'px-3 rounded-lg bg-[#7658E8] text-white text-xs font-semibold min-h-[40px] inline-flex items-center disabled:opacity-60';
const secondaryClass = 'px-3 rounded-lg border border-[#E5E7EB] bg-white text-xs font-semibold text-[#1C1C1C] min-h-[40px] inline-flex items-center gap-1.5 disabled:opacity-50';

interface BreakoutControlProps {
  roomCode: string;
  syncTick: number;
  onChanged: () => void;
  onMainCode: (code: string | null) => void;
}

// Moderators open groups and place people. Everyone else gets one link to where they should be.
export const BreakoutControl: React.FC<BreakoutControlProps> = ({ roomCode, syncTick, onChanged, onMainCode }) => {
  const [state, setState] = useState<api.BreakoutState | null>(null);
  const [open, setOpen] = useState(false);
  useEscapeKey(open, () => setOpen(false));
  const [groups, setGroups] = useState('2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mainCodeRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.getBreakouts(roomCode);
      setState(next);
      mainCodeRef.current = next.isBreakout ? next.mainCode : null;
      onMainCode(mainCodeRef.current);
      if (next.isBreakout && next.ended) window.location.assign(`/room/${next.mainCode}/preview`);
    } catch (err) {
      // Closing a group ends everyone's place in it, which is what brings them back.
      if (mainCodeRef.current && err instanceof ApiError && err.statusCode === 403) {
        window.location.assign(`/room/${mainCodeRef.current}/preview`);
      }
    }
  }, [roomCode, onMainCode]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [syncTick, refresh]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  if (state.isBreakout) {
    return (
      <Link href={`/room/${state.mainCode}/preview`} data-testid="back-to-main" className={`absolute top-2 left-2 z-10 ${secondaryClass}`}>
        Back to main meeting
      </Link>
    );
  }

  const assigned = state.myRoom && (
    <div data-testid="breakout-invite" className="absolute top-14 left-1/2 -translate-x-1/2 z-10 flex flex-wrap items-center gap-2 p-2 rounded-xl bg-white border border-[#7658E8] shadow-sm max-w-[calc(100%-1rem)]">
      <p className="text-xs text-[#1C1C1C]">You are in {state.myRoom.name}</p>
      <Link href={`/room/${state.myRoom.code}/preview`} className={primaryClass}>Join group</Link>
    </div>
  );

  if (!state.canManage) return <>{assigned}</>;

  const isOpen = state.rooms.length > 0;
  const startGroups = () => {
    const count = Math.min(MAX_GROUPS, Math.max(1, Number(groups) || 1));
    return act(() => api.openBreakouts(roomCode, Array.from({ length: count }, (_, i) => `Group ${i + 1}`)));
  };
  const spreadEvenly = () => act(async () => {
    const people = state.people.filter((p) => !p.isGuest && !p.breakoutId);
    for (const [index, person] of people.entries()) {
      await api.assignBreakout(roomCode, person.identity, state.rooms[index % state.rooms.length].id);
    }
  });

  return (
    <>
      {assigned}
      <button type="button" data-testid="open-breakouts" onClick={() => setOpen(true)} className={`absolute top-2 left-2 z-10 ${secondaryClass}`}>
        <Users className="w-3.5 h-3.5" aria-hidden="true" /> Breakouts{isOpen ? ` (${state.rooms.length})` : ''}
      </button>
      {open && (
        <div role="dialog" aria-label="Breakout rooms" className="absolute inset-0 z-30 bg-black/30 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-4 w-full max-w-lg space-y-3 max-h-full overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1C1C1C]">Breakout rooms</h3>
              <button type="button" aria-label="Close breakout rooms" onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6]"><X className="w-4 h-4" /></button>
            </div>
            {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
            {!isOpen ? (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label htmlFor="breakout-count" className="block text-xs font-semibold text-[#1C1C1C] mb-1">Number of groups</label>
                  <input id="breakout-count" type="number" min="1" max={MAX_GROUPS} value={groups} onChange={(e) => setGroups(e.target.value)} className={inputClass} />
                </div>
                <button type="button" disabled={busy} onClick={startGroups} className={primaryClass}>Open groups</button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={spreadEvenly} className={secondaryClass}>Assign the rest evenly</button>
                  <button type="button" disabled={busy} onClick={() => act(() => api.closeBreakouts(roomCode))} className={secondaryClass}>Close all groups</button>
                </div>
                <ul className="flex flex-wrap gap-2 text-xs">
                  {state.rooms.map((group) => (
                    <li key={group.id}>
                      <Link href={`/room/${group.code}/preview`} className="text-[#7658E8] underline inline-flex items-center min-h-[40px]">Visit {group.name}</Link>
                    </li>
                  ))}
                </ul>
                <ul className="divide-y divide-[#E5E7EB]">
                  {state.people.map((person) => (
                    <li key={person.identity} data-testid="breakout-person" className="py-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-[#1C1C1C] break-words min-w-0">{person.displayName}</span>
                      {person.isGuest ? (
                        <span className="text-[11px] text-[#6B7280]">Guests stay in the main meeting</span>
                      ) : (
                        <select
                          aria-label={`Group for ${person.displayName}`}
                          disabled={busy}
                          value={person.breakoutId ?? ''}
                          onChange={(e) => act(() => api.assignBreakout(roomCode, person.identity, e.target.value || null))}
                          className={`${inputClass} !w-auto`}
                        >
                          <option value="">Main meeting</option>
                          {state.rooms.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
