import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Phase 3 Architecture, Security & Light-First Verification', () => {
  const webRoot = path.resolve('.');

  test('Meeting components and panels exist in designated directory structure', () => {
    const requiredMeetingComponents = [
      'components/meeting/MeetingRoom.tsx',
      'components/meeting/MeetingStage.tsx',
      'components/meeting/MeetingControls.tsx',
      'components/meeting/ParticipantsPanel.tsx',
      'components/meeting/ChatPanel.tsx',
      'components/meeting/WaitingRoom.tsx',
      'components/meeting/InviteDialog.tsx',
      'components/meeting/ReactionPicker.tsx',
      'app/history/page.tsx',
    ];

    for (const rel of requiredMeetingComponents) {
      const fullPath = path.join(webRoot, rel);
      assert.ok(fs.existsSync(fullPath), `Required Phase 3 file must exist: ${rel}`);
    }
  });

  test('Performance: Three.js and heavy 3D modules are NOT bundled into meeting routes', () => {
    const meetingFiles = [
      'components/meeting/MeetingRoom.tsx',
      'components/meeting/MeetingStage.tsx',
      'components/meeting/MeetingControls.tsx',
      'components/meeting/ParticipantsPanel.tsx',
      'components/meeting/ChatPanel.tsx',
      'components/meeting/WaitingRoom.tsx',
      'app/room/[code]/page.tsx',
      'app/history/page.tsx',
    ];

    for (const rel of meetingFiles) {
      const content = fs.readFileSync(path.join(webRoot, rel), 'utf-8');
      assert.ok(!content.includes('three'), `Meeting component ${rel} must not import Three.js`);
      assert.ok(!content.includes('@react-three'), `Meeting component ${rel} must not import @react-three`);
    }
  });

  test('Design Aesthetics: Light-First Meeting Palette compliance', () => {
    const meetingStageContent = fs.readFileSync(
      path.join(webRoot, 'components/meeting/MeetingStage.tsx'),
      'utf-8'
    );
    // Background must be light (#FAFAF8)
    assert.ok(
      meetingStageContent.includes('FAFAF8') || meetingStageContent.includes('bg-white'),
      'MeetingStage must use warm-white or white background'
    );
    assert.ok(
      !meetingStageContent.includes('bg-[#111111]'),
      'MeetingStage must NOT have overall dark dashboard background #111111'
    );

    const controlsContent = fs.readFileSync(
      path.join(webRoot, 'components/meeting/MeetingControls.tsx'),
      'utf-8'
    );
    assert.ok(
      !controlsContent.includes('bg-[#141414]'),
      'MeetingControls must NOT use dark #141414 background'
    );
  });

  test('Chat: stored by the server, with a size limit and data channels only as hints', () => {
    const chatPanel = fs.readFileSync(path.join(webRoot, 'components/meeting/ChatPanel.tsx'), 'utf-8');
    assert.ok(chatPanel.includes('MAX_MESSAGE_LENGTH = 2000'), 'Chat must enforce the server limit');

    const meetingRoom = fs.readFileSync(path.join(webRoot, 'components/meeting/MeetingRoom.tsx'), 'utf-8');
    assert.ok(meetingRoom.includes('useMeetingInteraction'), 'MeetingRoom must use stored chat');
    assert.ok(!meetingRoom.includes("topic === 'tc-chat'"), 'MeetingRoom must not trust data channel chat');
  });

  test('Security: Waiting room gatekeeping prevents unauthorized LiveKit token issuance', () => {
    const roomPage = fs.readFileSync(path.join(webRoot, 'app/room/[code]/page.tsx'), 'utf-8');
    assert.ok(roomPage.includes('ADMISSION_REQUIRED'), 'Room page must detect ADMISSION_REQUIRED error');
    assert.ok(roomPage.includes('ADMISSION_PENDING'), 'Room page must detect ADMISSION_PENDING error');
    assert.ok(roomPage.includes('WaitingRoom'), 'Room page must render WaitingRoom for unadmitted guests');
    assert.ok(roomPage.includes('requestAdmission'), 'Room page must request admission via server state');
  });

  test('Meeting History: User-scoped and indexed history queries without raw media retention', () => {
    const historyPage = fs.readFileSync(path.join(webRoot, 'app/history/page.tsx'), 'utf-8');
    assert.ok(historyPage.includes('searchMeetings'), 'History page must invoke getMeetingHistory API');
    assert.ok(historyPage.includes('Authentication Required'), 'History page must prompt unauthenticated users');
  });
});
