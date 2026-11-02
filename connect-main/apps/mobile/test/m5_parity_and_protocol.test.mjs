import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

test('M5 Priority P0: Shared Realtime Chat Protocol Contract', async (t) => {
  const contractsPath = path.join(rootDir, 'packages/contracts/src/index.ts');
  const contractsContent = fs.readFileSync(contractsPath, 'utf-8');

  await t.test('contracts export TC_TOPIC_CHAT as "tc-chat"', () => {
    assert.match(contractsContent, /export const TC_TOPIC_CHAT\s*=\s*['"]tc-chat['"]/);
  });

  await t.test('contracts export ChatMessagePayload interface with id, text, timestamp', () => {
    assert.match(contractsContent, /export interface ChatMessagePayload/);
    assert.match(contractsContent, /id:\s*string/);
    assert.match(contractsContent, /text:\s*string/);
    assert.match(contractsContent, /timestamp:\s*number/);
  });

  await t.test('mobile MeetingScreen stores chat through the API and treats data channels as hints', () => {
    const meetingPath = path.join(rootDir, 'apps/mobile/src/screens/MeetingScreen.tsx');
    const meetingContent = fs.readFileSync(meetingPath, 'utf-8');

    assert.match(meetingContent, /defaultApiClient\.postMessage\(roomCode, clientMessageId, text\)/);
    assert.match(meetingContent, /defaultApiClient\.getLiveState\(roomCode, lastSeqRef\.current\)/);
    assert.match(meetingContent, /topic === TC_TOPIC_SYNC/);
    assert.doesNotMatch(meetingContent, /topic === TC_TOPIC_CHAT/);
  });

  await t.test('web MeetingRoom stores chat through the API and treats data channels as hints', () => {
    const webMeetingPath = path.join(rootDir, 'apps/web/components/meeting/MeetingRoom.tsx');
    const webContent = fs.readFileSync(webMeetingPath, 'utf-8');

    assert.match(webContent, /useMeetingInteraction\(/);
    assert.match(webContent, /topic\s*===\s*['"]tc-sync['"]/);
    assert.doesNotMatch(webContent, /topic\s*===\s*['"]tc-chat['"]/);
  });
});

test('M5 Priority P0: Shared Reaction & Hand Raise Protocol Contract', async (t) => {
  const contractsPath = path.join(rootDir, 'packages/contracts/src/index.ts');
  const contractsContent = fs.readFileSync(contractsPath, 'utf-8');

  await t.test('contracts export TC_TOPIC_REACTION as "tc-reaction"', () => {
    assert.match(contractsContent, /export const TC_TOPIC_REACTION\s*=\s*['"]tc-reaction['"]/);
  });

  await t.test('contracts export HandRaisePayload and ReactionEmojiPayload', () => {
    assert.match(contractsContent, /export interface HandRaisePayload/);
    assert.match(contractsContent, /type:\s*['"]hand_raise['"]/);
    assert.match(contractsContent, /export interface ReactionEmojiPayload/);
    assert.match(contractsContent, /type:\s*['"]reaction['"]/);
  });

  await t.test('mobile MeetingScreen stores hands and reactions through the API', () => {
    const meetingPath = path.join(rootDir, 'apps/mobile/src/screens/MeetingScreen.tsx');
    const meetingContent = fs.readFileSync(meetingPath, 'utf-8');

    assert.match(meetingContent, /defaultApiClient\.setHand\(roomCode, !isHandRaised\)/);
    assert.match(meetingContent, /defaultApiClient\.postReaction\(roomCode, emoji\)/);
  });
});

test('M5 Priority P0: Complete 10-Section Homepage Parity & Order', async (t) => {
  const landingPath = path.join(rootDir, 'apps/mobile/src/screens/LandingScreen.tsx');
  const landingContent = fs.readFileSync(landingPath, 'utf-8');

  const requiredSections = [
    { num: 1, name: 'SECTION 1 — NAVIGATION', test: /SECTION 1 — NAVIGATION/ },
    { num: 2, name: 'SECTION 2 — MAIN HERO', test: /SECTION 2 — MAIN HERO/ },
    { num: 3, name: 'SECTION 3 — HERO MEETING SHOWCASE', test: /SECTION 3 — HERO MEETING SHOWCASE/ },
    { num: 4, name: 'SECTION 4 — RESEARCH ROUND TABLE', test: /SECTION 4 — RESEARCH ROUND TABLE/ },
    { num: 5, name: 'SECTION 5 — ROOM CATEGORIES', test: /SECTION 5 — ROOM CATEGORIES/ },
    { num: 6, name: 'SECTION 6 — CONTEXT SECTION', test: /SECTION 6 — CONTEXT SECTION/ },
    { num: 7, name: 'SECTION 7 — AUDIO QUALITY SECTION', test: /SECTION 7 — AUDIO QUALITY SECTION/ },
    { num: 8, name: 'SECTION 8 — MENTORSHIP SECTION', test: /SECTION 8 — MENTORSHIP SECTION/ },
    { num: 9, name: 'SECTION 9 — FINAL CALL TO ACTION', test: /SECTION 9 — FINAL CALL TO ACTION/ },
    { num: 10, name: 'SECTION 10 — FOOTER', test: /SECTION 10 — FOOTER/ },
  ];

  let lastIndex = -1;
  for (const section of requiredSections) {
    await t.test(`Section ${section.num}: ${section.name} exists in LandingScreen`, () => {
      const match = landingContent.search(section.test);
      assert.ok(match > -1, `Missing ${section.name}`);
      assert.ok(match > lastIndex, `${section.name} appears out of order!`);
      lastIndex = match;
    });
  }

  await t.test('Section 2 contains exact headline: "Feels like a real room talk."', () => {
    assert.match(landingContent, /Feels like a/);
    assert.match(landingContent, /real room/);
    assert.match(landingContent, /talk\./);
  });

  await t.test('Section 4 contains exact round table participants: Anant, Sanara, Shivam, Rao, Neha', () => {
    assert.match(landingContent, /Multimodal AI Research Circle/);
    assert.match(landingContent, /Anant/);
    assert.match(landingContent, /Sanara Singh/);
    assert.match(landingContent, /Shivam/);
    assert.match(landingContent, /Prof\. Rao/);
    assert.match(landingContent, /Neha/);
  });

  await t.test('Section 5 contains all five room categories: Instant, Research, Project, Mentor, Community', () => {
    assert.match(landingContent, /Instant Meet/);
    assert.match(landingContent, /Research Room/);
    assert.match(landingContent, /Project Room/);
    assert.match(landingContent, /Mentor Session/);
    assert.match(landingContent, /Community Room/);
  });
});

test('M5 Priority P0: Same Homepage Before and After Login Architecture', async (t) => {
  const appPath = path.join(rootDir, 'apps/mobile/App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf-8');

  await t.test('App.tsx renders LandingScreen for both logged-in and logged-out users', () => {
    assert.match(appContent, /currentScreen\s*===\s*['"]landing['"]/);
    assert.match(appContent, /<LandingScreen/);
    // Does NOT route to a truncated HomeScreen dashboard
    assert.ok(!appContent.includes('<HomeScreen'), 'Must not render truncated HomeScreen');
  });

  await t.test('LandingScreen receives user prop and displays identity/signout when authenticated', () => {
    const landingPath = path.join(rootDir, 'apps/mobile/src/screens/LandingScreen.tsx');
    const landingContent = fs.readFileSync(landingPath, 'utf-8');

    assert.match(landingContent, /user\s*:\s*MobileAuthUser\s*\|\s*null/);
    assert.match(landingContent, /onSignOut/);
    assert.match(landingContent, /onSignIn/);
  });
});

test('M5 Priority P0: Consistent Vector Icon System (No Platform Emojis in Controls)', async (t) => {
  const iconsPath = path.join(rootDir, 'apps/mobile/src/design-system/icons.tsx');
  assert.ok(fs.existsSync(iconsPath), 'design-system/icons.tsx must exist');

  const iconsContent = fs.readFileSync(iconsPath, 'utf-8');
  assert.match(iconsContent, /from 'lucide-react-native'/);

  const meetingScreenPath = path.join(rootDir, 'apps/mobile/src/screens/MeetingScreen.tsx');
  const meetingContent = fs.readFileSync(meetingScreenPath, 'utf-8');

  await t.test('Meeting toolbar does not use platform emojis as control icons', () => {
    // Check controlsBar does not contain raw emoji icons
    assert.ok(!meetingContent.includes("Text style={styles.controlIcon}>🎤"), 'No emoji microphone');
    assert.ok(!meetingContent.includes("Text style={styles.controlIcon}>📹"), 'No emoji camera');
    assert.ok(!meetingContent.includes("Text style={styles.controlIcon}>📞"), 'No emoji phone');
    assert.ok(!meetingContent.includes("Text style={styles.controlIcon}>🔄"), 'No emoji flip');
  });

  await t.test('MeetingScreen imports Lucide vector icons', () => {
    assert.match(meetingContent, /Mic,\s*MicOff,\s*Video,\s*VideoOff/);
    assert.match(meetingContent, /MessageSquare/);
    assert.match(meetingContent, /Users/);
    assert.match(meetingContent, /Smile/);
    assert.match(meetingContent, /Hand/);
    assert.match(meetingContent, /PhoneOff/);
  });
});

test('M5 Priority P0: Real Transport Media Statistics (No Hardcoded Mock Metrics)', async (t) => {
  const liveKitTransportPath = path.join(rootDir, 'apps/web/features/meeting/transport/LiveKitTransport.ts');
  const lkContent = fs.readFileSync(liveKitTransportPath, 'utf-8');

  await t.test('LiveKitTransport queries real RTCPeerConnection stats', () => {
    assert.match(lkContent, /pc\.getStats\(\)/);
    // Does NOT contain hardcoded mock stats
    assert.ok(!lkContent.includes('rttMs: 25'), 'Mock rttMs must be removed');
    assert.ok(!lkContent.includes('jitterMs: 5'), 'Mock jitterMs must be removed');
  });
});
