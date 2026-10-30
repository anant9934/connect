import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';

import {
  ChevronLeft,
  ChevronRight,
  User,
  Edit2,
  Image as ImageIcon,
  Mail,
  Lock,
  Key,
  Video,
  Bell,
  Palette,
  Globe,
  X,
  Check,
  ShieldCheck,
} from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { MobileAuthUser, defaultApiClient } from '../services/apiClient';
import { secureStorage, SavedPreferences } from '../services/storage';
import { EditNameSheet } from '../components/profile/EditNameSheet';
import { AvatarPicker } from '../components/profile/AvatarPicker';

interface SettingsScreenProps {
  user: MobileAuthUser | null;
  onBack: () => void;
  onUpdateUser: (updated: MobileAuthUser) => void;
}

export function SettingsScreen({ user, onBack, onUpdateUser }: SettingsScreenProps) {
  // Modal states
  const [showEditName, setShowEditName] = useState(false);
  const [showAvatarPickerModal, setShowAvatarPickerModal] = useState(false);
  const [showProfileInfoModal, setShowProfileInfoModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [showMediaPrefsModal, setShowMediaPrefsModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showAppearanceModal, setShowAppearanceModal] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  // Change password inputs
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Preferences state
  const [mediaPrefs, setMediaPrefs] = useState<SavedPreferences>({
    defaultMicOn: false,
    defaultCameraOn: false,
    preferredCameraFacing: 'front',
  });
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [appearance, setAppearance] = useState<'Light' | 'Dark' | 'System'>('Light');
  const [language, setLanguage] = useState('English');

  useEffect(() => {
    async function loadPreferences() {
      const prefs = await secureStorage.getPreferences();
      setMediaPrefs(prefs);
    }
    loadPreferences();
  }, []);

  const handleSaveName = async (newName: string) => {
    if (!user) return;
    const res = await defaultApiClient.updateProfile({ displayName: newName });
    const updated = { ...user, displayName: newName };
    await secureStorage.saveUser(updated);
    onUpdateUser(updated);
  };

  const handleSaveAvatar = async (params: { avatarId?: string; avatarUrl?: string }) => {
    if (!user) return;
    await defaultApiClient.updateProfile(params);
    const updated = {
      ...user,
      avatarId: params.avatarId !== undefined ? params.avatarId : user.avatarId,
      avatarUrl: params.avatarUrl !== undefined ? params.avatarUrl : user.avatarUrl,
    };
    await secureStorage.saveUser(updated);
    onUpdateUser(updated);
  };

  const handleChangePasswordSubmit = async () => {
    if (!newPassword || newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setPasswordLoading(true);
    setPasswordError(null);
    setPasswordSuccess(null);

    try {
      await defaultApiClient.changePassword({
        currentPassword,
        newPassword,
      });
      setPasswordSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setShowChangePasswordModal(false);
        setPasswordSuccess(null);
      }, 1500);
    } catch (err: any) {
      setPasswordError(err?.message || 'Could not change password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSaveMediaPrefs = async (newPrefs: SavedPreferences) => {
    setMediaPrefs(newPrefs);
    await secureStorage.savePreferences(newPrefs);
    try {
      await defaultApiClient.updatePreferences(newPrefs);
    } catch (_) {}
  };

  // Check provider link status
  const isGoogleConnected = Boolean(user?.googleConnected);
  const isEmailPasswordConnected = Boolean(user?.emailPasswordConnected !== false);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF9FC" />

      {/* Top Bar matching Screen 3 */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ChevronLeft size={24} color="#17151F" />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Settings</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* =========================================================================
            GROUP 1 — ACCOUNT
           ========================================================================= */}
        <Text style={styles.sectionHeader}>Account</Text>
        <View style={styles.groupedCard}>
          {/* Row 1: Profile information */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setShowProfileInfoModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Profile information"
          >
            <View style={styles.menuRowLeft}>
              <User size={18} color="#4A4557" />
              <Text style={styles.menuLabel}>Profile information</Text>
            </View>
            <ChevronRight size={18} color="#A39E93" />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Row 2: Change name */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setShowEditName(true)}
            accessibilityRole="button"
            accessibilityLabel="Change name"
          >
            <View style={styles.menuRowLeft}>
              <Edit2 size={18} color="#4A4557" />
              <Text style={styles.menuLabel}>Change name</Text>
            </View>
            <ChevronRight size={18} color="#A39E93" />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Row 3: Choose profile picture */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setShowAvatarPickerModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Choose profile picture"
          >
            <View style={styles.menuRowLeft}>
              <ImageIcon size={18} color="#4A4557" />
              <Text style={styles.menuLabel}>Choose profile picture</Text>
            </View>
            <ChevronRight size={18} color="#A39E93" />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Row 4: Email */}
          <View style={styles.menuRow}>
            <View style={styles.menuRowLeft}>
              <Mail size={18} color="#4A4557" />
              <Text style={styles.menuLabel}>Email</Text>
            </View>
            <View style={styles.menuRowRight}>
              <Text style={styles.menuValueText} numberOfLines={1}>
                {user?.email || 'user@example.com'}
              </Text>
              <ChevronRight size={18} color="#A39E93" />
            </View>
          </View>
        </View>

        {/* =========================================================================
            GROUP 2 — SECURITY
           ========================================================================= */}
        <Text style={styles.sectionHeader}>Security</Text>
        <View style={styles.groupedCard}>
          {/* Row 1: Change password */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => {
              setPasswordError(null);
              setPasswordSuccess(null);
              setShowChangePasswordModal(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Change password"
          >
            <View style={styles.menuRowLeft}>
              <Lock size={18} color="#4A4557" />
              <Text style={styles.menuLabel}>Change password</Text>
            </View>
            <ChevronRight size={18} color="#A39E93" />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Row 2: Forgot password */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setShowForgotPasswordModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Forgot password"
          >
            <View style={styles.menuRowLeft}>
              <Key size={18} color="#4A4557" />
              <Text style={styles.menuLabel}>Forgot password</Text>
            </View>
            <ChevronRight size={18} color="#A39E93" />
          </TouchableOpacity>
        </View>

        {/* =========================================================================
            GROUP 3 — LOGIN & ACCOUNTS
           ========================================================================= */}
        <Text style={styles.sectionHeader}>Login & Accounts</Text>
        <View style={styles.groupedCard}>
          {/* Row 1: Google */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => {
              Alert.alert(
                'Google Account',
                isGoogleConnected
                  ? 'Your Google account is securely linked to this Tathastu Meet profile.'
                  : 'Google OAuth configuration is ready on backend. External Google Cloud client ID configuration required by project owner.'
              );
            }}
            accessibilityRole="button"
            accessibilityLabel="Google Account link status"
          >
            <View style={styles.menuRowLeft}>
              {/* Google colored G vector icon */}
              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <Path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <Path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  fill="#FBBC05"
                />
                <Path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  fill="#EA4335"
                />
              </Svg>
              <Text style={styles.menuLabel}>Google</Text>
            </View>
            <View style={styles.menuRowRight}>
              <Text
                style={[
                  styles.statusBadgeText,
                  isGoogleConnected ? styles.connectedText : styles.disconnectedText,
                ]}
              >
                {isGoogleConnected ? 'Connected' : 'Not connected'}
              </Text>
              <ChevronRight size={18} color="#A39E93" />
            </View>
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Row 2: Email & Password */}
          <View style={styles.menuRow}>
            <View style={styles.menuRowLeft}>
              <Mail size={18} color="#4A4557" />
              <Text style={styles.menuLabel}>Email & Password</Text>
            </View>
            <View style={styles.menuRowRight}>
              <Text
                style={[
                  styles.statusBadgeText,
                  isEmailPasswordConnected ? styles.connectedText : styles.disconnectedText,
                ]}
              >
                {isEmailPasswordConnected ? 'Connected' : 'Not configured'}
              </Text>
              <ChevronRight size={18} color="#A39E93" />
            </View>
          </View>
        </View>

        {/* =========================================================================
            GROUP 4 — PREFERENCES
           ========================================================================= */}
        <Text style={styles.sectionHeader}>Preferences</Text>
        <View style={styles.groupedCard}>
          {/* Row 1: Audio & Video */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setShowMediaPrefsModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Audio and video preferences"
          >
            <View style={styles.menuRowLeft}>
              <Video size={18} color="#4A4557" />
              <Text style={styles.menuLabel}>Audio & Video</Text>
            </View>
            <ChevronRight size={18} color="#A39E93" />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Row 2: Notifications */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setShowNotificationsModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Notifications preferences"
          >
            <View style={styles.menuRowLeft}>
              <Bell size={18} color="#4A4557" />
              <Text style={styles.menuLabel}>Notifications</Text>
            </View>
            <ChevronRight size={18} color="#A39E93" />
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Row 3: Appearance */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setShowAppearanceModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Appearance preferences"
          >
            <View style={styles.menuRowLeft}>
              <Palette size={18} color="#4A4557" />
              <Text style={styles.menuLabel}>Appearance</Text>
            </View>
            <View style={styles.menuRowRight}>
              <Text style={styles.menuValueText}>{appearance}</Text>
              <ChevronRight size={18} color="#A39E93" />
            </View>
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Row 4: Language */}
          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setShowLanguageModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Language preferences"
          >
            <View style={styles.menuRowLeft}>
              <Globe size={18} color="#4A4557" />
              <Text style={styles.menuLabel}>Language</Text>
            </View>
            <View style={styles.menuRowRight}>
              <Text style={styles.menuValueText}>{language}</Text>
              <ChevronRight size={18} color="#A39E93" />
            </View>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* --- MODALS --- */}

      {/* 1. Edit Name Sheet */}
      <EditNameSheet
        visible={showEditName}
        currentName={user?.displayName || ''}
        onSave={handleSaveName}
        onClose={() => setShowEditName(false)}
      />

      {/* 2. Choose Avatar Modal */}
      <Modal
        visible={showAvatarPickerModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowAvatarPickerModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalDialog}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Profile Picture</Text>
              <TouchableOpacity onPress={() => setShowAvatarPickerModal(false)} style={styles.closeBtn}>
                <X size={20} color="#17151F" />
              </TouchableOpacity>
            </View>
            <AvatarPicker
              currentAvatarId={user?.avatarId}
              currentAvatarUrl={user?.avatarUrl}
              userDisplayName={user?.displayName}
              userEmail={user?.email}
              onSelectAvatar={async (params) => {
                await handleSaveAvatar(params);
                setShowAvatarPickerModal(false);
              }}
            />
          </View>
        </View>
      </Modal>

      {/* 3. Profile Information Modal */}
      <Modal
        visible={showProfileInfoModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowProfileInfoModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalDialog}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Profile Information</Text>
              <TouchableOpacity onPress={() => setShowProfileInfoModal(false)} style={styles.closeBtn}>
                <X size={20} color="#17151F" />
              </TouchableOpacity>
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>Display Name</Text>
              <Text style={styles.infoValue}>{user?.displayName || 'Not set'}</Text>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{user?.email || 'Not set'}</Text>
            </View>
            <TouchableOpacity
              style={styles.primaryModalBtn}
              onPress={() => setShowProfileInfoModal(false)}
            >
              <Text style={styles.primaryModalBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 4. Change Password Modal */}
      <Modal
        visible={showChangePasswordModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowChangePasswordModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalDialog}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setShowChangePasswordModal(false)} style={styles.closeBtn}>
                <X size={20} color="#17151F" />
              </TouchableOpacity>
            </View>

            {passwordError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{passwordError}</Text>
              </View>
            ) : null}

            {passwordSuccess ? (
              <View style={styles.successBox}>
                <Text style={styles.successText}>{passwordSuccess}</Text>
              </View>
            ) : null}

            <Text style={styles.inputFieldLabel}>Current Password</Text>
            <TextInput
              style={styles.textInput}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="••••••••"
              placeholderTextColor="#9C988D"
              secureTextEntry={true}
              autoCapitalize="none"
            />

            <Text style={styles.inputFieldLabel}>New Password</Text>
            <TextInput
              style={styles.textInput}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="At least 8 characters"
              placeholderTextColor="#9C988D"
              secureTextEntry={true}
              autoCapitalize="none"
            />

            <Text style={styles.inputFieldLabel}>Confirm New Password</Text>
            <TextInput
              style={styles.textInput}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Repeat new password"
              placeholderTextColor="#9C988D"
              secureTextEntry={true}
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={[styles.primaryModalBtn, passwordLoading && styles.btnDisabled]}
              onPress={handleChangePasswordSubmit}
              disabled={passwordLoading}
            >
              {passwordLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryModalBtnText}>Update Password</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 5. Forgot Password Dialog */}
      <Modal
        visible={showForgotPasswordModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowForgotPasswordModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalDialog}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Password Recovery</Text>
              <TouchableOpacity onPress={() => setShowForgotPasswordModal(false)} style={styles.closeBtn}>
                <X size={20} color="#17151F" />
              </TouchableOpacity>
            </View>
            <Text style={styles.dialogText}>
              To protect your account against enumeration attacks, password recovery links are sent exclusively to your registered address:
            </Text>
            <View style={styles.emailBadge}>
              <Text style={styles.emailBadgeText}>{user?.email}</Text>
            </View>
            <Text style={styles.dialogSubtext}>
              Automated email delivery requires production SMTP / Resend configuration in your deployment environment.
            </Text>
            <TouchableOpacity
              style={styles.primaryModalBtn}
              onPress={() => {
                setShowForgotPasswordModal(false);
                Alert.alert('Notice', 'Password reset instructions will be sent once the email delivery service is configured.');
              }}
            >
              <Text style={styles.primaryModalBtnText}>Request Reset Link</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 6. Media Preferences Modal */}
      <Modal
        visible={showMediaPrefsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowMediaPrefsModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalDialog}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Audio & Video Defaults</Text>
              <TouchableOpacity onPress={() => setShowMediaPrefsModal(false)} style={styles.closeBtn}>
                <X size={20} color="#17151F" />
              </TouchableOpacity>
            </View>

            <View style={styles.prefRow}>
              <View style={styles.prefTextContainer}>
                <Text style={styles.prefTitle}>Default Microphone</Text>
                <Text style={styles.prefDesc}>Join meetings with microphone unmuted</Text>
              </View>
              <TouchableOpacity
                style={[styles.switchTrack, mediaPrefs.defaultMicOn && styles.switchTrackActive]}
                onPress={() => handleSaveMediaPrefs({ ...mediaPrefs, defaultMicOn: !mediaPrefs.defaultMicOn })}
                accessibilityRole="switch"
                accessibilityState={{ checked: Boolean(mediaPrefs.defaultMicOn) }}
              >
                <View style={[styles.switchThumb, mediaPrefs.defaultMicOn && styles.switchThumbActive]} />
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            <View style={styles.prefRow}>
              <View style={styles.prefTextContainer}>
                <Text style={styles.prefTitle}>Default Camera</Text>
                <Text style={styles.prefDesc}>Join meetings with video turned on</Text>
              </View>
              <TouchableOpacity
                style={[styles.switchTrack, mediaPrefs.defaultCameraOn && styles.switchTrackActive]}
                onPress={() => handleSaveMediaPrefs({ ...mediaPrefs, defaultCameraOn: !mediaPrefs.defaultCameraOn })}
                accessibilityRole="switch"
                accessibilityState={{ checked: Boolean(mediaPrefs.defaultCameraOn) }}
              >
                <View style={[styles.switchThumb, mediaPrefs.defaultCameraOn && styles.switchThumbActive]} />
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            <View style={styles.prefRow}>
              <View style={styles.prefTextContainer}>
                <Text style={styles.prefTitle}>Preferred Camera</Text>
                <Text style={styles.prefDesc}>Choose front or back camera by default</Text>
              </View>
              <TouchableOpacity
                style={styles.chipBtn}
                onPress={() => {
                  const nextFacing = mediaPrefs.preferredCameraFacing === 'front' ? 'back' : 'front';
                  handleSaveMediaPrefs({ ...mediaPrefs, preferredCameraFacing: nextFacing });
                }}
              >
                <Text style={styles.chipBtnText}>
                  {mediaPrefs.preferredCameraFacing === 'back' ? 'Back Camera' : 'Front Camera'}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.primaryModalBtn}
              onPress={() => setShowMediaPrefsModal(false)}
            >
              <Text style={styles.primaryModalBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 7. Notifications Modal */}
      <Modal
        visible={showNotificationsModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowNotificationsModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalDialog}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Notifications</Text>
              <TouchableOpacity onPress={() => setShowNotificationsModal(false)} style={styles.closeBtn}>
                <X size={20} color="#17151F" />
              </TouchableOpacity>
            </View>
            <View style={styles.prefRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.prefTitle}>Meeting Alerts</Text>
                <Text style={styles.prefDesc}>Receive room invitation and participant join updates</Text>
              </View>
              <TouchableOpacity
                style={[styles.switchTrack, notificationsEnabled && styles.switchTrackActive]}
                onPress={() => setNotificationsEnabled(!notificationsEnabled)}
                accessibilityRole="switch"
                accessibilityState={{ checked: notificationsEnabled }}
              >
                <View style={[styles.switchThumb, notificationsEnabled && styles.switchThumbActive]} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.primaryModalBtn}
              onPress={() => setShowNotificationsModal(false)}
            >
              <Text style={styles.primaryModalBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 8. Appearance Modal */}
      <Modal
        visible={showAppearanceModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowAppearanceModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalDialog}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Appearance</Text>
              <TouchableOpacity onPress={() => setShowAppearanceModal(false)} style={styles.closeBtn}>
                <X size={20} color="#17151F" />
              </TouchableOpacity>
            </View>
            {(['Light', 'Dark', 'System'] as const).map((opt) => (
              <TouchableOpacity
                key={opt}
                style={styles.optionRow}
                onPress={() => {
                  setAppearance(opt);
                  setShowAppearanceModal(false);
                }}
              >
                <Text style={styles.optionLabel}>{opt}</Text>
                {appearance === opt && <Check size={18} color="#7444E8" strokeWidth={2.5} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* 9. Language Modal */}
      <Modal
        visible={showLanguageModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowLanguageModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalDialog}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Language</Text>
              <TouchableOpacity onPress={() => setShowLanguageModal(false)} style={styles.closeBtn}>
                <X size={20} color="#17151F" />
              </TouchableOpacity>
            </View>
            {(['English', 'Hindi (Coming soon)', 'Spanish (Coming soon)'] as const).map((lang) => {
              const isEn = lang.startsWith('English');
              return (
                <TouchableOpacity
                  key={lang}
                  style={styles.optionRow}
                  disabled={!isEn}
                  onPress={() => {
                    setLanguage('English');
                    setShowLanguageModal(false);
                  }}
                >
                  <Text style={[styles.optionLabel, !isEn && { color: '#9C988D' }]}>{lang}</Text>
                  {isEn && <Check size={18} color="#7444E8" strokeWidth={2.5} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF9FC',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEE8',
    backgroundColor: '#FFFFFF',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#17151F',
    marginLeft: 8,
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8A857A',
    marginBottom: 8,
    marginLeft: 4,
    fontFamily: Platform.select({ android: 'Inter-SemiBold', ios: 'System', default: 'sans-serif' }),
  },
  groupedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: 24,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  menuRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  menuRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Medium', ios: 'System', default: 'sans-serif' }),
  },
  menuValueText: {
    fontSize: 14,
    color: '#8A857A',
    fontWeight: '500',
    maxWidth: 160,
    fontFamily: Platform.select({ android: 'Inter-Regular', ios: 'System', default: 'sans-serif' }),
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  connectedText: {
    color: '#1F6B3B',
  },
  disconnectedText: {
    color: '#8A857A',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F2EE',
    marginLeft: 46,
    marginRight: 16,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalDialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 22,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  closeBtn: {
    padding: 6,
    borderRadius: 18,
    backgroundColor: '#F3F2EE',
  },
  infoBox: {
    backgroundColor: '#F6F5F2',
    padding: 16,
    borderRadius: 16,
    marginBottom: 18,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A857A',
    marginTop: 8,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#17151F',
    marginBottom: 4,
  },
  primaryModalBtn: {
    backgroundColor: '#7444E8',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  primaryModalBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  inputFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#17151F',
    marginBottom: 6,
    marginTop: 8,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#17151F',
    marginBottom: 8,
  },
  errorBox: {
    backgroundColor: '#FFEAEA',
    borderWidth: 1,
    borderColor: '#FFC7C7',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    color: '#C53030',
    fontSize: 13,
    fontWeight: '600',
  },
  successBox: {
    backgroundColor: '#E4F8EB',
    borderWidth: 1,
    borderColor: '#CDEED8',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  successText: {
    color: '#1F6B3B',
    fontSize: 13,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  dialogText: {
    fontSize: 14,
    color: '#4A4557',
    lineHeight: 20,
    marginBottom: 12,
  },
  emailBadge: {
    backgroundColor: '#F1EBFF',
    padding: 10,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  emailBadgeText: {
    color: '#5A2FC7',
    fontWeight: '700',
    fontSize: 14,
  },
  dialogSubtext: {
    fontSize: 12,
    color: '#8A857A',
    lineHeight: 16,
    marginBottom: 16,
  },
  prefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  prefTextContainer: {
    flex: 1,
    flexShrink: 1,
    marginRight: 8,
  },
  prefTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#17151F',
  },
  prefDesc: {
    fontSize: 12,
    color: '#8A857A',
    marginTop: 2,
    flexShrink: 1,
  },
  chipBtn: {
    backgroundColor: '#F1EBFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipBtnText: {
    color: '#5A2FC7',
    fontSize: 13,
    fontWeight: '700',
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F2EE',
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#17151F',
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
    backgroundColor: '#7444E8',
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
});

