'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Participant, Track, ConnectionQuality } from 'livekit-client';
import { Mic, MicOff, Shield, Hand, WifiOff } from 'lucide-react';

import { TransportParticipant } from '@/features/meeting/transport';

interface ParticipantTileProps {
  participant: Participant | TransportParticipant | any;
  isLocal?: boolean;
  isHost?: boolean;
  isHandRaised?: boolean;
  reaction?: string | null;
  onTileClick?: () => void;
  isMini?: boolean;
}

export const ParticipantTile = React.memo<ParticipantTileProps>(({
  participant,
  isLocal = false,
  isHost = false,
  isHandRaised = false,
  reaction = null,
  onTileClick,
  isMini = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const attachedVideoTrackRef = useRef<any>(null);
  const attachedAudioTrackRef = useRef<any>(null);

  const [hasVideo, setHasVideo] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [connectionQuality, setConnectionQuality] = useState<'excellent' | 'good' | 'poor' | 'unknown'>('unknown');
  const [participantName, setParticipantName] = useState(participant.name || '');

  useEffect(() => {
    const updateTracks = () => {
      // Find camera video publication
      const videoPub = participant.getTrackPublication(Track.Source.Camera);
      const activeVideoTrack = videoPub && !videoPub.isMuted && videoPub.track ? videoPub.track : null;

      if (activeVideoTrack !== attachedVideoTrackRef.current) {
        if (attachedVideoTrackRef.current && videoRef.current) {
          attachedVideoTrackRef.current.detach(videoRef.current);
        }
        if (activeVideoTrack && videoRef.current) {
          activeVideoTrack.attach(videoRef.current);
          videoRef.current.play?.().catch(() => {});
          setHasVideo(true);
        } else {
          setHasVideo(false);
        }
        attachedVideoTrackRef.current = activeVideoTrack;
      } else if (activeVideoTrack && videoRef.current && !videoRef.current.srcObject) {
        activeVideoTrack.attach(videoRef.current);
        videoRef.current.play?.().catch(() => {});
        setHasVideo(true);
      } else if (!activeVideoTrack) {
        setHasVideo(false);
      }

      // Find microphone audio publication
      const audioPub = participant.getTrackPublication(Track.Source.Microphone);
      const isAudioActive = Boolean(audioPub && !audioPub.isMuted);
      setIsMuted(!isAudioActive);

      // Attach audio track for remote participants only
      if (!isLocal) {
        const activeAudioTrack = audioPub && !audioPub.isMuted && audioPub.track ? audioPub.track : null;
        if (activeAudioTrack !== attachedAudioTrackRef.current) {
          if (attachedAudioTrackRef.current && audioRef.current) {
            attachedAudioTrackRef.current.detach(audioRef.current);
          }
          if (activeAudioTrack && audioRef.current) {
            activeAudioTrack.attach(audioRef.current);
            audioRef.current.play?.().catch(() => {});
          }
          attachedAudioTrackRef.current = activeAudioTrack;
        } else if (activeAudioTrack && audioRef.current && !audioRef.current.srcObject) {
          activeAudioTrack.attach(audioRef.current);
          audioRef.current.play?.().catch(() => {});
        }
      }
    };

    updateTracks();

    // Listen to participant track and metadata events
    const onTrackMuted = () => updateTracks();
    const onTrackUnmuted = () => updateTracks();
    const onTrackSubscribed = () => updateTracks();
    const onTrackUnsubscribed = () => updateTracks();
    const onTrackPublished = () => updateTracks();
    const onTrackUnpublished = () => updateTracks();
    const onLocalTrackPublished = () => updateTracks();
    const onLocalTrackUnpublished = () => updateTracks();
    const onIsSpeakingChanged = (speaking: boolean) => setIsSpeaking(speaking);
    const onParticipantNameChanged = () => setParticipantName(participant.name || '');
    const onParticipantMetadataChanged = () => setParticipantName(participant.name || '');

    participant.on('trackMuted', onTrackMuted);
    participant.on('trackUnmuted', onTrackUnmuted);
    participant.on('trackSubscribed', onTrackSubscribed);
    participant.on('trackUnsubscribed', onTrackUnsubscribed);
    participant.on('trackPublished', onTrackPublished);
    participant.on('trackUnpublished', onTrackUnpublished);
    participant.on('localTrackPublished', onLocalTrackPublished);
    participant.on('localTrackUnpublished', onLocalTrackUnpublished);
    participant.on('isSpeakingChanged', onIsSpeakingChanged);
    participant.on('participantNameChanged' as any, onParticipantNameChanged);
    participant.on('participantMetadataChanged' as any, onParticipantMetadataChanged);

    // Connection quality monitoring
    const onConnectionQualityChanged = () => {
      const quality = participant.connectionQuality;
      if (quality === ConnectionQuality.Excellent) setConnectionQuality('excellent');
      else if (quality === ConnectionQuality.Good) setConnectionQuality('good');
      else if (quality === ConnectionQuality.Poor) setConnectionQuality('poor');
      else setConnectionQuality('unknown');
    };

    participant.on('connectionQualityChanged', onConnectionQualityChanged);
    onConnectionQualityChanged();

    return () => {
      participant.off('trackMuted', onTrackMuted);
      participant.off('trackUnmuted', onTrackUnmuted);
      participant.off('trackSubscribed', onTrackSubscribed);
      participant.off('trackUnsubscribed', onTrackUnsubscribed);
      participant.off('trackPublished', onTrackPublished);
      participant.off('trackUnpublished', onTrackUnpublished);
      participant.off('localTrackPublished', onLocalTrackPublished);
      participant.off('localTrackUnpublished', onLocalTrackUnpublished);
      participant.off('isSpeakingChanged', onIsSpeakingChanged);
      participant.off('participantNameChanged' as any, onParticipantNameChanged);
      participant.off('participantMetadataChanged' as any, onParticipantMetadataChanged);
      participant.off('connectionQualityChanged', onConnectionQualityChanged);

      if (attachedVideoTrackRef.current && videoRef.current) {
        attachedVideoTrackRef.current.detach(videoRef.current);
        attachedVideoTrackRef.current = null;
      }
      if (attachedAudioTrackRef.current && audioRef.current) {
        attachedAudioTrackRef.current.detach(audioRef.current);
        attachedAudioTrackRef.current = null;
      }
    };
  }, [participant, isLocal]);

  // Clean fallback display name (never expose raw guest:UUID)
  const resolvedName = React.useMemo(() => {
    const raw = participantName || participant.name;
    if (raw && raw.trim() !== '') {
      return raw.trim();
    }
    if (participant.identity?.startsWith('guest:')) {
      return isLocal ? 'You' : 'Guest';
    }
    if (participant.identity?.startsWith('user:')) {
      return isLocal ? 'You' : 'Participant';
    }
    return participant.identity || 'Participant';
  }, [participantName, participant.name, participant.identity, isLocal]);

  // Compute clean initials for avatar
  const initials = React.useMemo(() => {
    const parts = resolvedName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [resolvedName]);

  // Speaking ring animation
  const speakingRingClass = isSpeaking
    ? 'ring-2 ring-[#7658E8] ring-offset-1 ring-offset-[#FAFAF8] shadow-[0_0_16px_rgba(118,88,232,0.35)]'
    : '';

  return (
    <div
      data-testid="participant-tile"
      data-participant-name={resolvedName}
      data-is-local={String(isLocal)}
      data-participant-identity={participant.identity}
      onClick={onTileClick}
      className={`
        group relative w-full h-full rounded-2xl overflow-hidden bg-[#1E1E1E]
        flex items-center justify-center border
        transition-all duration-300 ease-out select-none
        ${onTileClick ? 'cursor-pointer hover:ring-2 hover:ring-[#7658E8]/30' : ''}
        ${isSpeaking
          ? 'border-[#7658E8] ' + speakingRingClass
          : 'border-[#2E2E2E] hover:border-[#3E3E3E]'
        }
      `}
    >
      {/* Video Stream Element */}
      <video
        ref={videoRef}
        data-testid="participant-video"
        autoPlay
        playsInline
        muted={isLocal} // Always mute local video playback to avoid feedback
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          hasVideo ? 'opacity-100' : 'opacity-0 absolute'
        } ${isLocal ? '-scale-x-100' : ''}`}
      />

      {/* Remote Audio Element */}
      {!isLocal && <audio ref={audioRef} autoPlay />}

      {/* Video Off Fallback Avatar */}
      {!hasVideo && (
        <div className="flex flex-col items-center justify-center p-3 animate-in fade-in duration-300">
          <div
            className={`${
              isMini ? 'w-10 h-10 text-xs' : 'w-16 h-16 sm:w-20 sm:h-20 text-lg sm:text-2xl'
            } rounded-full bg-gradient-to-br from-[#2A2A2A] to-[#3A3A3A] text-white flex items-center justify-center font-bold border border-[#4E4E4E] select-none shadow-inner`}
          >
            {initials}
          </div>
        </div>
      )}

      {/* Speaking Pulse Indicator */}
      {isSpeaking && (
        <div className="absolute top-2 left-2 z-10 pointer-events-none">
          <div className="relative flex items-center justify-center">
            <span className="absolute w-3 h-3 rounded-full bg-[#7658E8] opacity-50 animate-ping" />
            <span className="relative w-2 h-2 rounded-full bg-[#7658E8]" />
          </div>
        </div>
      )}

      {/* Hand Raised Badge */}
      {isHandRaised && (
        <div
          className={`absolute top-2 ${
            isSpeaking ? 'left-7' : 'left-2'
          } z-10 flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#FFF2BE] text-[#9A6700] text-[10px] sm:text-xs font-semibold shadow-md pointer-events-none`}
        >
          <Hand className="w-3 h-3 text-[#B45309]" />
          {!isMini && <span>Hand</span>}
        </div>
      )}

      {/* Reaction Bubble */}
      {reaction && (
        <div
          className={`absolute top-2 right-2 z-10 ${
            isMini ? 'w-6 h-6 text-xs' : 'w-8 h-8 text-lg'
          } rounded-full bg-white/95 backdrop-blur-sm shadow-md flex items-center justify-center animate-in zoom-in-75 duration-200 pointer-events-none`}
        >
          {reaction}
        </div>
      )}

      {/* Poor Connection Quality Badge */}
      {connectionQuality === 'poor' && (
        <div className="absolute top-2 right-2 z-10 p-1 rounded-lg bg-red-900/80 backdrop-blur-sm pointer-events-none">
          <WifiOff className="w-3 h-3 text-red-300" />
        </div>
      )}

      {/* Bottom Bar: Stable Name Pill + Mic Status (Never Overlapping) */}
      <div
        className={`absolute ${
          isMini ? 'bottom-1.5 left-1.5 right-1.5' : 'bottom-2 left-2 right-2'
        } flex items-center justify-between gap-1.5 pointer-events-none z-10`}
      >
        {/* Name Badge: flex-1 with min-w-0 for clean truncation */}
        <div
          data-testid="participant-name-badge"
          className={`flex-1 min-w-0 flex items-center gap-1.5 ${
            isMini ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
          } rounded-lg bg-black/75 backdrop-blur-md text-white font-medium shadow-xs border border-white/10`}
        >
          {isHost && (
            <Shield className={`${isMini ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-[#EEE8FF] shrink-0`} />
          )}
          <span className="truncate">
            {resolvedName}
            {isLocal && <span className="opacity-75 font-normal ml-1">(You)</span>}
          </span>
        </div>

        {/* Microphone Status Indicator: shrink-0 so it's never squished or overlapped */}
        <div
          className={`${
            isMini ? 'p-1' : 'p-1.5'
          } rounded-lg backdrop-blur-md text-white shrink-0 shadow-xs border border-white/10 transition-colors duration-200 ${
            isMuted ? 'bg-[#D32F2F]/90 text-white' : 'bg-black/75 text-emerald-400'
          }`}
          title={isMuted ? 'Muted' : 'Microphone active'}
        >
          {isMuted ? (
            <MicOff className={`${isMini ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-white`} />
          ) : (
            <Mic className={`${isMini ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-emerald-400`} />
          )}
        </div>
      </div>

      {/* Hover overlay for clickable tiles */}
      {onTileClick && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200 pointer-events-none rounded-2xl" />
      )}
    </div>
  );
});
