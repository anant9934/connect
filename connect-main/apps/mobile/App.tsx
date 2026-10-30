import './src/polyfills';
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Linking, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { registerGlobals } from '@livekit/react-native';
import { LandingScreen } from './src/screens/LandingScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { PrejoinScreen } from './src/screens/PrejoinScreen';
import { MeetingScreen } from './src/screens/MeetingScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ProfileSheet } from './src/components/profile/ProfileSheet';
import { secureStorage } from './src/services/storage';
import { defaultApiClient, MobileAuthUser } from './src/services/apiClient';

// Register LiveKit Native WebRTC and Audio modules globally
registerGlobals();

type AppNavScreen = 'landing' | 'signin' | 'prejoin' | 'meeting' | 'settings';

interface ActiveMeetingParams {
  roomCode: string;
  token: string;
  livekitUrl: string;
  displayName: string;
  initialMic?: boolean;
  initialCamera?: boolean;
  cameraFacing?: 'front' | 'back';
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<AppNavScreen>('landing');
  const [currentUser, setCurrentUser] = useState<MobileAuthUser | null>(null);
  const [showProfileSheet, setShowProfileSheet] = useState<boolean>(false);
  const [selectedRoomCode, setSelectedRoomCode] = useState<string>('');
  const [activeMeeting, setActiveMeeting] = useState<ActiveMeetingParams | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<'create_meeting' | null>(null);

  // Restore authenticated session on startup with authoritative backend sync
  useEffect(() => {
    let active = true;
    async function restoreSession() {
      const { token, user } = await secureStorage.getSession();
      if (token) {
        defaultApiClient.setAuthToken(token);
        if (active && user) {
          setCurrentUser(user);
        }
        // Fetch server-authoritative profile data
        try {
          const res = await defaultApiClient.getProfile();
          if (active && res?.profile) {
            setCurrentUser(res.profile);
            await secureStorage.saveUser(res.profile);
          }
        } catch (_) {
          // If offline or network unavailable, continue with valid cached session
        }
      }
    }
    restoreSession();
    return () => {
      active = false;
    };
  }, []);

  // Handle Android Deep Linking (meet://room/:code, connect://room/:code, https://connect.aitathastu.com/room/:code)
  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      const url = event.url;
      if (!url) return;

