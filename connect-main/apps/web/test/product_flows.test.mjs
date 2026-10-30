import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase 2 Product Flow & Security Structure Verification', () => {
  const webRoot = path.resolve('.');

  test('Auth pages and components exist without marketing contamination', () => {
    const signInPage = path.join(webRoot, 'app/(auth)/sign-in/page.tsx');
    const signUpPage = path.join(webRoot, 'app/(auth)/sign-up/page.tsx');
    const signInForm = path.join(webRoot, 'components/auth/SignInForm.tsx');
    const signUpForm = path.join(webRoot, 'components/auth/SignUpForm.tsx');

    assert.ok(fs.existsSync(signInPage), 'Sign In page must exist');
    assert.ok(fs.existsSync(signUpPage), 'Sign Up page must exist');
    assert.ok(fs.existsSync(signInForm), 'SignInForm component must exist');
    assert.ok(fs.existsSync(signUpForm), 'SignUpForm component must exist');

    const signInContent = fs.readFileSync(signInForm, 'utf-8');
    assert.ok(signInContent.includes('autocomplete="current-password"') || signInContent.includes('autoComplete="current-password"'));
    assert.ok(signInContent.includes('showPassword'));

    const signUpContent = fs.readFileSync(signUpForm, 'utf-8');
    assert.ok(signUpContent.includes('autocomplete="new-password"') || signUpContent.includes('autoComplete="new-password"'));
  });

  test('Pre-join preview page and device selector exist', () => {
    const previewPage = path.join(webRoot, 'app/room/[code]/preview/page.tsx');
    const devicePreview = path.join(webRoot, 'components/meeting/DevicePreview.tsx');
    const deviceSelector = path.join(webRoot, 'components/meeting/DeviceSelector.tsx');

    assert.ok(fs.existsSync(previewPage), 'Pre-join preview page must exist');
    assert.ok(fs.existsSync(devicePreview), 'Device preview component must exist');
    assert.ok(fs.existsSync(deviceSelector), 'Device selector component must exist');

    const previewContent = fs.readFileSync(previewPage, 'utf-8');
    assert.ok(previewContent.includes('videoEnabled'));
    assert.ok(previewContent.includes('audioEnabled'));
    assert.ok(previewContent.includes('getMediaDevices'));
  });

  test('Meeting room and WebRTC controls exist', () => {
    const roomPage = path.join(webRoot, 'app/room/[code]/page.tsx');
    const meetingRoom = path.join(webRoot, 'components/meeting/MeetingRoom.tsx');
    const meetingControls = path.join(webRoot, 'components/meeting/MeetingControls.tsx');
    const participantGrid = path.join(webRoot, 'components/meeting/ParticipantGrid.tsx');
    const screenShareStage = path.join(webRoot, 'components/meeting/ScreenShareStage.tsx');

    assert.ok(fs.existsSync(roomPage), 'Meeting room page must exist');
    assert.ok(fs.existsSync(meetingRoom), 'MeetingRoom component must exist');
    assert.ok(fs.existsSync(meetingControls), 'MeetingControls component must exist');
    assert.ok(fs.existsSync(participantGrid), 'ParticipantGrid component must exist');
    assert.ok(fs.existsSync(screenShareStage), 'ScreenShareStage component must exist');

    const controlsContent = fs.readFileSync(meetingControls, 'utf-8');
    assert.ok(controlsContent.includes('isScreenSharing'));
    assert.ok(controlsContent.includes('onEndMeetingForEveryone'));
    assert.ok(controlsContent.includes('onLeave'));
  });

  test('Zero secrets or API keys leaked into frontend client code', () => {
    const filesToCheck = [
      'features/auth/api.ts',
      'features/rooms/api.ts',
      'features/meeting/livekit.ts',
      'lib/api/client.ts',
    ];

    for (const file of filesToCheck) {
      const fullPath = path.join(webRoot, file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        assert.ok(!content.includes('LIVEKIT_API_SECRET'), `File ${file} must not reference LIVEKIT_API_SECRET`);
        assert.ok(!content.includes('devsecret'), `File ${file} must not contain devsecret`);
      }
    }
  });
});
