'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Room as LiveKitRoom,
  RoomEvent,
  ConnectionState,
  Track,
  TrackPublication,
  Participant,
  LocalParticipant,
} from 'livekit-client';
import { LIVEKIT_ROOM_OPTIONS } from '@/features/meeting/livekit';
import {
  leaveRoom,
  lockRoom,
  unlockRoom,
  endRoom,
  getRoom,
  removeParticipant,
  getMyRole,
  getParticipants,
  grantCoHost,
  revokeCoHost,
  transferHost,
  muteAllParticipants,
  updateRoomPermissions,
  muteParticipant,
  getPendingAdmissions,
  decideAdmission,
} from '@/features/rooms/api';
import { MeetingStage } from './MeetingStage';
import { Loader2, AlertCircle, UserX, Clock, Volume2, X } from 'lucide-react';
import { ChatMessage } from '@/features/chat/types';
import { AdmissionRequest } from '@/features/rooms/types';
import {
  MediaTransportFactory,
  MediaTransport,
  LiveKitTransport,
} from '@/features/meeting/transport';
import { TransportDiagnostics } from './TransportDiagnostics';
import { PermissionHelpSheet } from './PermissionHelpSheet';
import { TargetMediaDevice } from '@/features/meeting/permissions';

interface MeetingRoomProps {
  roomCode: string;
  token: string;
  livekitUrl: string;
  isHost: boolean;
  initialVideoEnabled: boolean;
  initialAudioEnabled: boolean;
  videoDeviceId?: string;
  audioDeviceId?: string;
  identity?: string;
  displayName?: string;
}

