import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  Platform,
} from 'react-native';
import { useWindowDimensions } from '../hooks/useWindowDimensions';

interface WelcomeScreenProps {
  onStartMeeting: () => void;
  onSignIn: () => void;
  onJoinCode: (code: string) => void;
  isCreating?: boolean;
}

const ROOM_KINDS = [
  {
    name: 'Instant Meet',
    desc: 'A normal call, ready in one click.',
    badgeBg: '#17151F',
    badgeText: '#FFFFFF',
    cardBg: '#F3F2EE',
    borderColor: '#E9E7E1',
    dotColor: '#17151F',
  },
  {
    name: 'Research Room',
    desc: 'Papers, notes and repo beside the call.',
    badgeBg: '#F1EBFF',
    badgeText: '#5A2FC7',
    cardBg: '#F1EBFF',
    borderColor: '#E4DCFC',
    dotColor: '#7444E8',
  },
  {
    name: 'Project Room',
    desc: 'Teammates, tasks and context together.',
    badgeBg: '#E4F8EB',
    badgeText: '#1F6B3B',
    cardBg: '#E4F8EB',
    borderColor: '#CDEED8',
    dotColor: '#2DBE74',
  },
  {
    name: 'Mentor Session',
    desc: 'Goals and agenda ready before you join.',
    badgeBg: '#FFF4D1',
    badgeText: '#6B4E00',
    cardBg: '#FFF4D1',
    borderColor: '#FBEAB4',
    dotColor: '#FFC93C',
  },
  {
    name: 'Community Room',
    desc: 'Clubs, events and group discussions.',
    badgeBg: '#FFE9E9',
    badgeText: '#9B2C2C',
    cardBg: '#FFE9E9',
    borderColor: '#FBD2D2',
    dotColor: '#FF6B6B',
  },
];

