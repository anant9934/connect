'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getRoomToken, requestAdmission } from '@/features/rooms/api';
import { MeetingRoom } from '@/components/meeting/MeetingRoom';
import { WaitingRoom } from '@/components/meeting/WaitingRoom';
import { Loader2, AlertCircle, UserX, Lock } from 'lucide-react';
import { ApiError } from '@/lib/api/client';

export default function MeetingRoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomCode = typeof params.code === 'string' ? params.code : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string>('http://localhost:7880');
  const [isWaitingRoom, setIsWaitingRoom] = useState(false);

  const [roomConfig, setRoomConfig] = useState<{
    videoEnabled: boolean;
    audioEnabled: boolean;
    selectedVideoId?: string;
    selectedAudioId?: string;
    isHost: boolean;
    participantIdentity?: string;
    displayName?: string;
    listenOnly?: boolean;
  } | null>(null);

  const fetchToken = useCallback(
    async (identity?: string, displayName?: string) => {
      try {
        const isGuest = identity?.startsWith('guest:');
        const tokenRes = await getRoomToken(
          roomCode,
          isGuest ? identity : undefined,
          isGuest ? displayName : undefined
        );

        setToken(tokenRes.token);
        if (tokenRes.livekitUrl) {
          setLivekitUrl(tokenRes.livekitUrl);
        }
        setIsWaitingRoom(false);
        setError(null);
        setErrorCode(null);
      } catch (err) {
        if (err instanceof ApiError) {
          setErrorCode(err.code || null);
          if (err.code === 'ADMISSION_REQUIRED') {
            // Automatically submit admission request for waiting room
            if (identity && displayName) {
              try {
                await requestAdmission(roomCode, displayName);
              } catch {
                // If request already exists, ignore
              }
            }
            setIsWaitingRoom(true);
            return;
          } else if (err.code === 'ADMISSION_PENDING') {
            setIsWaitingRoom(true);
            return;
          } else if (err.code === 'ADMISSION_DENIED') {
            setError('The host declined your request to join this meeting.');
          } else if (err.code === 'PARTICIPANT_REMOVED') {
            setError('You have been removed from this meeting by the host.');
          } else if (err.code === 'ROOM_LOCKED') {
            setError('This meeting is currently locked by the host.');
          } else if (err.code === 'ROOM_ENDED') {
            setError('This meeting has ended.');
          } else {
            setError(err.message || 'Unable to join meeting.');
          }
        } else {
          setError('Failed to obtain meeting media grant');
        }
      } finally {
        setLoading(false);
      }
    },
    [roomCode]
  );

  useEffect(() => {
    let isMounted = true;

    async function initMeeting() {
      if (!roomCode) return;

      // 1. Read pre-join setup from session storage
      const stored =
        typeof window !== 'undefined'
          ? sessionStorage.getItem(`tathastu_room_${roomCode}`)
          : null;

      if (!stored) {
        // Enforce pre-join device verification
        router.replace(`/room/${roomCode}/preview`);
        return;
      }

      let parsedConfig;
      try {
        parsedConfig = JSON.parse(stored);
      } catch {
        router.replace(`/room/${roomCode}/preview`);
        return;
      }

      if (!isMounted) return;

      setRoomConfig({
        videoEnabled: parsedConfig.videoEnabled ?? true,
        audioEnabled: parsedConfig.audioEnabled ?? true,
        selectedVideoId: parsedConfig.selectedVideoId,
        selectedAudioId: parsedConfig.selectedAudioId,
        isHost: parsedConfig.isHost ?? false,
        participantIdentity: parsedConfig.participantIdentity,
        displayName: parsedConfig.displayName,
        listenOnly: parsedConfig.listenOnly === true,
      });

      // 2. Request LiveKit token
      await fetchToken(parsedConfig.participantIdentity, parsedConfig.displayName);
    }

    initMeeting();

    return () => {
      isMounted = false;
    };
  }, [roomCode, router, fetchToken]);

  // Waiting Room state for guest participants awaiting host approval
  if (isWaitingRoom && roomConfig?.participantIdentity && roomConfig?.displayName) {
    return (
      <WaitingRoom
        roomCode={roomCode}
        identity={roomConfig.participantIdentity}
        displayName={roomConfig.displayName}
        onAdmitted={() => {
          fetchToken(roomConfig.participantIdentity, roomConfig.displayName);
        }}
      />
    );
  }

  // Error States (Light-first, polite messaging)
  if (error) {
    const isDenied = errorCode === 'ADMISSION_DENIED' || errorCode === 'PARTICIPANT_REMOVED';
    const isLocked = errorCode === 'ROOM_LOCKED';

    return (
      <div className="min-h-screen bg-[#FAFAF8] text-[#1C1C1C] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-[#E5E7EB] p-8 text-center space-y-5 shadow-sm">
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ${
              isDenied
                ? 'bg-[#FFE5DF] text-[#D32F2F]'
                : isLocked
                ? 'bg-[#FFF2BE] text-[#B45309]'
                : 'bg-[#EEE8FF] text-[#7658E8]'
            }`}
          >
            {isDenied ? (
              <UserX className="w-7 h-7" />
            ) : isLocked ? (
              <Lock className="w-7 h-7" />
            ) : (
              <AlertCircle className="w-7 h-7" />
            )}
          </div>

          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-[#1C1C1C]">
              {isDenied ? 'Unable to Join' : isLocked ? 'Meeting Locked' : 'Notice'}
            </h1>
            <p className="text-xs text-[#6B7280] leading-relaxed">{error}</p>
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <Link
              href="/"
              className="w-full py-3 px-4 rounded-2xl bg-[#7658E8] hover:bg-[#6045D8] text-white text-xs font-medium transition-colors text-center shadow-xs"
            >
              Return to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Initial loading state
  if (loading || !token || !roomConfig) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] text-[#1C1C1C] flex flex-col items-center justify-center p-4 space-y-3">
        <Loader2 className="w-8 h-8 text-[#7658E8] animate-spin" />
        <p className="text-xs text-[#6B7280] font-medium">Entering meeting stage...</p>
      </div>
    );
  }

  return (
    <MeetingRoom
      roomCode={roomCode}
      token={token}
      livekitUrl={livekitUrl}
      isHost={roomConfig.isHost}
      initialVideoEnabled={roomConfig.videoEnabled}
      initialAudioEnabled={roomConfig.audioEnabled}
      videoDeviceId={roomConfig.selectedVideoId}
      audioDeviceId={roomConfig.selectedAudioId}
      identity={roomConfig.participantIdentity}
      displayName={roomConfig.displayName}
      initialListenOnly={roomConfig.listenOnly}
    />
  );
}

