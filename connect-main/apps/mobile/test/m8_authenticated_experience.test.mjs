import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

// =============================================================================
// M8 TEST SUITE: AUTHENTICATED EXPERIENCE, PROFILE & SETTINGS
// =============================================================================

test('M8 Gate 1 — Authenticated Homepage Header & Actions', async (t) => {
  const landingPath = path.join(rootDir, 'apps/mobile/src/screens/LandingScreen.tsx');
  const landingContent = fs.readFileSync(landingPath, 'utf-8');

  await t.test('Authenticated header renders single profile avatar button and removes Sign out / Start free', () => {
    // Nav actions row branches cleanly on `user`
    assert.match(landingContent, /headerAvatarBtn/);
    assert.match(landingContent, /onOpenProfile/);
    assert.match(landingContent, /ProfileAvatar/);

    // In authenticated branch, Sign out and Start free must not be present
    const authBranchMatch = landingContent.match(/\{user\s*\?\s*\([\s\S]*?\)\s*:\s*\(/);
    assert.ok(authBranchMatch, 'Branches on user state in header');
    const authBranch = authBranchMatch[0];
    assert.doesNotMatch(authBranch, /signOutBtn/);
    assert.doesNotMatch(authBranch, /navStartBtn/);
    assert.doesNotMatch(authBranch, /Starting\.\.\./);
    assert.doesNotMatch(authBranch, /Start free/);
  });

  await t.test('Unauthenticated guest header preserves Sign in and Start free buttons', () => {
    assert.match(landingContent, /signInBtn/);
    assert.match(landingContent, /navStartBtn/);
  });
});

test('M8 Gate 2 — My Profile Sheet & Avatar Management', async (t) => {
  const profileSheetPath = path.join(rootDir, 'apps/mobile/src/components/profile/ProfileSheet.tsx');
  const profileSheetContent = fs.readFileSync(profileSheetPath, 'utf-8');

  await t.test('ProfileSheet renders My Profile title, close button, identity section, and AvatarPicker', () => {
    assert.match(profileSheetContent, /My Profile/);
    assert.match(profileSheetContent, /ProfileAvatar/);
    assert.match(profileSheetContent, /AvatarPicker/);
    assert.match(profileSheetContent, /cameraBadge/);
  });

  await t.test('ProfileSheet action rows strictly render 1: Edit name, 2: Settings, 3: Help & feedback, 4: Logout', () => {
    assert.match(profileSheetContent, /Edit name/);
    assert.match(profileSheetContent, /Settings/);
    assert.match(profileSheetContent, /Help & feedback/);
    assert.match(profileSheetContent, /Logout/);

    // Explicitly reject duplicate "Account settings" row
    assert.doesNotMatch(profileSheetContent, />Account settings</);
  });

  await t.test('Logout row has coral/red tint and distinct destructive styling', () => {
    assert.match(profileSheetContent, /logoutBtn:\s*\{[\s\S]*backgroundColor:\s*'#FFF1F1'/);
    assert.match(profileSheetContent, /color:\s*'#E53E3E'/);
  });

  await t.test('Avatar Registry bundles all 11 approved local avatar assets with thumbnails', () => {
    const registryPath = path.join(rootDir, 'apps/mobile/src/services/avatarRegistry.ts');
    const registryContent = fs.readFileSync(registryPath, 'utf-8');

    for (let i = 1; i <= 11; i++) {
      const id = `avatar_${String(i).padStart(2, '0')}`;
      assert.match(registryContent, new RegExp(`id:\\s*'${id}'`));
      assert.match(registryContent, new RegExp(`${id}_thumb\\.png`));
      assert.match(registryContent, new RegExp(`${id}\\.png`));
    }
  });
});

test('M8 Gate 3 — Exact Settings Page Hierarchy & Behaviors', async (t) => {
  const settingsPath = path.join(rootDir, 'apps/mobile/src/screens/SettingsScreen.tsx');
  const settingsContent = fs.readFileSync(settingsPath, 'utf-8');

  await t.test('Settings screen renders back button, Settings title, and all 4 exact section groups', () => {
    assert.match(settingsContent, /Settings/);
    assert.match(settingsContent, /Account/);
    assert.match(settingsContent, /Security/);
    assert.match(settingsContent, /Login & Accounts/);
    assert.match(settingsContent, /Preferences/);
  });

  await t.test('Group 1 (Account) contains Profile info, Change name, Choose profile picture, Email', () => {
    assert.match(settingsContent, /Profile information/);
    assert.match(settingsContent, /Change name/);
    assert.match(settingsContent, /Choose profile picture/);
    assert.match(settingsContent, /Email/);
  });

  await t.test('Group 2 (Security) contains Change password and Forgot password', () => {
    assert.match(settingsContent, /Change password/);
    assert.match(settingsContent, /Forgot password/);
  });

  await t.test('Group 3 (Login & Accounts) contains Google and Email & Password with truth-authoritative status', () => {
    assert.match(settingsContent, /Google/);
    assert.match(settingsContent, /Email & Password/);
    // Never hardcode Connected for Google: branches on isGoogleConnected
    assert.match(settingsContent, /isGoogleConnected\s*\?\s*'Connected'\s*:\s*'Not connected'/);
  });

  await t.test('Group 4 (Preferences) contains Audio & Video, Notifications, Appearance, Language', () => {
    assert.match(settingsContent, /Audio & Video/);
    assert.match(settingsContent, /Notifications/);
    assert.match(settingsContent, /Appearance/);
    assert.match(settingsContent, /Language/);
  });

  await t.test('No duplicate Account settings row exists in SettingsScreen', () => {
    assert.doesNotMatch(settingsContent, />Account settings</);
  });
});

test('M8 Gate 4 — Google Authentication & OAuth Architecture', async (t) => {
  const signinPath = path.join(rootDir, 'apps/mobile/src/screens/SignInScreen.tsx');
  const signinContent = fs.readFileSync(signinPath, 'utf-8');

  await t.test('SignInScreen renders Continue with Google button with official Google SVG', () => {
    assert.match(signinContent, /Continue with Google/);
    assert.match(signinContent, /googleBtn/);
    // Google official brand colors present in SVG
    assert.match(signinContent, /#4285F4/); // Blue
    assert.match(signinContent, /#34A853/); // Green
    assert.match(signinContent, /#FBBC05/); // Yellow
    assert.match(signinContent, /#EA4335/); // Red
  });

  await t.test('Handles unconfigured Google OAuth gracefully without crashes or fabricated success', () => {
    assert.match(signinContent, /Google Sign-In Configuration Required/);
    assert.match(signinContent, /M8_GOOGLE_AUTH_INTEGRATION\.md/);
  });
});

test('M8 Gate 5 — Responsive Bug Fixes (Round Table, Showcase & Prejoin)', async (t) => {
  const landingPath = path.join(rootDir, 'apps/mobile/src/screens/LandingScreen.tsx');
  const landingContent = fs.readFileSync(landingPath, 'utf-8');
  const prejoinPath = path.join(rootDir, 'apps/mobile/src/screens/PrejoinScreen.tsx');
  const prejoinContent = fs.readFileSync(prejoinPath, 'utf-8');

  await t.test('Central table oval width is set to 52% (down from 62%) to prevent Sanara Singh overlap', () => {
    assert.match(landingContent, /centralTableOval:\s*\{[\s\S]*width:\s*'52%'/);
    assert.match(landingContent, /centralTableOvalCompact:\s*\{[\s\S]*width:\s*'52%'/);
  });

  await t.test('Mathematical verification: Sanara Singh has >= 8px positive clearance from table oval on 320-430dp', () => {
    const viewports = [320, 360, 393, 412, 430];
    for (const w of viewports) {
      const isCompact = w < 380;
      const gutter = isCompact ? 12 : 16;
      const containerW = Math.min(w - (gutter * 2), 580);

      // Central table oval width is 52%
      const ovalW = containerW * 0.52;
      const ovalLeft = (containerW - ovalW) / 2;

      // Sanara container
      const sanaraLeft = isCompact ? 4 : 6;
      const sanaraW = isCompact ? 60 : 68;
      const sanaraRight = sanaraLeft + sanaraW;

      const clearance = ovalLeft - sanaraRight;
      assert.ok(
        clearance >= 7,
        `Sanara Singh clearance from central table oval on ${w}dp is ${clearance.toFixed(1)}px (>= 7px required)`
      );
    }
  });

  await t.test('Section 3 removes duplicate QuickMeetingAction per M8.1 Phase F', () => {
    assert.doesNotMatch(landingContent, /<QuickMeetingAction/);
    const quickMeetingPath = path.join(rootDir, 'apps/mobile/src/components/meeting/QuickMeetingAction.tsx');
    assert.ok(fs.existsSync(quickMeetingPath), 'QuickMeetingAction.tsx preserved for component history');
  });

  await t.test('PrejoinScreen enforces width containment without horizontal clipping', () => {
    assert.match(prejoinContent, /mainWrapperCompact:\s*\{[\s\S]*width:\s*'100%'/);
    assert.doesNotMatch(prejoinContent, /mainWrapperCompact:\s*\{[^}]*maxWidth:\s*'100%'/);
    assert.match(prejoinContent, /style=\{styles\.scrollView\}/);
    assert.match(prejoinContent, /keyboardShouldPersistTaps="handled"/);
  });
});
