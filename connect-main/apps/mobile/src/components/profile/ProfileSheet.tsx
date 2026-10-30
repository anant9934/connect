import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  BackHandler,
  Alert,
  Platform,
} from 'react-native';
import { X, Camera, Edit2, User, Settings, HelpCircle, LogOut, ChevronRight } from 'lucide-react-native';
import { ProfileAvatar } from './ProfileAvatar';
import { AvatarPicker } from './AvatarPicker';
import { EditNameSheet } from './EditNameSheet';
import { MobileAuthUser } from '../../services/apiClient';

interface ProfileSheetProps {
  visible: boolean;
  user: MobileAuthUser | null;
  onClose: () => void;
  onNavigateSettings: () => void;
  onUpdateName: (newName: string) => Promise<void>;
  onUpdateAvatar: (params: { avatarId?: string; avatarUrl?: string }) => Promise<void>;
  onSignOut: () => void;
}

export function ProfileSheet({
  visible,
  user,
  onClose,
  onNavigateSettings,
  onUpdateName,
  onUpdateAvatar,
  onSignOut,
}: ProfileSheetProps) {
  const [showEditName, setShowEditName] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Handle hardware Back button on Android
  useEffect(() => {
    if (!visible) return;
    const backAction = () => {
      if (showEditName) {
        setShowEditName(false);
        return true;
      }
      if (showHelpModal) {
        setShowHelpModal(false);
        return true;
      }
      onClose();
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [visible, showEditName, showHelpModal, onClose]);

  if (!user) return null;

  const handleLogoutPress = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of Tathastu Meet?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: () => {
            onClose();
            onSignOut();
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Dismiss profile"
        />

        <View style={styles.sheetContainer}>
          {/* Top Bar */}
          <View style={styles.headerBar}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close profile"
            >
              <X size={20} color="#17151F" />
            </TouchableOpacity>

            <Text style={styles.headerTitle}>My Profile</Text>

            {/* Empty view on right for symmetric title centering */}
            <View style={{ width: 44 }} />
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Profile Avatar & Identity */}
            <View style={styles.identitySection}>
              <View style={styles.avatarWrapper}>
                <ProfileAvatar
                  size={96}
                  avatarId={user.avatarId}
                  avatarUrl={user.avatarUrl}
                  name={user.displayName}
                  email={user.email}
                  useFullResolution={true}
                />
                {/* Camera / Edit Badge */}
                <TouchableOpacity
                  style={styles.cameraBadge}
                  onPress={() => setShowEditName(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Edit profile photo"
                >
                  <Camera size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </View>

              {/* Display Name with Pencil Icon */}
              <TouchableOpacity
                style={styles.nameRow}
                onPress={() => setShowEditName(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit display name"
              >
                <Text style={styles.displayName} numberOfLines={1}>
                  {user.displayName || 'Tathastu User'}
                </Text>
                <Edit2 size={16} color="#7444E8" style={styles.pencilIcon} />
              </TouchableOpacity>

              {/* Account Email */}
              <Text style={styles.emailText} numberOfLines={1}>
                {user.email}
              </Text>
            </View>

            {/* Avatar Chooser Card */}
            <AvatarPicker
              currentAvatarId={user.avatarId}
              currentAvatarUrl={user.avatarUrl}
              userDisplayName={user.displayName}
              userEmail={user.email}
              onSelectAvatar={onUpdateAvatar}
            />

            {/* Profile Action Rows Card (Strictly 1: Edit name, 2: Settings, 3: Help & feedback) */}
            <View style={styles.actionsCard}>
              {/* Row 1: Edit Name */}
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => setShowEditName(true)}
                accessibilityRole="button"
                accessibilityLabel="Edit name"
              >
                <View style={styles.actionLeft}>
                  <View style={styles.actionIconCircle}>
                    <User size={18} color="#4A4557" />
                  </View>
                  <Text style={styles.actionLabel}>Edit name</Text>
                </View>
                <ChevronRight size={18} color="#9C988D" />
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Row 2: Settings */}
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => {
                  onClose();
                  onNavigateSettings();
                }}
                accessibilityRole="button"
                accessibilityLabel="Settings"
              >
                <View style={styles.actionLeft}>
                  <View style={styles.actionIconCircle}>
                    <Settings size={18} color="#4A4557" />
                  </View>
                  <Text style={styles.actionLabel}>Settings</Text>
                </View>
                <ChevronRight size={18} color="#9C988D" />
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Row 3: Help & feedback */}
              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => setShowHelpModal(true)}
                accessibilityRole="button"
                accessibilityLabel="Help and feedback"
              >
                <View style={styles.actionLeft}>
                  <View style={styles.actionIconCircle}>
                    <HelpCircle size={18} color="#4A4557" />
                  </View>
                  <Text style={styles.actionLabel}>Help & feedback</Text>
                </View>
                <ChevronRight size={18} color="#9C988D" />
              </TouchableOpacity>
            </View>

            {/* Logout Row (Coral / Light Red Tint) */}
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={handleLogoutPress}
              accessibilityRole="button"
              accessibilityLabel="Log out of account"
            >
              <View style={styles.logoutLeft}>
                <LogOut size={18} color="#E53E3E" />
                <Text style={styles.logoutText}>Logout</Text>
              </View>
            </TouchableOpacity>
          </ScrollView>

          {/* Edit Name Sheet */}
          <EditNameSheet
            visible={showEditName}
            currentName={user.displayName || ''}
            onSave={onUpdateName}
            onClose={() => setShowEditName(false)}
          />

          {/* Help & Feedback Modal */}
          <Modal
            visible={showHelpModal}
            transparent={true}
            animationType="fade"
            onRequestClose={() => setShowHelpModal(false)}
          >
            <View style={styles.helpOverlay}>
              <View style={styles.helpCard}>
                <View style={styles.helpHeader}>
                  <Text style={styles.helpTitle}>Help & Feedback</Text>
                  <TouchableOpacity onPress={() => setShowHelpModal(false)} style={styles.closeBtn}>
                    <X size={18} color="#17151F" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.helpBody}>
                  Need assistance with Tathastu Meet? We are here to help you get the best conference experience.
                </Text>
                <View style={styles.helpDetails}>
                  <Text style={styles.helpDetailTitle}>Support Email:</Text>
                  <Text style={styles.helpDetailValue}>support@aitathastu.com</Text>
                  <Text style={styles.helpDetailTitle}>Website:</Text>
                  <Text style={styles.helpDetailValue}>https://connect.aitathastu.com</Text>
                  <Text style={styles.helpDetailTitle}>Version:</Text>
                  <Text style={styles.helpDetailValue}>Tathastu Meet v1.0.0 (M8 Authenticated)</Text>
                </View>
                <TouchableOpacity
                  style={styles.helpOkBtn}
                  onPress={() => setShowHelpModal(false)}
                >
                  <Text style={styles.helpOkText}>Got it</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#FAF9FC',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: '94%',
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 12,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F2EE',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#17151F',
    textAlign: 'center',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  scrollView: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  identitySection: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 8,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 8,
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(23, 21, 31, 0.8)',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  displayName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  pencilIcon: {
    marginTop: 2,
  },
  emailText: {
    fontSize: 13,
    color: '#6E6879',
    fontFamily: Platform.select({ android: 'Inter-Regular', ios: 'System', default: 'sans-serif' }),
  },
  actionsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 46,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F6F5F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Medium', ios: 'System', default: 'sans-serif' }),
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#F3F2EE',
    marginLeft: 58,
    marginRight: 16,
  },
  logoutBtn: {
    backgroundColor: '#FFF1F1',
    borderWidth: 1,
    borderColor: '#FFE0E0',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 11,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  logoutLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#E53E3E',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  helpOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  helpCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 22,
    elevation: 6,
  },
  helpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  helpTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#17151F',
  },
  helpBody: {
    fontSize: 14,
    color: '#6E6879',
    lineHeight: 20,
    marginBottom: 16,
  },
  helpDetails: {
    backgroundColor: '#F6F5F2',
    padding: 14,
    borderRadius: 14,
    marginBottom: 18,
  },
  helpDetailTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A857A',
    marginTop: 6,
  },
  helpDetailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#17151F',
  },
  helpOkBtn: {
    backgroundColor: '#7444E8',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  helpOkText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