      const roomMatch =
        url.match(/room\/([a-zA-Z0-9-]+)/i) ||
        url.match(/meet:\/\/([a-zA-Z0-9-]+)/i) ||
        url.match(/connect:\/\/([a-zA-Z0-9-]+)/i);
      if (roomMatch && roomMatch[1]) {
        setSelectedRoomCode(roomMatch[1]);
        setCurrentScreen('prejoin');
      }
    };

    Linking.getInitialURL().then((url: string | null) => {
      if (url) handleUrl({ url });
    });

    const subscription = Linking.addEventListener('url', handleUrl);
    return () => subscription.remove();
  }, []);

  // Real room creation with backend authentication check
  const handleStartMeeting = async () => {
    setIsCreatingRoom(true);
    try {
      const token = defaultApiClient.getAuthToken();
      if (!token) {
        // User needs to be authenticated to create rooms on the backend
        setPendingAction('create_meeting');
        setCurrentScreen('signin');
        setIsCreatingRoom(false);
        return;
      }
      const res = await defaultApiClient.createRoom(50, false);
      if (res?.room?.publicCode) {
        setSelectedRoomCode(res.room.publicCode);
        setCurrentScreen('prejoin');
      } else {
        throw new Error('Room created but public code was not returned.');
      }
    } catch {
      // If unauthenticated or token expired, redirect to sign in and resume
      setPendingAction('create_meeting');
      setCurrentScreen('signin');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleAuthSuccess = async () => {
    const session = await secureStorage.getSession();
    if (session?.user) {
      setCurrentUser(session.user);
    }

    if (pendingAction === 'create_meeting') {
      setPendingAction(null);
      setIsCreatingRoom(true);
      try {
        const res = await defaultApiClient.createRoom(50, false);
        if (res?.room?.publicCode) {
          setSelectedRoomCode(res.room.publicCode);
          setCurrentScreen('prejoin');
          setIsCreatingRoom(false);
          return;
        }
      } catch (_) {}
      setIsCreatingRoom(false);
    }
    setCurrentScreen('landing');
  };

  const handleSignOut = async () => {
    try {
      await defaultApiClient.logout();
    } catch (_) {}
    await secureStorage.clearSession();
    setCurrentUser(null);
    setShowProfileSheet(false);
    setCurrentScreen('landing');
  };

  const handleJoinByCode = (code: string) => {
    setSelectedRoomCode(code);
    setCurrentScreen('prejoin');
  };

  const handleUpdateName = async (newName: string) => {
    if (!currentUser) return;
    await defaultApiClient.updateProfile({ displayName: newName });
    const updated = { ...currentUser, displayName: newName };
    setCurrentUser(updated);
    await secureStorage.saveUser(updated);
  };

  const handleUpdateAvatar = async (params: { avatarId?: string; avatarUrl?: string }) => {
    if (!currentUser) return;
    await defaultApiClient.updateProfile(params);
    const updated = {
      ...currentUser,
      avatarId: params.avatarId !== undefined ? params.avatarId : currentUser.avatarId,
      avatarUrl: params.avatarUrl !== undefined ? params.avatarUrl : currentUser.avatarUrl,
    };
    setCurrentUser(updated);
    await secureStorage.saveUser(updated);
  };

  return (
    <SafeAreaProvider style={styles.root}>
      <StatusBar barStyle={currentScreen === 'meeting' ? 'light-content' : 'dark-content'} />

      {currentScreen === 'landing' && (
        <>
          <LandingScreen
            user={currentUser}
            onStartMeeting={handleStartMeeting}
            onSignIn={() => {
              setIsCreatingRoom(false);
              setCurrentScreen('signin');
            }}
            onSignOut={handleSignOut}
            onJoinCode={handleJoinByCode}
            onOpenProfile={() => setShowProfileSheet(true)}
            isCreating={isCreatingRoom}
          />

          <ProfileSheet
            visible={showProfileSheet}
            user={currentUser}
            onClose={() => setShowProfileSheet(false)}
            onNavigateSettings={() => {
              setShowProfileSheet(false);
              setCurrentScreen('settings');
            }}
            onUpdateName={handleUpdateName}
            onUpdateAvatar={handleUpdateAvatar}
            onSignOut={handleSignOut}
          />
        </>
      )}

      {currentScreen === 'settings' && (
        <SettingsScreen
          user={currentUser}
          onBack={() => setCurrentScreen('landing')}
          onUpdateUser={(updated) => setCurrentUser(updated)}
        />
      )}

      {currentScreen === 'signin' && (
        <SignInScreen
          onSuccess={handleAuthSuccess}
          onBack={() => {
            setPendingAction(null);
            setIsCreatingRoom(false);
            setCurrentScreen('landing');
          }}
        />
      )}

      {currentScreen === 'prejoin' && (
        <PrejoinScreen
          roomCode={selectedRoomCode}
          onJoinSuccess={(params) => {
            setActiveMeeting(params);
            setCurrentScreen('meeting');
          }}
          onBack={() => setCurrentScreen('landing')}
        />
      )}

      {currentScreen === 'meeting' && activeMeeting && (
        <MeetingScreen
          roomCode={activeMeeting.roomCode}
          token={activeMeeting.token}
          livekitUrl={activeMeeting.livekitUrl}
          displayName={activeMeeting.displayName}
          initialMic={activeMeeting.initialMic}
          initialCamera={activeMeeting.initialCamera}
          cameraFacing={activeMeeting.cameraFacing}
          onLeave={() => {
            setActiveMeeting(null);
            setCurrentScreen('landing');
          }}
        />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});
