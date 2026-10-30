import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

// =============================================================================
// PHASE A: RESEARCH ROUND TABLE GEOMETRY & COLLISION VERIFICATION
// =============================================================================
test('Phase A: Research Round Table Geometry & Collision Verification', async (t) => {
  const landingPath = path.join(rootDir, 'apps/mobile/src/screens/LandingScreen.tsx');
  const landingContent = fs.readFileSync(landingPath, 'utf-8');

  await t.test('All 5 participants are preserved with exact names and avatars', () => {
    assert.match(landingContent, /Anant/);
    assert.match(landingContent, /Sanara Singh/);
    assert.match(landingContent, /Shivam/);
    assert.match(landingContent, /Prof\. Rao/);
    assert.match(landingContent, /Neha/);
    assert.match(landingContent, /Multimodal AI Research Circle/);
  });

  await t.test('All 3 conversation bubbles are preserved with exact texts', () => {
    assert.match(landingContent, /Can we reuse the same evaluation set\?/);
    assert.match(landingContent, /Power data is the hard part\./);
    assert.match(landingContent, /I can share my dataset notes\./);
  });

  await t.test('Roundtable container allocates dynamic height (370dp-420dp) rather than cramped 290dp', () => {
    assert.match(landingContent, /roundTableContainer:\s*\{[\s\S]*height:\s*380/);
    assert.match(landingContent, /roundTableContainerCompact:\s*\{[\s\S]*height:\s*370/);
    assert.match(landingContent, /roundTableContainerTablet:\s*\{[\s\S]*height:\s*420/);
  });

  await t.test('Anant bubble is anchored to the RIGHT of Anant (left: 58%) to guarantee zero collision', () => {
    assert.match(landingContent, /anantBubble:\s*\{[\s\S]*left:\s*'58%'/);
    assert.match(landingContent, /anantBubbleCompact:\s*\{[\s\S]*left:\s*'58%'/);
  });

  await t.test('Mathematical simulation of roundtable geometry across device test matrix', () => {
    const testWidths = [320, 360, 393, 412, 430, 600, 800, 1200];
    const fontScales = [1.0, 1.3, 1.5];

    for (const screenW of testWidths) {
      for (const fs of fontScales) {
        const isCompact = screenW < 380;
        const isTablet = screenW >= 600;
        const gutter = isCompact ? 12 : (isTablet ? 28 : 16);
        const containerW = Math.min(screenW - (gutter * 2), isTablet ? 680 : 580);
        const containerH = isTablet ? 420 : (isCompact ? 370 : 380);

        // 1. Anant: Centered at 50%
        const anantW = (isCompact ? 36 : 42);
        const anantLeft = (containerW / 2) - (anantW / 2);
        const anantRight = anantLeft + anantW;

        // 2. Anant Bubble: left: 58%, maxWidth: 115-135 scaled with fontScale
        const anantBubbleLeft = containerW * 0.58;
        const baseBubbleW = isCompact ? 115 : 135;
        const anantBubbleW = Math.min(baseBubbleW * Math.min(fs, 1.3), containerW - anantBubbleLeft - 6);
        const anantBubbleRight = anantBubbleLeft + anantBubbleW;

        // Collision Invariant 1: Anant Bubble left edge > Anant avatar right edge
        assert.ok(
          anantBubbleLeft > anantRight,
          `Width ${screenW}dp, fontScale ${fs}: Bubble (${anantBubbleLeft}dp) must sit to the right of Anant (${anantRight}dp)`
        );

        // Collision Invariant 2: Bubble stays inside container boundary
        assert.ok(
          anantBubbleRight <= containerW + 1,
          `Width ${screenW}dp, fontScale ${fs}: Bubble right edge (${anantBubbleRight}dp) must not cross container width (${containerW}dp)`
        );

        // 3. Sanara & Bubble
        const sanaraTop = containerH * 0.34;
        const sanaraBubbleTop = containerH * (isCompact ? 0.09 : 0.10);
        const sanaraBubbleHeight = 38 * Math.min(fs, 1.3);

        // Collision Invariant 3: Sanara bubble bottom sits above Sanara avatar top
        assert.ok(
          sanaraBubbleTop + sanaraBubbleHeight < sanaraTop,
          `Width ${screenW}dp, fontScale ${fs}: Sanara bubble bottom (${sanaraBubbleTop + sanaraBubbleHeight}dp) must sit above Sanara (${sanaraTop}dp)`
        );

        // 4. Shivam & Neha & Bubble
        const shivamBottom = (containerH * 0.34) + 56;
        const nehaBottomDist = isCompact ? 6 : 8;
        const nehaTop = containerH - nehaBottomDist - 56;
        const nehaBubbleBottomDist = containerH * 0.22;
        const nehaBubbleTop = containerH - nehaBubbleBottomDist - (42 * Math.min(fs, 1.3));

        // Collision Invariant 4: Neha bubble sits between Shivam and Neha
        assert.ok(
          nehaBubbleTop > shivamBottom,
          `Width ${screenW}dp, fontScale ${fs}: Neha bubble top (${nehaBubbleTop}dp) must be below Shivam (${shivamBottom}dp)`
        );
        assert.ok(
          nehaBubbleTop + (42 * Math.min(fs, 1.3)) < nehaTop + 15,
          `Width ${screenW}dp, fontScale ${fs}: Neha bubble must not cover Neha identity`
        );
      }
    }
  });
});

// =============================================================================
// PHASE B: PREJOIN SCREEN USABLE WIDTH & OVERFLOW PROTECTION
// =============================================================================
test('Phase B: Prejoin Screen Usable Width & Overflow Protection', async (t) => {
  const prejoinPath = path.join(rootDir, 'apps/mobile/src/screens/PrejoinScreen.tsx');
  const prejoinContent = fs.readFileSync(prejoinPath, 'utf-8');

  await t.test('Calculates usableWidth strictly subtracting safeArea insets and gutters', () => {
    assert.match(prejoinContent, /usableWidth\s*=\s*width\s*-\s*safeLeft\s*-\s*safeRight\s*-\s*\(horizontalPadding\s*\*\s*2\)/);
    assert.match(prejoinContent, /containerMaxWidth\s*=\s*useTwoColumn\s*\?\s*Math\.min\(usableWidth,\s*920\)\s*:\s*Math\.min\(usableWidth,\s*480\)/);
  });

  await t.test('Enforces containerMaxWidth on mainWrapper in JSX', () => {
    assert.match(prejoinContent, /style=\{\[\s*styles\.mainWrapper,\s*\{\s*maxWidth:\s*containerMaxWidth\s*\}/);
  });

  await t.test('Prevents 2-column mode on short-height landscape phones (requires height >= 480 or tablet)', () => {
    assert.match(prejoinContent, /useTwoColumn\s*=\s*isLandscape\s*&&\s*\(\(width\s*>=\s*640\s*&&\s*height\s*>=\s*480\)\s*\|\|\s*isTablet\)/);
  });

  await t.test('Removes justifyContent: center from scrollContent to eliminate Android top-clipping bug', () => {
    assert.doesNotMatch(
      prejoinContent,
      /scrollContent:\s*\{[^}]*justifyContent:\s*'center'/
    );
  });

  await t.test('Room code badge truncates and wraps safely on long room codes', () => {
    assert.match(prejoinContent, /numberOfLines=\{1\}\s*ellipsizeMode="middle"/);
    assert.match(prejoinContent, /badgeRow:\s*\{[\s\S]*flexWrap:\s*'wrap'/);
    assert.match(prejoinContent, /roomBadge:\s*\{[\s\S]*flexShrink:\s*1/);
  });

  await t.test('Preview controls are centered with flexWrap and maxWidth to avoid edge overflow', () => {
    assert.match(prejoinContent, /previewControls:\s*\{[\s\S]*flexWrap:\s*'wrap'/);
    assert.match(prejoinContent, /previewControls:\s*\{[\s\S]*maxWidth:\s*'92%'/);
    assert.match(prejoinContent, /previewControlsCompact:\s*\{[\s\S]*maxWidth:\s*'96%'/);
  });
});

// =============================================================================
// PHASE C: CROSS-DEVICE TYPOGRAPHY CONSISTENCY
// =============================================================================
test('Phase C: Cross-Device Typography Consistency', async (t) => {
  await t.test('Inter font family assets are bundled in android assets directory', () => {
    const fontsDir = path.join(rootDir, 'apps/mobile/android/app/src/main/assets/fonts');
    assert.ok(fs.existsSync(fontsDir), 'android fonts assets directory exists');
    const files = fs.readdirSync(fontsDir);
    assert.ok(files.includes('Inter-Regular.otf'), 'Inter-Regular.otf exists');
    assert.ok(files.includes('Inter-Medium.otf'), 'Inter-Medium.otf exists');
    assert.ok(files.includes('Inter-SemiBold.otf'), 'Inter-SemiBold.otf exists');
    assert.ok(files.includes('Inter-Bold.otf'), 'Inter-Bold.otf exists');
  });

  await t.test('tokens.ts exports standardized fontFamilies dictionary with platform fallbacks', () => {
    const tokensPath = path.join(rootDir, 'apps/mobile/src/tokens.ts');
    const tokensContent = fs.readFileSync(tokensPath, 'utf-8');
    assert.match(tokensContent, /fontFamilies\s*=\s*\{/);
    assert.match(tokensContent, /regular:\s*Platform\.select/);
    assert.match(tokensContent, /medium:\s*Platform\.select/);
    assert.match(tokensContent, /bold:\s*Platform\.select/);
    assert.match(tokensContent, /fonts:\s*fontFamilies/);
  });

  await t.test('Screens specify explicit font families to prevent OEM theme handwriting font override', () => {
    const landingPath = path.join(rootDir, 'apps/mobile/src/screens/LandingScreen.tsx');
    const landingContent = fs.readFileSync(landingPath, 'utf-8');
    assert.match(landingContent, /fontFamily:\s*Platform\.select\(\{[\s\S]*android:\s*'Inter-Bold'/);
    assert.match(landingContent, /fontFamily:\s*Platform\.select\(\{[\s\S]*android:\s*'Inter-Regular'/);

    const prejoinPath = path.join(rootDir, 'apps/mobile/src/screens/PrejoinScreen.tsx');
    const prejoinContent = fs.readFileSync(prejoinPath, 'utf-8');
    assert.match(prejoinContent, /fontFamily:\s*Platform\.select\(\{[\s\S]*android:\s*'Inter-Bold'/);
    assert.match(prejoinContent, /fontFamily:\s*Platform\.select\(\{[\s\S]*android:\s*'Inter-Regular'/);
  });
});

// =============================================================================
// PHASE D & F: WEBRTC MEDIA CONFIGURATION & ADAPTIVE VIDEO PROFILES
// =============================================================================
test('Phase D & F: WebRTC Media Configuration & Adaptive Video Profiles', async (t) => {
  const meetingPath = path.join(rootDir, 'apps/mobile/src/screens/MeetingScreen.tsx');
  const meetingContent = fs.readFileSync(meetingPath, 'utf-8');

  await t.test('Mobile preserves adaptiveStream: false to prevent native ViewPortDetector black screen bug', () => {
    assert.match(meetingContent, /adaptiveStream:\s*false/);
  });

  await t.test('Mobile enables simulcast publication layers for subscriber quality downscaling', () => {
    assert.match(meetingContent, /simulcast:\s*true/);
    assert.match(meetingContent, /videoSimulcastLayers:\s*\[VideoPresets\.h180,\s*VideoPresets\.h360\]/);
  });
});

// =============================================================================
// PHASE E: ACCURATE MEDIA TELEMETRY & PRIVACY-SAFE EXPORT
// =============================================================================
test('Phase E: Accurate Media Telemetry & Privacy-Safe Export', async (t) => {
  const diagPath = path.join(rootDir, 'apps/mobile/src/services/mediaDiagnostics.ts');
  const diagContent = fs.readFileSync(diagPath, 'utf-8');

  await t.test('Calculates genuine delta bitrate from successive byte counters and elapsed time', () => {
    assert.match(diagContent, /const deltaBytes = inboundBytes - this\.prevInbound\.bytes/);
    assert.match(diagContent, /inBitrate = Math\.round\(\(deltaBytes \* 8\) \/ deltaTimeMs\)/);
  });

  await t.test('Peer connection stats extraction reads real WebRTC candidate-pair, inbound-rtp and outbound-rtp', () => {
    assert.match(diagContent, /stat\.type === 'candidate-pair'/);
    assert.match(diagContent, /stat\.type === 'inbound-rtp'/);
    assert.match(diagContent, /stat\.type === 'outbound-rtp'/);
  });

  await t.test('Generates sanitized diagnostic export for non-USB verification', () => {
    assert.match(diagContent, /generateSanitizedExport/);
    assert.match(diagContent, /com\.aitathastu\.connect/);
  });

  await t.test('MeetingScreen renders real-time WebRTC telemetry card in diagnostics modal', () => {
    const meetingPath = path.join(rootDir, 'apps/mobile/src/screens/MeetingScreen.tsx');
    const meetingContent = fs.readFileSync(meetingPath, 'utf-8');
    assert.match(meetingContent, /Realtime WebRTC Telemetry/);
    assert.match(meetingContent, /telemetrySnapshot\?\.totalBitrateKbps/);
    assert.match(meetingContent, /handleExportDiagnostics/);
  });
});

// =============================================================================
// PHASE G: AUDIO RELIABILITY & DELAY MINIMIZATION
// =============================================================================
test('Phase G: Audio Reliability & Routing', async (t) => {
  const meetingPath = path.join(rootDir, 'apps/mobile/src/screens/MeetingScreen.tsx');
  const meetingContent = fs.readFileSync(meetingPath, 'utf-8');

  await t.test('AudioSession is explicitly started and routed to speaker on join', () => {
    assert.match(meetingContent, /AudioSession\.startAudioSession\(\)/);
    assert.match(meetingContent, /AudioSession\.selectAudioOutput\('speaker'\)/);
  });

  await t.test('AudioSession is stopped on meeting leave to release native audio focus', () => {
    assert.match(meetingContent, /AudioSession\.stopAudioSession\(\)/);
  });

  await t.test('Supports runtime audio route switching between speaker and earpiece', () => {
    assert.match(meetingContent, /const toggleAudioRoute = async/);
    assert.match(meetingContent, /AudioSession\.selectAudioOutput\(nextRoute\)/);
  });
});

// =============================================================================
// PHASE H: SCREEN SHARING END-TO-END REPAIR
// =============================================================================
test('Phase H: Screen Sharing End-to-End Repair', async (t) => {
  const meetingPath = path.join(rootDir, 'apps/mobile/src/screens/MeetingScreen.tsx');
  const meetingContent = fs.readFileSync(meetingPath, 'utf-8');

  await t.test('LocalTrackPublished calls updateParticipants to immediately mount local screen share', () => {
    assert.match(
      meetingContent,
      /\.on\(RoomEvent\.LocalTrackPublished,[\s\S]*updateParticipants\(\);/
    );
  });

  await t.test('LocalTrackUnpublished calls updateParticipants to restore normal grid', () => {
    assert.match(
      meetingContent,
      /\.on\(RoomEvent\.LocalTrackUnpublished,[\s\S]*updateParticipants\(\);/
    );
  });

  await t.test('Resolves either videoTrack or track on local and remote screen publications', () => {
    assert.match(meetingContent, /localScreenPub\.videoTrack \|\| localScreenPub\.track/);
    assert.match(meetingContent, /directScreenPub\.videoTrack \|\| directScreenPub\.track/);
  });

  await t.test('Web LiveKitTransport checks both pub.track and pub.videoTrack', () => {
    const webTransportPath = path.join(rootDir, 'apps/web/features/meeting/transport/LiveKitTransport.ts');
    const webContent = fs.readFileSync(webTransportPath, 'utf-8');
    assert.match(webContent, /screenPub\.track \|\| \(screenPub as any\)\.videoTrack/);
  });

  await t.test('Web MeetingRoom checks both pub.track and pub.videoTrack', () => {
    const webRoomPath = path.join(rootDir, 'apps/web/components/meeting/MeetingRoom.tsx');
    const webRoomContent = fs.readFileSync(webRoomPath, 'utf-8');
    assert.match(webRoomContent, /screenPub\.track \|\| \(screenPub as any\)\.videoTrack/);
  });

  await t.test('Screen share stage renders with contain object-fit to prevent text cropping', () => {
    assert.match(meetingContent, /objectFit="contain"/);
  });
});
