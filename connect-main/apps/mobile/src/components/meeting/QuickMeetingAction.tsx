import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Video, Plus, KeyRound, ArrowRight, X } from 'lucide-react-native';

interface QuickMeetingActionProps {
  onNewMeeting: () => void;
  onJoinMeeting: (code: string) => void;
  isCreating?: boolean;
}

export function QuickMeetingAction({
  onNewMeeting,
  onJoinMeeting,
  isCreating = false,
}: QuickMeetingActionProps) {
  const [showSheet, setShowSheet] = useState(false);
  const [showJoinPrompt, setShowJoinPrompt] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleJoinSubmit = () => {
    const trimmed = inputCode.trim();
    if (!trimmed) {
      setError('Please enter a room code.');
      return;
    }
    setShowJoinPrompt(false);
    setShowSheet(false);
    setInputCode('');
    setError(null);
    onJoinMeeting(trimmed);
  };

  return (
    <>
      {/* Floating Translucent Purple Glass Button */}
      <TouchableOpacity
        style={styles.floatingButton}
        onPress={() => setShowSheet(true)}
        accessibilityRole="button"
        accessibilityLabel="Quick meeting options"
        activeOpacity={0.82}
      >
        <View style={styles.glassBackground}>
          <View style={styles.iconContainer}>
            <Video size={22} color="#FFFFFF" strokeWidth={2.2} />
            <View style={styles.plusOverlay}>
              <Plus size={10} color="#FFFFFF" strokeWidth={3} />
            </View>
          </View>
        </View>
      </TouchableOpacity>

      {/* Action Sheet Modal */}
      <Modal
        visible={showSheet}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowSheet(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.dismissArea}
            activeOpacity={1}
            onPress={() => setShowSheet(false)}
          />

          <View style={styles.actionSheet}>
            <View style={styles.dragHandle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Start or Join Meeting</Text>
              <TouchableOpacity
                onPress={() => setShowSheet(false)}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X size={18} color="#17151F" />
              </TouchableOpacity>
            </View>

            {/* Option 1: New meeting */}
            <TouchableOpacity
              style={styles.optionCard}
              onPress={() => {
                setShowSheet(false);
                onNewMeeting();
              }}
              disabled={isCreating}
              accessibilityRole="button"
              accessibilityLabel="New meeting"
            >
              <View style={[styles.optionIconCircle, { backgroundColor: '#7444E8' }]}>
                {isCreating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Video size={22} color="#FFFFFF" />
                )}
              </View>
              <View style={styles.optionTextCol}>
                <Text style={styles.optionTitle}>New meeting</Text>
                <Text style={styles.optionSubtitle}>
                  Create a fresh room link to collaborate instantly
                </Text>
              </View>
              <ArrowRight size={18} color="#7444E8" />
            </TouchableOpacity>

            {/* Option 2: Join meeting */}
            <TouchableOpacity
              style={styles.optionCard}
              onPress={() => {
                setShowJoinPrompt(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Join meeting with code"
            >
              <View style={[styles.optionIconCircle, { backgroundColor: '#F1EBFF' }]}>
                <KeyRound size={22} color="#5A2FC7" />
              </View>
              <View style={styles.optionTextCol}>
                <Text style={styles.optionTitle}>Join with a code</Text>
                <Text style={styles.optionSubtitle}>
                  Enter an invitation code or meeting URL
                </Text>
              </View>
              <ArrowRight size={18} color="#5A2FC7" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Join with Code Dialog */}
      <Modal
        visible={showJoinPrompt}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowJoinPrompt(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.promptDialog}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Join Meeting</Text>
              <TouchableOpacity
                onPress={() => setShowJoinPrompt(false)}
                style={styles.closeBtn}
              >
                <X size={18} color="#17151F" />
              </TouchableOpacity>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Text style={styles.promptDesc}>
              Enter the room code provided by the meeting host (e.g. abc-defg-hij)
            </Text>

            <TextInput
              style={styles.codeInput}
              value={inputCode}
              onChangeText={(t) => {
                setInputCode(t);
                if (error) setError(null);
              }}
              placeholder="e.g. abc-defg-hij"
              placeholderTextColor="#9C988D"
              autoFocus={true}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="join"
              onSubmitEditing={handleJoinSubmit}
            />

            <View style={styles.promptActions}>
              <TouchableOpacity
                style={styles.promptCancelBtn}
                onPress={() => setShowJoinPrompt(false)}
              >
                <Text style={styles.promptCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.promptJoinBtn}
                onPress={handleJoinSubmit}
              >
                <Text style={styles.promptJoinText}>Join Room</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  floatingButton: {
    position: 'absolute',
    right: -10,
    bottom: -10,
    width: 58,
    height: 58,
    borderRadius: 29,
    zIndex: 99,
    shadowColor: '#7444E8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  },
  glassBackground: {
    flex: 1,
    borderRadius: 29,
    backgroundColor: '#7444E8',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusOverlay: {
    position: 'absolute',
    top: -2,
    right: -5,
    backgroundColor: '#FFC93C',
    borderRadius: 6,
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  actionSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    elevation: 10,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E3E0D8',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  closeBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: '#F3F2EE',
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#FAF9FC',
    borderWidth: 1,
    borderColor: '#EFECE6',
    marginBottom: 12,
  },
  optionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  optionTextCol: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#17151F',
    marginBottom: 2,
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  optionSubtitle: {
    fontSize: 12,
    color: '#6E6879',
    lineHeight: 16,
    fontFamily: Platform.select({ android: 'Inter-Regular', ios: 'System', default: 'sans-serif' }),
  },
  promptDialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    marginHorizontal: 20,
    marginBottom: 'auto',
    marginTop: 'auto',
    padding: 22,
    elevation: 8,
  },
  promptDesc: {
    fontSize: 13,
    color: '#6E6879',
    lineHeight: 18,
    marginBottom: 16,
  },
  codeInput: {
    backgroundColor: '#F6F5F2',
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#17151F',
    letterSpacing: 1,
    marginBottom: 18,
  },
  errorBox: {
    backgroundColor: '#FFEAEA',
    borderWidth: 1,
    borderColor: '#FFC7C7',
    borderRadius: 10,
    padding: 8,
    marginBottom: 12,
  },
  errorText: {
    color: '#C53030',
    fontSize: 12,
    fontWeight: '600',
  },
  promptActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  promptCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  promptCancelText: {
    color: '#6E6879',
    fontSize: 14,
    fontWeight: '600',
  },
  promptJoinBtn: {
    backgroundColor: '#7444E8',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  promptJoinText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
