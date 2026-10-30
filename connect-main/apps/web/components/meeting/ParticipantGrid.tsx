'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Participant, LocalParticipant } from 'livekit-client';
import { Loader2, Users } from 'lucide-react';
import { ParticipantTile } from './ParticipantTile';
import { TransportParticipant } from '@/features/meeting/transport';

interface ParticipantGridProps {
  localParticipant: LocalParticipant | TransportParticipant | any;
  remoteParticipants: (Participant | TransportParticipant | any)[];
  hostIdentity?: string;
  isCompactStrip?: boolean;
  raisedHands?: Set<string>;
  reactions?: Record<string, string>;
  onSelectSpeaker?: (identity: string) => void;
}

interface GridDimensions {
  cols: number;
  rows: number;
  isScrollable: boolean;
}

/**
 * Calculates optimal columns & rows given participant count and container aspect ratio.
 */
function calculateOptimalGrid(count: number, width: number, height: number): GridDimensions {
  if (count <= 1) {
    return { cols: 1, rows: 1, isScrollable: false };
  }

  const isPortrait = height > width;

  if (count === 2) {
    return isPortrait
      ? { cols: 1, rows: 2, isScrollable: false }
      : { cols: 2, rows: 1, isScrollable: false };
  }

  if (count === 3) {
    return isPortrait
      ? { cols: 1, rows: 3, isScrollable: false }
      : { cols: 2, rows: 2, isScrollable: false };
  }

  if (count === 4) {
    return { cols: 2, rows: 2, isScrollable: false };
  }

  if (count <= 6) {
    return isPortrait
      ? { cols: 2, rows: 3, isScrollable: false }
      : { cols: 3, rows: 2, isScrollable: false };
  }

  if (count <= 9) {
    return isPortrait
      ? { cols: 2, rows: Math.ceil(count / 2), isScrollable: false }
      : { cols: 3, rows: 3, isScrollable: false };
  }

  // 10+ participants: Controlled scrollable view
  return {
    cols: isPortrait ? 2 : 4,
    rows: Math.ceil(count / (isPortrait ? 2 : 4)),
    isScrollable: true,
  };
}

export const ParticipantGrid = React.memo<ParticipantGridProps>(({
  localParticipant,
  remoteParticipants,
  hostIdentity,
  isCompactStrip = false,
  raisedHands,
  reactions,
  onSelectSpeaker,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Track container dimensions to adapt layout to actual available pixels
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
        }
      }
    });

    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, []);

  const allParticipants: { participant: Participant; isLocal: boolean }[] = useMemo(() => {
    const list: { participant: Participant; isLocal: boolean }[] = [];
    if (localParticipant) {
      list.push({ participant: localParticipant, isLocal: true });
    }
    const seen = new Set<string>();
    if (localParticipant?.identity) {
      seen.add(localParticipant.identity);
    }
    remoteParticipants.forEach((p) => {
      if (p && p.identity && !seen.has(p.identity)) {
        seen.add(p.identity);
        list.push({ participant: p, isLocal: false });
      }
    });
    return list;
  }, [localParticipant, remoteParticipants]);

  const total = allParticipants.length;

  // Empty state guard — never display a completely blank unexplained stage
  if (total === 0) {
    return (
      <div
        ref={containerRef}
        data-testid="participant-grid-empty"
        className="w-full h-full min-h-[240px] flex-1 flex flex-col items-center justify-center p-6 text-center select-none"
      >
        <div className="w-14 h-14 rounded-2xl bg-[#EEE8FF] text-[#7658E8] flex items-center justify-center mb-3 shadow-xs">
          <Loader2 className="w-7 h-7 animate-spin" />
        </div>
        <h3 className="text-sm font-semibold text-[#1C1C1C]">Connecting meeting stage...</h3>
        <p className="text-xs text-[#666664] max-w-xs mt-1 leading-relaxed">
          Initializing participant stream and media plane.
        </p>
      </div>
    );
  }

  // Compact strip mode — used alongside screen share or speaker view
  if (isCompactStrip) {
    return (
      <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-y-auto p-1 w-full md:w-60 max-h-full shrink-0 scrollbar-thin">
        {allParticipants.map(({ participant, isLocal }) => (
          <div
            key={participant.identity}
            className="w-40 md:w-full aspect-video shrink-0 rounded-2xl overflow-hidden shadow-xs transition-transform duration-200 hover:scale-[1.02]"
          >
            <ParticipantTile
              participant={participant}
              isLocal={isLocal}
              isHost={participant.identity === hostIdentity}
              isHandRaised={raisedHands?.has(participant.identity)}
              reaction={reactions?.[participant.identity] || null}
              onTileClick={onSelectSpeaker ? () => onSelectSpeaker(participant.identity) : undefined}
              isMini
            />
          </div>
        ))}
      </div>
    );
  }

  // Calculate dynamic dimensions
  const { cols, rows, isScrollable } = calculateOptimalGrid(
    total,
    containerSize.width || 390,
    containerSize.height || 600
  );

  const isMini = total >= 7;

  return (
    <div
      ref={containerRef}
      className={`w-full h-full min-h-0 flex-1 p-1.5 sm:p-2.5 ${
        isScrollable ? 'overflow-y-auto scrollbar-thin' : 'overflow-hidden'
      }`}
    >
      <div
        className={`w-full ${isScrollable ? 'min-h-full' : 'h-full'} grid gap-1.5 sm:gap-2.5 transition-all duration-300 ease-out`}
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: isScrollable ? undefined : `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {allParticipants.map(({ participant, isLocal }) => (
          <div
            key={participant.identity}
            className={`relative w-full h-full min-h-0 min-w-0 ${
              isScrollable ? 'aspect-video min-h-[120px]' : ''
            }`}
          >
            <ParticipantTile
              participant={participant}
              isLocal={isLocal}
              isHost={participant.identity === hostIdentity}
              isHandRaised={raisedHands?.has(participant.identity)}
              reaction={reactions?.[participant.identity] || null}
              onTileClick={onSelectSpeaker ? () => onSelectSpeaker(participant.identity) : undefined}
              isMini={isMini}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
