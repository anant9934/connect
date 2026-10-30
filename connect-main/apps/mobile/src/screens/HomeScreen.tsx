import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useWindowDimensions } from '../hooks/useWindowDimensions';
import { defaultApiClient, MobileAuthUser } from '../services/apiClient';
import { secureStorage } from '../services/storage';

interface HomeScreenProps {
  onJoinRoom: (code: string) => void;
  onSignOut: () => void;
}

const ROOM_KINDS = [
  { name: 'Instant Meet', desc: 'A normal call, ready in one tap.', color: '#17151F', bg: '#F3F2EE', border: '#E9E7E1' },
  { name: 'Research Room', desc: 'Papers, notes and repo beside the call.', color: '#7444E8', bg: '#F1EBFF', border: '#E4DCFC' },
  { name: 'Project Room', desc: 'Milestones, tasks and live code sync.', color: '#1F6B3B', bg: '#E4F8EB', border: '#CDEED8' },
  { name: 'Mentor Session', desc: '1:1 feedback with structured recordings.', color: '#8A6D00', bg: '#FFF4D1', border: '#FBEAB4' },
  { name: 'Community Room', desc: 'Open discussion with breakout circles.', color: '#C53030', bg: '#FFE9E9', border: '#FBD2D2' },
];

export function HomeScreen({ onJoinRoom, onSignOut }: HomeScreenProps) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 600;

  const [user, setUser] = useState<MobileAuthUser | null>(null);
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function checkAuth() {
      const session = await secureStorage.getSession();
      if (active && session?.user) {
        setUser(session.user);
        if (session.token) {
          defaultApiClient.setAuthToken(session.token);
        }
      }
    }
    checkAuth();
    return () => { active = false; };
  }, []);

  const handleStartInstant = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await defaultApiClient.createRoom(50, false);
      if (res?.room?.publicCode) {
        onJoinRoom(res.room.publicCode);
      } else {
        throw new Error('Room created but code not returned.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not create room.');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinByCode = () => {
    let cleanCode = code.trim();
    if (!cleanCode) {
      setError('Please enter a valid room code.');
      return;
    }

    // Support pasted URLs like https://connect.aitathastu.com/room/abc-defg-hij
    const match = cleanCode.match(/room\/([a-zA-Z0-9-]+)/i) || cleanCode.match(/meet:\/\/([a-zA-Z0-9-]+)/i);
    if (match && match[1]) {
      cleanCode = match[1];
    }

    setError(null);
    onJoinRoom(cleanCode);
  };

  const handleSignOut = async () => {
    try {
      await defaultApiClient.logout();
    } catch (_) {}
    await secureStorage.clearSession();
    onSignOut();
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <View style={styles.brandRow}>
            <View style={styles.brandLogo}>
              <View style={styles.brandDot} />
            </View>
            <View>
              <Text style={styles.brandTitle}>Tathastu Meet</Text>
              {user?.displayName ? (
                <Text style={styles.userSubtitle}>{user.displayName}</Text>
              ) : null}
            </View>
          </View>
          <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn} accessibilityRole="button">
            <Text style={styles.signOutText}>{user ? 'Sign out' : 'Switch'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.mainWrapper, isTablet && styles.mainWrapperTablet]}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Action Cards Row (Side-by-side on tablet, stacked on phone) */}
          <View style={[styles.actionsRow, isTablet && styles.actionsRowTablet]}>
            {/* Start Instant Room Card */}
            <View style={[styles.actionCard, isTablet && styles.actionCardTablet]}>
              <Text style={styles.actionTitle}>Start a Meeting</Text>
              <Text style={styles.actionDesc}>
                Launch a private room with low-latency adaptive WebRTC media.
              </Text>
              <TouchableOpacity
                style={[styles.primaryBtn, creating && styles.btnDisabled]}
                onPress={handleStartInstant}
                disabled={creating}
                accessibilityRole="button"
                accessibilityLabel="Start instant meeting"
              >
                {creating ? (
                  <ActivityIndicator color="#17151F" />
                ) : (
                  <Text style={styles.primaryBtnText}>Start a meeting</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Join by Code Card */}
            <View style={[styles.actionCard, isTablet && styles.actionCardTablet]}>
              <Text style={styles.actionTitle}>Join with Room Code</Text>
              <Text style={styles.actionDesc}>
                Enter the code or paste a link shared by your host.
              </Text>
              <View style={styles.joinInputRow}>
                <TextInput
                  style={styles.joinInput}
                  value={code}
                  onChangeText={setCode}
                  placeholder="abc-defg-hij"
                  placeholderTextColor="#9C988D"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="join"
                  onSubmitEditing={handleJoinByCode}
                />
                <TouchableOpacity
                  style={styles.joinBtn}
                  onPress={handleJoinByCode}
                  accessibilityRole="button"
                  accessibilityLabel="Join meeting"
                >
                  <Text style={styles.joinBtnText}>Join</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Room Categories */}
          <Text style={styles.sectionHeader}>Five Kinds of Rooms</Text>
          <View style={[styles.kindsGrid, isTablet && styles.kindsGridTablet]}>
            {ROOM_KINDS.map((rk, idx) => (
              <View
                key={idx}
                style={[
                  styles.kindCard,
                  isTablet && styles.kindCardTablet,
                  { backgroundColor: rk.bg, borderColor: rk.border },
                ]}
              >
                <View style={[styles.kindDot, { backgroundColor: rk.color }]} />
                <View style={styles.kindTextCol}>
                  <Text style={styles.kindName}>{rk.name}</Text>
                  <Text style={styles.kindDesc}>{rk.desc}</Text>
                </View>
              </View>
            ))}
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
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEE8',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandLogo: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: '#17151F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFC93C',
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#17151F',
    letterSpacing: -0.5,
  },
  userSubtitle: {
    fontSize: 12,
    color: '#7444E8',
    fontWeight: '700',
  },
  signOutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F6F5F2',
    minHeight: 40,
    justifyContent: 'center',
  },
  signOutText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5E5A50',
  },
  scrollContent: {
    padding: 20,
    alignItems: 'center',
  },
  mainWrapper: {
    width: '100%',
    maxWidth: 540,
    gap: 16,
  },
  mainWrapperTablet: {
    maxWidth: 960,
    gap: 20,
  },
  errorBox: {
    backgroundColor: '#FFEAEA',
    borderWidth: 1,
    borderColor: '#FFC7C7',
    borderRadius: 14,
    padding: 12,
  },
  errorText: {
    color: '#C53030',
    fontSize: 13,
    fontWeight: '600',
  },
  actionsRow: {
    gap: 14,
  },
  actionsRowTablet: {
    flexDirection: 'row',
  },
  actionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 22,
    borderWidth: 1.5,
    borderColor: '#EAE8E2',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
    flex: 1,
    justifyContent: 'space-between',
  },
  actionCardTablet: {
    minHeight: 180,
  },
  actionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#17151F',
    marginBottom: 4,
  },
  actionDesc: {
    fontSize: 14,
    color: '#5E5A50',
    lineHeight: 20,
    marginBottom: 16,
  },
  primaryBtn: {
    backgroundColor: '#FFC93C',
    borderRadius: 9999,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FFC93C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#17151F',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  joinInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  joinInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    borderRadius: 9999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#17151F',
    fontWeight: '600',
    minHeight: 48,
  },
  joinBtn: {
    backgroundColor: '#7444E8',
    borderRadius: 9999,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  joinBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '800',
    color: '#17151F',
    marginTop: 8,
    marginBottom: 2,
  },
  kindsGrid: {
    gap: 12,
  },
  kindsGridTablet: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  kindCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    gap: 14,
  },
  kindCardTablet: {
    width: '48%',
    flexGrow: 1,
  },
  kindDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  kindTextCol: {
    flex: 1,
  },
  kindName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#17151F',
    marginBottom: 2,
  },
  kindDesc: {
    fontSize: 13,
    color: '#5E5A50',
    lineHeight: 18,
  },
});
