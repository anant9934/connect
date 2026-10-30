'use client';

import React, { useEffect, useRef } from 'react';
import { Participant, TrackPublication } from 'livekit-client';
import { Monitor } from 'lucide-react';
import { TransportParticipant, TransportTrackPublication } from '@/features/meeting/transport';

interface ScreenShareStageProps {
  publication: TrackPublication | TransportTrackPublication | any;
  participant: Participant | TransportParticipant | any;
  isLocal?: boolean;
}

export const ScreenShareStage = React.memo<ScreenShareStageProps>(({
  publication,
  participant,
  isLocal = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const attachedTrackRef = useRef<any>(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const attachCurrentTrack = () => {
      const track = publication?.track;
      if (track !== attachedTrackRef.current) {
        if (attachedTrackRef.current && videoEl) {
          attachedTrackRef.current.detach(videoEl);
        }
        if (track && videoEl) {
          track.attach(videoEl);
          videoEl.play?.().catch(() => {});
        }
        attachedTrackRef.current = track;
      } else if (track && videoEl && !videoEl.srcObject) {
        track.attach(videoEl);
        videoEl.play?.().catch(() => {});
      }
    };

    attachCurrentTrack();

    const onSubscribed = () => attachCurrentTrack();
    const onUnsubscribed = () => attachCurrentTrack();

    if (typeof publication?.on === 'function') {
      publication.on('subscribed', onSubscribed);
      publication.on('unsubscribed', onUnsubscribed);
    }

    const interval = setInterval(attachCurrentTrack, 500);

    return () => {
      clearInterval(interval);
      if (typeof publication?.off === 'function') {
        publication.off('subscribed', onSubscribed);
        publication.off('unsubscribed', onUnsubscribed);
      }
      if (attachedTrackRef.current && videoEl) {
        attachedTrackRef.current.detach(videoEl);
        attachedTrackRef.current = null;
      }
    };
  }, [publication]);


  const sharerName = participant ? (participant.name || participant.identity) : 'Someone';

  return (
    <div
      id="screenshare-stage"
      data-testid="screenshare-stage"
      className="relative w-full h-full rounded-2xl bg-black overflow-hidden flex items-center justify-center border border-[#2D2D2D]"
    >
      <video
        ref={videoRef}
        id="screenshare-video"
        data-testid="screenshare-video"
        autoPlay
        playsInline
        muted={isLocal}
        className="w-full h-full object-contain"
      />

      {/* Screen Sharer Badge */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/75 backdrop-blur-md text-white text-xs border border-white/10 shadow-lg">
        <Monitor className="w-4 h-4 text-[#9E86FF]" />
        <span>{isLocal ? 'You are sharing your screen' : `${sharerName} is sharing`}</span>
      </div>
    </div>
  );
});


