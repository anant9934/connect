'use client';

import React, { useState, useEffect } from 'react';
import { MediaTransport, MediaTransportStats } from '@/features/meeting/transport';
import { Activity, ShieldCheck, X } from 'lucide-react';

interface TransportDiagnosticsProps {
  transport: MediaTransport | null;
  className?: string;
  inline?: boolean;
}

export const TransportDiagnostics: React.FC<TransportDiagnosticsProps> = ({
  transport,
  className = '',
  inline = true,
}) => {
  const [stats, setStats] = useState<MediaTransportStats | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!transport) return;

    const interval = setInterval(async () => {
      try {
        const s = await transport.getStats();
        if (s) setStats(s);
      } catch {
        // Non-blocking
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [transport]);

  // Keyboard shortcut to toggle: Shift+D
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!transport) return null;

  const isP2P = transport.type === 'p2p';

  return (
    <div className={`relative ${inline ? 'inline-flex items-center' : 'fixed bottom-20 left-4 z-40'} ${className}`}>
      <button
        id="transport-diagnostics-pill"
        data-testid="transport-diagnostics-pill"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        title="Toggle Developer WebRTC Diagnostics (Shift+D)"
        className="flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full bg-[#FAFAF8] hover:bg-[#F2F2F0] text-[10px] sm:text-[11px] font-medium text-[#1C1C1C]/80 border border-[#E5E5E3] transition-colors shadow-xs active:scale-95"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${isP2P ? 'bg-emerald-500' : 'bg-indigo-500'}`} />
        <span className="hidden sm:inline font-mono">{isP2P ? 'P2P Direct' : 'SFU Cloud'}</span>
        <span className="sm:hidden font-mono">{isP2P ? 'P2P' : 'SFU'}</span>
      </button>

      {isOpen && (
        <div className="fixed top-14 left-3 sm:absolute sm:top-full sm:left-0 sm:mt-2 w-72 rounded-2xl bg-[#1C1C1E]/95 backdrop-blur-xl border border-white/15 p-4 text-white shadow-2xl text-xs space-y-3 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2 font-semibold">
              <Activity className="w-4 h-4 text-[#9E86FF]" />
              <span>Media Telemetry</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              aria-label="Close telemetry diagnostics"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between py-0.5">
              <span className="text-white/60">Transport Engine:</span>
              <span className="font-semibold text-emerald-400">
                {isP2P ? 'Direct WebRTC P2P (1:1)' : 'LiveKit SFU (Cloud)'}
              </span>
            </div>

            {stats && (
              <>
                <div className="flex justify-between py-0.5">
                  <span className="text-white/60">Round Trip Time (RTT):</span>
                  <span className="font-mono text-white/90">{stats.rttMs} ms</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-white/60">Packet Jitter:</span>
                  <span className="font-mono text-white/90">{stats.jitterMs} ms</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-white/60">Packets Lost:</span>
                  <span className="font-mono text-white/90">{stats.packetsLost}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-white/60">Video Resolution:</span>
                  <span className="font-mono text-white/90">
                    {stats.resolution ? `${stats.resolution.width}x${stats.resolution.height}` : 'Inactive / None'}
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-white/60">Frame Rate:</span>
                  <span className="font-mono text-white/90">
                    {stats.frameRate !== null ? `${stats.frameRate} fps` : 'Inactive / None'}
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-white/60">Estimated Bitrate:</span>
                  <span className="font-mono text-white/90">
                    {stats.bitrateKbps} kbps{' '}
                    <span className="text-[9px] text-white/50">
                      (↓{stats.inboundBitrateKbps ?? 0}k, ↑{stats.outboundBitrateKbps ?? 0}k)
                    </span>
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-white/60">ICE Routing:</span>
                  <span className="font-mono text-white/90">
                    {stats.isRelayed ? 'TURN Relay' : `Direct (${stats.candidateType})`}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="pt-1 text-[10px] text-white/40 border-t border-white/10 flex items-center justify-between">
            <span>Press Shift+D to toggle</span>
            <span className="flex items-center gap-1 text-emerald-400/80">
              <ShieldCheck className="w-3 h-3" /> E2E Encrypted
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
