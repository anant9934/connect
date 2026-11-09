'use client';

import React, { useEffect, useState } from 'react';
import { BandwidthMode, MediaTransport } from '@/features/meeting/transport';

const STORAGE_KEY = 'tc-bandwidth-mode';
const CHECK_EVERY_MS = 5000;
const POOR_RTT_MS = 500;
const POOR_READINGS_BEFORE_ADVICE = 3;

const readSaved = (): BandwidthMode => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'low' || saved === 'audio-only' ? saved : 'normal';
  } catch {
    return 'normal';
  }
};

// Lets someone on a weak connection receive less video, and suggests it when the connection stays poor.
// override, when set (listen-only mode), wins over the saved choice until it is cleared.
export const BandwidthControl: React.FC<{ transport: MediaTransport; override?: BandwidthMode | null }> = ({ transport, override = null }) => {
  const [mode, setMode] = useState<BandwidthMode>(() => (typeof window === 'undefined' ? 'normal' : readSaved()));
  const [advice, setAdvice] = useState(false);

  useEffect(() => {
    setMode(readSaved());
  }, [transport]);

  useEffect(() => {
    transport.setBandwidthMode?.(override ?? mode);
  }, [transport, mode, override]);

  useEffect(() => {
    if (mode !== 'normal' || override !== null) {
      setAdvice(false);
      return;
    }
    let poor = 0;
    const timer = setInterval(async () => {
      try {
        const stats = await transport.getStats();
        poor = stats && stats.rttMs > POOR_RTT_MS ? poor + 1 : 0;
        if (poor >= POOR_READINGS_BEFORE_ADVICE) setAdvice(true);
      } catch {
        // Stats are advisory.
      }
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [mode, override, transport]);

  const choose = (next: BandwidthMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // It still applies for this meeting.
    }
  };

  return (
    <>
      <label className="inline-flex items-center gap-1 text-[11px] text-[#666664]">
        <span className="sr-only">Video quality you receive</span>
        <select
          data-testid="bandwidth-mode"
          value={override ?? mode}
          disabled={override !== null}
          title={override !== null ? 'Listen-only mode receives audio only' : undefined}
          onChange={(e) => choose(e.target.value as BandwidthMode)}
          className="bg-[#FAFAF8] border border-[#E5E7EB] rounded-lg px-1.5 min-h-[32px] text-[11px] text-[#1C1C1C] max-w-[8rem]"
        >
          <option value="normal">Best video</option>
          <option value="low">Low bandwidth</option>
          <option value="audio-only">Audio only</option>
        </select>
      </label>
      {advice && (
        <div role="status" data-testid="bandwidth-advice" className="fixed top-14 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center gap-2 p-2 rounded-xl bg-white border border-amber-300 shadow-sm max-w-[calc(100%-1rem)]">
          <p className="text-xs text-[#1C1C1C]">Your connection is weak. Low bandwidth may help.</p>
          <button type="button" onClick={() => choose('low')} className="px-3 rounded-lg bg-[#7658E8] text-white text-xs font-semibold min-h-[36px]">Switch</button>
          <button type="button" onClick={() => setAdvice(false)} className="px-3 rounded-lg border border-[#E5E7EB] text-xs font-semibold text-[#1C1C1C] min-h-[36px]">Dismiss</button>
        </div>
      )}
    </>
  );
};
