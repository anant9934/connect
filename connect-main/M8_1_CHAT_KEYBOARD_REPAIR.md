# TATHASTU MEET — M8.1 IN-MEETING CHAT & KEYBOARD REPAIR REPORT

**Project:** Tathastu Meet  
**File Modified:** `apps/mobile/src/screens/MeetingScreen.tsx`  
**Milestone:** M8.1 Master Implementation  
**Affected Defect:** BUG 10 (Chat composer and keyboard overflow)  

---

## 1. Executive Summary

This report documents the root-cause diagnosis and engineering repair of the in-meeting chat drawer on Android devices. Prior to this fix, opening the soft keyboard caused the composer input and Send action to be obscured or pushed outside the usable screen bounds, and pressing the hardware Back button triggered a meeting exit prompt instead of dismissing the drawer.

---

## 2. Root-Cause Analysis

1. **Missing Android Keyboard Avoiding Behavior:**
   - The Chat modal previously specified:
     ```tsx
     <KeyboardAvoidingView
       behavior={Platform.OS === 'ios' ? 'padding' : undefined}
       style={[styles.modalContainer, isShortHeight && styles.modalContainerShort]}
     >
     ```
   - On Android, `behavior={undefined}` causes `KeyboardAvoidingView` to bypass layout adjustments completely.
2. **Modal Window Soft Input Interaction:**
   - Inside React Native's `<Modal>`, Android's native dialog window does not automatically shrink flex children unless `behavior="height"` is explicitly enabled. As a result, the soft keyboard overlaid `chatInputRow`, rendering the message composer and Send button inaccessible.
3. **Hardware Back Handler Collision:**
   - `MeetingScreen` registered a global hardware back listener that unconditionally invoked `confirmLeave()`. When chat was open, pressing the physical or gesture back button triggered an alert asking whether to leave the call, rather than closing the chat drawer.

---

## 3. Implementation Fix

### 3.1 Adaptive Keyboard Avoiding Configuration
Updated `KeyboardAvoidingView` to explicitly handle Android window height shrinkage:
```tsx
<Modal visible={showChat} animationType="slide" transparent onRequestClose={() => setShowChat(false)}>
  <SafeAreaView style={styles.modalOverlay}>
    <TouchableOpacity
      style={styles.modalBackdropTouch}
      activeOpacity={1}
      onPress={() => setShowChat(false)}
      accessibilityLabel="Dismiss chat"
    />
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.modalContainer, isShortHeight && styles.modalContainerShort]}
    >
      <View style={styles.modalHeader}>
        <View style={styles.modalTitleRow}>
          <MessageSquare size={18} color="#17151F" />
          <Text style={styles.modalTitle}>In-Meeting Chat</Text>
        </View>
        <TouchableOpacity onPress={() => setShowChat(false)} style={styles.closeBtn}>
          <X size={18} color="#17151F" />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={chatScrollRef}
        style={styles.chatList}
        contentContainerStyle={styles.chatListContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
      >
        {/* Chat message bubbles */}
      </ScrollView>

      <View style={[styles.chatInputRow, { paddingBottom: Math.max(12, safeInsets?.bottom || 0) }]}>
        <TextInput
          style={styles.chatTextInput}
          placeholder="Type a message to everyone..."
          placeholderTextColor="#8E8A80"
          value={chatInput}
          onChangeText={setChatInput}
          onSubmitEditing={handleSendChat}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.chatSendBtn, !chatInput.trim() && styles.chatSendBtnDisabled]}
          onPress={handleSendChat}
          disabled={!chatInput.trim()}
        >
          <Text style={styles.chatSendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>
</Modal>
```

### 3.2 Prioritized Android Back Navigation
Updated `MeetingScreen`'s `BackHandler` effect to check open overlay states before prompting to leave:
```tsx
useEffect(() => {
  const onBackPress = () => {
    if (showChat) {
      setShowChat(false);
      return true;
    }
    if (showParticipants) {
      setShowParticipants(false);
      return true;
    }
    if (showMoreActions) {
      setShowMoreActions(false);
      return true;
    }
    if (showReactionPicker) {
      setShowReactionPicker(false);
      return true;
    }
    confirmLeave();
    return true;
  };
  const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
  return () => backHandler.remove();
}, [isHost, showChat, showParticipants, showMoreActions, showReactionPicker]);
```

---

## 4. Chat Transport & Protocol Preservation

- **LiveKit Data Channel:** Verified that `room.localParticipant.publishData` over topic `tc-chat` continues to transmit JSON payloads with `id`, `sender`, `text`, and `timestamp`.
- **Deduplication:** Message reception via `RoomEvent.DataReceived` preserves local and remote message identity deduplication.
- **Media Continuity:** Opening, typing in, or dismissing the chat drawer does not affect audio session routing or video streaming tracks.
- **Automated Test Validation:** Verified by Gate 5 in `apps/mobile/test/m8_1_responsiveness_and_immersive.test.mjs`.
