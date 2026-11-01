'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Video, AlertTriangle, VolumeX } from 'lucide-react';
import { getRoom, joinRoom } from '@/features/rooms/api';
import { getSession } from '@/features/auth/api';
import { Room } from '@/features/rooms/types';
import { User } from '@/features/auth/types';
import {
  getMediaDevices,
  DeviceInfo,
} from '@/features/meeting/media';
import { useMediaPermissions, TargetMediaDevice } from '@/features/meeting/permissions';
import { DevicePreview } from '@/components/meeting/DevicePreview';
import { DeviceSelector } from '@/components/meeting/DeviceSelector';
import { PermissionHelpSheet } from '@/components/meeting/PermissionHelpSheet';
import { ApiError } from '@/lib/api/client';

export default function RoomPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const roomCode = typeof params.code === 'string' ? params.code : '';

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestNameError, setGuestNameError] = useState<string | null>(null);
  const [passcode, setPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);

  // Device and Media States (Default off on first visit until granted or explicitly activated by user)
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [videoDevices, setVideoDevices] = useState<DeviceInfo[]>([]);
  const [audioInputDevices, setAudioInputDevices] = useState<DeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<DeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [selectedAudioId, setSelectedAudioId] = useState('');
  const [selectedOutputId, setSelectedOutputId] = useState('');
  const [hasAudioOutputSupport, setHasAudioOutputSupport] = useState(false);
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);

  // Permission Hook & Help Sheet States
  const mediaPerms = useMediaPermissions();
  const [showHelpSheet, setShowHelpSheet] = useState(false);
  const [helpSheetDevice, setHelpSheetDevice] = useState<TargetMediaDevice>('camera');

  // 1. Initial Room & Session Resolution
  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        const [roomData, sessionUser] = await Promise.all([
          getRoom(roomCode),
          getSession(),
        ]);

        if (!isMounted) return;
        setRoom(roomData);
        setUser(sessionUser);

        if (sessionUser) {
          setGuestName(sessionUser.displayName);
        }
      } catch (err) {
        if (!isMounted) return;
        if (err instanceof ApiError) {
          if (err.statusCode === 410 || err.code === 'ROOM_ENDED') {
            setRoomError('This meeting has ended.');
          } else {
            setRoomError('This meeting is unavailable.');
          }
        } else {
          setRoomError('This meeting is unavailable.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    if (roomCode) {
      init();
    }

    return () => {
      isMounted = false;
    };
  }, [roomCode]);

  // Helper to re-enumerate devices with real labels after permission is acquired
  const refreshDevices = useCallback(async () => {
    const devs = await getMediaDevices();
    setVideoDevices(devs.videoDevices);
    setAudioInputDevices(devs.audioInputDevices);
    setAudioOutputDevices(devs.audioOutputDevices);

    if (devs.videoDevices.length > 0 && !selectedVideoId) {
      setSelectedVideoId(devs.videoDevices[0].deviceId);
    }
    if (devs.audioInputDevices.length > 0 && !selectedAudioId) {
      setSelectedAudioId(devs.audioInputDevices[0].deviceId);
    }
    if (devs.audioOutputDevices.length > 0 && !selectedOutputId) {
      setSelectedOutputId(devs.audioOutputDevices[0].deviceId);
    }

    if (typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype) {
      setHasAudioOutputSupport(true);
    }
  }, [selectedVideoId, selectedAudioId, selectedOutputId]);

  // FIX P0.2: Camera and microphone remain strictly OFF when entering prejoin by default.
  // Previous browser permission state does NOT trigger capture unprompted.
  // Explicit user activation is required unless the user has opted into an explicit auto-preview preference.
  useEffect(() => {
    let isMounted = true;

    async function initPrejoinDevices() {
      let autoPreviewPref = false;
      try {
        if (typeof window !== 'undefined') {
          autoPreviewPref = localStorage.getItem('meet_auto_preview_enabled') === 'true';
        }
      } catch {
        // Fallback to strict default-off
      }

      if (autoPreviewPref && isMounted) {
        if (mediaPerms.cameraState === 'granted' && !mediaPerms.cameraTrack) {
          const camRes = await mediaPerms.requestCamera(selectedVideoId || undefined);
          if (isMounted && camRes.track) {
            setVideoEnabled(true);
            await refreshDevices();
          }
        }
        if (mediaPerms.micState === 'granted' && !mediaPerms.micTrack) {
          const micRes = await mediaPerms.requestMicrophone(selectedAudioId || undefined);
          if (isMounted && micRes.track) {
            setAudioEnabled(true);
            await refreshDevices();
          }
        }
      } else {
        // Populate device lists without activating media capture
        if (isMounted) {
          await refreshDevices();
        }
      }
    }

    initPrejoinDevices();

    return () => {
      isMounted = false;
    };
  }, []);

  // Toggle Video (Camera)
  const handleToggleVideo = async () => {
    if (videoEnabled && mediaPerms.cameraTrack) {
      setVideoEnabled(false);
      mediaPerms.stopCamera();
    } else {
      if (mediaPerms.cameraState === 'denied') {
        setHelpSheetDevice('camera');
        setShowHelpSheet(true);
        return;
      }

      const res = await mediaPerms.requestCamera(selectedVideoId || undefined);
      if (res.track) {
        setVideoEnabled(true);
        await refreshDevices();
      } else {
        setVideoEnabled(false);
        if (res.state === 'denied' || res.state === 'policy-blocked') {
          setHelpSheetDevice('camera');
          setShowHelpSheet(true);
        }
      }
    }
  };

  // Toggle Audio (Microphone)
  const handleToggleAudio = async () => {
    if (audioEnabled && mediaPerms.micTrack) {
      setAudioEnabled(false);
      mediaPerms.stopMicrophone();
    } else {
      if (mediaPerms.micState === 'denied') {
        setHelpSheetDevice('microphone');
        setShowHelpSheet(true);
        return;
      }

      const res = await mediaPerms.requestMicrophone(selectedAudioId || undefined);
      if (res.track) {
        setAudioEnabled(true);
        await refreshDevices();
      } else {
        setAudioEnabled(false);
        if (res.state === 'denied' || res.state === 'policy-blocked') {
          setHelpSheetDevice('microphone');
          setShowHelpSheet(true);
        }
      }
    }
  };

  // Open device help sheet
  const handleRequestHelp = (device: 'camera' | 'microphone') => {
    setHelpSheetDevice(device);
    setShowHelpSheet(true);
  };

  // Retry device after changing browser settings
  const handleRetryDevice = async (device: TargetMediaDevice): Promise<boolean> => {
    let camSuccess = false;
    let micSuccess = false;

    if (device === 'camera' || device === 'both') {
      const res = await mediaPerms.requestCamera(selectedVideoId || undefined);
      if (res.track) {
        setVideoEnabled(true);
        camSuccess = true;
      }
    }

    if (device === 'microphone' || device === 'both') {
      const res = await mediaPerms.requestMicrophone(selectedAudioId || undefined);
      if (res.track) {
        setAudioEnabled(true);
        micSuccess = true;
      }
    }

    await refreshDevices();

    if (device === 'camera') return camSuccess;
    if (device === 'microphone') return micSuccess;
    return camSuccess && micSuccess;
  };

  // Switch camera between front and back
  const handleSwitchCamera = useCallback(async () => {
    if (videoDevices.length <= 1) return;
    const currentIndex = videoDevices.findIndex((d) => d.deviceId === selectedVideoId);
    const nextIndex = (currentIndex + 1) % videoDevices.length;
    const nextDeviceId = videoDevices[nextIndex].deviceId;
    setSelectedVideoId(nextDeviceId);

    if (videoEnabled) {
      await mediaPerms.requestCamera(nextDeviceId);
    }
  }, [videoDevices, selectedVideoId, videoEnabled, mediaPerms]);

  // Join meeting handler
  const handleJoin = async (e?: React.FormEvent, joinMuted = false) => {
    if (e) e.preventDefault();
    setGuestNameError(null);
    setPasscodeError(null);

    const effectiveName = user ? user.displayName : guestName.trim();
    if (!effectiveName || effectiveName.length < 2) {
      setGuestNameError('Please enter a display name with at least 2 characters.');
      return;
    }

    setJoining(true);

    try {
      const finalVideo = joinMuted ? false : videoEnabled;
      const finalAudio = joinMuted ? false : audioEnabled;

      const joinRes = await joinRoom(roomCode, user ? undefined : effectiveName, passcode.trim());

      // Store device choices for room session initialization
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(
          `tathastu_room_${roomCode}`,
          JSON.stringify({
            videoEnabled: finalVideo,
            audioEnabled: finalAudio,
            selectedVideoId,
            selectedAudioId,
            participantIdentity: joinRes.participant.identity,
            displayName: joinRes.participant.displayName,
            isHost: joinRes.isHost,
          })
        );
      }

      // Cleanup local preview stream before entering meeting room
      mediaPerms.stopAll();

      router.push(`/room/${roomCode}`);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'PASSCODE_REQUIRED' || err.code === 'INVALID_PASSCODE')) {
        setPasscodeError(err.message);
        setJoining(false);
        return;
      }
      if (err instanceof ApiError) {
        setRoomError(err.message);
      } else {
        setRoomError('Unable to join meeting. Please try again.');
      }
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen min-h-dvh bg-[#FCFCFA] flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-[#7258E8] animate-spin mb-3" />
        <p className="text-sm text-[#686868]">Checking meeting status...</p>
      </div>
    );
  }

  // Unavailable or Ended Room State
  if (roomError || !room) {
    return (
      <div className="min-h-screen min-h-dvh bg-[#FCFCFA] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-[#E9E9E5] p-6 sm:p-8 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-[#171717]">{roomError || 'This meeting is unavailable.'}</h1>
          <p className="text-xs sm:text-sm text-[#686868]">
            The meeting code may be incorrect, expired, or ended by the host.
          </p>
          <div className="pt-2 flex flex-col gap-2">
            <Link
              href="/"
              className="w-full py-2.5 px-4 rounded-xl bg-[#7258E8] hover:bg-[#6045D8] text-white text-sm font-medium transition-colors text-center shadow-xs"
            >
              Return home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isCameraBlocked = mediaPerms.cameraState === 'denied';
  const isMicBlocked = mediaPerms.micState === 'denied';

  return (
    <div className="min-h-screen min-h-dvh bg-[#FCFCFA] flex flex-col overflow-x-hidden">
      {/* Pre-join Header */}
      <header className="w-full border-b border-[#E9E9E5] bg-white/80 backdrop-blur-md px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between shrink-0">
        <Link href="/" className="flex items-center gap-1.5 text-xs sm:text-sm text-[#686868] hover:text-[#171717] transition-colors">
          <ArrowLeft className="w-4 h-4" />
          <span>Exit</span>
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-mono font-medium text-[#171717] bg-[#F7F7F3] px-2.5 py-1 rounded-md border border-[#E9E9E5]">
            {room.publicCode}
          </span>
        </div>
      </header>

      {/* Main Pre-join Stage */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-3 sm:p-6 md:p-8 flex items-center justify-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-8 items-center">
          {/* Left Column: Device Preview (Clean, no overlays, independent controls) */}
          <div className="lg:col-span-7">
            <DevicePreview
              stream={mediaPerms.mediaStream}
              videoEnabled={videoEnabled && Boolean(mediaPerms.cameraTrack)}
              audioEnabled={audioEnabled && Boolean(mediaPerms.micTrack)}
              cameraBlocked={isCameraBlocked}
              micBlocked={isMicBlocked}
              onToggleVideo={handleToggleVideo}
              onToggleAudio={handleToggleAudio}
              onRequestHelp={handleRequestHelp}
              onSwitchCamera={handleSwitchCamera}
              canSwitchCamera={videoDevices.length > 1}
              displayName={user ? user.displayName : guestName}
            />
          </div>

          {/* Right Column: Identity, Selectors & Join Action */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E9E9E5] p-5 sm:p-6 shadow-sm space-y-5">
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-[#171717]">Ready to join?</h1>
              <p className="text-xs text-[#686868] mt-0.5">Check your display name and devices before entering</p>
            </div>

            <form onSubmit={(e) => handleJoin(e, false)} className="space-y-4">
              {room.hasPasscode && (
                <div>
                  <label htmlFor="meetingPasscode" className="block text-xs font-semibold text-[#171717] mb-1 uppercase tracking-wider">
                    Meeting Passcode
                  </label>
                  <input
                    id="meetingPasscode"
                    type="password"
                    autoComplete="off"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="Not needed if you are the host"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] placeholder-[#888888] focus:outline-none focus:ring-2 focus:ring-[#7258E8] transition-all min-h-[44px]"
                  />
                  {passcodeError && (
                    <p role="alert" className="text-xs text-red-600 mt-1">{passcodeError}</p>
                  )}
                </div>
              )}

              {/* Identity State */}
              {user ? (
                <div className="p-3 rounded-xl bg-[#F7F7F3] border border-[#E9E9E5]">
                  <p className="text-[11px] text-[#888888]">Joining as</p>
                  <p className="text-sm font-semibold text-[#171717] mt-0.5">{user.displayName}</p>
                  <p className="text-xs text-[#686868] truncate">{user.email}</p>
                </div>
              ) : (
                <div>
                  <label htmlFor="guestName" className="block text-xs font-semibold text-[#171717] mb-1 uppercase tracking-wider">
                    Your Name
                  </label>
                  <input
                    id="guestName"
                    type="text"
                    required
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="Enter your name to join"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E9E9E5] bg-[#FCFCFA] text-[16px] sm:text-sm text-[#171717] placeholder-[#888888] focus:outline-none focus:ring-2 focus:ring-[#7258E8] transition-all min-h-[44px]"
                  />
                  {guestNameError && (
                    <p className="text-xs text-red-600 mt-1">{guestNameError}</p>
                  )}
                  <p className="text-[11px] text-[#888888] mt-1">
                    Guests can join without an account.{' '}
                    <Link href={`/sign-in?redirect=/room/${roomCode}/preview`} className="text-[#7258E8] hover:underline">
                      Sign in
                    </Link>
                  </p>
                </div>
              )}

              {/* Hardware Device Pickers Toggle */}
              {videoDevices.length > 0 || audioInputDevices.length > 0 ? (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowDeviceSettings(!showDeviceSettings)}
                    className="text-xs font-medium text-[#7658E8] hover:underline flex items-center gap-1"
                  >
                    <span>{showDeviceSettings ? 'Hide device settings' : 'Change camera or microphone'}</span>
                  </button>

                  {showDeviceSettings && (
                    <div className="mt-3 pt-3 border-t border-[#F2F2F0]">
                      <DeviceSelector
                        videoDevices={videoDevices}
                        audioInputDevices={audioInputDevices}
                        audioOutputDevices={audioOutputDevices}
                        selectedVideoId={selectedVideoId}
                        selectedAudioId={selectedAudioId}
                        selectedOutputId={selectedOutputId}
                        onSelectVideo={setSelectedVideoId}
                        onSelectAudio={setSelectedAudioId}
                        onSelectOutput={setSelectedOutputId}
                        hasAudioOutputSupport={hasAudioOutputSupport}
                      />
                    </div>
                  )}
                </div>
              ) : null}

              {/* Primary Join Action */}
              <div className="space-y-2 pt-1">
                <button
                  id="join-meeting-btn"
                  data-testid="join-meeting-btn"
                  type="submit"
                  disabled={joining}
                  className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-[#7658E8] hover:bg-[#6045D8] active:scale-[0.99] text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                >
                  {joining ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Joining meeting...</span>
                    </>
                  ) : (
                    <>
                      <Video className="w-4 h-4" />
                      <span>Join Meeting</span>
                    </>
                  )}
                </button>

                {/* Secondary Option: Join with camera and mic off */}
                <button
                  id="join-muted-btn"
                  data-testid="join-muted-btn"
                  type="button"
                  onClick={() => handleJoin(undefined, true)}
                  disabled={joining}
                  className="w-full py-2 px-3 rounded-xl text-xs font-medium text-[#666664] hover:text-[#1C1C1C] hover:bg-[#F2F2F0] transition-colors flex items-center justify-center gap-1.5"
                >
                  <VolumeX className="w-3.5 h-3.5" />
                  <span>Join with camera & mic off</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* Permission Help Sheet outside the media preview zone */}
      <PermissionHelpSheet
        isOpen={showHelpSheet}
        onClose={() => setShowHelpSheet(false)}
        targetDevice={helpSheetDevice}
        cameraState={mediaPerms.cameraState}
        micState={mediaPerms.micState}
        onRetry={handleRetryDevice}
      />
    </div>
  );
}
