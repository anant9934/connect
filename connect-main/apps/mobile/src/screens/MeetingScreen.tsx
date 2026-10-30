import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
  BackHandler,
  TextInput,
  ScrollView,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';

const RNShare = (require('react-native') as any).Share;
import {
  Room,
  RoomEvent,
  Track,
  VideoTrack as LKVideoTrack,
  RemoteParticipant,
  Participant,
  LocalTrackPublication,
  RemoteTrackPublication,
  TrackPublication,
  RemoteTrack,
  VideoPresets,
} from 'livekit-client';
import { VideoView, AudioSession } from '@livekit/react-native';
import { defaultApiClient } from '../services/apiClient';
import {
  checkCameraPermission,
  requestCameraPermission,
  checkMicrophonePermission,
  requestMicrophonePermission,
} from '../permissions/androidPermissions';
import { mediaDiagnostics, DiagnosticEvent } from '../services/mediaDiagnostics';
import { useWindowDimensions } from '../hooks/useWindowDimensions';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  RefreshCw,
  Volume2,
  VolumeX,
  MessageSquare,
  Users,
  Smile,
  Hand,
  Monitor,
  PhoneOff,
  Share2,
  X,
  Lock,
  Unlock,
  Activity,
  MoreHorizontal,
  UserPlus,
} from '../design-system/icons';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';
import { secureStorage } from '../services/storage';

// Realtime topic constants (matching web exactly)
export const TC_TOPIC_CHAT = 'tc-chat';
export const TC_TOPIC_REACTION = 'tc-reaction';

interface MeetingScreenProps {
  roomCode: string;
  token: string;
  livekitUrl: string;
  displayName: string;
  initialMic?: boolean;
  initialCamera?: boolean;
  cameraFacing?: 'front' | 'back';
  onLeave: () => void;
}

interface ChatMessage {
  id: string;
  sender: string;
  senderIdentity?: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
  status: 'sending' | 'sent' | 'error';
}

const REACTION_EMOJIS = ['👏', '❤️', '🎉', '👍', '💡', '🔥'];

