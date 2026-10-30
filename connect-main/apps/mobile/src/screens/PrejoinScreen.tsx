import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { useWindowDimensions } from '../hooks/useWindowDimensions';
import { CameraView } from 'expo-camera';
import { defaultApiClient } from '../services/apiClient';
import { secureStorage } from '../services/storage';
import {
  checkCameraPermission,
  checkMicrophonePermission,
  requestCameraPermission,
  requestMicrophonePermission,
} from '../permissions/androidPermissions';
import { Mic, MicOff, Video, VideoOff, RefreshCw } from '../design-system/icons';
import { mediaDiagnostics } from '../services/mediaDiagnostics';

interface PrejoinScreenProps {
  roomCode: string;
  onJoinSuccess: (params: {
    roomCode: string;
    token: string;
    livekitUrl: string;
    displayName: string;
    initialMic: boolean;
    initialCamera: boolean;
    cameraFacing: 'front' | 'back';
  }) => void;
  onBack: () => void;
}

export function PrejoinScreen({ roomCode, onJoinSuccess, onBack }: PrejoinScreenProps) {
  const { width, height, isCompact, isTablet, isLandscape, isShortHeight, safeInsets } = useWindowDimensions();
  const useTwoColumn = isLandscape && ((width >= 640 && height >= 480) || isTablet);

  const safeLeft = safeInsets?.left || 0;
  const safeRight = safeInsets?.right || 0;
  const horizontalPadding = isCompact ? 12 : 20;
  const usableWidth = width - safeLeft - safeRight - (horizontalPadding * 2);
  const containerMaxWidth = useTwoColumn ? Math.min(usableWidth, 920) : Math.min(usableWidth, 480);



  const [displayName, setDisplayName] = useState('');
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomStatus, setRoomStatus] = useState<string>('Checking...');
  const [isRoomAvailable, setIsRoomAvailable] = useState<boolean>(true);

  // Check room status & restore saved session
  useEffect(() => {
    let active = true;
    async function loadInitial() {
      // Restore user name
      const { user } = await secureStorage.getSession();
      if (active && user?.displayName) {
        setDisplayName(user.displayName);
      }

      // Restore media preferences
      const prefs = await secureStorage.getPreferences();
      if (active) {
        if (prefs.defaultMicOn !== undefined) setMicEnabled(prefs.defaultMicOn);
        if (prefs.defaultCameraOn !== undefined) setCameraEnabled(prefs.defaultCameraOn);
        if (prefs.preferredCameraFacing) setCameraFacing(prefs.preferredCameraFacing);
      }

      // Check permissions
      const [cam, mic] = await Promise.all([
        checkCameraPermission(),
        checkMicrophonePermission(),
      ]);
      if (active) {
        setHasCameraPermission(cam);
        setHasMicPermission(mic);
      }

      // Verify room existence with accurate backend response (no false positives)
      if (roomCode) {
        try {
          mediaDiagnostics.log('room', 'PrejoinRoomCheck', { details: { roomCode } });
          const res = await defaultApiClient.getRoom(roomCode);
          if (active) {
            if (res.room.status === 'ended') {
              setRoomStatus('Ended');
              setIsRoomAvailable(false);
              setError('This meeting room has ended.');
            } else if (res.room.isLocked) {
              setRoomStatus('Locked');
              setIsRoomAvailable(true);
            } else {
              setRoomStatus('Ready to join');
              setIsRoomAvailable(true);
            }
          }
        } catch (err: any) {
          if (active) {
            setRoomStatus('Unavailable');
            setIsRoomAvailable(false);
            setError('Meeting room not found or unavailable. Please verify the code.');
            mediaDiagnostics.log('room', 'PrejoinRoomCheckFailed', {
              error: err?.message || 'Room check failed',
            });
          }
        }
      }
    }

    loadInitial();
    return () => {
      active = false;
    };
  }, [roomCode]);

  const handleToggleCamera = async () => {
    if (!cameraEnabled) {
      if (!hasCameraPermission) {
        const granted = await requestCameraPermission();
        setHasCameraPermission(granted);
        if (!granted) {
          setError('Camera permission is required to enable video preview.');
          return;
        }
      }
      setCameraEnabled(true);
    } else {
      setCameraEnabled(false);
    }
  };

  const handleToggleMic = async () => {
    if (!micEnabled) {
      if (!hasMicPermission) {
        const granted = await requestMicrophonePermission();
        setHasMicPermission(granted);
        if (!granted) {
          setError('Microphone permission is required to transmit audio.');
          return;
        }
      }
      setMicEnabled(true);
    } else {
      setMicEnabled(false);
    }
  };

  const handleFlipCamera = () => {
    setCameraFacing((f) => (f === 'front' ? 'back' : 'front'));
  };

  const handleJoin = async () => {
    if (!isRoomAvailable) {
      setError('Cannot join an unavailable or ended room.');
      return;
    }

    const name = displayName.trim() || 'Mobile Participant';

    setLoading(true);
    setError(null);
    setIsTransitioning(true);

    // Save preferences
    await secureStorage.savePreferences({
      defaultMicOn: micEnabled,
      defaultCameraOn: cameraEnabled,
      preferredCameraFacing: cameraFacing,
    });

    // Explicitly unmount native expo-camera session and yield to allow Android Camera2 release
    mediaDiagnostics.log('media', 'PrejoinCameraReleaseInitiated');
    await new Promise((r) => setTimeout(r, 200));

    try {
      // Step 1: Register participant and obtain room-scoped guest credential
      mediaDiagnostics.log('room', 'JoinRoomRequest', { details: { roomCode, name } });
      const joinRes = await defaultApiClient.joinRoom(roomCode, name);

      // Step 2: Request LiveKit access token with registered identity and guest token
      const participantIdentity = joinRes.participant?.identity;
      const res = await defaultApiClient.getRoomToken(
        roomCode,
        participantIdentity,
        name,
        joinRes.guestToken
      );

      if (!res.token) {
        throw new Error('Access token was not returned by server.');
      }

      mediaDiagnostics.log('room', 'JoinTokenAcquired', {
        participantIdentity,
        details: { livekitUrl: res.livekitUrl },
      });

      onJoinSuccess({
        roomCode,
        token: res.token,
        livekitUrl: res.livekitUrl || 'wss://tathastu-connect-htzr4167.livekit.cloud',
        displayName: name,
        initialMic: micEnabled,
        initialCamera: cameraEnabled,
        cameraFacing,
      });
    } catch (err: any) {
      setIsTransitioning(false);
      setError(err?.message || 'Could not join room. Please check the code.');
      mediaDiagnostics.log('room', 'JoinRoomError', { error: err?.message || String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <View style={styles.topBarInner}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn} accessibilityRole="button">
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Pre-join Setup</Text>
          <View style={{ width: 60 }} />
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          isCompact && styles.scrollContentCompact,
          { paddingHorizontal: horizontalPadding },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.mainWrapper,
            { maxWidth: containerMaxWidth },
            useTwoColumn ? styles.mainWrapperLandscape : (isTablet ? styles.mainWrapperTabletPortrait : (isCompact ? styles.mainWrapperCompact : undefined)),
          ]}
        >

          {/* Room info header badge */}
          <View style={[styles.badgeRow, isCompact && styles.badgeRowCompact]}>
            <View style={[styles.roomBadge, isCompact && styles.roomBadgeCompact]}>
              <Text style={[styles.roomBadgeText, isCompact && styles.roomBadgeTextCompact]} numberOfLines={1} ellipsizeMode="middle">
                ROOM: {roomCode ? roomCode.toUpperCase() : 'INSTANT'}
              </Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                isCompact && styles.statusBadgeCompact,
                !isRoomAvailable && styles.statusBadgeUnavailable,
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  !isRoomAvailable && styles.statusDotUnavailable,
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  isCompact && styles.statusTextCompact,
                  !isRoomAvailable && styles.statusTextUnavailable,
                ]}
                numberOfLines={1}
              >
                {roomStatus}
              </Text>
            </View>
          </View>

          {/* Dynamic layout: 2-column for landscape, stacked centered for portrait */}
          <View style={[styles.compositionRow, useTwoColumn && styles.compositionRowTwoColumn]}>
            {/* Camera Preview */}
            <View
              style={[
                styles.previewCol,
                useTwoColumn && styles.previewColTwoColumn,
                isTablet && !useTwoColumn && styles.previewColTabletPortrait,
              ]}
            >
              <View
                style={[
                  styles.videoPreview,
                  isCompact && styles.videoPreviewCompact,
                  isLandscape && !isTablet && styles.videoPreviewLandscapePhone,
                  isTablet && !useTwoColumn && styles.videoPreviewTabletPortrait,
                ]}
              >
                {cameraEnabled && hasCameraPermission && !isTransitioning ? (
                  <CameraView
                    style={StyleSheet.absoluteFill}
                    facing={cameraFacing}
                  />
                ) : (
                  <View style={styles.avatarFallback}>
                    <View style={[styles.avatarCircle, isCompact && styles.avatarCircleCompact]}>
                      <Text style={[styles.avatarLetter, isCompact && styles.avatarLetterCompact]}>
                        {displayName.trim() ? displayName.trim().charAt(0).toUpperCase() : 'M'}
                      </Text>
                    </View>
                    <Text style={styles.cameraStatus}>
                      {isTransitioning
                        ? 'Preparing room media...'
                        : cameraEnabled && !hasCameraPermission
                        ? 'Camera Permission Needed'
                        : 'Camera is Off'}
                    </Text>
                  </View>
                )}

                {/* Quick Toggle Overlays */}
                {!isTransitioning && (
                  <View style={[styles.previewControls, isCompact && styles.previewControlsCompact]}>
                    <TouchableOpacity
                      style={[styles.mediaToggle, isCompact && styles.mediaToggleCompact, !micEnabled && styles.mediaToggleOff]}
                      onPress={handleToggleMic}
                      accessibilityRole="button"
                      accessibilityLabel={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
                    >
                      {micEnabled ? <Mic size={isCompact ? 14 : 16} color="#FFFFFF" /> : <MicOff size={isCompact ? 14 : 16} color="#FFFFFF" />}
                      <Text style={[styles.toggleText, isCompact && styles.toggleTextCompact]}>
                        {micEnabled ? 'Mic On' : 'Mic Off'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.mediaToggle, isCompact && styles.mediaToggleCompact, !cameraEnabled && styles.mediaToggleOff]}
                      onPress={handleToggleCamera}
                      accessibilityRole="button"
                      accessibilityLabel={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                    >
                      {cameraEnabled ? <Video size={isCompact ? 14 : 16} color="#FFFFFF" /> : <VideoOff size={isCompact ? 14 : 16} color="#FFFFFF" />}
                      <Text style={[styles.toggleText, isCompact && styles.toggleTextCompact]}>
                        {cameraEnabled ? 'Cam On' : 'Cam Off'}
                      </Text>
                    </TouchableOpacity>

                    {cameraEnabled && hasCameraPermission && (
                      <TouchableOpacity
                        style={[styles.mediaToggle, isCompact && styles.mediaToggleCompact]}
                        onPress={handleFlipCamera}
                        accessibilityRole="button"
                        accessibilityLabel="Flip camera"
                      >
                        <RefreshCw size={isCompact ? 14 : 16} color="#FFFFFF" />
                        <Text style={[styles.toggleText, isCompact && styles.toggleTextCompact]}>Flip</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>

            {/* Participant Setup Form */}
            <View
              style={[
                styles.formCol,
                isCompact && styles.formColCompact,
                useTwoColumn && styles.formColTwoColumn,
                isTablet && !useTwoColumn && styles.formColTabletPortrait,
              ]}
            >
              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Display Name Field */}
              <View style={[styles.nameGroup, isCompact && styles.nameGroupCompact]}>
                <Text style={styles.inputLabel}>Your display name</Text>
                <TextInput
                  style={[styles.nameInput, isCompact && styles.nameInputCompact]}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="e.g. Anant Sharma"
                  placeholderTextColor="#9C988D"
                  autoCapitalize="words"
                  editable={!loading && !isTransitioning}
                />
              </View>

              {/* Join Action */}
              <TouchableOpacity
                style={[
                  styles.joinBtn,
                  isCompact && styles.joinBtnCompact,
                  (!isRoomAvailable || loading || isTransitioning) && styles.btnDisabled,
                ]}
                onPress={handleJoin}
                disabled={!isRoomAvailable || loading || isTransitioning}
                accessibilityRole="button"
                accessibilityLabel="Join meeting room"
              >
                {loading || isTransitioning ? (
                  <View style={styles.joiningRow}>
                    <ActivityIndicator color="#17151F" />
                    <Text style={styles.joinBtnText}>
                      {isTransitioning ? 'Entering Room...' : 'Connecting...'}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.joinBtnText}>Join Room</Text>
                )}
              </TouchableOpacity>

              <Text style={styles.hintText}>
                You can adjust camera, microphone, and audio speaker anytime during the call.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF9FC',
  },
  topBar: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEE8',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  topBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
  },
  backBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  backText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#7444E8',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    paddingVertical: 20,

    paddingHorizontal: 16,
    alignItems: 'center',
    flexGrow: 1,
  },
  mainWrapper: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  mainWrapperTabletPortrait: {
    maxWidth: 640,
    paddingVertical: 16,
  },
  mainWrapperLandscape: {
    maxWidth: 960,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
    width: '100%',
  },
  roomBadge: {
    backgroundColor: '#F1EBFF',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 9999,
    maxWidth: '65%',
    flexShrink: 1,
  },
  roomBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5A2FC7',
    letterSpacing: 0.5,
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  statusBadge: {
    backgroundColor: '#E4F8EB',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  statusBadgeUnavailable: {
    backgroundColor: '#FFEAEA',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#2DBE74',
  },
  statusDotUnavailable: {
    backgroundColor: '#E53E3E',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F6B3B',
    fontFamily: Platform.select({ android: 'Inter-SemiBold', ios: 'System', default: 'sans-serif' }),
  },
  statusTextUnavailable: {
    color: '#C53030',
  },
  compositionRow: {
    gap: 24,
  },
  compositionRowTwoColumn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 28,
  },
  previewCol: {
    width: '100%',
  },
  previewColTabletPortrait: {
    width: '100%',
  },
  previewColTwoColumn: {
    flex: 1.25,
  },
  videoPreview: {
    width: '100%',
    backgroundColor: '#17151F',
    borderRadius: 24,
    aspectRatio: 16 / 10,
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 4,
  },
  videoPreviewTabletPortrait: {
    width: '100%',
    aspectRatio: 16 / 10,
    minHeight: 340,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#7444E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  avatarLetter: {
    fontSize: 34,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  cameraStatus: {
    fontSize: 14,
    color: '#E4E2DB',
    fontWeight: '600',
  },
  previewControls: {
    position: 'absolute',
    bottom: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignSelf: 'center',
    flexWrap: 'wrap',
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9999,
    maxWidth: '92%',
  },
  mediaToggle: {
    backgroundColor: 'rgba(23, 21, 31, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  mediaToggleOff: {
    backgroundColor: '#E53E3E',
    borderColor: '#E53E3E',
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  formCol: {
    width: '100%',
    maxWidth: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
    elevation: 2,
  },
  formColTabletPortrait: {
    padding: 28,
  },
  formColTwoColumn: {
    flex: 1,
    padding: 26,
  },
  errorBox: {
    backgroundColor: '#FFEAEA',
    borderWidth: 1,
    borderColor: '#FFC7C7',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#C53030',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    fontFamily: Platform.select({ android: 'Inter-Medium', ios: 'System', default: 'sans-serif' }),
  },
  nameGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#17151F',
    marginBottom: 8,
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  nameInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#17151F',
    minHeight: 50,
    fontFamily: Platform.select({ android: 'Inter-Regular', ios: 'System', default: 'sans-serif' }),
  },
  joinBtn: {
    backgroundColor: '#FFC93C',
    borderRadius: 9999,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FFC93C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 3,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  joiningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  joinBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  hintText: {
    fontSize: 12,
    color: '#8A857A',
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 18,
    fontFamily: Platform.select({ android: 'Inter-Regular', ios: 'System', default: 'sans-serif' }),
  },

  /* RESPONSIVE ADAPTIVE RULES FOR PHONES & LANDSCAPE */
  scrollContentCompact: {
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  mainWrapperCompact: {
    width: '100%',
  },

  badgeRowCompact: {
    marginBottom: 10,
    gap: 6,
  },
  roomBadgeCompact: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  roomBadgeTextCompact: {
    fontSize: 11,
  },
  statusBadgeCompact: {
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  statusTextCompact: {
    fontSize: 10,
  },
  videoPreviewCompact: {
    width: '100%',
    borderRadius: 18,
    minHeight: 180,
    maxHeight: 240,
  },
  videoPreviewLandscapePhone: {
    aspectRatio: 16 / 9,
    minHeight: 160,
    maxHeight: 260,
  },
  avatarCircleCompact: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: 6,
  },
  avatarLetterCompact: {
    fontSize: 24,
  },
  previewControlsCompact: {
    bottom: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 8,
    maxWidth: '96%',
  },
  mediaToggleCompact: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 3,
  },
  toggleTextCompact: {
    fontSize: 10,
  },
  formColCompact: {
    padding: 14,
    borderRadius: 18,
  },
  nameGroupCompact: {
    marginBottom: 10,
  },
  nameInputCompact: {
    minHeight: 44,
    paddingVertical: 8,
    fontSize: 14,
  },
  joinBtnCompact: {
    minHeight: 48,
  },
});
