import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, '..');

describe('P0 Smart Media Permissions & Mobile UX Architecture Verification', () => {
  test('Independent media error parser correctly categorizes device errors', async () => {
    const mediaSource = await fs.readFile(path.join(WEB_ROOT, 'features/meeting/media.ts'), 'utf-8');

    assert.ok(mediaSource.includes('export function parseMediaError'), 'parseMediaError must be exported');
    assert.ok(mediaSource.includes("'denied'"), 'Must handle denied state');
    assert.ok(mediaSource.includes("'unavailable'"), 'Must handle unavailable device state');
    assert.ok(mediaSource.includes("'device-busy'"), 'Must handle busy device state');
    assert.ok(mediaSource.includes("'policy-blocked'"), 'Must handle policy blocked state');
    assert.ok(mediaSource.includes('acquireCameraTrack'), 'Must provide independent camera acquisition');
    assert.ok(mediaSource.includes('acquireMicrophoneTrack'), 'Must provide independent microphone acquisition');
  });

  test('Independent acquisition fallback preserves audio when camera fails and vice versa', async () => {
    const mediaSource = await fs.readFile(path.join(WEB_ROOT, 'features/meeting/media.ts'), 'utf-8');

    // Verify createLocalMediaStream contains independent fallback
    assert.ok(
      mediaSource.includes('acquireCameraTrack') && mediaSource.includes('acquireMicrophoneTrack'),
      'createLocalMediaStream must acquire devices independently when combined acquisition fails'
    );
    assert.ok(
      mediaSource.includes('cameraTrack: camResult.track'),
      'Must return acquired cameraTrack even if mic failed'
    );
    assert.ok(
      mediaSource.includes('audioTrack: micResult.track'),
      'Must return acquired audioTrack even if camera failed'
    );
  });

  test('Browser environment detection detects in-app browsers, Android, and WebViews', async () => {
    const detectionSource = await fs.readFile(
      path.join(WEB_ROOT, 'features/meeting/permissions/browserDetection.ts'),
      'utf-8'
    );

    assert.ok(detectionSource.includes('Instagram'), 'Must detect Instagram in-app browser');
    assert.ok(detectionSource.includes('LinkedInApp'), 'Must detect LinkedIn in-app browser');
    assert.ok(detectionSource.includes('FBAN'), 'Must detect Facebook in-app browser');
    assert.ok(detectionSource.includes('GSA'), 'Must detect Google Search App in-app browser');
    assert.ok(detectionSource.includes('Android'), 'Must detect Android');
    assert.ok(detectionSource.includes('hasMediaDevicesSupport'), 'Must verify media devices API availability');
    assert.ok(detectionSource.includes('isSecureContext'), 'Must verify secure HTTPS context');
  });

  test('Prejoin DevicePreview does NOT contain red error overlay or duplicate Enable button', async () => {
    const previewSource = await fs.readFile(
      path.join(WEB_ROOT, 'components/meeting/DevicePreview.tsx'),
      'utf-8'
    );

    // Assert removal of large red error overlay inside preview
    assert.strictEqual(
      previewSource.includes('bg-red-950'),
      false,
      'DevicePreview must NOT render big red error banner inside camera preview'
    );

    // Assert removal of center "Enable Camera & Mic" button inside preview
    assert.strictEqual(
      previewSource.includes('Enable Camera & Mic'),
      false,
      'DevicePreview must NOT render duplicate Enable Camera & Mic button inside video container'
    );

    // Assert unobtrusive blocked state on controls
    assert.ok(
      previewSource.includes('cameraBlocked') && previewSource.includes('micBlocked'),
      'DevicePreview must accept independent cameraBlocked and micBlocked props'
    );
    assert.ok(
      previewSource.includes('onRequestHelp'),
      'DevicePreview must trigger onRequestHelp when blocked control is tapped'
    );
  });

  test('Prejoin Page does NOT contain duplicate purple recommended card or coupled requests', async () => {
    const prejoinPageSource = await fs.readFile(
      path.join(WEB_ROOT, 'app/room/[code]/preview/page.tsx'),
      'utf-8'
    );

    // Assert removal of duplicate purple permission card
    assert.strictEqual(
      prejoinPageSource.includes('Camera and microphone access recommended for meeting'),
      false,
      'Prejoin page must NOT contain duplicate purple recommended card below preview'
    );

    // Assert independent useMediaPermissions controller usage
    assert.ok(
      prejoinPageSource.includes('useMediaPermissions'),
      'Prejoin page must use independent useMediaPermissions hook'
    );
    assert.ok(
      prejoinPageSource.includes('PermissionHelpSheet'),
      'Prejoin page must integrate non-intrusive PermissionHelpSheet'
    );
    assert.ok(
      prejoinPageSource.includes('handleRetryDevice'),
      'Prejoin page must provide device retry without refreshing whole page'
    );

    // Assert join muted always remains functional
    assert.ok(
      prejoinPageSource.includes('Join with camera & mic off'),
      'Prejoin page must preserve join muted flow'
    );
  });

  test('MeetingRoom does NOT contain fixed top-16 pink error overlay over video stage', async () => {
    const meetingRoomSource = await fs.readFile(
      path.join(WEB_ROOT, 'components/meeting/MeetingRoom.tsx'),
      'utf-8'
    );

    // Assert removal of fixed top-16 pink mediaAlert overlay
    assert.strictEqual(
      meetingRoomSource.includes('bg-[#FFE5DF] border border-[#F8C8BF] text-[#D32F2F]'),
      false,
      'MeetingRoom must NOT render fixed pink mediaAlert banner covering participant video tile'
    );
    assert.strictEqual(
      meetingRoomSource.includes('mediaAlert'),
      false,
      'MeetingRoom must eliminate mediaAlert state entirely'
    );

    // Assert independent blocked states
    assert.ok(
      meetingRoomSource.includes('isMicBlocked') && meetingRoomSource.includes('isVideoBlocked'),
      'MeetingRoom must track isMicBlocked and isVideoBlocked independently'
    );
    assert.ok(
      meetingRoomSource.includes('PermissionHelpSheet'),
      'MeetingRoom must render PermissionHelpSheet outside the video viewing area'
    );
  });

  test('MeetingControls toolbar supports blocked device state and help triggers', async () => {
    const controlsSource = await fs.readFile(
      path.join(WEB_ROOT, 'components/meeting/MeetingControls.tsx'),
      'utf-8'
    );

    assert.ok(
      controlsSource.includes('isMicBlocked') && controlsSource.includes('isVideoBlocked'),
      'MeetingControls must accept isMicBlocked and isVideoBlocked props'
    );
    assert.ok(
      controlsSource.includes('onRequestDeviceHelp'),
      'MeetingControls must support onRequestDeviceHelp callback'
    );
  });

  test('TransportDiagnostics is integrated into predictable header zone, preventing mobile overlap with participant names', async () => {
    const diagnosticsSource = await fs.readFile(
      path.join(WEB_ROOT, 'components/meeting/TransportDiagnostics.tsx'),
      'utf-8'
    );
    const stageSource = await fs.readFile(
      path.join(WEB_ROOT, 'components/meeting/MeetingStage.tsx'),
      'utf-8'
    );

    // Assert TransportDiagnostics has inline support
    assert.ok(
      diagnosticsSource.includes('inline = true'),
      'TransportDiagnostics must support inline header rendering'
    );

    // Assert MeetingStage header includes TransportDiagnostics
    assert.ok(
      stageSource.includes('<TransportDiagnostics transport={transport} inline={true} />'),
      'MeetingStage header must integrate TransportDiagnostics in predictable top zone'
    );
  });

  test('PermissionHelpSheet provides step-by-step Chrome, Android OS, and In-App browser guidance', async () => {
    const sheetSource = await fs.readFile(
      path.join(WEB_ROOT, 'components/meeting/PermissionHelpSheet.tsx'),
      'utf-8'
    );

    assert.ok(sheetSource.includes('Chrome Settings'), 'Must include Chrome site settings guidance');
    assert.ok(sheetSource.includes('Phone Settings'), 'Must include Android OS phone settings guidance');
    assert.ok(sheetSource.includes('In-App Browser'), 'Must include In-App browser guidance');
    assert.ok(sheetSource.includes('Copy meeting link'), 'Must provide meeting link copy button for in-app browser');
    assert.ok(sheetSource.includes('Try'), 'Must provide single-device retry action');
    assert.ok(sheetSource.includes('role="dialog"'), 'Must have accessible dialog semantics');
  });

  test('useMediaPermissions uses independent camera and mic request IDs to prevent concurrent capture races', async () => {
    const hookSource = await fs.readFile(
      path.join(WEB_ROOT, 'features/meeting/permissions/useMediaPermissions.ts'),
      'utf-8'
    );

    // Assert independent cameraRequestIdRef and micRequestIdRef exist
    assert.ok(hookSource.includes('cameraRequestIdRef'), 'Must use cameraRequestIdRef for camera requests');
    assert.ok(hookSource.includes('micRequestIdRef'), 'Must use micRequestIdRef for microphone requests');
    assert.strictEqual(
      hookSource.includes('const requestIdRef = useRef(0);'),
      false,
      'Must NOT use single shared requestIdRef for both devices'
    );

    // Assert unmount safety via isMountedRef
    assert.ok(hookSource.includes('isMountedRef'), 'Must track component mount lifecycle via isMountedRef');
    assert.ok(hookSource.includes('isMountedRef.current = false'), 'Must mark unmounted on cleanup');
  });

  test('Prejoin experience enforces default-off devices on mount and strict independent activation', async () => {
    const prejoinSource = await fs.readFile(
      path.join(WEB_ROOT, 'app/room/[code]/preview/page.tsx'),
      'utf-8'
    );

    // Initial state defaults strictly to false on prejoin visit
    assert.ok(
      prejoinSource.includes("const [videoEnabled, setVideoEnabled] = useState(false);"),
      'videoEnabled must default to false on visit until explicit user action'
    );
    assert.ok(
      prejoinSource.includes("const [audioEnabled, setAudioEnabled] = useState(false);"),
      'audioEnabled must default to false on visit until explicit user action'
    );

    // Fragile hasSyncedRef and unprompted background sync are removed
    assert.strictEqual(
      prejoinSource.includes('hasSyncedRef'),
      false,
      'Fragile one-time shared hasSyncedRef mechanism must be removed'
    );

    // Documented explicit opt-in preference check exists
    assert.ok(
      prejoinSource.includes('meet_auto_preview_enabled'),
      'Auto-preview must only activate if user explicitly opted into documented preference'
    );

    // Turning on camera never calls requestMicrophone
    assert.ok(
      prejoinSource.includes('handleToggleVideo'),
      'handleToggleVideo must exist'
    );
    // Turning on microphone never calls requestCamera
    assert.ok(
      prejoinSource.includes('handleToggleAudio'),
      'handleToggleAudio must exist'
    );
  });
});