export function MeetingScreen({
  roomCode,
  token,
  livekitUrl,
  displayName,
  initialMic = true,
  initialCamera = true,
  cameraFacing = 'front',
  onLeave,
}: MeetingScreenProps) {
  // Connection and Room State
  const roomRef = useRef<Room | null>(null);
  const [connectionState, setConnectionState] = useState<
    'connecting' | 'connected' | 'reconnecting' | 'error' | 'disconnected'
  >('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [isRoomLocked, setIsRoomLocked] = useState(false);

  // Local Media State
  const [micMuted, setMicMuted] = useState(!initialMic);
  const [cameraOff, setCameraOff] = useState(!initialCamera);
  const [facing, setFacing] = useState<'front' | 'back'>(cameraFacing);
  const [localVideoTrack, setLocalVideoTrack] = useState<LKVideoTrack | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // Remote Media State
  const [remoteTracks, setRemoteTracks] = useState<
    Map<
      string,
      {
        participant: RemoteParticipant;
        videoTrack?: LKVideoTrack;
        isCameraMuted: boolean;
        isSubscribing: boolean;
        isMicMuted: boolean;
        hasSubscriptionError: boolean;
      }
    >
  >(new Map());
  const failedSubsRef = useRef<Set<string>>(new Set());
  const [screenShareTrack, setScreenShareTrack] = useState<{
    participant: RemoteParticipant | Participant;
    track: LKVideoTrack;
  } | null>(null);
  const [participantsCount, setParticipantsCount] = useState(1);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);

  // Reactions & Hand Raise State
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [transientReactions, setTransientReactions] = useState<
    { id: string; emoji: string; sender: string }[]
  >([]);
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  // Audio Routing State
  const [audioRoute, setAudioRoute] = useState<'speaker' | 'earpiece'>('speaker');

  // UI Panels
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<any>(null);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [remoteParticipantsList, setRemoteParticipantsList] = useState<RemoteParticipant[]>([]);
  const [diagnosticEvents, setDiagnosticEvents] = useState<DiagnosticEvent[]>([]);
  const chatScrollRef = useRef<any>(null);

  // Immersive Calling & Controls State
  const [localUser, setLocalUser] = useState<any>(null);
  const [focusedParticipantId, setFocusedParticipantId] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Two-Tap PiP State: first tap = preview/focus; second tap = swap
  const [pipFocusState, setPipFocusState] = useState<'normal' | 'focused'>('normal');
  const pipFocusTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load local user profile on mount to preserve avatar selections
  useEffect(() => {
    secureStorage.getSession().then(({ user }) => {
      if (user) setLocalUser(user);
    });
  }, []);

  const resetControlsTimer = () => {
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }
    // Auto-hide controls after 5 seconds of inactivity if no overlay is open
    if (!showChat && !showParticipants && !showMoreActions && !showReactionPicker) {
      controlsTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 5000);
    }
  };

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [showChat, showParticipants, showMoreActions, showReactionPicker, controlsVisible]);

  const toggleControls = () => {
    // If PiP is currently focused, tap dismisses the focus
    if (pipFocusState === 'focused') {
      if (pipFocusTimerRef.current) clearTimeout(pipFocusTimerRef.current);
      setPipFocusState('normal');
    }
    setControlsVisible((prev) => {
      const next = !prev;
      if (next) resetControlsTimer();
      return next;
    });
  };

  const handleToggleFocus = () => {
    resetControlsTimer();
    if (pipFocusState === 'normal') {
      // First tap: Enlarge slightly / focused preview emphasis state
      setPipFocusState('focused');
      if (pipFocusTimerRef.current) clearTimeout(pipFocusTimerRef.current);
      pipFocusTimerRef.current = setTimeout(() => {
        setPipFocusState('normal');
      }, 4000);
    } else {
      // Second tap on the same focused PiP: Perform stage swap!
      if (pipFocusTimerRef.current) clearTimeout(pipFocusTimerRef.current);
      setPipFocusState('normal');
      setFocusedParticipantId((prev) => (prev === 'local' ? null : 'local'));
    }
  };

  // Compatibility aliases for stage tap & PiP interactions across view modes
  const handleStageTap = toggleControls;
  const handlePipPress = handleToggleFocus;

  // Responsive Layout Engine
  const {
    width,
    height,
    isTablet,
    isCompact,
    isStandard,
    isWide,
    isLandscape,
    isShortHeight,
    safeInsets,
  } = useWindowDimensions();

  // Compute actual usable width for toolbar after accounting for safe-area insets
  const availableToolbarWidth = width - ((safeInsets?.left || 0) + (safeInsets?.right || 0));
  const isCompactToolbar = availableToolbarWidth < 520;
  const isVeryNarrow = availableToolbarWidth < 360;

  // Responsive PiP dimensions with two-tap preview enlargement
  const pipWidth = isTablet ? 110 : (isLandscape ? 78 : (isCompact ? 84 : 96));
  const pipHeight = isTablet ? 155 : (isLandscape ? 108 : (isCompact ? 118 : 136));
  const isPipFocused = pipFocusState === 'focused';
  const effectivePipWidth = isPipFocused ? Math.round(pipWidth * 1.25) : pipWidth;
  const effectivePipHeight = isPipFocused ? Math.round(pipHeight * 1.25) : pipHeight;

  // Hardware Back Handler for Android: Dismisses open overlays before prompting leave
  useEffect(() => {
    const onBackPress = () => {
      if (pipFocusState === 'focused') {
        if (pipFocusTimerRef.current) clearTimeout(pipFocusTimerRef.current);
        setPipFocusState('normal');
        return true;
      }
      if (showChat) {
        setShowChat(false);
        return true;
      }
      if (showParticipants) {
        setShowParticipants(false);
        return true;
      }
      if (showMoreActions) {
        setShowMoreActions(false);
        return true;
      }
      if (showReactionPicker) {
        setShowReactionPicker(false);
        return true;
      }
      confirmLeave();
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [isHost, showChat, showParticipants, showMoreActions, showReactionPicker, pipFocusState]);

  const confirmLeave = () => {
    if (isHost) {
      Alert.alert(
        'Host Actions',
        'You are the host. Would you like to leave or end the meeting for all participants?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Leave Only', onPress: handleLeave },
          { text: 'End for All', style: 'destructive', onPress: handleEndForAll },
        ]
      );
    } else {
      Alert.alert(
        'Leave Meeting?',
        'Are you sure you want to exit the current meeting room?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: handleLeave },
        ]
      );
    }
  };

  // Initialize Audio Session & Connect to LiveKit Room
  useEffect(() => {
    let isMounted = true;

    async function initRoom() {
      try {
        setConnectionState('connecting');
        mediaDiagnostics.log('room', 'ConnectingInitiated', {
          details: { roomCode, livekitUrl },
        });

        // 1. Verify and request Android runtime permissions before starting media
        const hasCam = await checkCameraPermission();
        if (!hasCam) {
          const camGranted = await requestCameraPermission();
          mediaDiagnostics.log('permission', 'CameraPermissionCheck', {
            details: { granted: camGranted },
          });
        }
        const hasMic = await checkMicrophonePermission();
        if (!hasMic) {
          const micGranted = await requestMicrophonePermission();
          mediaDiagnostics.log('permission', 'MicPermissionCheck', {
            details: { granted: micGranted },
          });
        }

        // 2. Configure and start Native Audio Session
        try {
          await AudioSession.startAudioSession();
          await AudioSession.selectAudioOutput('speaker');
          mediaDiagnostics.log('audio', 'AudioSessionStarted', {
            details: { route: 'speaker' },
          });
        } catch (audioErr: any) {
          mediaDiagnostics.log('audio', 'AudioSessionSetupWarning', {
            error: audioErr?.message || String(audioErr),
          });
        }

        // 3. Instantiate LiveKit Room with responsive defaults
        // On mobile, set adaptiveStream: false so subscribed remote video frames stream down immediately without ViewPortDetector bugs
        const room = new Room({
          adaptiveStream: false,
          dynacast: false,
          videoCaptureDefaults: {
            resolution: VideoPresets.h720.resolution,
          },
          publishDefaults: {
            videoCodec: 'vp8',
            videoEncoding: VideoPresets.h720.encoding,
            simulcast: true,
            videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
          },
        });
        roomRef.current = room;

        const updateParticipants = () => {
          if (!isMounted || !room) return;
          const remotes = Array.from(room.remoteParticipants.values());
          setRemoteParticipantsList(remotes);
          setParticipantsCount(remotes.length + 1);

          // Update tracks map
          const newMap = new Map<
            string,
            {
              participant: RemoteParticipant;
              videoTrack?: LKVideoTrack;
              isCameraMuted: boolean;
              isSubscribing: boolean;
              isMicMuted: boolean;
              hasSubscriptionError: boolean;
            }
          >();
          let activeScreen: { participant: RemoteParticipant | Participant; track: LKVideoTrack } | null = null;

          // Check if local screen share is active (resolve either videoTrack or track)
          const localScreenPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
          if (localScreenPub && !localScreenPub.isMuted) {
            const trk = (localScreenPub.videoTrack || localScreenPub.track) as LKVideoTrack | undefined;
            if (trk) {
              activeScreen = {
                participant: room.localParticipant,
                track: trk,
              };
            }
          }

          remotes.forEach((p) => {
            let userVideo: LKVideoTrack | undefined;
            const cameraPub = p.getTrackPublication(Track.Source.Camera);
            const hasCameraPub = !!cameraPub;
            let isCamMuted = cameraPub ? cameraPub.isMuted : true;
            let isMicrophoneMuted = true;
            let hasSubErr = false;

            // Direct check for remote ScreenShare publication
            const directScreenPub = p.getTrackPublication(Track.Source.ScreenShare);
            if (directScreenPub && !directScreenPub.isMuted) {
              const trk = (directScreenPub.videoTrack || directScreenPub.track) as LKVideoTrack | undefined;
              if (trk) {
                activeScreen = { participant: p, track: trk };
              }
            }

            p.videoTrackPublications.forEach((pub) => {
              if (pub.source === Track.Source.ScreenShare) {
                if (!pub.isMuted) {
                  const trk = (pub.videoTrack || pub.track) as LKVideoTrack | undefined;
                  if (trk) {
                    activeScreen = { participant: p, track: trk };
                  }
                }
              } else if (pub.source === Track.Source.Camera) {
                isCamMuted = pub.isMuted;
                if (pub.videoTrack) {
                  userVideo = pub.videoTrack as LKVideoTrack;
                } else if (pub.track) {
                  userVideo = pub.track as LKVideoTrack;
                }
                if (failedSubsRef.current.has(pub.trackSid)) {
                  hasSubErr = true;
                }
              }
            });

            p.audioTrackPublications.forEach((pub) => {
              if (pub.source === Track.Source.Microphone) {
                isMicrophoneMuted = pub.isMuted;
              }
            });

            const isSubscribing = hasCameraPub && !isCamMuted && !userVideo && !hasSubErr;

            newMap.set(p.identity, {
              participant: p,
              videoTrack: userVideo,
              isCameraMuted: isCamMuted,
              isSubscribing,
              isMicMuted: isMicrophoneMuted,
              hasSubscriptionError: hasSubErr,
            });
          });

          setRemoteTracks(newMap);
          setScreenShareTrack(activeScreen);
        };

        // 4. Register Comprehensive Room Event Listeners
        room
          .on(RoomEvent.Connected, async () => {
            if (!isMounted) return;
            setConnectionState('connected');
            mediaDiagnostics.log('room', 'Connected', {
              details: {
                roomName: room.name,
                participantIdentity: room.localParticipant.identity,
                remoteCount: room.remoteParticipants.size,
              },
            });

            const localPart = room.localParticipant;
            const hostCheck =
              localPart.permissions?.canPublishData && localPart.permissions?.canUpdateMetadata;
            setIsHost(!!hostCheck);

            // Publish Initial Camera with Retry Loop (Handles native Camera2 release delay)
            if (initialCamera) {
              let published = false;
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  mediaDiagnostics.log('media', 'AndroidCameraPublishAttempt', { attempt });
                  await localPart.setCameraEnabled(true, {
                    facingMode: facing === 'front' ? 'user' : 'environment',
                  });
                  const camPub = localPart.getTrackPublication(Track.Source.Camera);
                  if (camPub?.videoTrack && isMounted) {
                    setLocalVideoTrack(camPub.videoTrack as LKVideoTrack);
                    setCameraOff(false);
                    published = true;
                    mediaDiagnostics.log('track', 'LocalTrackPublished', {
                      trackSid: camPub.trackSid,
                      source: 'Camera',
                      kind: 'video',
                    });
                    break;
                  }
                } catch (camErr: any) {
                  mediaDiagnostics.log('media', 'AndroidCameraPublishRetry', {
                    attempt,
                    error: camErr?.message || String(camErr),
                  });
                  if (attempt < 3) {
                    await new Promise((r) => setTimeout(r, 400));
                  }
                }
              }
              if (!published && isMounted) {
                console.warn('Could not publish initial camera after 3 attempts');
                setCameraOff(true);
              }
            } else {
              await localPart.setCameraEnabled(false).catch(() => {});
              setCameraOff(true);
            }

            // Publish Initial Microphone
            if (initialMic) {
              try {
                await localPart.setMicrophoneEnabled(true);
                setMicMuted(false);
                const micPub = localPart.getTrackPublication(Track.Source.Microphone);
                mediaDiagnostics.log('track', 'LocalTrackPublished', {
                  trackSid: micPub?.trackSid,
                  source: 'Microphone',
                  kind: 'audio',
                });
              } catch (micErr: any) {
                console.warn('Failed to publish initial mic:', micErr);
                setMicMuted(true);
                mediaDiagnostics.log('media', 'AndroidMicPublishError', {
                  error: micErr?.message || String(micErr),
                });
              }
            } else {
              await localPart.setMicrophoneEnabled(false).catch(() => {});
              setMicMuted(true);
            }

            updateParticipants();
          })
          .on(RoomEvent.Reconnecting, () => {
            mediaDiagnostics.log('room', 'Reconnecting');
            if (isMounted) setConnectionState('reconnecting');
          })
          .on(RoomEvent.Reconnected, () => {
            mediaDiagnostics.log('room', 'Reconnected');
            if (isMounted) {
              setConnectionState('connected');
              updateParticipants();
            }
          })
          .on(RoomEvent.Disconnected, () => {
            mediaDiagnostics.log('room', 'Disconnected');
            if (isMounted) {
              setConnectionState('disconnected');
              onLeave();
            }
          })
          .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
            mediaDiagnostics.log('room', 'ParticipantConnected', {
              participantIdentity: p.identity,
              details: { name: p.name },
            });
            updateParticipants();
          })
          .on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
            mediaDiagnostics.log('room', 'ParticipantDisconnected', {
              participantIdentity: participant.identity,
            });
            updateParticipants();
            setRaisedHands((prev) => {
              if (!prev.has(participant.identity)) return prev;
              const next = new Set(prev);
              next.delete(participant.identity);
              return next;
            });
          })
          .on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
            mediaDiagnostics.log('track', 'TrackPublished', {
              participantIdentity: p.identity,
              trackSid: pub.trackSid,
              source: pub.source,
              kind: pub.kind,
            });
            updateParticipants();
          })
          .on(RoomEvent.TrackUnpublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
            mediaDiagnostics.log('track', 'TrackUnpublished', {
              participantIdentity: p.identity,
              trackSid: pub.trackSid,
              source: pub.source,
            });
            updateParticipants();
          })
          .on(
            RoomEvent.TrackSubscribed,
            (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
              mediaDiagnostics.log('track', 'TrackSubscribed', {
                participantIdentity: participant.identity,
                trackSid: pub.trackSid,
                source: pub.source,
                kind: track.kind,
                isSubscribed: true,
              });
              failedSubsRef.current.delete(pub.trackSid);
              updateParticipants();
            }
          )
          .on(
            RoomEvent.TrackUnsubscribed,
            (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
              mediaDiagnostics.log('track', 'TrackUnsubscribed', {
                participantIdentity: participant.identity,
                trackSid: pub.trackSid,
                source: pub.source,
                kind: track.kind,
                isSubscribed: false,
              });
              updateParticipants();
            }
          )
          .on(
            RoomEvent.TrackSubscriptionFailed,
            (trackSid: string, participant: RemoteParticipant, error?: any) => {
              failedSubsRef.current.add(trackSid);
              mediaDiagnostics.log('track', 'TrackSubscriptionFailed', {
                participantIdentity: participant.identity,
                trackSid,
                error: String(error),
              });
              updateParticipants();
            }
          )
          .on(RoomEvent.TrackMuted, (pub: TrackPublication, p?: Participant) => {
            mediaDiagnostics.log('track', 'TrackMuted', {
              participantIdentity: p?.identity,
              trackSid: pub.trackSid,
              source: pub.source,
            });
            updateParticipants();
          })
          .on(RoomEvent.TrackUnmuted, (pub: TrackPublication, p?: Participant) => {
            mediaDiagnostics.log('track', 'TrackUnmuted', {
              participantIdentity: p?.identity,
              trackSid: pub.trackSid,
              source: pub.source,
            });
            updateParticipants();
          })
          .on(
            RoomEvent.TrackStreamStateChanged,
            (pub: RemoteTrackPublication, streamState: Track.StreamState, p: RemoteParticipant) => {
              mediaDiagnostics.log('track', 'TrackStreamStateChanged', {
                participantIdentity: p.identity,
                trackSid: pub.trackSid,
                details: { streamState },
              });
              updateParticipants();
            }
          )
          .on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
            mediaDiagnostics.log('track', 'LocalTrackPublished', {
              trackSid: pub.trackSid,
              source: pub.source,
              kind: pub.kind,
            });
            if (pub.source === Track.Source.Camera && (pub.videoTrack || pub.track) && isMounted) {
              setLocalVideoTrack((pub.videoTrack || pub.track) as LKVideoTrack);
            }
            if (pub.source === Track.Source.ScreenShare && isMounted) {
              setIsScreenSharing(true);
            }
            updateParticipants();
          })
          .on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
            mediaDiagnostics.log('track', 'LocalTrackUnpublished', {
              trackSid: pub.trackSid,
              source: pub.source,
            });
            if (pub.source === Track.Source.Camera && isMounted) {
              setLocalVideoTrack(null);
            }
            if (pub.source === Track.Source.ScreenShare && isMounted) {
              setIsScreenSharing(false);
            }
            updateParticipants();
          })
          .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
            if (!isMounted) return;
            if (speakers.length > 0) {
              setActiveSpeaker(speakers[0].identity);
            } else {
              setActiveSpeaker(null);
            }
          })
          .on(
            RoomEvent.DataReceived,
            (payload: Uint8Array, participant?: RemoteParticipant, _kind?: any, topic?: string) => {
              if (!isMounted) return;
              try {
                const str = new TextDecoder().decode(payload);
                const data = JSON.parse(str);

                mediaDiagnostics.log('media', 'DataReceived', {
                  participantIdentity: participant?.identity,
                  details: { topic, length: payload.length },
                });

                // Handle Chat
                if (topic === TC_TOPIC_CHAT || (!topic && data.text && (data.id || data.type === 'chat'))) {
                  const msgId = typeof data.id === 'string' ? data.id : `msg_${Date.now()}_${Math.random()}`;
                  const senderName =
                    data.senderName || data.sender || participant?.name || participant?.identity || 'Participant';
                  const senderIdentity = participant?.identity || data.senderIdentity;

                  setChatMessages((prev) => {
                    if (prev.some((m) => m.id === msgId)) return prev;
                    return [
                      ...prev,
                      {
                        id: msgId,
                        sender: senderName,
                        senderIdentity,
                        text: data.text,
                        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
                        isSelf: false,
                        status: 'sent',
                      },
                    ];
                  });

                  if (!showChat) {
                    setUnreadChatCount((c) => c + 1);
                  }
                }
                // Handle Reactions & Hand Raise
                else if (
                  topic === TC_TOPIC_REACTION ||
                  (!topic && (data.type === 'hand_raise' || data.type === 'reaction'))
                ) {
                  if (data.type === 'hand_raise' && participant) {
                    setRaisedHands((prev) => {
                      const next = new Set(prev);
                      if (data.raised) {
                        next.add(participant.identity);
                      } else {
                        next.delete(participant.identity);
                      }
                      return next;
                    });
                  } else if (data.type === 'reaction' && data.emoji) {
                    const reactionId = `rx_${Date.now()}_${Math.random()}`;
                    const senderName = participant?.name || participant?.identity || 'Participant';
                    setTransientReactions((prev) => [
                      ...prev,
                      { id: reactionId, emoji: data.emoji, sender: senderName },
                    ]);
                    setTimeout(() => {
                      setTransientReactions((current) => current.filter((r) => r.id !== reactionId));
                    }, 3500);
                  }
                }
              } catch (e) {
                console.warn('Failed to parse incoming data message:', e);
              }
            }
          );

        // 5. Connect to LiveKit SFU
        await room.connect(livekitUrl, token);

        // 6. Periodic Realtime WebRTC Telemetry sampling interval (every 2.5s)
        statsInterval = setInterval(async () => {
          if (!isMounted || !roomRef.current) return;
          try {
            const pcs: any[] = [];
            const sub = (roomRef.current.engine as any)?.pcManager?.subscriber?.pc;
            const pub = (roomRef.current.engine as any)?.pcManager?.publisher?.pc;
            if (sub) pcs.push(sub);
            if (pub) pcs.push(pub);
            if (pcs.length > 0) {
              await mediaDiagnostics.samplePeerConnectionStats(pcs);
            }
          } catch (_) {}
        }, 2500);
      } catch (err: any) {
        console.error('Room connection error:', err);
        mediaDiagnostics.log('room', 'ConnectionFailed', {
          error: err?.message || String(err),
        });
        if (isMounted) {
          setConnectionState('error');
          setErrorMessage(err?.message || 'Failed to establish LiveKit connection.');
        }
      }
    }

    let statsInterval: any = null;
    initRoom();

    return () => {
      isMounted = false;
      if (statsInterval) {
        clearInterval(statsInterval);
      }
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      AudioSession.stopAudioSession().catch(() => {});
    };
  }, [token, livekitUrl]);

  // Media Controls Handlers
  const toggleMic = async () => {
    if (!roomRef.current) return;
    try {
      const next = !micMuted;
      await roomRef.current.localParticipant.setMicrophoneEnabled(!next);
      setMicMuted(next);
      mediaDiagnostics.log('media', 'MicrophoneToggled', { isMuted: next });
    } catch (err: any) {
      console.warn('Failed to toggle mic:', err);
      mediaDiagnostics.log('media', 'MicrophoneToggleError', { error: err?.message });
    }
  };

  const toggleCamera = async () => {
    if (!roomRef.current) return;
    try {
      const next = !cameraOff;
      await roomRef.current.localParticipant.setCameraEnabled(!next, {
        facingMode: facing === 'front' ? 'user' : 'environment',
      });
      setCameraOff(next);
      mediaDiagnostics.log('media', 'CameraToggled', { cameraOff: next });
      if (next) {
        setLocalVideoTrack(null);
      } else {
        const camPub = roomRef.current.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.videoTrack) {
          setLocalVideoTrack(camPub.videoTrack as LKVideoTrack);
        }
      }
    } catch (err: any) {
      console.warn('Failed to toggle camera:', err);
      mediaDiagnostics.log('media', 'CameraToggleError', { error: err?.message });
    }
  };

  const flipCamera = async () => {
    if (!roomRef.current || cameraOff) return;
    const camPub = roomRef.current.localParticipant.getTrackPublication(Track.Source.Camera);
    if (camPub?.videoTrack) {
      try {
        await (camPub.videoTrack as any).switchCamera();
        const nextFacing = facing === 'front' ? 'back' : 'front';
        setFacing(nextFacing);
        mediaDiagnostics.log('media', 'CameraFlipped', { facing: nextFacing });
      } catch (err: any) {
        console.warn('Failed to flip camera:', err);
        mediaDiagnostics.log('media', 'CameraFlipError', { error: err?.message });
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!roomRef.current) return;
    const next = !isScreenSharing;
    try {
      mediaDiagnostics.log('screenshare', 'ScreenShareToggleRequest', { next });
      await roomRef.current.localParticipant.setScreenShareEnabled(next);
      setIsScreenSharing(next);
      mediaDiagnostics.log('screenshare', 'ScreenShareToggled', { isScreenSharing: next });
    } catch (err: any) {
      mediaDiagnostics.log('screenshare', 'ScreenShareError', { error: err?.message || String(err) });
      Alert.alert(
        'Screen Share',
        err?.message || 'Could not start screen sharing. Please check system permissions.'
      );
      setIsScreenSharing(false);
    }
  };

  const toggleAudioRoute = async () => {
    const nextRoute = audioRoute === 'speaker' ? 'earpiece' : 'speaker';
    try {
      await AudioSession.selectAudioOutput(nextRoute);
      setAudioRoute(nextRoute);
      mediaDiagnostics.log('audio', 'AudioRouteChanged', { route: nextRoute });
    } catch (err: any) {
      console.warn('Failed to change audio route:', err);
      mediaDiagnostics.log('audio', 'AudioRouteError', { error: err?.message });
    }
  };

  // Leave & End Meeting
  const handleLeave = async () => {
    try {
      await defaultApiClient.leaveRoom(roomCode);
    } catch (_) {}
    if (roomRef.current) {
      roomRef.current.disconnect();
    }
    await AudioSession.stopAudioSession().catch(() => {});
    onLeave();
  };

  const handleEndForAll = async () => {
    try {
      await defaultApiClient.endRoom(roomCode);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not end room.');
      return;
    }
    if (roomRef.current) {
      roomRef.current.disconnect();
    }
    await AudioSession.stopAudioSession().catch(() => {});
    onLeave();
  };

  // Chat Actions
  const handleSendChat = async () => {
    const text = chatInput.trim();
    if (!text || !roomRef.current) return;

    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newMsg: ChatMessage = {
      id: msgId,
      sender: displayName,
      text,
      timestamp: Date.now(),
      isSelf: true,
      status: 'sending',
    };

    setChatMessages((prev) => [...prev, newMsg]);
    setChatInput('');

    try {
      const payload = JSON.stringify({
        id: msgId,
        text,
        timestamp: newMsg.timestamp,
        senderName: displayName,
        senderIdentity: roomRef.current.localParticipant.identity,
      });
      const data = new TextEncoder().encode(payload);
      await roomRef.current.localParticipant.publishData(data, {
        reliable: true,
        topic: TC_TOPIC_CHAT,
      });

      setChatMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, status: 'sent' } : m))
      );
    } catch (err) {
      console.warn('Failed to publish chat data:', err);
      setChatMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, status: 'error' } : m))
      );
    }
  };

  // Hand Raise Action
  const handleToggleHandRaise = async () => {
    if (!roomRef.current) return;
    const next = !isHandRaised;
    setIsHandRaised(next);

    try {
      const payload = JSON.stringify({
        type: 'hand_raise',
        raised: next,
      });
      const data = new TextEncoder().encode(payload);
      await roomRef.current.localParticipant.publishData(data, {
        reliable: true,
        topic: TC_TOPIC_REACTION,
      });
    } catch (err) {
      console.warn('Failed to publish hand raise:', err);
    }
  };

  // Send Reaction Action
  const handleSendReaction = async (emoji: string) => {
    setShowReactionPicker(false);
    if (!roomRef.current) return;

    const reactionId = `self_rx_${Date.now()}`;
    setTransientReactions((prev) => [
      ...prev,
      { id: reactionId, emoji, sender: 'You' },
    ]);
    setTimeout(() => {
      setTransientReactions((current) => current.filter((r) => r.id !== reactionId));
    }, 3500);

    try {
      const payload = JSON.stringify({
        type: 'reaction',
        emoji,
      });
      const data = new TextEncoder().encode(payload);
      await roomRef.current.localParticipant.publishData(data, {
        reliable: true,
        topic: TC_TOPIC_REACTION,
      });
    } catch (err) {
      console.warn('Failed to publish reaction:', err);
    }
  };

  // Share Room Link
  const handleShareRoom = async () => {
    const url = `https://connect.aitathastu.com/room/${roomCode.toLowerCase()}`;
    try {
      if (RNShare?.share) {
        await RNShare.share({
          title: 'Join Tathastu Meet',
          message: `Join my meeting on Tathastu Meet: ${url}\nRoom code: ${roomCode.toUpperCase()}`,
          url,
        });
      }
    } catch (err) {
      console.warn('Share error:', err);
    }
  };

  // Diagnostics Inspector with Genuine WebRTC Sampling
  const openDiagnostics = async () => {
    if (roomRef.current) {
      const pcs: any[] = [];
      const sub = (roomRef.current.engine as any)?.pcManager?.subscriber?.pc;
      const pub = (roomRef.current.engine as any)?.pcManager?.publisher?.pc;
      if (sub) pcs.push(sub);
      if (pub) pcs.push(pub);
      if (pcs.length > 0) {
        await mediaDiagnostics.samplePeerConnectionStats(pcs);
      }
    }
    setTelemetrySnapshot(mediaDiagnostics.getLatestMetrics());
    setDiagnosticEvents(mediaDiagnostics.getRecentEvents(30));
    setShowDiagnostics(true);
  };

  const handleExportDiagnostics = async () => {
    try {
      const exportJson = mediaDiagnostics.generateSanitizedExport({
        roomCode: roomCode.toUpperCase(),
        connectionState,
        audioRoute,
        isHost,
        screenSharingActive: isScreenSharing,
        participantsCount,
      });
      if (RNShare?.share) {
        await RNShare.share({
          title: `Tathastu_Diagnostics_${roomCode.toUpperCase()}`,
          message: exportJson,
        });
      }
    } catch (err) {
      console.warn('Export diagnostics error:', err);
    }
  };

  // Host Participant Moderation
  const handleMuteParticipant = async (identity: string) => {
    try {
      await defaultApiClient.muteParticipant(roomCode, identity);
      Alert.alert('Participant Muted', 'The participant has been muted.');
    } catch (err: any) {
      Alert.alert('Action Failed', err?.message || 'Could not mute participant.');
    }
  };

  const handleRemoveParticipant = async (identity: string) => {
    try {
      await defaultApiClient.removeParticipant(roomCode, identity);
      Alert.alert('Participant Removed', 'The participant has been removed from the room.');
    } catch (err: any) {
      Alert.alert('Action Failed', err?.message || 'Could not remove participant.');
    }
  };

  const handleToggleRoomLock = () => {
    setIsRoomLocked((prev) => {
      const next = !prev;
      Alert.alert(
        next ? 'Room Locked' : 'Room Unlocked',
        next
          ? 'New participants will not be able to join this meeting.'
          : 'The meeting room is now open for participants.'
      );
      return next;
    });
  };

  const remoteParticipantsArray = Array.from(remoteTracks.values());

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#17151F" />

      {/* Top Header Bar */}
      <View
        style={[
          styles.topBar,
          isCompact && styles.topBarCompact,
          !controlsVisible && styles.hiddenBar,
          { paddingTop: Math.max(10, (safeInsets?.top || 0) + 4) },
        ]}
      >
        {/* Top Left: LIVE badge and room code */}
        <View style={styles.roomInfoLeft}>
          <View style={styles.liveIndicator}>
            <View
              style={[
                styles.liveDot,
                connectionState !== 'connected' && styles.liveDotConnecting,
              ]}
            />
            <Text style={styles.liveText}>
              {connectionState === 'connected' ? 'LIVE' : connectionState.toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.roomCodeText, isCompact && styles.roomCodeTextCompact]} numberOfLines={1}>
            {roomCode.toUpperCase()}
          </Text>
        </View>

        {/* Top Right: 1. Clean Invite action, 2. Participants badge (NO Chat here) */}
        <View style={styles.topRightActions}>
          {/* 1. Invite Action Button (Available on all screen sizes) */}
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={() => {
              resetControlsTimer();
              handleShareRoom();
            }}
            accessibilityRole="button"
            accessibilityLabel="Invite participants"
            activeOpacity={0.75}
          >
            <UserPlus size={18} color="#FFFFFF" />
          </TouchableOpacity>

          {/* 2. Participants Badge Button */}
          <TouchableOpacity
            style={styles.headerActionBadge}
            onPress={() => {
              setShowParticipants(true);
              resetControlsTimer();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Participants: ${participantsCount}`}
            activeOpacity={0.75}
          >
            <Users size={17} color="#FFFFFF" />
            <Text style={styles.badgeText}>{participantsCount}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Transient Floating Reactions Overlay */}
      {transientReactions.length > 0 && (
        <View style={styles.reactionsOverlay} pointerEvents="none">
          {transientReactions.map((rx) => (
            <View key={rx.id} style={styles.floatingReactionBubble}>
              <Text style={styles.floatingReactionEmoji}>{rx.emoji}</Text>
              <Text style={styles.floatingReactionSender}>{rx.sender}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Main Video Stage */}
      <View style={styles.stage}>
        {connectionState === 'connecting' ? (
          <View style={styles.centerCard}>
            <ActivityIndicator size="large" color="#FFC93C" />
            <Text style={styles.connectingText}>Connecting to LiveKit Room...</Text>
            <Text style={styles.connectingSubtext}>{roomCode.toUpperCase()}</Text>
          </View>
        ) : connectionState === 'error' ? (
          <View style={styles.centerCard}>
            <Text style={styles.errorTitle}>Connection Failed</Text>
            <Text style={styles.errorDesc}>
              {errorMessage || 'Unable to establish WebRTC media connection.'}
            </Text>
            <TouchableOpacity style={styles.errorLeaveBtn} onPress={onLeave}>
              <Text style={styles.errorLeaveBtnText}>Exit Meeting</Text>
            </TouchableOpacity>
          </View>
        ) : screenShareTrack ? (
          // Screen Share Stage (Presentation takes main focus with contain-fit)
          <TouchableOpacity
            activeOpacity={1}
            style={styles.stageGrid}
            onPress={handleStageTap}
            accessibilityLabel="Toggle call controls"
          >
            <View style={styles.screenShareContainer}>
              <VideoView
                videoTrack={screenShareTrack.track}
                style={StyleSheet.absoluteFill}
                objectFit="contain"
              />
              <View style={styles.screenShareBadge}>
                <Monitor size={14} color="#FFFFFF" />
                <Text style={styles.screenShareBadgeText}>
                  Screen sharing from{' '}
                  {screenShareTrack.participant.name || screenShareTrack.participant.identity}
                </Text>
              </View>
            </View>

            {/* Smart PiP with Two-Tap Focus/Enlarge & Swap */}
            <TouchableOpacity
              activeOpacity={0.88}
              style={[
                styles.localPip,
                { width: pipWidth, height: pipHeight },
                isPipFocused && styles.localPipFocused,
              ]}
              onPress={handlePipPress}
              accessibilityRole="button"
              accessibilityLabel={isPipFocused ? 'Tap again to swap stage' : 'Focus preview'}
            >
              {isPipFocused && (
                <View style={styles.pipFocusBadge}>
                  <Text style={styles.pipFocusBadgeText}>Tap to swap</Text>
                </View>
              )}

              {/* Quick Flip camera button when local camera is active in PiP */}
              {!cameraOff && localVideoTrack && (
                <TouchableOpacity
                  style={styles.pipFlipBtn}
                  onPress={() => {
                    flipCamera();
                    resetControlsTimer();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Flip camera"
                >
                  <RefreshCw size={12} color="#FFFFFF" />
                </TouchableOpacity>
              )}

              {!cameraOff && localVideoTrack ? (
                <VideoView
                  videoTrack={localVideoTrack}
                  style={StyleSheet.absoluteFill}
                  mirror={facing === 'front'}
                  objectFit="cover"
                />
              ) : (
                <View style={styles.pipAvatarContainer}>
                  <ProfileAvatar
                    size={isPipFocused ? 58 : 46}
                    avatarId={localUser?.avatarId}
                    avatarUrl={localUser?.avatarUrl}
                    name={displayName}
                    seed={displayName}
                    borderWidth={2}
                    borderColor="rgba(255, 255, 255, 0.2)"
                  />
                  <Text style={styles.pipCameraOffText}>Camera Off</Text>
                </View>
              )}
              <View style={styles.localTag}>
                <Text style={styles.localTagName} numberOfLines={1}>
                  You {micMuted ? '(Muted)' : ''}
                </Text>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        ) : remoteParticipantsArray.length === 0 ? (
          // Solo in Room (Waiting for others)
          <TouchableOpacity
            activeOpacity={1}
            style={styles.stageGrid}
            onPress={handleStageTap}
            accessibilityLabel="Toggle call controls"
          >
            <View style={styles.soloContainer}>
              <View style={styles.soloAvatarWrapper}>
                <ProfileAvatar
                  size={96}
                  avatarId={localUser?.avatarId}
                  avatarUrl={localUser?.avatarUrl}
                  name={displayName}
                  seed={displayName}
                  useFullResolution={true}
                  borderWidth={3}
                  borderColor="rgba(116, 68, 232, 0.4)"
                />
              </View>
              <Text style={styles.soloTitle}>Waiting for others to join</Text>
              <Text style={styles.soloSubtitle}>
                Share room code {roomCode.toUpperCase()} or tap Invite to share the link.
              </Text>
              <TouchableOpacity
                style={styles.soloInviteBtn}
                onPress={() => {
                  resetControlsTimer();
                  handleShareRoom();
                }}
                activeOpacity={0.8}
              >
                <UserPlus size={18} color="#17151F" />
                <Text style={styles.soloInviteBtnText}>Invite Participants</Text>
              </TouchableOpacity>
            </View>

            {/* Smart PiP with Two-Tap Preview & Swap */}
            <TouchableOpacity
              activeOpacity={0.88}
              style={[
                styles.localPip,
                { width: pipWidth, height: pipHeight },
                isPipFocused && styles.localPipFocused,
              ]}
              onPress={handlePipPress}
              accessibilityRole="button"
              accessibilityLabel={isPipFocused ? 'Tap again to swap stage' : 'Focus preview'}
            >
              {isPipFocused && (
                <View style={styles.pipFocusBadge}>
                  <Text style={styles.pipFocusBadgeText}>Tap to swap</Text>
                </View>
              )}

              {/* Quick Flip camera button when camera is on */}
              {!cameraOff && localVideoTrack && (
                <TouchableOpacity
                  style={styles.pipFlipBtn}
                  onPress={() => {
                    flipCamera();
                    resetControlsTimer();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Flip camera"
                >
                  <RefreshCw size={12} color="#FFFFFF" />
                </TouchableOpacity>
              )}

              {!cameraOff && localVideoTrack ? (
                <VideoView
                  videoTrack={localVideoTrack}
                  style={StyleSheet.absoluteFill}
                  mirror={facing === 'front'}
                  objectFit="cover"
                />
              ) : (
                <View style={styles.pipAvatarContainer}>
                  <ProfileAvatar
                    size={isPipFocused ? 58 : 46}
                    avatarId={localUser?.avatarId}
                    avatarUrl={localUser?.avatarUrl}
                    name={displayName}
                    seed={displayName}
                    borderWidth={2}
                    borderColor="rgba(255, 255, 255, 0.2)"
                  />
                  <Text style={styles.pipCameraOffText}>Camera Off</Text>
                </View>
              )}
              <View style={styles.localTag}>
                <Text style={styles.localTagName} numberOfLines={1}>
                  You {micMuted ? '(Muted)' : ''}
                </Text>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        ) : remoteParticipantsArray.length === 1 ? (
          // 1-to-1 Call: Immersive focused video stage with local/remote focus swapping
          (() => {
            const singleRemote = remoteParticipantsArray[0];
            const isLocalFocused = focusedParticipantId === 'local';
            const mainName = isLocalFocused ? displayName : (singleRemote.participant.name || singleRemote.participant.identity);
            const mainIsMuted = isLocalFocused ? micMuted : singleRemote.isMicMuted;
            const pipName = isLocalFocused ? (singleRemote.participant.name || singleRemote.participant.identity) : 'You';
            const pipIsMuted = isLocalFocused ? singleRemote.isMicMuted : micMuted;

            return (
              <TouchableOpacity
                activeOpacity={1}
                style={styles.stageGrid}
                onPress={toggleControls}
                accessibilityLabel="Toggle call controls"
              >
                {/* Main Focused Stage */}
                <View style={styles.immersiveMainStage}>
                  {isLocalFocused ? (
                    // Local user focused on main stage
                    !cameraOff && localVideoTrack ? (
                      <VideoView
                        videoTrack={localVideoTrack}
                        style={StyleSheet.absoluteFill}
                        mirror={facing === 'front'}
                        objectFit="cover"
                      />
                    ) : (
                      <View style={styles.stageAvatarContainer}>
                        <View style={styles.avatarHaloRing}>
                          <ProfileAvatar
                            size={116}
                            avatarId={localUser?.avatarId}
                            avatarUrl={localUser?.avatarUrl}
                            name={displayName}
                            seed={displayName}
                            useFullResolution={true}
                            borderWidth={3}
                            borderColor="rgba(255, 201, 60, 0.4)"
                          />
                        </View>
                        <View style={styles.cameraOffPill}>
                          <Text style={styles.cameraOffPillText}>Camera Off</Text>
                        </View>
                      </View>
                    )
                  ) : (
                    // Remote participant focused on main stage
                    singleRemote.videoTrack && !singleRemote.isCameraMuted ? (
                      <VideoView
                        videoTrack={singleRemote.videoTrack}
                        style={StyleSheet.absoluteFill}
                        objectFit="cover"
                      />
                    ) : (
                      <View style={styles.stageAvatarContainer}>
                        <View style={styles.avatarHaloRing}>
                          <ProfileAvatar
                            size={116}
                            name={mainName}
                            seed={singleRemote.participant.identity || mainName}
                            useFullResolution={true}
                            borderWidth={3}
                            borderColor="rgba(255, 201, 60, 0.4)"
                          />
                        </View>
                        <View style={styles.cameraOffPill}>
                          <Text style={styles.cameraOffPillText}>
                            {singleRemote.hasSubscriptionError
                              ? 'Media Subscription Issue'
                              : singleRemote.isSubscribing
                              ? 'Connecting Video...'
                              : singleRemote.isCameraMuted
                              ? 'Camera Off'
                              : 'Connecting Media...'}
                          </Text>
                        </View>
                      </View>
                    )
                  )}

                  {/* Main stage participant tag */}
                  <View style={styles.participantTag}>
                    <Text style={styles.participantTagName} numberOfLines={1}>
                      {mainName} {mainIsMuted ? '(Muted)' : ''}
                    </Text>
                  </View>
                </View>

                {/* Floating Swappable PiP with Smart Two-Tap Interaction */}
                <TouchableOpacity
                  activeOpacity={0.88}
                  style={[
                    styles.localPip,
                    { width: effectivePipWidth, height: effectivePipHeight },
                    isPipFocused && styles.localPipFocused,
                  ]}
                  onPress={handleToggleFocus}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isPipFocused
                      ? `Tap again to swap stage with ${pipName}`
                      : `Focus preview for ${pipName}`
                  }
                >
                  {/* Visual indication that PiP is focused/selected */}
                  {isPipFocused && (
                    <View style={styles.pipFocusBadge}>
                      <Text style={styles.pipFocusBadgeText}>Tap to swap</Text>
                    </View>
                  )}

                  {/* Quick Flip camera button on PiP if local user is in PiP and camera is active */}
                  {!isLocalFocused && !cameraOff && localVideoTrack && (
                    <TouchableOpacity
                      style={styles.pipFlipBtn}
                      onPress={() => {
                        flipCamera();
                        resetControlsTimer();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Flip camera"
                    >
                      <RefreshCw size={12} color="#FFFFFF" />
                    </TouchableOpacity>
                  )}

                  {isLocalFocused ? (
                    // Remote participant in PiP
                    singleRemote.videoTrack && !singleRemote.isCameraMuted ? (
                      <VideoView
                        videoTrack={singleRemote.videoTrack}
                        style={StyleSheet.absoluteFill}
                        objectFit="cover"
                      />
                    ) : (
                      <View style={styles.pipAvatarContainer}>
                        <ProfileAvatar
                          size={isPipFocused ? 58 : 46}
                          name={pipName}
                          seed={singleRemote.participant.identity || pipName}
                          borderWidth={2}
                          borderColor="rgba(255, 255, 255, 0.2)"
                        />
                        <Text style={styles.pipCameraOffText}>Camera Off</Text>
                      </View>
                    )
                  ) : (
                    // Local user in PiP
                    !cameraOff && localVideoTrack ? (
                      <VideoView
                        videoTrack={localVideoTrack}
                        style={StyleSheet.absoluteFill}
                        mirror={facing === 'front'}
                        objectFit="cover"
                      />
                    ) : (
                      <View style={styles.pipAvatarContainer}>
                        <ProfileAvatar
                          size={isPipFocused ? 58 : 46}
                          avatarId={localUser?.avatarId}
                          avatarUrl={localUser?.avatarUrl}
                          name={displayName}
                          seed={displayName}
                          borderWidth={2}
                          borderColor="rgba(255, 255, 255, 0.2)"
                        />
                        <Text style={styles.pipCameraOffText}>Camera Off</Text>
                      </View>
                    )
                  )}

                  <View style={styles.localTag}>
                    <Text style={styles.localTagName} numberOfLines={1}>
                      {pipName} {pipIsMuted ? '(Muted)' : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })()
        ) : (
          // Multi-Participant Remote Video Grid (3+ in call)
          <TouchableOpacity
            activeOpacity={1}
            style={styles.stageGrid}
            onPress={handleStageTap}
            accessibilityLabel="Toggle call controls"
          >
            <View
              style={[
                styles.remoteGridContainer,
                remoteParticipantsArray.length === 2 && (isLandscape || isTablet ? styles.remoteGridTwoHorizontal : styles.remoteGridTwoVertical),
                remoteParticipantsArray.length >= 3 && styles.remoteGridMulti,
              ]}
            >
              {remoteParticipantsArray.map(
                ({ participant, videoTrack, isCameraMuted, isSubscribing, isMicMuted, hasSubscriptionError }) => {
                  const isSpeaking = activeSpeaker === participant.identity;
                  const hasRaisedHand = raisedHands.has(participant.identity);
                  const pName = participant.name || participant.identity;

                  return (
                    <View
                      key={participant.identity}
                      style={[
                        styles.remoteTile,
                        isSpeaking && styles.activeSpeakerTile,
                        remoteParticipantsArray.length === 2 && (isLandscape || isTablet ? styles.remoteTileTwoHorizontal : styles.remoteTileTwoVertical),
                        remoteParticipantsArray.length >= 3 && styles.remoteTileMulti,
                      ]}
                    >
                      {videoTrack && !isCameraMuted ? (
                        <VideoView
                          videoTrack={videoTrack}
                          style={StyleSheet.absoluteFill}
                          objectFit="cover"
                        />
                      ) : (
                        <View style={styles.remoteAvatarContainer}>
                          <ProfileAvatar
                            size={68}
                            name={pName}
                            seed={participant.identity || pName}
                            useFullResolution={true}
                            borderWidth={2}
                            borderColor="rgba(255, 255, 255, 0.2)"
                          />
                          <Text style={styles.remoteCameraOffText}>
                            {hasSubscriptionError
                              ? 'Subscription Issue'
                              : isSubscribing
                              ? 'Connecting Video...'
                              : isCameraMuted
                              ? 'Camera Off'
                              : 'Connecting Media...'}
                          </Text>
                        </View>
                      )}

                      {/* Participant Name Tag & Audio Status */}
                      <View style={styles.participantTag}>
                        {hasRaisedHand && (
                          <View style={styles.handBadge}>
                            <Hand size={12} color="#17151F" />
                          </View>
                        )}
                        <Text style={styles.participantTagName} numberOfLines={1}>
                          {pName} {isMicMuted ? '(Muted)' : ''}
                        </Text>
                      </View>
                    </View>
                  );
                }
              )}
            </View>

            {/* Local Video PiP with Two-Tap preview emphasis & swap */}
            <TouchableOpacity
              activeOpacity={0.88}
              style={[
                styles.localPip,
                { width: pipWidth, height: pipHeight },
                isPipFocused && styles.localPipFocused,
              ]}
              onPress={handlePipPress}
              accessibilityRole="button"
              accessibilityLabel={isPipFocused ? 'Tap again to swap stage' : 'Focus preview'}
            >
              {isPipFocused && (
                <View style={styles.pipFocusBadge}>
                  <Text style={styles.pipFocusBadgeText}>Tap to swap</Text>
                </View>
              )}

              {/* Quick Flip camera button on PiP when camera is active */}
              {!cameraOff && localVideoTrack && (
                <TouchableOpacity
                  style={styles.pipFlipBtn}
                  onPress={() => {
                    flipCamera();
                    resetControlsTimer();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Flip camera"
                >
                  <RefreshCw size={12} color="#FFFFFF" />
                </TouchableOpacity>
              )}

              {!cameraOff && localVideoTrack ? (
                <VideoView
                  videoTrack={localVideoTrack}
                  style={StyleSheet.absoluteFill}
                  mirror={facing === 'front'}
                  objectFit="cover"
                />
              ) : (
                <View style={styles.pipAvatarContainer}>
                  <ProfileAvatar
                    size={isPipFocused ? 58 : 46}
                    avatarId={localUser?.avatarId}
                    avatarUrl={localUser?.avatarUrl}
                    name={displayName}
                    seed={displayName}
                    borderWidth={2}
                    borderColor="rgba(255, 255, 255, 0.2)"
                  />
                  <Text style={styles.pipCameraOffText}>Camera Off</Text>
                </View>
              )}
              <View style={styles.localTag}>
                <Text style={styles.localTagName} numberOfLines={1}>
                  You {micMuted ? '(Muted)' : ''}
                </Text>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      </View>

      {/* Right-Side WhatsApp-Inspired Quick Action Controls (Chat, Reactions, Raise Hand) */}
      {controlsVisible && (
        <View style={[styles.rightQuickActions, isCompact && styles.rightQuickActionsCompact]}>
          {/* 1. Chat Quick Action with Unread Badge */}
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => {
              setShowChat(true);
              setUnreadChatCount(0);
              resetControlsTimer();
            }}
            accessibilityRole="button"
            accessibilityLabel="Open in-meeting chat"
            activeOpacity={0.75}
          >
            <MessageSquare size={20} color="#FFFFFF" />
            {unreadChatCount > 0 && (
              <View style={styles.quickActionUnreadBadge}>
                <Text style={styles.quickActionUnreadText}>{unreadChatCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* 2. Emoji Reactions Quick Action */}
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => {
              setShowReactionPicker(true);
              resetControlsTimer();
            }}
            accessibilityRole="button"
            accessibilityLabel="Send emoji reaction"
            activeOpacity={0.75}
          >
            <Smile size={20} color="#FFFFFF" />
          </TouchableOpacity>

          {/* 3. Raise Hand Quick Action */}
          <TouchableOpacity
            style={[styles.quickActionBtn, isHandRaised && styles.quickActionBtnHandActive]}
            onPress={() => {
              handleToggleHandRaise();
              resetControlsTimer();
            }}
            accessibilityRole="button"
            accessibilityLabel={isHandRaised ? 'Lower hand' : 'Raise hand'}
            activeOpacity={0.75}
          >
            <Hand size={20} color={isHandRaised ? '#17151F' : '#FFFFFF'} />
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom Floating Control Dock — Clean, 5 Essential Controls */}
      {controlsVisible && (
        <View
          style={[
            styles.controlsBar,
            isCompactToolbar && styles.controlsBarCompact,
            isVeryNarrow && styles.controlsBarVeryNarrow,
            { paddingBottom: Math.max(12, (safeInsets?.bottom || 0) + 6) },
          ]}
        >
          {isCompactToolbar ? (
            /* Handset Layout (< 520dp): 5 Essential Controls */
            <>
              {/* 1. More / Overflow Action Sheet Toggle */}
              <TouchableOpacity
                style={[
                  styles.controlBtn,
                  showMoreActions && styles.controlBtnActiveMore,
                ]}
                onPress={() => {
                  setShowMoreActions(true);
                  resetControlsTimer();
                }}
                accessibilityRole="button"
                accessibilityLabel="More meeting actions"
              >
                <MoreHorizontal size={20} color="#FFFFFF" />
              </TouchableOpacity>

              {/* 2. Camera Toggle */}
              <TouchableOpacity
                style={[styles.controlBtn, cameraOff && styles.controlBtnDanger]}
                onPress={() => {
                  toggleCamera();
                  resetControlsTimer();
                }}
                accessibilityRole="button"
                accessibilityLabel={cameraOff ? 'Turn on camera' : 'Turn off camera'}
              >
                {cameraOff ? <VideoOff size={20} color="#FFFFFF" /> : <Video size={20} color="#FFFFFF" />}
              </TouchableOpacity>

              {/* 3. Speaker / Audio Route Direct Toggle */}
              <TouchableOpacity
                style={[styles.controlBtn, audioRoute === 'earpiece' && styles.controlBtnActiveRoute]}
                onPress={() => {
                  toggleAudioRoute();
                  resetControlsTimer();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Audio output: ${audioRoute}`}
              >
                {audioRoute === 'speaker' ? (
                  <Volume2 size={20} color="#FFFFFF" />
                ) : (
                  <VolumeX size={20} color="#FFC93C" />
                )}
              </TouchableOpacity>

              {/* 4. Mic Toggle */}
              <TouchableOpacity
                style={[styles.controlBtn, micMuted && styles.controlBtnDanger]}
                onPress={() => {
                  toggleMic();
                  resetControlsTimer();
                }}
                accessibilityRole="button"
                accessibilityLabel={micMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {micMuted ? <MicOff size={20} color="#FFFFFF" /> : <Mic size={20} color="#FFFFFF" />}
              </TouchableOpacity>

              {/* 5. End / Leave Call Button */}
              <TouchableOpacity
                style={[
                  styles.leaveBtn,
                  isCompactToolbar && styles.leaveBtnCompact,
                  isVeryNarrow && styles.leaveBtnVeryNarrow,
                ]}
                onPress={() => {
                  resetControlsTimer();
                  confirmLeave();
                }}
                accessibilityRole="button"
                accessibilityLabel="Leave meeting"
              >
                <PhoneOff size={18} color="#FFFFFF" />
                <Text style={styles.leaveBtnText}>{isHost ? 'End' : 'Leave'}</Text>
              </TouchableOpacity>
            </>
          ) : (
            /* Tablet / Wide Display: Expanded Toolbar */
            <>
              {/* Screen Share */}
              <TouchableOpacity
                style={[styles.controlBtn, isScreenSharing && styles.controlBtnActiveShare]}
                onPress={() => {
                  toggleScreenShare();
                  resetControlsTimer();
                }}
                accessibilityRole="button"
                accessibilityLabel={isScreenSharing ? 'Stop screen sharing' : 'Share screen'}
              >
                <Monitor size={20} color={isScreenSharing ? '#17151F' : '#FFFFFF'} />
              </TouchableOpacity>

              {/* Flip Camera */}
              <TouchableOpacity
                style={[styles.controlBtn, cameraOff && styles.controlBtnDisabled]}
                onPress={() => {
                  flipCamera();
                  resetControlsTimer();
                }}
                disabled={cameraOff}
                accessibilityRole="button"
                accessibilityLabel="Flip camera"
              >
                <RefreshCw size={20} color={cameraOff ? '#8E8A80' : '#FFFFFF'} />
              </TouchableOpacity>

              {/* Speaker / Audio Route */}
              <TouchableOpacity
                style={[styles.controlBtn, audioRoute === 'earpiece' && styles.controlBtnActiveRoute]}
                onPress={() => {
                  toggleAudioRoute();
                  resetControlsTimer();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Audio output: ${audioRoute}`}
              >
                {audioRoute === 'speaker' ? (
                  <Volume2 size={20} color="#FFFFFF" />
                ) : (
                  <VolumeX size={20} color="#FFC93C" />
                )}
              </TouchableOpacity>

              {/* Camera */}
              <TouchableOpacity
                style={[styles.controlBtn, cameraOff && styles.controlBtnDanger]}
                onPress={() => {
                  toggleCamera();
                  resetControlsTimer();
                }}
                accessibilityRole="button"
                accessibilityLabel={cameraOff ? 'Turn on camera' : 'Turn off camera'}
              >
                {cameraOff ? <VideoOff size={20} color="#FFFFFF" /> : <Video size={20} color="#FFFFFF" />}
              </TouchableOpacity>

              {/* Mic */}
              <TouchableOpacity
                style={[styles.controlBtn, micMuted && styles.controlBtnDanger]}
                onPress={() => {
                  toggleMic();
                  resetControlsTimer();
                }}
                accessibilityRole="button"
                accessibilityLabel={micMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {micMuted ? <MicOff size={20} color="#FFFFFF" /> : <Mic size={20} color="#FFFFFF" />}
              </TouchableOpacity>

              {/* More Actions */}
              <TouchableOpacity
                style={[styles.controlBtn, showMoreActions && styles.controlBtnActiveMore]}
                onPress={() => {
                  setShowMoreActions(true);
                  resetControlsTimer();
                }}
                accessibilityRole="button"
                accessibilityLabel="More meeting actions"
              >
                <MoreHorizontal size={20} color="#FFFFFF" />
              </TouchableOpacity>

              {/* Leave */}
              <TouchableOpacity
                style={styles.leaveBtn}
                onPress={() => {
                  resetControlsTimer();
                  confirmLeave();
                }}
                accessibilityRole="button"
                accessibilityLabel="Leave meeting"
              >
                <PhoneOff size={18} color="#FFFFFF" />
                <Text style={styles.leaveBtnText}>{isHost ? 'End' : 'Leave'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Emoji Reaction Picker Modal */}
      <Modal visible={showReactionPicker} animationType="fade" transparent onRequestClose={() => setShowReactionPicker(false)}>
        <TouchableOpacity
          style={styles.reactionModalBackdrop}
          activeOpacity={1}
          onPress={() => setShowReactionPicker(false)}
        >
          <View style={[styles.reactionPickerBubble, isShortHeight && styles.reactionPickerBubbleShort]}>
            {REACTION_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={styles.emojiPickBtn}
                onPress={() => {
                  handleSendReaction(emoji);
                  resetControlsTimer();
                }}
              >
                <Text style={styles.emojiPickText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Rebuilt Meeting Actions Modal — Compact, Clean, Balanced Layout */}
      <Modal visible={showMoreActions} animationType="slide" transparent onRequestClose={() => setShowMoreActions(false)}>
        <TouchableOpacity
          style={styles.moreActionsBackdrop}
          activeOpacity={1}
          onPress={() => setShowMoreActions(false)}
        >
          <View style={[styles.moreActionsContainer, isShortHeight && styles.moreActionsContainerShort]}>
            <View style={styles.sheetDragHandle} />

            <View style={styles.moreActionsHeader}>
              <Text style={styles.moreActionsTitle}>Meeting Actions</Text>
              <TouchableOpacity
                onPress={() => setShowMoreActions(false)}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close actions"
              >
                <X size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <View style={styles.moreActionsGrid}>
              {/* Flip Camera */}
              <TouchableOpacity
                style={[styles.moreActionItem, cameraOff && styles.moreActionItemDisabled]}
                onPress={() => {
                  setShowMoreActions(false);
                  flipCamera();
                  resetControlsTimer();
                }}
                disabled={cameraOff}
              >
                <View style={[styles.moreActionIconCircle, cameraOff && styles.moreActionIconCircleDisabled]}>
                  <RefreshCw size={22} color={cameraOff ? '#8E8A80' : '#FFFFFF'} />
                </View>
                <Text style={styles.moreActionLabel}>Flip Camera</Text>
                <Text style={styles.moreActionSublabel}>{facing === 'front' ? 'Front' : 'Back'}</Text>
              </TouchableOpacity>

              {/* Share Screen */}
              <TouchableOpacity
                style={styles.moreActionItem}
                onPress={() => {
                  setShowMoreActions(false);
                  toggleScreenShare();
                  resetControlsTimer();
                }}
              >
                <View style={[styles.moreActionIconCircle, isScreenSharing && styles.moreActionIconActiveShare]}>
                  <Monitor size={22} color={isScreenSharing ? '#17151F' : '#FFFFFF'} />
                </View>
                <Text style={styles.moreActionLabel}>Share Screen</Text>
                <Text style={styles.moreActionSublabel}>{isScreenSharing ? 'Active' : 'Off'}</Text>
              </TouchableOpacity>

              {/* Audio Output Route */}
              <TouchableOpacity
                style={styles.moreActionItem}
                onPress={() => {
                  setShowMoreActions(false);
                  toggleAudioRoute();
                  resetControlsTimer();
                }}
              >
                <View style={[styles.moreActionIconCircle, audioRoute === 'earpiece' && styles.moreActionIconActiveRoute]}>
                  {audioRoute === 'speaker' ? (
                    <Volume2 size={22} color="#FFFFFF" />
                  ) : (
                    <VolumeX size={22} color="#FFC93C" />
                  )}
                </View>
                <Text style={styles.moreActionLabel}>Audio Output</Text>
                <Text style={styles.moreActionSublabel}>{audioRoute === 'speaker' ? 'Speaker' : 'Earpiece'}</Text>
              </TouchableOpacity>

              {/* Share Invite */}
              <TouchableOpacity
                style={styles.moreActionItem}
                onPress={() => {
                  setShowMoreActions(false);
                  resetControlsTimer();
                  handleShareRoom();
                }}
                accessibilityRole="button"
                accessibilityLabel="Share Invite"
              >
                <View style={styles.moreActionIconCircle}>
                  <UserPlus size={22} color="#FFFFFF" />
                </View>
                <Text style={styles.moreActionLabel}>Share Invite</Text>
                <Text style={styles.moreActionSublabel}>Invite Link</Text>
              </TouchableOpacity>

              {/* Host: Lock / Unlock Room */}
              {isHost && (
                <TouchableOpacity
                  style={styles.moreActionItem}
                  onPress={() => {
                    setShowMoreActions(false);
                    resetControlsTimer();
                    handleToggleRoomLock();
                  }}
                >
                  <View style={[styles.moreActionIconCircle, isRoomLocked && styles.moreActionIconLocked]}>
                    {isRoomLocked ? (
                      <Lock size={22} color="#FF6B6B" />
                    ) : (
                      <Unlock size={22} color="#2DBE74" />
                    )}
                  </View>
                  <Text style={styles.moreActionLabel}>{isRoomLocked ? 'Room Locked' : 'Room Unlocked'}</Text>
                  <Text style={styles.moreActionSublabel}>{isRoomLocked ? 'Restricted' : 'Open'}</Text>
                </TouchableOpacity>
              )}

              {/* Diagnostics (Strictly Gated for Development) */}
              {Boolean(__DEV__) && (
                <TouchableOpacity
                  style={styles.moreActionItem}
                  onPress={() => {
                    setShowMoreActions(false);
                    setShowDiagnostics(true);
                  }}
                >
                  <View style={styles.moreActionIconCircle}>
                    <Activity size={22} color="#7444E8" />
                  </View>
                  <Text style={styles.moreActionLabel}>Diagnostics</Text>
                  <Text style={styles.moreActionSublabel}>Dev Only</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* In-Meeting Chat Drawer Modal */}
      <Modal visible={showChat} animationType="slide" transparent onRequestClose={() => setShowChat(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdropTouch}
            activeOpacity={1}
            onPress={() => setShowChat(false)}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.modalContainer, isShortHeight && styles.modalContainerShort]}
          >
            <View style={styles.sheetDragHandle} />

            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <MessageSquare size={18} color="#FFC93C" />
                <Text style={styles.modalTitle}>In-Meeting Chat</Text>
              </View>
              <TouchableOpacity onPress={() => setShowChat(false)} style={styles.closeBtn}>
                <X size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={chatScrollRef}
              style={styles.chatList}
              contentContainerStyle={styles.chatListContent}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
            >
              {chatMessages.length === 0 ? (
                <View style={styles.emptyChatBox}>
                  <Text style={styles.chatEmptyText}>
                    Messages sent here are visible to everyone in the room.
                  </Text>
                </View>
              ) : (
                chatMessages.map((msg) => (
                  <View
                    key={msg.id}
                    style={[
                      styles.chatBubble,
                      msg.isSelf ? styles.chatBubbleSelf : styles.chatBubbleRemote,
                    ]}
                  >
                    <Text style={styles.chatSenderText}>{msg.sender}</Text>
                    <Text style={msg.isSelf ? styles.chatTextSelf : styles.chatTextRemote}>
                      {msg.text}
                    </Text>
                    <View style={styles.chatMetaRow}>
                      <Text style={styles.chatTimeText}>
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                      {msg.isSelf && (
                        <Text style={styles.chatStatusText}>
                          {msg.status === 'sending' ? '• sending' : msg.status === 'error' ? '• failed' : '✓'}
                        </Text>
                      )}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <View style={[styles.chatInputRow, { paddingBottom: Math.max(12, (safeInsets?.bottom || 0) + 6) }]}>
              <TextInput
                style={styles.chatTextInput}
                placeholder="Type a message to everyone..."
                placeholderTextColor="#8E8A80"
                value={chatInput}
                onChangeText={setChatInput}
                onSubmitEditing={handleSendChat}
                returnKeyType="send"
              />
              <TouchableOpacity
                style={[styles.chatSendBtn, !chatInput.trim() && styles.chatSendBtnDisabled]}
                onPress={handleSendChat}
                disabled={!chatInput.trim()}
              >
                <Text style={styles.chatSendText}>Send</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Participants Drawer Modal */}
      <Modal visible={showParticipants} animationType="slide" transparent onRequestClose={() => setShowParticipants(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdropTouch}
            activeOpacity={1}
            onPress={() => setShowParticipants(false)}
          />
          <View style={[styles.modalContainer, isShortHeight && styles.modalContainerShort]}>
            <View style={styles.sheetDragHandle} />

            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Users size={18} color="#FFC93C" />
                <Text style={styles.modalTitle}>Participants ({participantsCount})</Text>
              </View>
              <TouchableOpacity onPress={() => setShowParticipants(false)} style={styles.closeBtn}>
                <X size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.participantsList}>
              {/* Local Participant */}
              <View style={styles.participantRow}>
                <ProfileAvatar
                  size={40}
                  avatarId={localUser?.avatarId}
                  avatarUrl={localUser?.avatarUrl}
                  name={displayName}
                  seed={displayName}
                  borderWidth={1.5}
                  borderColor="#7444E8"
                />
                <View style={styles.participantInfo}>
                  <Text style={styles.participantNameText}>
                    {displayName} (You)
                  </Text>
                  <Text style={styles.participantRoleText}>{isHost ? 'Host' : 'Participant'}</Text>
                </View>
                <View style={styles.participantStatusIcons}>
                  {micMuted ? <MicOff size={16} color="#E53E3E" /> : <Mic size={16} color="#2DBE74" />}
                  {cameraOff ? <VideoOff size={16} color="#E53E3E" /> : <Video size={16} color="#2DBE74" />}
                </View>
              </View>

              {/* Remote Participants */}
              {remoteParticipantsList.map((rp) => {
                const isMuted = !rp.getTrackPublication(Track.Source.Microphone) || rp.getTrackPublication(Track.Source.Microphone)?.isMuted;
                const isCamOff = !rp.getTrackPublication(Track.Source.Camera) || rp.getTrackPublication(Track.Source.Camera)?.isMuted;
                const pName = rp.name || rp.identity;

                return (
                  <View key={rp.identity} style={styles.participantRow}>
                    <ProfileAvatar
                      size={40}
                      name={pName}
                      seed={rp.identity || pName}
                      borderWidth={1.5}
                      borderColor="#FFC93C"
                    />
                    <View style={styles.participantInfo}>
                      <Text style={styles.participantNameText}>{pName}</Text>
                      <Text style={styles.participantRoleText}>Participant</Text>
                    </View>
                    <View style={styles.participantStatusIcons}>
                      {isMuted ? <MicOff size={16} color="#E53E3E" /> : <Mic size={16} color="#2DBE74" />}
                      {isCamOff ? <VideoOff size={16} color="#E53E3E" /> : <Video size={16} color="#2DBE74" />}
                      {isHost && (
                        <TouchableOpacity
                          style={styles.hostActionBtn}
                          onPress={() => handleMuteParticipant(rp.identity)}
                        >
                          <Text style={styles.hostActionText}>Mute</Text>
                        </TouchableOpacity>
                      )}
                      {isHost && (
                        <TouchableOpacity
                          style={[styles.hostActionBtn, styles.hostRemoveBtn]}
                          onPress={() => handleRemoveParticipant(rp.identity)}
                        >
                          <Text style={styles.hostRemoveText}>Remove</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Media Diagnostics Modal (Scoped strictly to development debugging) */}
      {Boolean(__DEV__) && (
        <Modal visible={showDiagnostics} animationType="slide" transparent onRequestClose={() => setShowDiagnostics(false)}>
        <SafeAreaView style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Activity size={18} color="#7444E8" />
                <Text style={styles.modalTitle}>Media Pipeline Diagnostics</Text>
              </View>
              <TouchableOpacity onPress={() => setShowDiagnostics(false)} style={styles.closeBtn}>
                <X size={18} color="#17151F" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.diagnosticsList} contentContainerStyle={{ padding: 16 }}>
              <View style={styles.diagCard}>
                <Text style={styles.diagCardTitle}>Room State</Text>
                <Text style={styles.diagLine}>Code: {roomCode.toUpperCase()}</Text>
                <Text style={styles.diagLine}>Connection: {connectionState}</Text>
                <Text style={styles.diagLine}>Audio Route: {audioRoute}</Text>
                <Text style={styles.diagLine}>Participants: {participantsCount}</Text>
                <Text style={styles.diagLine}>Local Cam: {cameraOff ? 'Off' : 'Active'}</Text>
                <Text style={styles.diagLine}>Local Mic: {micMuted ? 'Muted' : 'Active'}</Text>
                <Text style={styles.diagLine}>Screen Share: {isScreenSharing ? 'Active' : 'Off'}</Text>
              </View>

              {/* WebRTC Realtime Telemetry & Bitrate */}
              <View style={styles.diagCard}>
                <Text style={styles.diagCardTitle}>Realtime WebRTC Telemetry</Text>
                <Text style={styles.diagLine}>
                  Throughput: {telemetrySnapshot?.totalBitrateKbps || 0} kbps (In: {telemetrySnapshot?.inboundBitrateKbps || 0} | Out: {telemetrySnapshot?.outboundBitrateKbps || 0})
                </Text>
                <Text style={styles.diagLine}>
                  Round Trip Time (RTT): {telemetrySnapshot?.rttMs ? `${telemetrySnapshot.rttMs} ms` : 'N/A'}
                </Text>
                <Text style={styles.diagLine}>
                  Jitter / Packet Loss: {telemetrySnapshot?.jitterMs ? `${telemetrySnapshot.jitterMs} ms` : '0 ms'} / {telemetrySnapshot?.packetsLost || 0} lost
                </Text>
                <Text style={styles.diagLine}>
                  FPS: In {telemetrySnapshot?.inboundFps ?? 'N/A'} | Out {telemetrySnapshot?.outboundFps ?? 'N/A'}
                </Text>
                <Text style={styles.diagLine}>
                  Resolution: In {telemetrySnapshot?.inboundResolution ? `${telemetrySnapshot.inboundResolution.width}x${telemetrySnapshot.inboundResolution.height}` : 'N/A'} | Out {telemetrySnapshot?.outboundResolution ? `${telemetrySnapshot.outboundResolution.width}x${telemetrySnapshot.outboundResolution.height}` : 'N/A'}
                </Text>
                <Text style={styles.diagLine}>
                  ICE Route: {telemetrySnapshot?.candidateType || 'unknown'} {telemetrySnapshot?.isRelayed ? '(TURN Relayed)' : '(Direct P2P/Host)'}
                </Text>
              </View>

              <View style={styles.diagCard}>
                <Text style={styles.diagCardTitle}>Remote Track Subscriptions</Text>
                {remoteParticipantsArray.length === 0 ? (
                  <Text style={styles.diagEmpty}>No remote participants connected.</Text>
                ) : (
                  remoteParticipantsArray.map(({ participant, videoTrack, isCameraMuted, isMicMuted }) => (
                    <View key={participant.identity} style={{ marginBottom: 8 }}>
                      <Text style={styles.diagParticipantHeader}>
                        {participant.name || participant.identity}
                      </Text>
                      <Text style={styles.diagSubLine}>
                        • Video Track: {videoTrack ? `Rendered (muted: ${isCameraMuted})` : 'Not Available / Cam Off'}
                      </Text>
                      <Text style={styles.diagSubLine}>
                        • Audio: {isMicMuted ? 'Muted' : 'Active'}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.diagCard}>
                <Text style={styles.diagCardTitle}>Recent Lifecycle Events</Text>
                {diagnosticEvents.length === 0 ? (
                  <Text style={styles.diagEmpty}>No diagnostic events captured.</Text>
                ) : (
                  diagnosticEvents.slice().reverse().map((ev, i) => (
                    <View key={i} style={styles.diagEventRow}>
                      <Text style={styles.diagEventTime}>
                        {new Date(ev.epochMs).toLocaleTimeString()} [{ev.category}]
                      </Text>
                      <Text style={styles.diagEventName}>{ev.event}</Text>
                      {ev.trackSid && <Text style={styles.diagEventMeta}>sid: {ev.trackSid}</Text>}
                      {ev.error && <Text style={styles.diagEventErr}>err: {ev.error}</Text>}
                    </View>
                  ))
                )}
              </View>

              <TouchableOpacity
                style={styles.exportDiagBtn}
                onPress={handleExportDiagnostics}
                accessibilityRole="button"
                accessibilityLabel="Export sanitized diagnostics report"
              >
                <Share2 size={16} color="#FFFFFF" />
                <Text style={styles.exportDiagBtnText}>Share / Export Sanitized Diagnostics</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0C13',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(23, 21, 31, 0.94)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    zIndex: 50,
  },
  topBarCompact: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  roomInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(229, 62, 62, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E53E3E',
  },
  liveDotConnecting: {
    backgroundColor: '#FFC93C',
  },
  liveText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FF6B6B',
    letterSpacing: 0.5,
  },
  roomCodeText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  roomCodeTextCompact: {
    fontSize: 13,
  },
  topRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 19,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  // WhatsApp-Inspired Right-Side Floating Quick Action Stack
  rightQuickActions: {
    position: 'absolute',
    right: 14,
    top: '32%',
    zIndex: 60,
    flexDirection: 'column',
    gap: 12,
    alignItems: 'center',
  },
  rightQuickActionsCompact: {
    right: 10,
    gap: 10,
  },
  quickActionBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(23, 21, 31, 0.72)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  quickActionBtnHandActive: {
    backgroundColor: '#FFC93C',
    borderColor: '#FFE082',
  },
  quickActionUnreadBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FFC93C',
    borderRadius: 9999,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#17151F',
  },
  quickActionUnreadText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#17151F',
  },
  stage: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#0D0C13',
  },
  centerCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  connectingText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 16,
  },
  connectingSubtext: {
    fontSize: 13,
    color: '#8E8A80',
    marginTop: 6,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#E53E3E',
  },
  errorDesc: {
    fontSize: 13,
    color: '#CCCCCC',
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 300,
    lineHeight: 18,
  },
  errorLeaveBtn: {
    marginTop: 20,
    backgroundColor: '#E53E3E',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 9999,
  },
  errorLeaveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  stageGrid: {
    flex: 1,
    position: 'relative',
  },
  screenShareContainer: {
    flex: 1,
    backgroundColor: '#000000',
    position: 'relative',
  },
  screenShareBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  screenShareBadgeText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  soloContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  soloAvatarWrapper: {
    marginBottom: 16,
    padding: 8,
    borderRadius: 9999,
    backgroundColor: 'rgba(116, 68, 232, 0.15)',
    borderWidth: 2,
    borderColor: 'rgba(116, 68, 232, 0.35)',
  },
  soloTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  soloSubtitle: {
    fontSize: 13,
    color: '#8E8A80',
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
    lineHeight: 19,
  },
  soloInviteBtn: {
    marginTop: 22,
    backgroundColor: '#FFC93C',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 9999,
    shadowColor: '#FFC93C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  soloInviteBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#17151F',
  },
  remoteGridContainer: {
    flex: 1,
    padding: 6,
  },
  remoteGridTwoHorizontal: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  remoteGridTwoVertical: {
    flexDirection: 'column',
  },
  remoteGridMulti: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  remoteTile: {
    flex: 1,
    backgroundColor: '#1E1B29',
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: 180,
    margin: 4,
  },
  remoteTileTwoHorizontal: {
    minWidth: '47%',
    flex: 1,
  },
  remoteTileTwoVertical: {
    minWidth: '100%',
    flex: 1,
    minHeight: 140,
  },
  remoteTileMulti: {
    minWidth: '47%',
    maxHeight: '48%',
    flex: 1,
  },
  activeSpeakerTile: {
    borderColor: '#FFC93C',
  },
  remoteAvatarContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#161421',
  },
  remoteCameraOffText: {
    fontSize: 12,
    color: '#8E8A80',
    fontWeight: '600',
    marginTop: 8,
  },
  participantTag: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    maxWidth: '85%',
  },
  participantTagName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  handBadge: {
    backgroundColor: '#FFC93C',
    borderRadius: 4,
    padding: 2,
  },
  // Floating PiP with Smart Two-Tap Interaction
  localPip: {
    position: 'absolute',
    bottom: 84,
    right: 14,
    borderRadius: 16,
    backgroundColor: '#1E1B29',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 55,
  },
  localPipFocused: {
    borderColor: '#FFC93C',
    borderWidth: 2.5,
    shadowColor: '#FFC93C',
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 12,
  },
  pipFocusBadge: {
    position: 'absolute',
    top: 5,
    left: 6,
    right: 6,
    backgroundColor: 'rgba(255, 201, 60, 0.95)',
    borderRadius: 5,
    paddingVertical: 2,
    zIndex: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipFocusBadgeText: {
    fontSize: 8.5,
    fontWeight: '900',
    color: '#17151F',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  pipFlipBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  pipAvatarContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E1B29',
    padding: 4,
  },
  pipCameraOffText: {
    fontSize: 9,
    color: '#8E8A80',
    fontWeight: '700',
    marginTop: 4,
  },
  localTag: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  localTagName: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  // Main Stage
  immersiveMainStage: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#0D0C13',
    position: 'relative',
    overflow: 'hidden',
  },
  stageAvatarContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121118',
  },
  avatarHaloRing: {
    padding: 10,
    borderRadius: 9999,
    backgroundColor: 'rgba(116, 68, 232, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(116, 68, 232, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7444E8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
  cameraOffPill: {
    marginTop: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cameraOffPillText: {
    fontSize: 12,
    color: '#C7C4BE',
    fontWeight: '700',
  },
  // Bottom Floating Control Dock
  controlsBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(23, 21, 31, 0.94)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    gap: 12,
    zIndex: 40,
  },
  controlsBarCompact: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 10,
  },
  controlsBarVeryNarrow: {
    paddingHorizontal: 5,
    gap: 6,
  },
  hiddenBar: {
    display: 'none',
  },
  controlBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  controlBtnDanger: {
    backgroundColor: '#E53E3E',
    borderColor: '#FF6B6B',
  },
  controlBtnDisabled: {
    backgroundColor: '#33303E',
  },
  controlBtnActiveRoute: {
    backgroundColor: 'rgba(116, 68, 232, 0.3)',
    borderColor: '#7444E8',
  },
  controlBtnActiveMore: {
    backgroundColor: 'rgba(255, 201, 60, 0.25)',
    borderColor: '#FFC93C',
  },
  controlBtnActiveShare: {
    backgroundColor: '#FFC93C',
    borderColor: '#FFE082',
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E53E3E',
    paddingHorizontal: 18,
    height: 48,
    borderRadius: 24,
    shadowColor: '#E53E3E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  leaveBtnCompact: {
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 23,
  },
  leaveBtnVeryNarrow: {
    paddingHorizontal: 10,
    gap: 4,
  },
  leaveBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  // Floating Reaction Bubbles Overlay
  reactionsOverlay: {
    position: 'absolute',
    bottom: 96,
    left: 20,
    right: 20,
    alignItems: 'flex-start',
    gap: 8,
    zIndex: 100,
  },
  floatingReactionBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(23, 21, 31, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  floatingReactionEmoji: {
    fontSize: 22,
  },
  floatingReactionSender: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reactionModalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  reactionPickerBubble: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(27, 25, 38, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 24,
    marginBottom: 84,
    borderRadius: 28,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  reactionPickerBubbleShort: {
    marginBottom: 60,
    paddingVertical: 8,
  },
  emojiPickBtn: {
    padding: 6,
  },
  emojiPickText: {
    fontSize: 28,
  },
  // Rebuilt Compact Meeting Actions Sheet
  moreActionsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  moreActionsContainer: {
    backgroundColor: '#1B1926',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingBottom: 26,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  moreActionsContainerShort: {
    maxHeight: '90%',
    paddingBottom: 16,
  },
  sheetDragHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  moreActionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 16,
  },
  moreActionsTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  moreActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  moreActionItem: {
    width: '31%',
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  moreActionItemDisabled: {
    opacity: 0.4,
  },
  moreActionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  moreActionIconCircleDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  moreActionIconActiveShare: {
    backgroundColor: '#FFC93C',
    borderColor: '#FFE082',
  },
  moreActionIconActiveRoute: {
    backgroundColor: 'rgba(116, 68, 232, 0.3)',
    borderColor: '#7444E8',
  },
  moreActionIconLocked: {
    backgroundColor: 'rgba(229, 62, 62, 0.25)',
    borderColor: '#E53E3E',
  },
  moreActionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  moreActionSublabel: {
    fontSize: 10,
    color: '#8E8A80',
    marginTop: 2,
    fontWeight: '600',
  },
  // Dark Modal Drawers (Chat & Participants)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalBackdropTouch: {
    flex: 1,
  },
  modalContainer: {
    backgroundColor: '#1B1926',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    maxHeight: '82%',
    minHeight: '52%',
    overflow: 'hidden',
    paddingTop: 10,
  },
  modalContainerShort: {
    minHeight: 120,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: '#1B1926',
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  closeBtn: {
    padding: 6,
  },
  // In-Meeting Chat
  chatList: {
    flex: 1,
  },
  chatListContent: {
    padding: 16,
    gap: 12,
  },
  emptyChatBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  chatEmptyText: {
    fontSize: 13,
    color: '#8E8A80',
    textAlign: 'center',
    maxWidth: 240,
    lineHeight: 18,
  },
  chatBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    maxWidth: '82%',
  },
  chatBubbleSelf: {
    alignSelf: 'flex-end',
    backgroundColor: '#7444E8',
    borderBottomRightRadius: 4,
  },
  chatBubbleRemote: {
    alignSelf: 'flex-start',
    backgroundColor: '#272436',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  chatSenderText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFC93C',
    marginBottom: 3,
  },
  chatTextSelf: {
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 19,
  },
  chatTextRemote: {
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 19,
  },
  chatMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
  chatTimeText: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  chatStatusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFC93C',
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: '#1B1926',
  },
  chatTextInput: {
    flex: 1,
    backgroundColor: '#272436',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 9999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: '#FFFFFF',
    minHeight: 44,
  },
  chatSendBtn: {
    backgroundColor: '#7444E8',
    paddingHorizontal: 18,
    height: 44,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSendBtnDisabled: {
    opacity: 0.4,
  },
  chatSendText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  // Participants Drawer
  participantsList: {
    flex: 1,
    padding: 16,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    gap: 12,
  },
  participantInfo: {
    flex: 1,
  },
  participantNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  participantRoleText: {
    fontSize: 12,
    color: '#8E8A80',
    marginTop: 2,
  },
  participantStatusIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hostActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(116, 68, 232, 0.25)',
  },
  hostActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A78BFA',
  },
  hostRemoveBtn: {
    backgroundColor: 'rgba(229, 62, 62, 0.25)',
  },
  hostRemoveText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FF6B6B',
  },
  // Diagnostics
  diagnosticsList: {
    flex: 1,
  },
  diagCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EBE8DF',
  },
  diagCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#7444E8',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  diagLine: {
    fontSize: 12,
    color: '#17151F',
    marginBottom: 3,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  diagEmpty: {
    fontSize: 12,
    color: '#8E8A80',
    fontStyle: 'italic',
  },
  diagParticipantHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#17151F',
  },
  diagSubLine: {
    fontSize: 11,
    color: '#555555',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  diagEventRow: {
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0EDE3',
  },
  diagEventTime: {
    fontSize: 10,
    color: '#8E8A80',
  },
  diagEventName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#17151F',
  },
  diagEventMeta: {
    fontSize: 10,
    color: '#666666',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  diagEventErr: {
    fontSize: 10,
    color: '#E53E3E',
    fontWeight: '700',
  },
  exportDiagBtn: {
    backgroundColor: '#7444E8',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 24,
  },
  exportDiagBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
});
