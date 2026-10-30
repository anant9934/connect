import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { X, Check } from 'lucide-react-native';

interface EditNameSheetProps {
  visible: boolean;
  currentName: string;
  onSave: (newName: string) => Promise<void>;
  onClose: () => void;
}

export function EditNameSheet({
  visible,
  currentName,
  onSave,
  onClose,
}: EditNameSheetProps) {
  const [name, setName] = useState(currentName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(currentName);
      setError(null);
    }
  }, [visible, currentName]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }
    if (trimmed.length > 50) {
      setError('Name cannot exceed 50 characters.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onSave(trimmed);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update name. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Edit Name</Text>
            <TouchableOpacity
              onPress={onClose}
              disabled={loading}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={20} color="#17151F" />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            Your display name is visible to other participants in meetings and shared rooms.
          </Text>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={(text) => {
                setName(text);
                if (error) setError(null);
              }}
              placeholder="e.g. Anant Kumar"
              placeholderTextColor="#9C988D"
              autoFocus={true}
              autoCapitalize="words"
              maxLength={50}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={loading}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, loading && styles.btnDisabled]}
              onPress={handleSave}
              disabled={loading}
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <View style={styles.saveRow}>
                  <Check size={18} color="#FFFFFF" strokeWidth={2.5} />
                  <Text style={styles.saveText}>Save</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
  closeBtn: {
    padding: 6,
    borderRadius: 18,
    backgroundColor: '#F3F2EE',
  },
  subtitle: {
    fontSize: 13,
    color: '#6E6879',
    lineHeight: 18,
    marginBottom: 18,
    fontFamily: Platform.select({ android: 'Inter-Regular', ios: 'System', default: 'sans-serif' }),
  },
  errorBox: {
    backgroundColor: '#FFEAEA',
    borderWidth: 1,
    borderColor: '#FFC7C7',
    borderRadius: 12,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    color: '#C53030',
    fontSize: 13,
    fontWeight: '600',
  },
  inputContainer: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#17151F',
    marginBottom: 6,
    fontFamily: Platform.select({ android: 'Inter-Medium', ios: 'System', default: 'sans-serif' }),
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Regular', ios: 'System', default: 'sans-serif' }),
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6E6879',
  },
  saveBtn: {
    backgroundColor: '#7444E8',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  saveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
});
