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
  Linking,
  Image,
} from 'react-native';
import { useWindowDimensions } from '../hooks/useWindowDimensions';
import { MobileAuthUser } from '../services/apiClient';
import {
  Mic,
  Video,
  Monitor,
  Hand,
  PhoneOff,
  Sparkles,
} from '../design-system/icons';
import { ProfileAvatar } from '../components/profile/ProfileAvatar';

export interface LandingScreenProps {
  user: MobileAuthUser | null;
  onStartMeeting: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onJoinCode: (code: string) => void;
  onOpenProfile?: () => void;
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

export function LandingScreen({
  user,
  onStartMeeting,
  onSignIn,
  onSignOut,
  onJoinCode,
  onOpenProfile,
  isCreating = false,
}: LandingScreenProps) {

  const {
    width,
    height,
    isTablet,
    isLargeTablet,
    isCompact,
    isStandard,
    isComfortable,
    isWide,
    isLandscape,
    horizontalGutter,
  } = useWindowDimensions();

  const [inputCode, setInputCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  // Section 7 interactive preview toggles
  const [audioToggles, setAudioToggles] = useState({
    noise: true,
    echo: true,
    adaptive: true,
  });

  const handleJoinSubmit = () => {
    let clean = inputCode.trim();
    if (!clean) {
      setJoinError('Enter a room code');
      return;
    }
    const match = clean.match(/room\/([a-zA-Z0-9-]+)/i) || clean.match(/meet:\/\/([a-zA-Z0-9-]+)/i);
    if (match && match[1]) {
      clean = match[1];
    }
    setJoinError(null);
    onJoinCode(clean);
  };

  return (
    <SafeAreaView style={styles.safeContainer}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* =========================================================================
          SECTION 1 — NAVIGATION
         ========================================================================= */}
      <View style={[styles.navBar, isCompact && styles.navBarCompact]}>
        <View style={[styles.navInner, isTablet && styles.navInnerTablet]}>
          {/* Brand */}
          <View style={styles.brandRow}>
            <Image
              source={require('../../assets/icon.png')}
              style={[styles.brandLogo, isCompact && styles.brandLogoCompact]}
              resizeMode="cover"
              accessibilityLabel="Tathastu Meet logo"
            />
            <Text style={[styles.brandTitle, isCompact && styles.brandTitleCompact]} numberOfLines={1}>
              {isCompact && width < 340 ? 'Meet' : 'Tathastu Meet'}
            </Text>
          </View>

          {/* Desktop/Tablet Links */}
          {isTablet && (
            <View style={styles.navLinksRow}>
              <Text style={styles.navLinkText}>Product</Text>
              <Text style={styles.navLinkText}>Rooms</Text>
              <Text style={styles.navLinkText}>Quality</Text>
            </View>
          )}

          {/* User / Auth Actions */}
          <View style={[styles.navActionsRow, isCompact && styles.navActionsRowCompact]}>
            {user ? (
              <TouchableOpacity
                style={styles.headerAvatarBtn}
                onPress={onOpenProfile}
                accessibilityRole="button"
                accessibilityLabel="Open profile menu"
                activeOpacity={0.8}
              >
                <ProfileAvatar
                  size={isCompact ? 38 : 42}
                  avatarId={user.avatarId}
                  avatarUrl={user.avatarUrl}
                  name={user.displayName}
                  email={user.email}
                  fallbackBgColor="#7444E8"
                />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.navStartBtn, isCompact && styles.navStartBtnCompact]}
                onPress={onSignIn}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
              >
                <Text style={[styles.navStartBtnText, isCompact && styles.navStartBtnTextCompact]}>
                  Sign in
                </Text>
              </TouchableOpacity>
            )}
          </View>

        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          isCompact && styles.scrollContentCompact,
          isTablet && styles.scrollContentTablet,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.pageContent, isTablet && styles.pageContentTablet]}>
          {/* =========================================================================
              SECTION 2 — MAIN HERO
             ========================================================================= */}
          <View style={styles.heroSection}>
            <Text
              style={[
                styles.heroHeadline,
                isCompact && styles.heroHeadlineCompact,
                isTablet && styles.heroHeadlineTablet,
                isLargeTablet && styles.heroHeadlineLargeTablet,
              ]}
            >
              Feels like a{' '}
              <Text style={styles.heroHighlight}>
                {' '}real room{' '}
              </Text>{' '}
              talk.
            </Text>

            <Text
              style={[
                styles.heroSubtitle,
                isCompact && styles.heroSubtitleCompact,
                isTablet && styles.heroSubtitleTablet,
              ]}
            >
              Crystal-clear voice, video that adapts to your network, and rooms that already know why you are meeting.
            </Text>

            {/* CTA and Join Form Group */}
            <View style={[styles.heroActionsRow, isTablet && styles.heroActionsRowTablet]}>
              <TouchableOpacity
                style={[
                  styles.primaryCtaBtn,
                  isCompact && styles.primaryCtaBtnCompact,
                  isTablet && styles.primaryCtaBtnTablet,
                  isCreating && styles.btnDisabled,
                ]}
                onPress={onStartMeeting}
                disabled={isCreating}
                accessibilityRole="button"
                accessibilityLabel="Start a meeting"
              >
                <Text style={[styles.primaryCtaText, isCompact && styles.primaryCtaTextCompact]}>
                  {isCreating ? 'Starting...' : 'Start a meeting'}
                </Text>
              </TouchableOpacity>

              <View style={[
                styles.roomCodeContainer,
                isCompact && styles.roomCodeContainerCompact,
                isTablet && styles.roomCodeContainerTablet,
              ]}>
                {!isCompact && width >= 380 && <Text style={styles.roomCodeLabel}>Room code</Text>}
                <TextInput
                  style={[styles.roomCodeInput, isCompact && styles.roomCodeInputCompact]}
                  value={inputCode}
                  onChangeText={(text) => {
                    setInputCode(text);
                    if (joinError) setJoinError(null);
                  }}
                  placeholder={isCompact || width < 380 ? "Room code (e.g. abc-defg-hij)" : "abc-defg-hij"}
                  placeholderTextColor="#9C988D"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="join"
                  onSubmitEditing={handleJoinSubmit}
                />
                <TouchableOpacity
                  style={[styles.roomCodeJoinBtn, isCompact && styles.roomCodeJoinBtnCompact]}
                  onPress={handleJoinSubmit}
                  accessibilityRole="button"
                  accessibilityLabel="Join meeting"
                >
                  <Text style={[styles.roomCodeJoinText, isCompact && styles.roomCodeJoinTextCompact]}>Join</Text>
                </TouchableOpacity>
              </View>
            </View>

            {joinError ? (
              <Text style={styles.joinErrorText}>{joinError}</Text>
            ) : null}

            {/* Room Category Pills */}
            <View style={styles.categoryPillsRow}>
              {ROOM_KINDS.map((kind) => (
                <View
                  key={kind.name}
                  style={[
                    styles.categoryPill,
                    isCompact && styles.categoryPillCompact,
                    { backgroundColor: kind.badgeBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryPillText,
                      isCompact && styles.categoryPillTextCompact,
                      { color: kind.badgeText },
                    ]}
                  >
                    {kind.name.replace(' Room', '').replace(' Session', '').replace(' Meet', '')}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* =========================================================================
              SECTION 3 — HERO MEETING SHOWCASE
             ========================================================================= */}
          <View style={styles.showcaseSection}>
            <View style={[styles.showcaseWindowCard, isCompact && styles.showcaseWindowCardCompact]}>
              {/* Window Top Bar */}
              <View style={styles.showcaseTopBar}>
                <View style={styles.showcaseTitleLeft}>
                  <View style={styles.purpleDot} />
                  <Text style={[styles.showcaseTitleText, isCompact && styles.showcaseTitleTextCompact]} numberOfLines={1}>
                    Federated Learning Collaboration
                  </Text>
                </View>
                <View style={styles.showcasePillsRight}>
                  <View style={styles.researchBadge}>
                    <Text style={styles.researchBadgeText}>Research Room</Text>
                  </View>
                  <View style={styles.timerBadge}>
                    <View style={styles.pulsingGreenDot} />
                    <Text style={styles.timerBadgeText}>00:32:14</Text>
                  </View>
                </View>
              </View>

              {/* Video Surface Container */}
              <View style={[styles.stageSurface, isCompact && styles.stageSurfaceCompact]}>
                {/* Internal Layout: Big Speaker Tile + Side Participants */}
                <View style={[styles.stageLayout, isTablet && styles.stageLayoutTablet]}>
                  {/* Speaker Tile: Anant */}
                  <View style={[
                    styles.speakerTile,
                    isCompact && styles.speakerTileCompact,
                    isTablet && styles.speakerTileTablet,
                  ]}>
                    <View style={[styles.speakerAvatar, isCompact && styles.speakerAvatarCompact]}>
                      <Text style={[styles.speakerAvatarText, isCompact && styles.speakerAvatarTextCompact]}>A</Text>
                    </View>
                    <View style={[styles.speakerSpeechBubble, isCompact && styles.speakerSpeechBubbleCompact]}>
                      <Text style={[styles.speakerSpeechText, isCompact && styles.speakerSpeechTextCompact]}>
                        What if we federate at the grid edge?
                      </Text>
                    </View>
                    <View style={styles.speakerIdentityBadge}>
                      <View style={styles.pulsingGreenDot} />
                      <Text style={styles.speakerIdentityText}>Anant · speaking</Text>
                    </View>
                  </View>

                  {/* 3 Secondary Participants */}
                  <View style={[
                    styles.sideTilesCol,
                    isCompact && styles.sideTilesColCompact,
                    isTablet && styles.sideTilesColTablet,
                  ]}>
                    <View style={[styles.miniTile, isCompact && styles.miniTileCompact, { backgroundColor: '#FFF4D1' }]}>
                      <View style={[styles.miniAvatar, isCompact && styles.miniAvatarCompact, { backgroundColor: '#FFC93C' }]}>
                        <Text style={[styles.miniAvatarText, isCompact && styles.miniAvatarTextCompact]}>S</Text>
                      </View>
                      <Text style={[styles.miniTileName, isCompact && styles.miniTileNameCompact]} numberOfLines={1}>
                        Sanara Singh
                      </Text>
                    </View>

                    <View style={[styles.miniTile, isCompact && styles.miniTileCompact, { backgroundColor: '#E4F8EB' }]}>
                      <View style={[styles.miniAvatar, isCompact && styles.miniAvatarCompact, { backgroundColor: '#86E3A8' }]}>
                        <Text style={[styles.miniAvatarText, isCompact && styles.miniAvatarTextCompact]}>S</Text>
                      </View>
                      <Text style={[styles.miniTileName, isCompact && styles.miniTileNameCompact]} numberOfLines={1}>
                        Shivam
                      </Text>
                    </View>

                    <View style={[styles.miniTile, isCompact && styles.miniTileCompact, { backgroundColor: '#FFE9E9' }]}>
                      <View style={[styles.miniAvatar, isCompact && styles.miniAvatarCompact, { backgroundColor: '#FF8A8A' }]}>
                        <Text style={[styles.miniAvatarText, isCompact && styles.miniAvatarTextCompact]}>M</Text>
                      </View>
                      <Text style={[styles.miniTileName, isCompact && styles.miniTileNameCompact]} numberOfLines={1}>
                        Mentor
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Decorative Vector Meeting Controls Bar */}
                <View style={[styles.simulatedControlsBar, isCompact && styles.simulatedControlsBarCompact]}>
                  <View style={[styles.simControlCircle, isCompact && styles.simControlCircleCompact, { backgroundColor: '#86E3A8' }]}>
                    <Mic size={isCompact ? 15 : 18} color="#17151F" />
                  </View>
                  <View style={[styles.simControlCircle, isCompact && styles.simControlCircleCompact, { backgroundColor: '#86E3A8' }]}>
                    <Video size={isCompact ? 15 : 18} color="#17151F" />
                  </View>
                  <View style={[styles.simControlCircle, isCompact && styles.simControlCircleCompact, { backgroundColor: '#7444E8' }]}>
                    <Monitor size={isCompact ? 15 : 18} color="#FFFFFF" />
                  </View>
                  <View style={[styles.simControlCircle, isCompact && styles.simControlCircleCompact, { backgroundColor: '#FFC93C' }]}>
                    <Hand size={isCompact ? 15 : 18} color="#17151F" />
                  </View>
                  <View style={[styles.simControlPill, isCompact && styles.simControlPillCompact, { backgroundColor: '#FF6B6B' }]}>
                    <PhoneOff size={isCompact ? 15 : 18} color="#FFFFFF" />
                  </View>
                </View>
              </View>

            </View>
          </View>


          {/* =========================================================================
              SECTION 4 — RESEARCH ROUND TABLE
             ========================================================================= */}
          <View style={styles.roundTableSection}>
            <View style={styles.sectionBadgeWrapper}>
              <View style={[styles.smallBadge, { backgroundColor: '#FFF4D1', borderColor: '#FBEAB4' }]}>
                <Text style={[styles.smallBadgeText, { color: '#6B4E00' }]}>THE REAL-ROOM FEELING</Text>
              </View>
            </View>

            <Text style={[styles.sectionHeading, isCompact && styles.sectionHeadingCompact, isTablet && styles.sectionHeadingTablet]}>
              Everyone gets a seat at the table.
            </Text>

            {/* Roundtable Constellation Container */}
            <View style={[
              styles.roundTableContainer,
              isCompact && styles.roundTableContainerCompact,
              isTablet && styles.roundTableContainerTablet,
            ]}>
              {/* Central Table Oval */}
              <View style={[
                styles.centralTableOval,
                isCompact && styles.centralTableOvalCompact,
                isTablet && styles.centralTableOvalTablet,
              ]}>
                <Text style={[styles.centralTableText, isCompact && styles.centralTableTextCompact]}>
                  Multimodal AI Research Circle
                </Text>
              </View>

              {/* 1. Anant (Top) */}
              <View style={[styles.anantContainer, isCompact && styles.anantContainerCompact]}>
                <View style={[styles.rtAvatar, isCompact && styles.rtAvatarCompact, { backgroundColor: '#7444E8' }]}>
                  <Text style={[styles.rtAvatarTextWhite, isCompact && styles.rtAvatarTextCompact]}>A</Text>
                </View>
                <Text style={[styles.rtName, isCompact && styles.rtNameCompact]}>Anant</Text>
              </View>
              {/* Bubble 1: Anant */}
              <View style={[styles.anantBubble, isCompact && styles.anantBubbleCompact]}>
                <Text style={[styles.bubbleText, isCompact && styles.bubbleTextCompact]}>
                  Can we reuse the same evaluation set?
                </Text>
              </View>

              {/* 2. Sanara Singh (Left) */}
              <View style={[styles.sanaraContainer, isCompact && styles.sanaraContainerCompact]}>
                <View style={[styles.rtAvatar, isCompact && styles.rtAvatarCompact, { backgroundColor: '#FFC93C' }]}>
                  <Text style={[styles.rtAvatarTextDark, isCompact && styles.rtAvatarTextCompact]}>S</Text>
                </View>
                <Text style={[styles.rtName, isCompact && styles.rtNameCompact]}>Sanara Singh</Text>
              </View>
              {/* Bubble 2: Sanara */}
              <View style={[styles.sanaraBubble, isCompact && styles.sanaraBubbleCompact]}>
                <Text style={[styles.bubbleText, isCompact && styles.bubbleTextCompact]}>
                  Power data is the hard part.
                </Text>
              </View>

              {/* 3. Shivam (Right) */}
              <View style={[styles.shivamContainer, isCompact && styles.shivamContainerCompact]}>
                <View style={[styles.rtAvatar, isCompact && styles.rtAvatarCompact, { backgroundColor: '#86E3A8' }]}>
                  <Text style={[styles.rtAvatarTextDark, isCompact && styles.rtAvatarTextCompact]}>S</Text>
                </View>
                <Text style={[styles.rtName, isCompact && styles.rtNameCompact]}>Shivam</Text>
              </View>

              {/* 4. Prof. Rao (Bottom Left) */}
              <View style={[styles.raoContainer, isCompact && styles.raoContainerCompact]}>
                <View style={[styles.rtAvatar, isCompact && styles.rtAvatarCompact, { backgroundColor: '#FF8A8A' }]}>
                  <Text style={[styles.rtAvatarTextDark, isCompact && styles.rtAvatarTextCompact]}>P</Text>
                </View>
                <Text style={[styles.rtName, isCompact && styles.rtNameCompact]}>Prof. Rao</Text>
              </View>

              {/* 5. Neha (Bottom Right) */}
              <View style={[styles.nehaContainer, isCompact && styles.nehaContainerCompact]}>
                <View style={[styles.rtAvatar, isCompact && styles.rtAvatarCompact, { backgroundColor: '#17151F' }]}>
                  <Text style={[styles.rtAvatarTextWhite, isCompact && styles.rtAvatarTextCompact]}>N</Text>
                </View>
                <Text style={[styles.rtName, isCompact && styles.rtNameCompact]}>Neha</Text>
              </View>
              {/* Bubble 3: Neha */}
              <View style={[styles.nehaBubble, isCompact && styles.nehaBubbleCompact]}>
                <Text style={[styles.bubbleText, isCompact && styles.bubbleTextCompact]}>
                  I can share my dataset notes.
                </Text>
              </View>
            </View>
          </View>

          {/* =========================================================================
              SECTION 5 — ROOM CATEGORIES
             ========================================================================= */}
          <View style={styles.categoriesSection}>
            <Text style={[styles.sectionHeading, isCompact && styles.sectionHeadingCompact, isTablet && styles.sectionHeadingTablet]}>
              One engine. Five kinds of rooms.
            </Text>

            <View style={[
              styles.roomGrid,
              (isWide || (isTablet && !isLargeTablet)) && styles.roomGridWide,
              isTablet && styles.roomGridTablet,
            ]}>
              {ROOM_KINDS.map((kind) => (
                <View
                  key={kind.name}
                  style={[
                    styles.roomCategoryCard,
                    (isWide || (isTablet && !isLargeTablet)) && styles.roomCategoryCardWide,
                    isTablet && styles.roomCategoryCardTablet,
                    { backgroundColor: kind.cardBg, borderColor: kind.borderColor },
                  ]}
                >
                  <View style={[styles.cardDot, { backgroundColor: kind.dotColor }]} />
                  <Text style={styles.categoryCardTitle}>{kind.name}</Text>
                  <Text style={styles.categoryCardDesc}>{kind.desc}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* =========================================================================
              SECTION 6 — CONTEXT SECTION
             ========================================================================= */}
          <View style={[styles.featureRow, isTablet && styles.featureRowTablet]}>
            <View style={[styles.featureTextCol, isTablet && styles.featureTextColTablet]}>
              <View style={[styles.smallBadge, { backgroundColor: '#F1EBFF', borderColor: '#E4DCFC' }]}>
                <Text style={[styles.smallBadgeText, { color: '#5A2FC7' }]}>CONTEXT</Text>
              </View>
              <Text style={[styles.featureTitle, isTablet && styles.featureTitleTablet]}>
                Rooms that know why you are meeting.
              </Text>
              <Text style={styles.featureParagraph}>
                Come from AI Tathastu and your room opens with the topic, shared interests and resources ready. Only what you allow is shared.
              </Text>
            </View>

            <View style={[styles.featureCardCol, isTablet && styles.featureCardColTablet]}>
              <View style={styles.contextCardOuter}>
                <View style={styles.contextCardInner}>
                  <Text style={styles.contextInnerHeader}>Context</Text>
                  <Text style={styles.contextTopicText}>
                    Discuss federated RL architecture for EV charging
                  </Text>
                  <View style={styles.contextTagsRow}>
                    <View style={[styles.miniTag, { backgroundColor: '#F1EBFF' }]}>
                      <Text style={[styles.miniTagText, { color: '#5A2FC7' }]}>Federated Learning</Text>
                    </View>
                    <View style={[styles.miniTag, { backgroundColor: '#E4F8EB' }]}>
                      <Text style={[styles.miniTagText, { color: '#1F6B3B' }]}>Edge AI</Text>
                    </View>
                    <View style={[styles.miniTag, { backgroundColor: '#FFF4D1' }]}>
                      <Text style={[styles.miniTagText, { color: '#6B4E00' }]}>Smart Grid</Text>
                    </View>
                  </View>

                  <View style={styles.contextDividerRow}>
                    <Text style={styles.contextRowLabel}>Paper draft</Text>
                    <View style={styles.contextPill}>
                      <Text style={styles.contextPillText}>Attached</Text>
                    </View>
                  </View>

                  <View style={styles.contextDividerRow}>
                    <Text style={styles.contextRowLabel}>GitHub repository</Text>
                    <View style={styles.contextPill}>
                      <Text style={styles.contextPillText}>Linked</Text>
                    </View>
                  </View>

                  <View style={[styles.contextDividerRow, { borderBottomWidth: 0 }]}>
                    <Text style={styles.contextRowLabel}>Research notes</Text>
                    <View style={styles.contextPill}>
                      <Text style={styles.contextPillText}>Ready</Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* =========================================================================
              SECTION 7 — AUDIO QUALITY SECTION
             ========================================================================= */}
          <View style={[styles.featureRow, isTablet && styles.featureRowTablet, isTablet && styles.featureRowReversed]}>
            <View style={[styles.featureTextCol, isTablet && styles.featureTextColTablet]}>
              <View style={[styles.smallBadge, { backgroundColor: '#E4F8EB', borderColor: '#CDEED8' }]}>
                <Text style={[styles.smallBadgeText, { color: '#1F6B3B' }]}>QUALITY</Text>
              </View>
              <Text style={[styles.featureTitle, isTablet && styles.featureTitleTablet]}>
                Voice you can actually understand.
              </Text>
              <Text style={styles.featureParagraph}>
                Audio is prioritised over video. When your network drops, video softens and your voice stays sharp.
              </Text>
            </View>

            <View style={[styles.featureCardCol, isTablet && styles.featureCardColTablet]}>
              <View style={styles.qualityCardOuter}>
                <View style={styles.qualityCardInner}>
                  <View style={styles.qualityTopRow}>
                    <Text style={styles.contextInnerHeader}>Audio Engine</Text>
                    <View style={styles.previewTagPill}>
                      <Text style={styles.previewTagText}>Interactive Preview</Text>
                    </View>
                  </View>

                  <Text style={styles.qualitySubtext}>
                    Simulated demonstration of Tathastu adaptive filters (operational in live meetings).
                  </Text>

                  {/* Switch 1: Noise suppression */}
                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>Noise suppression</Text>
                    <TouchableOpacity
                      style={[styles.switchTrack, audioToggles.noise && styles.switchTrackActive]}
                      onPress={() => setAudioToggles((t) => ({ ...t, noise: !t.noise }))}
                      accessibilityRole="switch"
                      accessibilityLabel="Toggle noise suppression"
                    >
                      <View style={[styles.switchThumb, audioToggles.noise && styles.switchThumbActive]} />
                    </TouchableOpacity>
                  </View>

                  {/* Switch 2: Echo cancellation */}
                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>Echo cancellation</Text>
                    <TouchableOpacity
                      style={[styles.switchTrack, audioToggles.echo && styles.switchTrackActive]}
                      onPress={() => setAudioToggles((t) => ({ ...t, echo: !t.echo }))}
                      accessibilityRole="switch"
                      accessibilityLabel="Toggle echo cancellation"
                    >
                      <View style={[styles.switchThumb, audioToggles.echo && styles.switchThumbActive]} />
                    </TouchableOpacity>
                  </View>

                  {/* Switch 3: Adaptive video quality */}
                  <View style={[styles.toggleRow, { borderBottomWidth: 0 }]}>
                    <Text style={styles.toggleLabel}>Adaptive video quality</Text>
                    <TouchableOpacity
                      style={[styles.switchTrack, audioToggles.adaptive && styles.switchTrackActive]}
                      onPress={() => setAudioToggles((t) => ({ ...t, adaptive: !t.adaptive }))}
                      accessibilityRole="switch"
                      accessibilityLabel="Toggle adaptive video quality"
                    >
                      <View style={[styles.switchThumb, audioToggles.adaptive && styles.switchThumbActive]} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* =========================================================================
              SECTION 8 — MENTORSHIP SECTION
             ========================================================================= */}
          <View style={[styles.featureRow, isTablet && styles.featureRowTablet]}>
            <View style={[styles.featureTextCol, isTablet && styles.featureTextColTablet]}>
              <View style={[styles.smallBadge, { backgroundColor: '#FFF4D1', borderColor: '#FBEAB4' }]}>
                <Text style={[styles.smallBadgeText, { color: '#6B4E00' }]}>MENTORSHIP</Text>
              </View>
              <Text style={[styles.featureTitle, isTablet && styles.featureTitleTablet]}>
                Sessions with an agenda, not small talk.
              </Text>
              <Text style={styles.featureParagraph}>
                Mentor sessions open with the student goal and a suggested agenda, so the first minute is already useful.
              </Text>
            </View>

            <View style={[styles.featureCardCol, isTablet && styles.featureCardColTablet]}>
              <View style={styles.agendaCardOuter}>
                <View style={styles.agendaCardInner}>
                  <Text style={styles.contextInnerHeader}>Suggested agenda</Text>

                  {/* Step 1 */}
                  <View style={styles.agendaItemRow}>
                    <View style={[styles.agendaStepCircle, { backgroundColor: '#FFC93C' }]}>
                      <Text style={styles.agendaStepTextDark}>1</Text>
                    </View>
                    <Text style={styles.agendaItemTitle}>Current projects</Text>
                  </View>

                  {/* Step 2 */}
                  <View style={styles.agendaItemRow}>
                    <View style={[styles.agendaStepCircle, { backgroundColor: '#7444E8' }]}>
                      <Text style={styles.agendaStepTextWhite}>2</Text>
                    </View>
                    <Text style={styles.agendaItemTitle}>Deployment knowledge</Text>
                  </View>

                  {/* Step 3 */}
                  <View style={styles.agendaItemRow}>
                    <View style={[styles.agendaStepCircle, { backgroundColor: '#86E3A8' }]}>
                      <Text style={styles.agendaStepTextDark}>3</Text>
                    </View>
                    <Text style={styles.agendaItemTitle}>Portfolio gaps</Text>
                  </View>

                  {/* Step 4 */}
                  <View style={[styles.agendaItemRow, { borderBottomWidth: 0 }]}>
                    <View style={[styles.agendaStepCircle, { backgroundColor: '#FF8A8A' }]}>
                      <Text style={styles.agendaStepTextDark}>4</Text>
                    </View>
                    <Text style={styles.agendaItemTitle}>Next learning milestone</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* =========================================================================
              SECTION 9 — FINAL CALL TO ACTION
             ========================================================================= */}
          <View style={styles.ctaSectionWrapper}>
            <View style={styles.ctaCard}>
              <Text style={[styles.ctaHeading, isTablet && styles.ctaHeadingTablet]}>
                Start your first room in seconds.
              </Text>
              <TouchableOpacity
                style={styles.ctaButton}
                onPress={onStartMeeting}
                disabled={isCreating}
                accessibilityRole="button"
                accessibilityLabel="Start a meeting"
              >
                <Text style={styles.ctaButtonText}>
                  {isCreating ? 'Creating room...' : 'Start a meeting'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* =========================================================================
              SECTION 10 — FOOTER
             ========================================================================= */}
          <View style={styles.footerContainer}>
            <View style={[styles.footerGrid, isTablet && styles.footerGridTablet]}>
              {/* Brand Column */}
              <View style={styles.footerColBrand}>
                <View style={styles.brandRow}>
                  <View style={styles.brandLogoSmall}>
                    <View style={styles.brandDotSmall} />
                  </View>
                  <Text style={styles.footerBrandText}>Tathastu Meet</Text>
                </View>
                <Text style={styles.footerDesc}>
                  Lightweight, high-fidelity video meetings built for research, projects, and teamwork.
                </Text>
                <Text style={styles.footerCopyright}>
                  © {new Date().getFullYear()} AI Tathastu. All rights reserved.
                </Text>
              </View>

              {/* Product Column */}
              <View style={styles.footerCol}>
                <Text style={styles.footerColHeader}>Product</Text>
                <Text style={styles.footerLink}>Instant Meet</Text>
                <Text style={styles.footerLink}>Research Room</Text>
                <Text style={styles.footerLink}>Project Room</Text>
                <Text style={styles.footerLink}>Mentor Session</Text>
              </View>

              {/* Company Column */}
              <View style={styles.footerCol}>
                <Text style={styles.footerColHeader}>Company</Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://aitathastu.com')}>
                  <Text style={styles.footerLink}>AI Tathastu</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={user ? onSignOut : onSignIn}>
                  <Text style={styles.footerLink}>{user ? 'Sign Out' : 'Sign In'}</Text>
                </TouchableOpacity>
                <Text style={styles.footerMutedLink}>Security & Zero Trust</Text>
                <Text style={styles.footerMutedLink}>Privacy Policy</Text>
              </View>
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
    backgroundColor: '#FFFFFF',
  },
  navBar: {
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEE8',
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: 30,
  },
  navInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
  },
  navInnerTablet: {
    paddingHorizontal: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#17151F',
    letterSpacing: -0.5,
  },
  navLinksRow: {
    flexDirection: 'row',
    gap: 20,
  },
  navLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5E5A50',
  },
  navActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerAvatarBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#7444E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  signInBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F6F5F2',
    minHeight: 38,
    justifyContent: 'center',
  },
  signInText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5E5A50',
  },
  signOutBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F6F5F2',
    minHeight: 34,
    justifyContent: 'center',
  },
  signOutText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5E5A50',
  },
  navStartBtn: {
    backgroundColor: '#FFC93C',
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navStartBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#17151F',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 48,
    alignItems: 'center',
  },
  scrollContentTablet: {
    paddingHorizontal: 32,
    paddingTop: 36,
  },
  pageContent: {
    width: '100%',
    maxWidth: 620,
    alignItems: 'center',
  },
  pageContentTablet: {
    maxWidth: 1040,
  },

  /* HERO STYLES */
  heroSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 28,
  },
  heroHeadline: {
    fontSize: 34,
    fontWeight: '900',
    color: '#17151F',
    lineHeight: 40,
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: 14,
  },
  heroHeadlineTablet: {
    fontSize: 56,
    lineHeight: 62,
    letterSpacing: -1.8,
    maxWidth: 820,
  },
  heroHeadlineLargeTablet: {
    fontSize: 72,
    lineHeight: 78,
  },
  heroHighlight: {
    backgroundColor: '#FFC93C',
    color: '#17151F',
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#5E5A50',
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 580,
    marginBottom: 24,
  },
  heroSubtitleTablet: {
    fontSize: 20,
    lineHeight: 28,
    maxWidth: 680,
    marginBottom: 32,
  },
  heroActionsRow: {
    width: '100%',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  heroActionsRowTablet: {
    flexDirection: 'row',
    gap: 14,
  },
  primaryCtaBtn: {
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
  primaryCtaBtnTablet: {
    width: 'auto',
    minWidth: 200,
  },
  primaryCtaText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#17151F',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  roomCodeContainer: {
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
  roomCodeContainerTablet: {
    width: 'auto',
    minWidth: 320,
  },
  roomCodeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B675C',
    marginRight: 6,
  },
  roomCodeInput: {
    flex: 1,
    fontSize: 15,
    color: '#17151F',
    fontWeight: '600',
    minHeight: 44,
    paddingHorizontal: 4,
  },
  roomCodeJoinBtn: {
    backgroundColor: '#7444E8',
    borderRadius: 9999,
    paddingHorizontal: 20,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roomCodeJoinText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  joinErrorText: {
    color: '#C53030',
    fontSize: 13,
    fontWeight: '600',
    marginTop: -4,
    marginBottom: 8,
  },
  categoryPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 10,
  },
  categoryPill: {
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: 9999,
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '700',
  },

  /* SECTION 3 — SHOWCASE STYLES */
  showcaseSection: {
    width: '100%',
    marginBottom: 44,
  },
  showcaseWindowCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#E4E2DB',
    padding: 12,
    shadowColor: '#7444E8',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.12,
    shadowRadius: 36,
    elevation: 6,
  },
  showcaseTopBar: {
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
  showcaseTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 180,
  },
  purpleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#7444E8',
  },
  showcaseTitleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#17151F',
  },
  showcasePillsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  researchBadge: {
    backgroundColor: '#F1EBFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  researchBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5A2FC7',
  },
  timerBadge: {
    backgroundColor: '#E4F8EB',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pulsingGreenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2DBE74',
  },
  timerBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1F6B3B',
  },
  stageSurface: {
    backgroundColor: '#FAF9FC',
    borderRadius: 18,
    padding: 12,
    gap: 12,
  },
  stageLayout: {
    gap: 10,
  },
  stageLayoutTablet: {
    flexDirection: 'row',
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
    flex: 2,
  },
  speakerTileTablet: {
    minHeight: 260,
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
  speakerSpeechBubble: {
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
  speakerSpeechText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#17151F',
    textAlign: 'center',
  },
  speakerIdentityBadge: {
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
  speakerIdentityText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#17151F',
  },
  sideTilesCol: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    flex: 1,
  },
  sideTilesColTablet: {
    flexDirection: 'column',
    gap: 10,
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
  simulatedControlsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
  },
  simControlCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  simControlPill: {
    width: 54,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* SECTION 4 — ROUND TABLE */
  roundTableSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 48,
  },
  sectionBadgeWrapper: {
    marginBottom: 10,
  },
  smallBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 9999,
    borderWidth: 1,
    alignSelf: 'center',
  },
  smallBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  sectionHeading: {
    fontSize: 26,
    fontWeight: '900',
    color: '#17151F',
    textAlign: 'center',
    letterSpacing: -0.8,
    marginBottom: 24,
  },
  sectionHeadingTablet: {
    fontSize: 38,
    letterSpacing: -1.2,
    marginBottom: 32,
  },
  roundTableContainer: {
    position: 'relative',
    width: '100%',
    maxWidth: 580,
    height: 380,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundTableContainerTablet: {
    maxWidth: 680,
    height: 420,
  },
  centralTableOval: {
    width: '52%',
    height: '38%',
    borderRadius: 80,
    backgroundColor: '#F6F5F2',
    borderWidth: 1,
    borderColor: '#E9E7E1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    zIndex: 1,
  },
  centralTableOvalTablet: {
    width: '52%',
    height: '42%',
    borderRadius: 90,
  },
  centralTableText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B675C',
    textAlign: 'center',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  rtAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  rtAvatarTextWhite: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  rtAvatarTextDark: {
    fontSize: 18,
    fontWeight: '800',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  rtName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Medium', ios: 'System', default: 'sans-serif' }),
    textAlign: 'center',
  },
  bubbleText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#17151F',
    lineHeight: 14,
    fontFamily: Platform.select({ android: 'Inter-Regular', ios: 'System', default: 'sans-serif' }),
  },
  anantContainer: {
    position: 'absolute',
    top: 6,
    left: '50%',
    transform: [{ translateX: -30 }],
    width: 60,
    alignItems: 'center',
    zIndex: 10,
  },
  anantBubble: {
    position: 'absolute',
    top: 2,
    left: '58%',
    backgroundColor: '#FFFFFF',

    borderRadius: 12,
    padding: 8,
    maxWidth: 128,
    borderWidth: 1,
    borderColor: '#F0EEE8',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    zIndex: 20,
  },
  sanaraContainer: {
    position: 'absolute',
    left: 6,
    top: '32%',
    width: 68,
    alignItems: 'center',
    zIndex: 10,
  },
  sanaraBubble: {
    position: 'absolute',
    left: 6,
    top: '8%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 8,
    maxWidth: 108,
    borderWidth: 1,
    borderColor: '#F0EEE8',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    zIndex: 20,
  },
  shivamContainer: {
    position: 'absolute',
    right: 6,
    top: '32%',
    width: 68,
    alignItems: 'center',
    zIndex: 10,
  },

  raoContainer: {
    position: 'absolute',
    left: '20%',
    bottom: 8,
    alignItems: 'center',
    zIndex: 10,
  },
  nehaContainer: {
    position: 'absolute',
    right: '20%',
    bottom: 8,
    alignItems: 'center',
    zIndex: 10,
  },
  nehaBubble: {
    position: 'absolute',
    right: 6,
    bottom: '22%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 8,
    maxWidth: 120,
    borderWidth: 1,
    borderColor: '#F0EEE8',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    zIndex: 20,
  },

  /* SECTION 5 — CATEGORIES GRID */
  categoriesSection: {
    width: '100%',
    marginBottom: 52,
  },
  roomGrid: {
    gap: 12,
    width: '100%',
  },
  roomGridTablet: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
  },
  roomCategoryCard: {
    borderRadius: 22,
    padding: 20,
    borderWidth: 1.5,
    minHeight: 120,
  },
  roomCategoryCardTablet: {
    width: '31%',
    minWidth: 220,
    minHeight: 140,
  },
  cardDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginBottom: 10,
  },
  categoryCardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#17151F',
    marginBottom: 4,
  },
  categoryCardDesc: {
    fontSize: 13,
    color: '#4F4B44',
    lineHeight: 18,
  },

  /* FEATURE ROWS (SECTIONS 6, 7, 8) */
  featureRow: {
    width: '100%',
    gap: 20,
    marginBottom: 48,
    alignItems: 'center',
  },
  featureRowTablet: {
    flexDirection: 'row',
    gap: 32,
    alignItems: 'center',
  },
  featureRowReversed: {
    flexDirection: 'row-reverse',
  },
  featureTextCol: {
    width: '100%',
    alignItems: 'flex-start',
  },
  featureTextColTablet: {
    flex: 1,
  },
  featureCardCol: {
    width: '100%',
  },
  featureCardColTablet: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#17151F',
    lineHeight: 32,
    letterSpacing: -0.6,
    marginTop: 10,
    marginBottom: 10,
  },
  featureTitleTablet: {
    fontSize: 34,
    lineHeight: 40,
  },
  featureParagraph: {
    fontSize: 15,
    color: '#5E5A50',
    lineHeight: 22,
  },

  /* CONTEXT CARD */
  contextCardOuter: {
    backgroundColor: '#F1EBFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E3D9FC',
    padding: 16,
  },
  contextCardInner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDE8F7',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 3,
  },
  contextInnerHeader: {
    fontSize: 16,
    fontWeight: '800',
    color: '#17151F',
    marginBottom: 6,
  },
  contextTopicText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#17151F',
    marginBottom: 10,
  },
  contextTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  miniTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  miniTagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  contextDividerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEE8',
  },
  contextRowLabel: {
    fontSize: 14,
    color: '#17151F',
    fontWeight: '600',
  },
  contextPill: {
    backgroundColor: '#F1EBFF',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
  },
  contextPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7444E8',
  },

  /* AUDIO QUALITY CARD */
  qualityCardOuter: {
    backgroundColor: '#E4F8EB',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#CDEED8',
    padding: 16,
  },
  qualityCardInner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2F5E9',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 3,
  },
  qualityTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  previewTagPill: {
    backgroundColor: '#E4F8EB',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: '#CDEED8',
  },
  previewTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1F6B3B',
  },
  qualitySubtext: {
    fontSize: 11,
    color: '#6B675C',
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEE8',
  },
  toggleLabel: {
    fontSize: 14,
    color: '#17151F',
    fontWeight: '600',
  },
  switchTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#D1D5DB',
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackActive: {
    backgroundColor: '#2DBE74',
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  switchThumbActive: {
    alignSelf: 'flex-end',
  },

  /* MENTORSHIP AGENDA CARD */
  agendaCardOuter: {
    backgroundColor: '#FFF4D1',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#FBEAB4',
    padding: 16,
  },
  agendaCardInner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F6EED2',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 3,
  },
  agendaItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEE8',
  },
  agendaStepCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agendaStepTextWhite: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  agendaStepTextDark: {
    fontSize: 12,
    fontWeight: '800',
    color: '#17151F',
  },
  agendaItemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#17151F',
  },

  /* SECTION 9 — CTA */
  ctaSectionWrapper: {
    width: '100%',
    marginBottom: 52,
  },
  ctaCard: {
    backgroundColor: '#FFC93C',
    borderRadius: 32,
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#FFC93C',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
    elevation: 5,
  },
  ctaHeading: {
    fontSize: 26,
    fontWeight: '900',
    color: '#17151F',
    textAlign: 'center',
    letterSpacing: -0.8,
    marginBottom: 20,
    maxWidth: 480,
  },
  ctaHeadingTablet: {
    fontSize: 40,
    lineHeight: 46,
    marginBottom: 26,
  },
  ctaButton: {
    backgroundColor: '#17151F',
    borderRadius: 9999,
    paddingVertical: 14,
    paddingHorizontal: 32,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  /* SECTION 10 — FOOTER */
  footerContainer: {
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: '#E9E7E1',
    paddingTop: 32,
    paddingBottom: 24,
  },
  footerGrid: {
    width: '100%',
    gap: 24,
  },
  footerGridTablet: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 32,
  },
  footerColBrand: {
    flex: 2,
    gap: 8,
  },
  brandLogoSmall: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#17151F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandDotSmall: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#FFC93C',
  },
  footerBrandText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#17151F',
  },
  footerDesc: {
    fontSize: 13,
    color: '#6B675C',
    lineHeight: 18,
    maxWidth: 320,
  },
  footerCopyright: {
    fontSize: 12,
    color: '#9C988D',
    marginTop: 6,
  },
  footerCol: {
    flex: 1,
    gap: 8,
  },
  footerColHeader: {
    fontSize: 14,
    fontWeight: '800',
    color: '#17151F',
    marginBottom: 4,
  },
  footerLink: {
    fontSize: 13,
    color: '#6B675C',
    fontWeight: '600',
  },
  footerMutedLink: {
    fontSize: 13,
    color: '#9C988D',
  },

  /* RESPONSIVE ADAPTIVE RULES FOR PHONES & WIDE SCREENS */
  navBarCompact: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  brandLogoCompact: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  brandDotCompact: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  brandTitleCompact: {
    fontSize: 16,
    letterSpacing: -0.3,
  },
  navActionsRowCompact: {
    gap: 6,
  },
  userSectionCompact: {
    gap: 6,
  },
  userAvatarCompact: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  userAvatarTextCompact: {
    fontSize: 12,
  },
  signInBtnCompact: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    minHeight: 34,
  },
  signInTextCompact: {
    fontSize: 12,
  },
  signOutBtnCompact: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    minHeight: 30,
  },
  signOutTextCompact: {
    fontSize: 11,
  },
  navStartBtnCompact: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    minHeight: 34,
  },
  navStartBtnTextCompact: {
    fontSize: 12,
  },
  scrollContentCompact: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 36,
  },
  heroHeadlineCompact: {
    fontSize: 27,
    lineHeight: 33,
    letterSpacing: -0.6,
  },
  heroSubtitleCompact: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
  },
  primaryCtaBtnCompact: {
    minHeight: 48,
    paddingHorizontal: 20,
  },
  primaryCtaTextCompact: {
    fontSize: 15,
  },
  roomCodeContainerCompact: {
    minHeight: 48,
    paddingLeft: 12,
    paddingRight: 5,
  },
  roomCodeInputCompact: {
    fontSize: 14,
    minHeight: 40,
  },
  roomCodeJoinBtnCompact: {
    paddingHorizontal: 16,
    minHeight: 38,
  },
  roomCodeJoinTextCompact: {
    fontSize: 14,
  },
  categoryPillCompact: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  categoryPillTextCompact: {
    fontSize: 11,
  },
  showcaseWindowCardCompact: {
    padding: 8,
    borderRadius: 18,
  },
  showcaseTitleTextCompact: {
    fontSize: 12,
  },
  stageSurfaceCompact: {
    padding: 8,
    gap: 8,
  },
  speakerTileCompact: {
    padding: 14,
    minHeight: 180,
  },
  speakerAvatarCompact: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: 8,
  },
  speakerAvatarTextCompact: {
    fontSize: 24,
  },
  speakerSpeechBubbleCompact: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
  },
  speakerSpeechTextCompact: {
    fontSize: 11,
  },
  sideTilesColCompact: {
    gap: 6,
  },
  miniTileCompact: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  miniAvatarCompact: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginBottom: 4,
  },
  miniAvatarTextCompact: {
    fontSize: 13,
  },
  miniTileNameCompact: {
    fontSize: 10,
  },
  simulatedControlsBarCompact: {
    gap: 6,
    paddingTop: 4,
  },
  simControlCircleCompact: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  simControlPillCompact: {
    width: 46,
    height: 36,
    borderRadius: 18,
  },
  sectionHeadingCompact: {
    fontSize: 22,
    letterSpacing: -0.6,
    marginBottom: 16,
  },
  roundTableContainerCompact: {
    height: 370,
  },
  centralTableOvalCompact: {
    width: '52%',
    height: '36%',
    borderRadius: 50,
  },
  centralTableTextCompact: {
    fontSize: 10,
  },
  rtAvatarCompact: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  rtAvatarTextCompact: {
    fontSize: 15,
  },
  rtNameCompact: {
    fontSize: 10,
  },
  anantContainerCompact: {
    top: 4,
    transform: [{ translateX: -26 }],
    width: 52,
  },
  anantBubbleCompact: {
    maxWidth: 110,
    padding: 6,
    left: '58%',
    top: 2,
  },

  sanaraContainerCompact: {
    left: 4,
    top: '32%',
    width: 60,
    alignItems: 'center',
  },
  sanaraBubbleCompact: {
    maxWidth: 96,
    padding: 6,
    left: 4,
    top: '8%',
  },
  shivamContainerCompact: {
    right: 4,
    top: '32%',
    width: 60,
    alignItems: 'center',
  },

  raoContainerCompact: {
    left: '14%',
    bottom: 6,
  },
  nehaContainerCompact: {
    right: '14%',
    bottom: 6,
  },
  nehaBubbleCompact: {
    maxWidth: 105,
    padding: 6,
    right: 4,
    bottom: '22%',
  },
  bubbleTextCompact: {
    fontSize: 9,
    lineHeight: 12,
  },
  roomGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  roomCategoryCardWide: {
    width: '48%',
    minHeight: 120,
  },
  ctaCardCompact: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    borderRadius: 22,
  },
  ctaHeadingCompact: {
    fontSize: 22,
    marginBottom: 14,
  },
  footerContainerCompact: {
    paddingTop: 20,
    paddingBottom: 16,
  },
});