export const MeetingRoom: React.FC<MeetingRoomProps> = ({
  roomCode,
  token,
  livekitUrl,
  isHost: initialIsHost,
  initialVideoEnabled,
  initialAudioEnabled,
  videoDeviceId,
  audioDeviceId,
  identity: initialIdentity,
  displayName: initialDisplayName,
}) => {
  const router = useRouter();

  const [roomInstance, setRoomInstance] = useState<LiveKitRoom | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Connecting);
  const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<Participant[]>([]);
  const [screenSharePub, setScreenSharePub] = useState<TrackPublication | null>(null);
  const [screenShareParticipant, setScreenShareParticipant] = useState<Participant | null>(null);

  const [isMicMuted, setIsMicMuted] = useState(!initialAudioEnabled);
  const [isVideoMuted, setIsVideoMuted] = useState(!initialVideoEnabled);
  const isMicMutedRef = useRef(!initialAudioEnabled);
  const isVideoMutedRef = useRef(!initialVideoEnabled);
  isMicMutedRef.current = isMicMuted;
  isVideoMutedRef.current = isVideoMuted;

  const [isMicPending, setIsMicPending] = useState(false);
  const [isVideoPending, setIsVideoPending] = useState(false);
  const [isMicBlocked, setIsMicBlocked] = useState(false);
  const [isVideoBlocked, setIsVideoBlocked] = useState(false);
  const [showHelpSheet, setShowHelpSheet] = useState(false);
  const [helpSheetDevice, setHelpSheetDevice] = useState<TargetMediaDevice>('camera');
  const [canPlaybackAudio, setCanPlaybackAudio] = useState(true);

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isHost, setIsHost] = useState(initialIsHost);
  const [myPermissions, setMyPermissions] = useState<Record<string, boolean>>(
    initialIsHost ? { admit: true, mute: true, remove: true, lock: true, speakers: true } : {}
  );
  const [participantRoles, setParticipantRoles] = useState<Record<string, string>>({});
  const [participantsCanPublish, setParticipantsCanPublish] = useState(true);
  const [coHostPermissions, setCoHostPermissions] = useState<Record<string, boolean>>({});
  const [moderationError, setModerationError] = useState<string | null>(null);

  // Phase 3 & 4 States: Panels, Chat, Reactions, Notes, Files, Host Moderation
  const [activePanel, setActivePanel] = useState<'chat' | 'participants' | 'notes' | 'files' | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<Record<string, string>>({});
  const [isLocalHandRaised, setIsLocalHandRaised] = useState(false);
  const [pendingAdmissions, setPendingAdmissions] = useState<AdmissionRequest[]>([]);
  const [externalNotesRevision, setExternalNotesRevision] = useState<number>(1);
  const [externalFileEvent, setExternalFileEvent] = useState<{ action: string; fileId: string; filename: string } | undefined>(undefined);
  const [captureMode, setCaptureMode] = useState<'detail' | 'motion'>('detail');

  const [meetingEnded, setMeetingEnded] = useState(false);
  const [wasRemoved, setWasRemoved] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const roomRef = useRef<LiveKitRoom | null>(null);
  const transportRef = useRef<MediaTransport | null>(null);
  const [activeTransport, setActiveTransport] = useState<MediaTransport | null>(null);
  const activePanelRef = useRef<'chat' | 'participants' | 'notes' | 'files' | null>(null);
  activePanelRef.current = activePanel;

  // Sync active screen share publication across all participants
  const updateScreenShareState = useCallback((room: LiveKitRoom) => {
    // 1. Check local screen share
    const localScreen = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    if (localScreen && !localScreen.isMuted) {
      setScreenSharePub(localScreen);
      setScreenShareParticipant(room.localParticipant);
      setIsScreenSharing(true);
      return;
    }

    // 2. Check remote screen share
    for (const rp of room.remoteParticipants.values()) {
      const screenPub = rp.getTrackPublication(Track.Source.ScreenShare);
      const track = screenPub ? (screenPub.track || (screenPub as any).videoTrack) : undefined;
      if (screenPub && !screenPub.isMuted && track) {
        setScreenSharePub(screenPub);
        setScreenShareParticipant(rp);
        setIsScreenSharing(false);
        return;
      }
    }

    // No screen share active
    setScreenSharePub(null);
    setScreenShareParticipant(null);
    setIsScreenSharing(false);
  }, []);

  const handleDataPayload = useCallback((payload: Uint8Array, participant?: any, topic?: string) => {
    const sender = participant || {
      identity: 'remote-peer',
      name: 'Participant',
    };

    try {
      const text = new TextDecoder().decode(payload);
      const data = JSON.parse(text);

      if (topic === 'tc-chat') {
        if (typeof data.text === 'string' && data.text.length <= 1000) {
          const newMsg: ChatMessage = {
            id: typeof data.id === 'string' ? data.id : `msg-${Date.now()}`,
            senderIdentity: sender.identity,
            senderName: sender.name || sender.identity,
            text: data.text,
            timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
            isSelf: false,
            status: 'delivered',
          };

          setChatMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });

          if (activePanelRef.current !== 'chat') {
            setUnreadChatCount((c) => c + 1);
          }
        }
      } else if (topic === 'tc-reaction') {
        if (data.type === 'hand_raise') {
          setRaisedHands((prev) => {
            const next = new Set(prev);
            if (data.raised) {
              next.add(participant.identity);
            } else {
              next.delete(participant.identity);
            }
            return next;
          });
        } else if (data.type === 'reaction' && typeof data.emoji === 'string') {
          setReactions((prev) => ({
            ...prev,
            [participant.identity]: data.emoji,
          }));
          setTimeout(() => {
            setReactions((prev) => {
              if (prev[participant.identity] === data.emoji) {
                const next = { ...prev };
                delete next[participant.identity];
                return next;
              }
              return prev;
            });
          }, 3500);
        }
      } else if (topic === 'tc-notes') {
        if (typeof data.revision === 'number') {
          setExternalNotesRevision(data.revision);
        }
      } else if (topic === 'tc-files') {
        if (typeof data.fileId === 'string') {
          setExternalFileEvent({
            action: typeof data.action === 'string' ? data.action : 'uploaded',
            fileId: data.fileId,
            filename: typeof data.filename === 'string' ? data.filename : '',
          });
        }
      }
    } catch {
      // Ignore malformed packets safely
    }
  }, []);

  // Initialize and Connect Media Transport
  useEffect(() => {
    let isCancelled = false;
    const hasBeenConnectedRef = { current: false };

    async function init() {
      try {
        const transport = await MediaTransportFactory.createTransport({
          roomCode,
          forceLiveKit: true,
        });

        if (isCancelled) {
          transport.disconnect();
          return;
        }

        transportRef.current = transport;
        setActiveTransport(transport);

        const bindRoomEvents = (room: LiveKitRoom) => {
          room
            .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
              setConnectionState(state);
            })
            .on(RoomEvent.Connected, () => {
              hasBeenConnectedRef.current = true;
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
              setCanPlaybackAudio(room.canPlaybackAudio);
            })
            .on(RoomEvent.Disconnected, () => {
              if (hasBeenConnectedRef.current) {
                setMeetingEnded(true);
              }
            })
            .on(RoomEvent.Reconnecting, () => {
              setConnectionState(ConnectionState.Reconnecting);
            })
            .on(RoomEvent.Reconnected, () => {
              setConnectionState(ConnectionState.Connected);
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
            })
            .on(RoomEvent.ParticipantConnected, () => {
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
            })
            .on(RoomEvent.ParticipantDisconnected, (participant: Participant) => {
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
              setRaisedHands((prev) => {
                if (!prev.has(participant.identity)) return prev;
                const next = new Set(prev);
                next.delete(participant.identity);
                return next;
              });
              setReactions((prev) => {
                if (!prev[participant.identity]) return prev;
                const next = { ...prev };
                delete next[participant.identity];
                return next;
              });
            })
            .on(RoomEvent.TrackSubscribed, () => {
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
            })
            .on(RoomEvent.TrackUnsubscribed, () => {
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
            })
            .on(RoomEvent.TrackPublished, () => {
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
            })
            .on(RoomEvent.TrackUnpublished, () => {
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
            })
            .on(RoomEvent.LocalTrackPublished, () => {
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
            })
            .on(RoomEvent.LocalTrackUnpublished, () => {
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
            })
            .on(RoomEvent.TrackMuted, () => {
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
            })
            .on(RoomEvent.TrackUnmuted, () => {
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              setLocalParticipant(room.localParticipant);
              updateScreenShareState(room);
            })
            .on(RoomEvent.AudioPlaybackStatusChanged, () => {
              setCanPlaybackAudio(room.canPlaybackAudio);
            })
            .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: Participant, _kind?: any, topic?: string) => {
              handleDataPayload(payload, participant, topic);
            });
        };

        if (transport.type === 'livekit') {
          const room = (transport as LiveKitTransport).getLiveKitRoom();
          roomRef.current = room;
          setRoomInstance(room);

          if (typeof window !== 'undefined' && room) {
            const allowDiagnostics =
              process.env.NODE_ENV !== 'production' ||
              Boolean((window as any).__TC_ENABLE_TEST_DIAGNOSTICS);

            if (allowDiagnostics) {
              (window as any).__livekitRoom = room;
            } else {
              delete (window as any).__livekitRoom;
              delete (window as any).__tcDiagnostics;
            }
          }

          if (room) {
            bindRoomEvents(room);
          }
        }

        transport.on('state_changed', (state: ConnectionState) => {
          setConnectionState(state);
          if (state === ConnectionState.Connected) {
            hasBeenConnectedRef.current = true;
          } else if (state === ConnectionState.Disconnected && hasBeenConnectedRef.current) {
            setMeetingEnded(true);
          }
        });

        transport.on('participants_changed', () => {
          if (transport.type === 'livekit') {
            const room = (transport as LiveKitTransport).getLiveKitRoom();
            if (room) {
              setLocalParticipant(room.localParticipant);
              setRemoteParticipants(Array.from(room.remoteParticipants.values()));
              updateScreenShareState(room);
              setCanPlaybackAudio(room.canPlaybackAudio);
            }
          } else {
            setLocalParticipant(transport.localParticipant as any);
            setRemoteParticipants(transport.remoteParticipants as any[]);
            setScreenSharePub(transport.screenSharePub as any);
            setScreenShareParticipant(transport.screenShareParticipant as any);
            setIsScreenSharing(Boolean(transport.screenSharePub && transport.screenShareParticipant?.isLocal));
          }
        });

        transport.on('data_received', (payload: Uint8Array, participant?: any, topic?: string) => {
          handleDataPayload(payload, participant, topic);
        });

        transport.on('fallback_required', async (reason: string) => {
          console.warn('[MeetingRoom] Coordinated handoff to SFU triggered:', reason);
          if (transportRef.current?.type === 'p2p') {
            const oldP2P = transportRef.current;
            const fallback = new LiveKitTransport();
            const userIdent = initialIdentity || (isHost ? 'user:host' : `guest:${Date.now()}`);
            const userDisp = initialDisplayName || (isHost ? 'Host' : 'Guest');

            const room = fallback.getLiveKitRoom();
            if (room) {
              bindRoomEvents(room);
              roomRef.current = room;
              setRoomInstance(room);
            }

            transportRef.current = fallback;
            setActiveTransport(fallback);

            try {
              await fallback.connect({
                roomCode,
                token,
                livekitUrl,
                identity: userIdent,
                displayName: userDisp,
                isHost,
                initialAudioEnabled: !isMicMutedRef.current,
                initialVideoEnabled: !isVideoMutedRef.current,
                audioDeviceId,
                videoDeviceId,
              });

              if (room) {
                setLocalParticipant(room.localParticipant);
                setRemoteParticipants(Array.from(room.remoteParticipants.values()));
                updateScreenShareState(room);
                setConnectionState(ConnectionState.Connected);
              }

              await oldP2P.disconnect();
            } catch (fallbackErr) {
              console.error('[MeetingRoom] Fallback connect failed:', fallbackErr);
            }
          }
        });

        await transport.connect({
          roomCode,
          token,
          livekitUrl,
          identity: initialIdentity || (isHost ? 'user:host' : `guest:${Date.now()}`),
          displayName: initialDisplayName || (isHost ? 'Host' : 'Guest'),
          isHost,
          initialAudioEnabled: !isMicMutedRef.current,
          initialVideoEnabled: !isVideoMutedRef.current,
          audioDeviceId,
          videoDeviceId,
        });

        if (transport.type === 'livekit') {
          const room = (transport as LiveKitTransport).getLiveKitRoom();
          if (room) {
            hasBeenConnectedRef.current = true;
            setLocalParticipant(room.localParticipant);
            setRemoteParticipants(Array.from(room.remoteParticipants.values()));
            setConnectionState(room.state);
            updateScreenShareState(room);
            setCanPlaybackAudio(room.canPlaybackAudio);
          }
        } else {
          hasBeenConnectedRef.current = true;
          setLocalParticipant(transport.localParticipant as any);
          setRemoteParticipants(transport.remoteParticipants as any[]);
          setConnectionState(ConnectionState.Connected);
        }

        // Fetch backend room state for lock status
        try {
          const roomData = await getRoom(roomCode);
          setIsLocked(roomData.isLocked);
        } catch {
          // Non-blocking
        }
      } catch (err: any) {
        setConnectError(err?.message || 'Failed to connect to media server');
      }
    }

    init();

    // Periodic room check to detect host ending or locking
    const statusInterval = setInterval(async () => {
      try {
        const currentRoom = await getRoom(roomCode);
        setIsLocked(currentRoom.isLocked);
        setParticipantsCanPublish(currentRoom.participantsCanPublish ?? true);
        setCoHostPermissions(currentRoom.coHostPermissions ?? {});
        if (currentRoom.status === 'ended') {
          setMeetingEnded(true);
          transportRef.current?.disconnect();
        }
      } catch (err: any) {
        if (
          err?.status === 410 ||
          err?.code === 'ROOM_ENDED' ||
          err?.message?.includes('ended')
        ) {
          setMeetingEnded(true);
          transportRef.current?.disconnect();
        }
      }
    }, 2000);

    return () => {
      isCancelled = true;
      clearInterval(statusInterval);
      if (typeof window !== 'undefined') {
        delete (window as any).__livekitRoom;
        delete (window as any).__tcDiagnostics;
      }
      if (transportRef.current) {
        transportRef.current.disconnect();
        transportRef.current = null;
      }
      roomRef.current = null;
    };
  }, [
    livekitUrl,
    token,
    roomCode,
    initialAudioEnabled,
    initialVideoEnabled,
    audioDeviceId,
    videoDeviceId,
    updateScreenShareState,
    handleDataPayload,
    isHost,
  ]);

  // Follow role changes made by the host, including transfers and succession
  useEffect(() => {
    let isMounted = true;
    async function syncRoles() {
      try {
        const [me, participants] = await Promise.all([getMyRole(roomCode), getParticipants(roomCode)]);
        if (!isMounted) return;
        setIsHost(me.isHost);
        setMyPermissions(me.permissions || {});
        setParticipantRoles(Object.fromEntries(participants.map((p) => [p.identity, p.identity === me.hostIdentity ? 'host' : p.role])));
      } catch {
        // Keeps the last known roles; the server still enforces every action
      }
    }
    syncRoles();
    const interval = setInterval(syncRoles, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [roomCode]);

  // Periodic poll for pending admissions (anyone allowed to admit)
  useEffect(() => {
    if (!myPermissions.admit) return;

    let isMounted = true;
    async function fetchAdmissions() {
      try {
        const res = await getPendingAdmissions(roomCode);
        if (isMounted) {
          setPendingAdmissions(res.requests || []);
        }
      } catch {
        // Non-blocking
      }
    }

    fetchAdmissions();
    const interval = setInterval(fetchAdmissions, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [myPermissions.admit, roomCode]);

  // Handle Controls Interactions
  const handleToggleMic = async () => {
    const transport = transportRef.current;
    if (!transport || isMicPending) return;
    setIsMicPending(true);
    try {
      const willEnable = isMicMuted;
      await transport.setMicrophoneEnabled(willEnable, audioDeviceId);
      setIsMicMuted(!willEnable);
      setIsMicBlocked(false);
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        setIsMicBlocked(true);
        setHelpSheetDevice('microphone');
        setShowHelpSheet(true);
      }
    } finally {
      setIsMicPending(false);
    }
  };

  const handleToggleVideo = async () => {
    const transport = transportRef.current;
    if (!transport || isVideoPending) return;
    setIsVideoPending(true);
    try {
      const willEnable = isVideoMuted;
      await transport.setCameraEnabled(willEnable, videoDeviceId);
      setIsVideoMuted(!willEnable);
      setIsVideoBlocked(false);
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        setIsVideoBlocked(true);
        setHelpSheetDevice('camera');
        setShowHelpSheet(true);
      }
    } finally {
      setIsVideoPending(false);
    }
  };

  const handleRetryDeviceInRoom = async (device: TargetMediaDevice): Promise<boolean> => {
    const transport = transportRef.current;
    if (!transport) return false;

    let camSuccess = false;
    let micSuccess = false;

    if (device === 'camera' || device === 'both') {
      try {
        await transport.setCameraEnabled(true, videoDeviceId);
        setIsVideoMuted(false);
        setIsVideoBlocked(false);
        camSuccess = true;
      } catch (err: any) {
        setIsVideoBlocked(true);
      }
    }

    if (device === 'microphone' || device === 'both') {
      try {
        await transport.setMicrophoneEnabled(true, audioDeviceId);
        setIsMicMuted(false);
        setIsMicBlocked(false);
        micSuccess = true;
      } catch (err: any) {
        setIsMicBlocked(true);
      }
    }

    if (device === 'camera') return camSuccess;
    if (device === 'microphone') return micSuccess;
    return camSuccess && micSuccess;
  };

  const handleUnlockAudio = async () => {
    const transport = transportRef.current;
    if (transport && typeof (transport as any).startAudio === 'function') {
      try {
        await (transport as any).startAudio();
        setCanPlaybackAudio(true);
      } catch {
        // Non-blocking
      }
    }
  };

  const handleToggleScreenShare = async () => {
    const transport = transportRef.current;
    if (!transport) return;
    try {
      const willShare = !isScreenSharing;
      if (willShare) {
        await transport.startScreenShare({ captureMode });
        setIsScreenSharing(true);
      } else {
        await transport.stopScreenShare();
        setIsScreenSharing(false);
      }
    } catch {
      setIsScreenSharing(false);
    }
  };

  const handleToggleCaptureMode = () => {
    const nextMode = captureMode === 'detail' ? 'motion' : 'detail';
    setCaptureMode(nextMode);
    const room = roomRef.current;
    if (room && isScreenSharing) {
      const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
      if (pub?.track?.mediaStreamTrack && 'contentHint' in pub.track.mediaStreamTrack) {
        pub.track.mediaStreamTrack.contentHint = nextMode;
      }
    }
  };

  const broadcastNotesRevision = (rev: number) => {
    const transport = transportRef.current;
    if (!transport || !localParticipant) return;
    transport.sendData('tc-notes', { revision: rev });
  };

  const broadcastFileUploaded = (fileId: string, filename: string) => {
    const transport = transportRef.current;
    if (!transport || !localParticipant) return;
    transport.sendData('tc-files', { action: 'uploaded', fileId, filename });
  };

  const handleToggleLock = async () => {
    if (!myPermissions.lock) return;
    try {
      if (isLocked) {
        await unlockRoom(roomCode);
        setIsLocked(false);
      } else {
        await lockRoom(roomCode);
        setIsLocked(true);
      }
    } catch {
      // Authorization failure or network
    }
  };

  const handleLeave = async () => {
    const transport = transportRef.current;
    if (transport && localParticipant) {
      await leaveRoom(roomCode, localParticipant.identity);
      await transport.disconnect();
    }
    router.push('/');
  };

  const handleEndMeetingForEveryone = async () => {
    if (!isHost) return;
    try {
      await endRoom(roomCode);
      const transport = transportRef.current;
      if (transport) {
        await transport.disconnect();
      }
      router.push('/');
    } catch {
      // Failed to end
    }
  };

  // Phase 3: Realtime Chat Sending
  const handleSendMessage = async (text: string) => {
    const transport = transportRef.current;
    if (!transport || !localParticipant) return;

    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 1000) return;

    const msgId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newMsg: ChatMessage = {
      id: msgId,
      senderIdentity: localParticipant.identity,
      senderName: localParticipant.name || 'You',
      text: trimmed,
      timestamp: Date.now(),
      isSelf: true,
      status: 'sending',
    };

    setChatMessages((prev) => [...prev, newMsg]);

    try {
      await transport.sendData('tc-chat', {
        id: msgId,
        text: trimmed,
        timestamp: newMsg.timestamp,
      });

      setChatMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, status: 'sent' } : m))
      );
    } catch {
      setChatMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, status: 'error' } : m))
      );
    }
  };

  // Phase 3: Reactions & Hand Raise
  const handleSendReaction = (emoji: string) => {
    const transport = transportRef.current;
    if (!transport || !localParticipant) return;

    setReactions((prev) => ({
      ...prev,
      [localParticipant.identity]: emoji,
    }));

    setTimeout(() => {
      setReactions((prev) => {
        if (prev[localParticipant.identity] === emoji) {
          const next = { ...prev };
          delete next[localParticipant.identity];
          return next;
        }
        return prev;
      });
    }, 3500);

    try {
      transport.sendData('tc-reaction', {
        type: 'reaction',
        emoji,
        timestamp: Date.now(),
      });
    } catch {
      // Non-blocking
    }
  };

  const handleToggleHandRaise = () => {
    const transport = transportRef.current;
    if (!transport || !localParticipant) return;

    const nextState = !isLocalHandRaised;
    setIsLocalHandRaised(nextState);

    setRaisedHands((prev) => {
      const next = new Set(prev);
      if (nextState) next.add(localParticipant.identity);
      else next.delete(localParticipant.identity);
      return next;
    });

    try {
      transport.sendData('tc-reaction', {
        type: 'hand_raise',
        raised: nextState,
        timestamp: Date.now(),
      });
    } catch {
      // Non-blocking
    }
  };

  // Phase 3: Host Moderation Actions
  const handleRemoveParticipant = async (identity: string) => {
    if (!myPermissions.remove) return;
    try {
      await removeParticipant(roomCode, identity);
    } catch {
      // Error handled
    }
  };

  const handleMuteParticipant = async (identity: string) => {
    if (!myPermissions.mute) return;
    try {
      const rp = remoteParticipants.find((p) => p.identity === identity);
      const micPub = rp?.getTrackPublication(Track.Source.Microphone);
      if (micPub?.trackSid) {
        await muteParticipant(roomCode, identity, micPub.trackSid);
      }
    } catch {
      // Error handled
    }
  };

  const runModeration = async (action: () => Promise<void>, failure: string) => {
    setModerationError(null);
    try {
      await action();
    } catch (err: any) {
      setModerationError(err?.message || failure);
    }
  };

  const moderation = {
    permissions: myPermissions,
    roles: participantRoles,
    participantsCanPublish,
    coHostPermissions,
    error: moderationError,
    onGrantCoHost: (identity: string) => runModeration(() => grantCoHost(roomCode, identity), 'Could not make this person a co-host.'),
    onRevokeCoHost: (identity: string) => runModeration(() => revokeCoHost(roomCode, identity), 'Could not revoke co-host.'),
    onTransferHost: (identity: string) => runModeration(() => transferHost(roomCode, identity), 'Could not transfer the host role.'),
    onMuteAll: () => runModeration(() => muteAllParticipants(roomCode), 'Could not mute everyone.'),
    onUpdatePermissions: (coHost: Record<string, boolean>, canPublish: boolean) => {
      setCoHostPermissions(coHost);
      setParticipantsCanPublish(canPublish);
      runModeration(() => updateRoomPermissions(roomCode, coHost, canPublish), 'Could not change meeting permissions.');
    },
  };

  const handleAdmitGuest = async (requestID: string) => {
    if (!myPermissions.admit) return;
    try {
      await decideAdmission(roomCode, requestID, 'admitted');
      setPendingAdmissions((prev) => prev.filter((p) => p.id !== requestID));
    } catch {
      // Error handled
    }
  };

  const handleDenyGuest = async (requestID: string) => {
    if (!myPermissions.admit) return;
    try {
      await decideAdmission(roomCode, requestID, 'denied');
      setPendingAdmissions((prev) => prev.filter((p) => p.id !== requestID));
    } catch {
      // Error handled
    }
  };

  const handleTogglePanel = (panel: 'chat' | 'participants' | 'notes' | 'files') => {
    if (activePanel === panel) {
      setActivePanel(null);
    } else {
      setActivePanel(panel);
      if (panel === 'chat') {
        setUnreadChatCount(0);
      }
    }
  };

  // Audio Unlock on user gesture (Mobile & Desktop Safari/Chrome policy)
  useEffect(() => {
    const handleGlobalClick = () => {
      if (!canPlaybackAudio && transportRef.current) {
        handleUnlockAudio();
      }
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, [canPlaybackAudio]);

  // Meeting Ended Clean State (Light-First)
  if (meetingEnded) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] text-[#1C1C1C] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-[#E5E5E3] p-8 text-center space-y-5 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-[#EEE8FF] text-[#7658E8] flex items-center justify-center mx-auto shadow-xs">
            <Clock className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-[#1C1C1C]">This meeting has ended</h1>
            <p className="text-xs text-[#666664] leading-relaxed">
              The session has concluded or was ended by the host.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-block w-full py-3 px-4 rounded-2xl bg-[#7658E8] hover:bg-[#6045D8] text-white text-xs font-semibold transition-colors shadow-xs"
            >
              Return to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Removed by Host State
  if (wasRemoved) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] text-[#1C1C1C] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-[#E5E5E3] p-8 text-center space-y-5 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-[#FFE5DF] text-[#D32F2F] flex items-center justify-center mx-auto">
            <UserX className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-[#1C1C1C]">Removed from Meeting</h1>
            <p className="text-xs text-[#666664] leading-relaxed">
              You were removed from this meeting session by the host.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-block w-full py-3 px-4 rounded-2xl bg-[#1C1C1C] hover:bg-[#333333] text-white text-xs font-semibold transition-colors"
            >
              Return to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Connection Error State (Light-First)
  if (connectError) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] text-[#1C1C1C] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-[#FFE5DF] p-8 text-center space-y-5 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-[#FFE5DF] text-[#D32F2F] flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-[#1C1C1C]">Connection Issue</h1>
            <p className="text-xs text-[#666664] leading-relaxed">
              Unable to establish connection with the meeting media server.
            </p>
          </div>
          <div className="pt-2 flex flex-col gap-2">
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 px-4 rounded-2xl bg-[#7658E8] hover:bg-[#6045D8] text-white text-xs font-semibold transition-colors shadow-xs"
            >
              Retry Connection
            </button>
            <Link
              href="/"
              className="w-full py-3 px-4 rounded-2xl bg-[#F2F2F0] hover:bg-[#EAEAE8] text-[#1C1C1C] text-xs font-medium transition-colors text-center"
            >
              Return to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Connecting Initial State (Light-First)
  if (connectionState === ConnectionState.Connecting && !localParticipant) {
    return (
      <div className="min-h-screen bg-[#FAFAF8] text-[#1C1C1C] flex flex-col items-center justify-center p-4 space-y-3">
        <Loader2 className="w-8 h-8 text-[#7658E8] animate-spin" />
        <p className="text-xs text-[#666664] font-medium">Connecting to meeting stage...</p>
      </div>
    );
  }

  return (
    <>
      {/* Audio Playback Autoplay Unlock Banner */}
      {!canPlaybackAudio && (
        <div
          onClick={handleUnlockAudio}
          role="button"
          tabIndex={0}
          aria-label="Enable meeting audio playback"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[#7658E8] text-white px-4 py-2 rounded-2xl shadow-lg flex items-center gap-2 cursor-pointer hover:bg-[#6045D8] transition-all text-xs font-semibold animate-bounce"
        >
          <Volume2 className="w-4 h-4 shrink-0" />
          <span>Tap anywhere to enable audio playback</span>
        </div>
      )}

      <MeetingStage
        roomCode={roomCode}
        connectionState={connectionState}
        localParticipant={localParticipant}
        remoteParticipants={remoteParticipants}
        screenSharePub={screenSharePub}
        screenShareParticipant={screenShareParticipant}
        isHost={isHost}
        moderation={moderation}
        isLocked={isLocked}
        isMicMuted={isMicMuted}
        isVideoMuted={isVideoMuted}
        isMicBlocked={isMicBlocked}
        isVideoBlocked={isVideoBlocked}
        onRequestDeviceHelp={(dev) => {
          setHelpSheetDevice(dev);
          setShowHelpSheet(true);
        }}
        transport={activeTransport}
        isScreenSharing={isScreenSharing}
        activePanel={activePanel}
        unreadChatCount={unreadChatCount}
        chatMessages={chatMessages}
        pendingAdmissions={pendingAdmissions}
        raisedHands={raisedHands}
        reactions={reactions}
        isLocalHandRaised={isLocalHandRaised}
        broadcastNotesRevision={broadcastNotesRevision}
        externalNotesRevision={externalNotesRevision}
        broadcastFileUploaded={broadcastFileUploaded}
        externalFileEvent={externalFileEvent}
        captureMode={captureMode}
        onToggleCaptureMode={handleToggleCaptureMode}
        onSendMessage={handleSendMessage}
        onSendReaction={handleSendReaction}
        onToggleHandRaise={handleToggleHandRaise}
        onTogglePanel={handleTogglePanel}
        onClosePanel={() => setActivePanel(null)}
        onToggleMic={handleToggleMic}
        onToggleVideo={handleToggleVideo}
        onToggleScreenShare={handleToggleScreenShare}
        onToggleLock={handleToggleLock}
        onRemoveParticipant={handleRemoveParticipant}
        onMuteParticipant={handleMuteParticipant}
        onAdmitGuest={handleAdmitGuest}
        onDenyGuest={handleDenyGuest}
        onLeave={handleLeave}
        onEndMeetingForEveryone={handleEndMeetingForEveryone}
      />

      {/* Permission Help Sheet (Modal/Bottom Sheet outside the video area) */}
      <PermissionHelpSheet
        isOpen={showHelpSheet}
        onClose={() => setShowHelpSheet(false)}
        targetDevice={helpSheetDevice}
        onRetry={handleRetryDeviceInRoom}
      />
    </>
  );
};

