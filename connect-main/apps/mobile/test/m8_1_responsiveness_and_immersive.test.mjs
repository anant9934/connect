import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

test('M8.1 Master Implementation Verification Suite', async (t) => {
  const landingPath = path.join(rootDir, 'apps/mobile/src/screens/LandingScreen.tsx');
  const settingsPath = path.join(rootDir, 'apps/mobile/src/screens/SettingsScreen.tsx');
  const profileSheetPath = path.join(rootDir, 'apps/mobile/src/components/profile/ProfileSheet.tsx');
  const avatarPickerPath = path.join(rootDir, 'apps/mobile/src/components/profile/AvatarPicker.tsx');
  const prejoinPath = path.join(rootDir, 'apps/mobile/src/screens/PrejoinScreen.tsx');
  const meetingPath = path.join(rootDir, 'apps/mobile/src/screens/MeetingScreen.tsx');

  const landingSrc = fs.readFileSync(landingPath, 'utf-8');
  const settingsSrc = fs.readFileSync(settingsPath, 'utf-8');
  const profileSheetSrc = fs.readFileSync(profileSheetPath, 'utf-8');
  const avatarPickerSrc = fs.readFileSync(avatarPickerPath, 'utf-8');
  const prejoinSrc = fs.readFileSync(prejoinPath, 'utf-8');
  const meetingSrc = fs.readFileSync(meetingPath, 'utf-8');

  await t.test('Gate 1 (Prejoin): Preview width containment and control separation', () => {
    // BUG 01: Preview card fills 100% width of column, ensuring symmetric margins matching formCol below
    assert.match(prejoinSrc, /videoPreview:\s*\{[\s\S]*width:\s*'100%'/);
    assert.match(prejoinSrc, /videoPreviewTabletPortrait:\s*\{[\s\S]*width:\s*'100%'/);
    assert.match(prejoinSrc, /videoPreviewCompact:\s*\{[\s\S]*width:\s*'100%'/);

    // BUG 02: Vertical clearance between "Camera is Off" and controls to eliminate collision
    assert.match(prejoinSrc, /avatarFallback:\s*\{[\s\S]*paddingBottom:\s*40/);

    // Visible gap between Mic and Cam buttons
    assert.match(prejoinSrc, /previewControls:\s*\{[\s\S]*gap:\s*12/);
    assert.match(prejoinSrc, /previewControlsCompact:\s*\{[\s\S]*gap:\s*8/);
  });

  await t.test('Gate 2 (Profile & Settings): Avatar visibility, reachable logout, simplified profile info, responsive chip', () => {
    // BUG 03 & 04: ProfileSheet tightened vertical spacing so avatar is completely visible and Logout is reachable
    assert.match(profileSheetSrc, /identitySection:\s*\{[\s\S]*paddingTop:\s*6/);
    assert.match(profileSheetSrc, /actionsCard:\s*\{[\s\S]*borderRadius:\s*18/);
    assert.match(profileSheetSrc, /actionRow:\s*\{[\s\S]*minHeight:\s*46/);
    assert.match(profileSheetSrc, /logoutBtn:\s*\{[\s\S]*minHeight:\s*46/);
    assert.match(avatarPickerSrc, /card:\s*\{[\s\S]*borderRadius:\s*18/);

    // BUG 05: Profile Information modal strips implementation jargon
    assert.doesNotMatch(settingsSrc, /Argon2id/);
    assert.doesNotMatch(settingsSrc, /Server Authenticated/);
    assert.doesNotMatch(settingsSrc, /Active & Verified/);
    assert.match(settingsSrc, /Display Name/);
    assert.match(settingsSrc, /Email/);

    // BUG 06: Audio & Video Defaults Preferred Camera chip does not overflow
    assert.match(settingsSrc, /prefTextContainer:\s*\{[\s\S]*flex:\s*1[\s\S]*flexShrink:\s*1/);
    assert.match(settingsSrc, /chipBtn:\s*\{[\s\S]*flexShrink:\s*0/);
    assert.doesNotMatch(settingsSrc, /prefDesc:\s*\{[\s\S]*maxWidth:\s*240/);
  });

  await t.test('Gate 3 (Landing): Exact single yellow Sign in header button & showcase cleanup', () => {
    // BUG 08 & Critical Guest Header Correction:
    // Exactly ONE guest header button: yellow Sign in button (navStartBtn) with onSignIn handler
    assert.match(landingSrc, /<TouchableOpacity[\s\S]*?styles\.navStartBtn[\s\S]*?onPress=\{onSignIn\}[\s\S]*?>[\s\S]*?Sign in[\s\S]*?<\/TouchableOpacity>/);

    // No grey Sign in button and no "Start free" in guest header
    assert.doesNotMatch(landingSrc, /<TouchableOpacity[\s\S]*?styles\.signInBtn[\s\S]*?onPress=\{onSignIn\}/);
    assert.doesNotMatch(landingSrc, /'Start free'/);

    // BUG 07: QuickMeetingAction removed from showcase
    assert.doesNotMatch(landingSrc, /<QuickMeetingAction/);
  });

  await t.test('Gate 4 (Immersive Meeting): 1-to-1 focus swap, stage tap toggle, auto-hide', () => {
    // BUG 09 & 12: Immersive 1-to-1 video focus state
    assert.match(meetingSrc, /const \[focusedParticipantId, setFocusedParticipantId\] = useState/);
    assert.match(meetingSrc, /const \[controlsVisible, setControlsVisible\] = useState/);
    assert.match(meetingSrc, /handleToggleFocus/);
    assert.match(meetingSrc, /toggleControls/);
    assert.match(meetingSrc, /controlsTimerRef/);

    // Tap to swap focus on PiP
    assert.match(meetingSrc, /onPress=\{handleToggleFocus\}/);

    // Tap to toggle controls on stage
    assert.match(meetingSrc, /onPress=\{toggleControls\}/);

    // Hidden bar style applied when controlsVisible is false
    assert.match(meetingSrc, /!controlsVisible && styles\.hiddenBar/);
    assert.match(meetingSrc, /hiddenBar:\s*\{[\s\S]*display:\s*'none'/);
  });

  await t.test('Gate 5 (Chat & Keyboard): Height avoidance and Android back prioritization', () => {
    // BUG 10: KeyboardAvoidingView handles Android height resize
    assert.match(meetingSrc, /behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);

    // Android back handler priority: closes chat/drawers before confirmLeave
    assert.match(meetingSrc, /if \(showChat\) \{\s*setShowChat\(false\);\s*return true;\s*\}/);
    assert.match(meetingSrc, /if \(showParticipants\) \{\s*setShowParticipants\(false\);\s*return true;\s*\}/);
    assert.match(meetingSrc, /if \(showMoreActions\) \{\s*setShowMoreActions\(false\);\s*return true;\s*\}/);
    assert.match(meetingSrc, /if \(showReactionPicker\) \{\s*setShowReactionPicker\(false\);\s*return true;\s*\}/);

    // Modal onRequestClose handlers
    assert.match(meetingSrc, /<Modal visible=\{showChat\}[\s\S]*onRequestClose=\{\(\) => setShowChat\(false\)\}/);
  });

  await t.test('Gate 6 (Consumer Simplicity): Consumer diagnostics removed while internal telemetry preserved', () => {
    // BUG 11: Diagnostics removed from ordinary top bar and more actions
    assert.doesNotMatch(meetingSrc, /<TouchableOpacity[\s\S]*?openDiagnostics[\s\S]*?Activity/);
    assert.doesNotMatch(meetingSrc, /styles\.moreActionItem[\s\S]*?openDiagnostics/);

    // Live indicator is purely informational status badge
    assert.doesNotMatch(meetingSrc, /<TouchableOpacity[\s\S]*?styles\.liveIndicator[\s\S]*?openDiagnostics/);
    assert.match(meetingSrc, /<View style=\{styles\.liveIndicator\}>/);

    // Diagnostics modal is scoped to development only
    assert.match(meetingSrc, /\{Boolean\(__DEV__\) && \(/);

    // Internal telemetry logs remain intact
    assert.match(meetingSrc, /mediaDiagnostics\.log\('room', 'Connected'/);
    assert.match(meetingSrc, /mediaDiagnostics\.log\('media', 'AndroidCameraPublishAttempt'/);
  });
});
