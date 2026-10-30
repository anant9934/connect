import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { BUNDLED_AVATARS } from '../../services/avatarRegistry';
import { ProfileAvatar } from './ProfileAvatar';
import { Upload, MoreHorizontal, X, Check } from 'lucide-react-native';

interface AvatarPickerProps {
  currentAvatarId?: string | null;
  currentAvatarUrl?: string | null;
  userDisplayName?: string | null;
  userEmail?: string | null;
  onSelectAvatar: (params: { avatarId?: string; avatarUrl?: string }) => Promise<void> | void;
}

export function AvatarPicker({
  currentAvatarId,
  currentAvatarUrl,
  userDisplayName,
  userEmail,
  onSelectAvatar,
}: AvatarPickerProps) {
  const [showMoreModal, setShowMoreModal] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Check if an item is currently selected
  const isSelected = (id?: string, isInitial?: boolean, isInitialAlt?: boolean) => {
    if (currentAvatarUrl) return false;
    if (isInitial) {
      return !currentAvatarId || currentAvatarId === 'initial_primary';
    }
    if (isInitialAlt) {
      return currentAvatarId === 'initial_alt';
    }
    return currentAvatarId === id;
  };

  const handlePickImage = async () => {
    try {
      setUploading(true);
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Required', 'Permission to access photo gallery is needed to upload an avatar.');
        setUploading(false);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        // Create safe base64 data uri if available, or file uri
        const uri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
        await onSelectAvatar({ avatarId: '', avatarUrl: uri });
      }
    } catch (err: any) {
      Alert.alert('Upload Failed', err?.message || 'Could not process the selected image.');
    } finally {
      setUploading(false);
    }
  };

  const handleSelectBundled = async (avatarId: string) => {
    await onSelectAvatar({ avatarId, avatarUrl: '' });
  };

  const handleSelectInitial = async (type: 'initial_primary' | 'initial_alt') => {
    await onSelectAvatar({ avatarId: type, avatarUrl: '' });
  };

  const userInitial = (userDisplayName || userEmail || 'S').trim().charAt(0).toUpperCase();

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Choose a profile picture</Text>

      {/* 2 rows x 4 columns grid matching Screen 2 */}
      <View style={styles.grid}>
        {/* Row 1 */}
        <View style={styles.row}>
          {/* Tile 1: Upload */}
          <TouchableOpacity
            style={styles.itemWrapper}
            onPress={handlePickImage}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Upload photo"
          >
            <View style={[styles.avatarCircle, styles.uploadCircle]}>
              {uploading ? (
                <ActivityIndicator size="small" color="#7444E8" />
              ) : (
                <Upload size={22} color="#4A4557" />
              )}
            </View>
            <Text style={styles.itemLabel}>Upload</Text>
          </TouchableOpacity>

          {/* Tile 2: Primary Initial (Purple) */}
          <TouchableOpacity
            style={styles.itemWrapper}
            onPress={() => handleSelectInitial('initial_primary')}
            accessibilityRole="button"
            accessibilityLabel={`Initials avatar ${userInitial}`}
          >
            <View style={[styles.ringContainer, isSelected(undefined, true) && styles.ringSelected]}>
              <View style={[styles.avatarCircle, { backgroundColor: '#7444E8' }]}>
                <Text style={styles.initialText}>{userInitial}</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Tile 3: Secondary Initial (Blue 'A') */}
          <TouchableOpacity
            style={styles.itemWrapper}
            onPress={() => handleSelectInitial('initial_alt')}
            accessibilityRole="button"
            accessibilityLabel="Initials avatar A"
          >
            <View style={[styles.ringContainer, isSelected(undefined, false, true) && styles.ringSelected]}>
              <View style={[styles.avatarCircle, { backgroundColor: '#3B82F6' }]}>
                <Text style={styles.initialText}>A</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Tile 4: Bundled Avatar 1 */}
          <TouchableOpacity
            style={styles.itemWrapper}
            onPress={() => handleSelectBundled('avatar_01')}
            accessibilityRole="button"
            accessibilityLabel="Avatar 1"
          >
            <View style={[styles.ringContainer, isSelected('avatar_01') && styles.ringSelected]}>
              <ProfileAvatar size={48} avatarId="avatar_01" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Row 2 */}
        <View style={styles.row}>
          {/* Tile 5: Bundled Avatar 2 */}
          <TouchableOpacity
            style={styles.itemWrapper}
            onPress={() => handleSelectBundled('avatar_02')}
            accessibilityRole="button"
            accessibilityLabel="Avatar 2"
          >
            <View style={[styles.ringContainer, isSelected('avatar_02') && styles.ringSelected]}>
              <ProfileAvatar size={48} avatarId="avatar_02" />
            </View>
          </TouchableOpacity>

          {/* Tile 6: Bundled Avatar 3 */}
          <TouchableOpacity
            style={styles.itemWrapper}
            onPress={() => handleSelectBundled('avatar_03')}
            accessibilityRole="button"
            accessibilityLabel="Avatar 3"
          >
            <View style={[styles.ringContainer, isSelected('avatar_03') && styles.ringSelected]}>
              <ProfileAvatar size={48} avatarId="avatar_03" />
            </View>
          </TouchableOpacity>

          {/* Tile 7: Bundled Avatar 4 */}
          <TouchableOpacity
            style={styles.itemWrapper}
            onPress={() => handleSelectBundled('avatar_04')}
            accessibilityRole="button"
            accessibilityLabel="Avatar 4"
          >
            <View style={[styles.ringContainer, isSelected('avatar_04') && styles.ringSelected]}>
              <ProfileAvatar size={48} avatarId="avatar_04" />
            </View>
          </TouchableOpacity>

          {/* Tile 8: More */}
          <TouchableOpacity
            style={styles.itemWrapper}
            onPress={() => setShowMoreModal(true)}
            accessibilityRole="button"
            accessibilityLabel="More avatars"
          >
            <View style={[styles.avatarCircle, styles.moreCircle]}>
              <MoreHorizontal size={22} color="#6E6879" />
            </View>
            <Text style={styles.itemLabel}>More</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* All Avatars Modal Gallery */}
      <Modal
        visible={showMoreModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowMoreModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Avatar</Text>
              <TouchableOpacity
                onPress={() => setShowMoreModal(false)}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close gallery"
              >
                <X size={20} color="#17151F" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.galleryGrid} showsVerticalScrollIndicator={false}>
              {BUNDLED_AVATARS.map((avatar) => {
                const active = currentAvatarId === avatar.id;
                return (
                  <TouchableOpacity
                    key={avatar.id}
                    style={styles.galleryItem}
                    onPress={async () => {
                      await handleSelectBundled(avatar.id);
                      setShowMoreModal(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={avatar.label}
                  >
                    <View style={[styles.galleryRing, active && styles.ringSelected]}>
                      <ProfileAvatar size={64} avatarId={avatar.id} />
                      {active && (
                        <View style={styles.checkBadge}>
                          <Check size={12} color="#FFFFFF" strokeWidth={3} />
                        </View>
                      )}
                    </View>
                    <Text style={styles.galleryLabel} numberOfLines={1}>
                      {avatar.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#17151F',
    marginBottom: 10,
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  grid: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    minHeight: 56,
  },
  ringContainer: {
    padding: 3,
    borderRadius: 9999,
    borderWidth: 2.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSelected: {
    borderColor: '#7444E8',
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadCircle: {
    backgroundColor: '#F6F5F2',
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    borderStyle: 'dashed',
  },
  moreCircle: {
    backgroundColor: '#F3F2EE',
    borderWidth: 1,
    borderColor: '#E6E4DC',
  },
  initialText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  itemLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6E6879',
    marginTop: 4,
    fontFamily: Platform.select({ android: 'Inter-Medium', ios: 'System', default: 'sans-serif' }),
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '80%',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  closeBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#F3F2EE',
  },
  galleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
    paddingBottom: 20,
  },
  galleryItem: {
    width: '30%',
    alignItems: 'center',
    marginBottom: 8,
  },
  galleryRing: {
    padding: 3,
    borderRadius: 9999,
    borderWidth: 2.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  checkBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#7444E8',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  galleryLabel: {
    fontSize: 11,
    color: '#4A4557',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
    fontFamily: Platform.select({ android: 'Inter-Regular', ios: 'System', default: 'sans-serif' }),
  },
});