export function WelcomeScreen({
  onStartMeeting,
  onSignIn,
  onJoinCode,
  isCreating = false,
}: WelcomeScreenProps) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 600;
  const isLargeTablet = width >= 840;

  const [inputCode, setInputCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleJoinSubmit = () => {
    let clean = inputCode.trim();
    if (!clean) {
      setJoinError('Enter a room code');
      return;
    }
    // Clean pasted URLs
    const match = clean.match(/room\/([a-zA-Z0-9-]+)/i) || clean.match(/meet:\/\/([a-zA-Z0-9-]+)/i);
    if (match && match[1]) {
      clean = match[1];
    }
    setJoinError(null);
    onJoinCode(clean);
  };

  return (
    <SafeAreaView style={styles.safeContainer}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF9FC" />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <View style={styles.brandRow}>
            <View style={styles.brandLogo}>
              <View style={styles.brandDot} />
            </View>
            <Text style={styles.brandTitle}>Tathastu Meet</Text>
          </View>
          <TouchableOpacity
            style={styles.signInBtn}
            onPress={onSignIn}
            accessibilityRole="button"
            accessibilityLabel="Sign in or create account"
          >
            <Text style={styles.signInText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          isTablet && styles.scrollContentTablet,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.mainContainer, isTablet && styles.mainContainerTablet]}>
          {/* Badge */}
          <View style={styles.badgeContainer}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>THE REAL-ROOM FEELING</Text>
            </View>
          </View>

          {/* Hero Headline */}
          <Text
            style={[
              styles.headline,
              isTablet && styles.headlineTablet,
              isLargeTablet && styles.headlineLargeTablet,
            ]}
          >
            Feels like a{' '}
            <Text style={styles.headlineHighlight}>
              {' '}real room{' '}
            </Text>{' '}
            talk.
          </Text>

          {/* Subtitle */}
          <Text
            style={[
              styles.subtitle,
              isTablet && styles.subtitleTablet,
            ]}
          >
            Crystal-clear voice, video that adapts to your network, and rooms that already know why you are meeting.
          </Text>

          {/* Action Row: Start Meeting + Room Code Join */}
          <View style={[styles.actionRow, isTablet && styles.actionRowTablet]}>
            {/* Start a meeting button */}
            <TouchableOpacity
              style={[
                styles.primaryCta,
                isTablet && styles.primaryCtaTablet,
                isCreating && styles.btnDisabled,
              ]}
              onPress={onStartMeeting}
              disabled={isCreating}
              accessibilityRole="button"
              accessibilityLabel="Start a meeting"
            >
              <Text style={styles.primaryCtaText}>
                {isCreating ? 'Starting...' : 'Start a meeting'}
              </Text>
            </TouchableOpacity>

            {/* Room Code Form */}
            <View style={[styles.joinContainer, isTablet && styles.joinContainerTablet]}>
              <Text style={styles.joinLabel}>Room code</Text>
              <TextInput
                style={styles.joinInput}
                value={inputCode}
                onChangeText={(text) => {
                  setInputCode(text);
                  if (joinError) setJoinError(null);
                }}
                placeholder="abc-defg-hij"
                placeholderTextColor="#9C988D"
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="join"
                onSubmitEditing={handleJoinSubmit}
              />
              <TouchableOpacity
                style={styles.joinBtn}
                onPress={handleJoinSubmit}
                accessibilityRole="button"
                accessibilityLabel="Join meeting with room code"
              >
                <Text style={styles.joinBtnText}>Join</Text>
              </TouchableOpacity>
            </View>
          </View>

          {joinError ? (
            <Text style={styles.joinErrorText}>{joinError}</Text>
          ) : null}

          {/* Room Category Pills */}
          <View style={styles.pillsRow}>
            {ROOM_KINDS.map((kind) => (
              <View
                key={kind.name}
                style={[
                  styles.categoryPill,
                  { backgroundColor: kind.badgeBg },
                ]}
              >
                <Text
                  style={[
                    styles.categoryPillText,
                    { color: kind.badgeText },
                  ]}
                >
                  {kind.name.replace(' Room', '').replace(' Session', '').replace(' Meet', '')}
                </Text>
              </View>
            ))}
          </View>

          {/* Hero Meeting Preview Showcase */}
          <View style={styles.previewWindowWrapper}>
            <View style={styles.previewWindowCard}>
              {/* Window Top Bar */}
              <View style={styles.windowHeader}>
                <View style={styles.windowHeaderLeft}>
                  <View style={styles.activeDot} />
                  <Text style={styles.windowTitle} numberOfLines={1}>
                    Federated Learning Collaboration
                  </Text>
                </View>
                <View style={styles.windowHeaderRight}>
                  <View style={styles.researchPill}>
                    <Text style={styles.researchPillText}>Research Room</Text>
                  </View>
                  <View style={styles.timerPill}>
                    <View style={styles.timerDot} />
                    <Text style={styles.timerText}>00:32:14</Text>
                  </View>
                </View>
              </View>

              {/* Video Stage Preview */}
              <View style={styles.stageContainer}>
                {/* Main Speaker Tile */}
                <View style={[styles.speakerTile, isTablet && styles.speakerTileTablet]}>
                  <View style={styles.speakerAvatar}>
                    <Text style={styles.speakerAvatarText}>A</Text>
                  </View>
                  <View style={styles.speechBubble}>
                    <Text style={styles.speechBubbleText}>
                      What if we federate at the grid edge?
                    </Text>
                  </View>
                  <View style={styles.speakerBadgeRow}>
                    <View style={styles.speakingIndicator}>
                      <View style={styles.liveGreenDot} />
                      <Text style={styles.speakerBadgeText}>Anant · speaking</Text>
                    </View>
                  </View>
                </View>

                {/* Secondary Participant Tiles */}
                <View style={[styles.sideTilesRow, isTablet && styles.sideTilesRowTablet]}>
                  <View style={[styles.miniTile, { backgroundColor: '#FFF4D1' }]}>
                    <View style={[styles.miniAvatar, { backgroundColor: '#FFC93C' }]}>
                      <Text style={styles.miniAvatarText}>S</Text>
                    </View>
                    <Text style={styles.miniTileName} numberOfLines={1}>Sanara Singh</Text>
                  </View>

                  <View style={[styles.miniTile, { backgroundColor: '#E4F8EB' }]}>
                    <View style={[styles.miniAvatar, { backgroundColor: '#86E3A8' }]}>
                      <Text style={styles.miniAvatarText}>S</Text>
                    </View>
                    <Text style={styles.miniTileName} numberOfLines={1}>Shivam</Text>
                  </View>

                  <View style={[styles.miniTile, { backgroundColor: '#FFE9E9' }]}>
                    <View style={[styles.miniAvatar, { backgroundColor: '#FF8A8A' }]}>
                      <Text style={styles.miniAvatarText}>M</Text>
                    </View>
                    <Text style={styles.miniTileName} numberOfLines={1}>Mentor</Text>
                  </View>
                </View>
              </View>

              {/* Simulated Controls Bar */}
              <View style={styles.controlsBar}>
                <View style={[styles.controlIconCircle, { backgroundColor: '#86E3A8' }]}>
                  <Text style={styles.controlIconText}>🎤</Text>
                </View>
                <View style={[styles.controlIconCircle, { backgroundColor: '#86E3A8' }]}>
                  <Text style={styles.controlIconText}>📹</Text>
                </View>
                <View style={[styles.controlIconCircle, { backgroundColor: '#FFFFFF' }]}>
                  <Text style={styles.controlIconText}>📺</Text>
                </View>
                <View style={[styles.controlIconCircle, { backgroundColor: '#FF4D4D' }]}>
                  <Text style={styles.controlIconText}>📞</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Five Kinds of Rooms Section */}
          <View style={styles.roomKindsSection}>
            <Text style={[styles.sectionTitle, isTablet && styles.sectionTitleTablet]}>
              One engine. Five kinds of rooms.
            </Text>

            <View style={[styles.cardsGrid, isTablet && styles.cardsGridTablet]}>
              {ROOM_KINDS.map((kind) => (
                <View
                  key={kind.name}
                  style={[
                    styles.roomCard,
                    isTablet && styles.roomCardTablet,
                    { backgroundColor: kind.cardBg, borderColor: kind.borderColor },
                  ]}
                >
                  <View style={[styles.cardDot, { backgroundColor: kind.dotColor }]} />
                  <Text style={styles.cardTitle}>{kind.name}</Text>
                  <Text style={styles.cardDesc}>{kind.desc}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
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
    maxWidth: 1080,
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
  signInBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: '#F6F5F2',
    borderWidth: 1,
    borderColor: '#E3E0D8',
    minHeight: 40,
    justifyContent: 'center',
  },
  signInText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#17151F',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 48,
    alignItems: 'center',
  },
  scrollContentTablet: {
    paddingHorizontal: 32,
    paddingTop: 36,
  },
  mainContainer: {
    width: '100%',
    maxWidth: 600,
    alignItems: 'center',
  },
  mainContainerTablet: {
    maxWidth: 960,
  },
  badgeContainer: {
    marginBottom: 16,
  },
  badge: {
    backgroundColor: '#FFF4D1',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: '#FBEAB4',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B4E00',
    letterSpacing: 0.8,
  },
  headline: {
    fontSize: 34,
    fontWeight: '900',
    color: '#17151F',
    lineHeight: 40,
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: 14,
  },
  headlineTablet: {
    fontSize: 54,
    lineHeight: 60,
    letterSpacing: -1.8,
    maxWidth: 780,
  },
  headlineLargeTablet: {
    fontSize: 68,
    lineHeight: 74,
  },
  headlineHighlight: {
    backgroundColor: '#FFC93C',
    color: '#17151F',
  },
  subtitle: {
    fontSize: 16,
    color: '#5E5A50',
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 580,
    marginBottom: 26,
  },
  subtitleTablet: {
    fontSize: 19,
    lineHeight: 28,
    maxWidth: 680,
    marginBottom: 32,
  },
  actionRow: {
    width: '100%',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  actionRowTablet: {
    flexDirection: 'row',
    gap: 14,
  },
  primaryCta: {
    backgroundColor: '#FFC93C',
    borderRadius: 9999,
    minHeight: 52,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 360,
    shadowColor: '#FFC93C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 4,
  },
  primaryCtaTablet: {
    width: 'auto',
    minWidth: 200,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryCtaText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#17151F',
  },
  joinContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    borderRadius: 9999,
    paddingVertical: 4,
    paddingLeft: 16,
    paddingRight: 6,
    minHeight: 52,
    width: '100%',
    maxWidth: 360,
  },
  joinContainerTablet: {
    width: 'auto',
    minWidth: 320,
  },
  joinLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B675C',
    marginRight: 6,
  },
  joinInput: {
    flex: 1,
    fontSize: 15,
    color: '#17151F',
    fontWeight: '600',
    minHeight: 44,
    paddingHorizontal: 4,
  },
  joinBtn: {
    backgroundColor: '#7444E8',
    borderRadius: 9999,
    paddingHorizontal: 20,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  joinBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  joinErrorText: {
    color: '#C53030',
    fontSize: 13,
    fontWeight: '600',
    marginTop: -8,
    marginBottom: 12,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 10,
    marginBottom: 34,
  },
  categoryPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 9999,
  },
  categoryPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  previewWindowWrapper: {
    width: '100%',
    marginBottom: 44,
  },
  previewWindowCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#E4E2DB',
    padding: 12,
    shadowColor: '#7444E8',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 6,
  },
  windowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEE8',
    marginBottom: 10,
    flexWrap: 'wrap',
    gap: 8,
  },
  windowHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 160,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#7444E8',
  },
  windowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#17151F',
  },
  windowHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  researchPill: {
    backgroundColor: '#F1EBFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  researchPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5A2FC7',
  },
  timerPill: {
    backgroundColor: '#E4F8EB',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  timerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2DBE74',
  },
  timerText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1F6B3B',
  },
  stageContainer: {
    backgroundColor: '#FAF9FC',
    borderRadius: 18,
    padding: 12,
    gap: 12,
  },
  speakerTile: {
    backgroundColor: '#F1EBFF',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#7444E8',
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 220,
    position: 'relative',
  },
  speakerTileTablet: {
    minHeight: 280,
  },
  speakerAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#7444E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  speakerAvatarText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  speechBubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E8E2F5',
    marginBottom: 16,
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  speechBubbleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#17151F',
    textAlign: 'center',
  },
  speakerBadgeRow: {
    position: 'absolute',
    bottom: 12,
    left: 12,
  },
  speakingIndicator: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E5E0F2',
  },
  liveGreenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2DBE74',
  },
  speakerBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#17151F',
  },
  sideTilesRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  sideTilesRowTablet: {
    gap: 12,
  },
  miniTile: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  miniAvatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#17151F',
  },
  miniTileName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#17151F',
  },
  controlsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 12,
  },
  controlIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  controlIconText: {
    fontSize: 18,
  },
  roomKindsSection: {
    width: '100%',
    paddingTop: 8,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#17151F',
    letterSpacing: -0.8,
    marginBottom: 20,
    textAlign: 'center',
  },
  sectionTitleTablet: {
    fontSize: 36,
    letterSpacing: -1.2,
    marginBottom: 28,
  },
  cardsGrid: {
    gap: 12,
    width: '100%',
  },
  cardsGridTablet: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
  },
  roomCard: {
    borderRadius: 22,
    padding: 20,
    borderWidth: 1.5,
    minHeight: 120,
  },
  roomCardTablet: {
    width: '31%',
    minWidth: 240,
    minHeight: 140,
  },
  cardDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#17151F',
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 13,
    color: '#5E5A50',
    lineHeight: 18,
  },
});
