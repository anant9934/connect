# TATHASTU MEET — M5 CHAT PROTOCOL FIX
## Code-Level Protocol Diagnosis, Shared Contract & Interoperability Resolution

**Milestone:** M5 Master Engineering Execution  
**Topic:** Realtime In-Meeting Chat Protocol  
**Files Involved:**  
- `packages/contracts/src/index.ts`
- `apps/web/components/meeting/MeetingRoom.tsx`
- `apps/mobile/src/screens/MeetingScreen.tsx`
- `apps/mobile/test/m5_parity_and_protocol.test.mjs`

---

## 1. Problem Diagnosis: The Confirmed Protocol Mismatch

During M4 testing, users reported that messages typed on the mobile tablet were not appearing on the laptop web browser, and vice versa.

Upon code-level inspection of both codebases, an exact protocol mismatch was discovered:

### Web Implementation
In `apps/web/components/meeting/MeetingRoom.tsx`:
- **Sending:**
  ```typescript
  await transport.sendData('tc-chat', {
    id: msgId,
    text: trimmed,
    timestamp: newMsg.timestamp,
  });
  ```
- **Receiving:**
  ```typescript
  room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant, kind?: any, topic?: string) => {
    if (topic === 'tc-chat') {
      // Process chat message
    }
  });
  ```

### Pre-M5 Mobile Implementation
In `apps/mobile/src/screens/MeetingScreen.tsx`:
- **Sending:**
  ```typescript
  const payload = JSON.stringify({
    type: 'chat',
    text,
    sender: displayName,
    timestamp: Date.now(),
  });
  const data = new TextEncoder().encode(payload);
  await roomRef.current.localParticipant.publishData(data, { reliable: true });
  // Notice: OMITTED topic parameter!
  ```
- **Receiving:**
  ```typescript
  room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
    // Notice: Callback signature omitted the 4th `topic` parameter!
    const data = JSON.parse(new TextDecoder().decode(payload));
    if (data.type === 'chat' && data.text) {
      // Process chat message
    }
  });
  ```

### Consequence: Total Silent Message Drop Both Ways
1. **Android -> Web:** Android published with no topic. The web client received `topic === undefined` (or empty), so its `if (topic === 'tc-chat')` check evaluated to `false`, silently dropping the message.
2. **Web -> Android:** Web published with topic `'tc-chat'` and payload `{ id, text, timestamp }`. Android did not inspect topic and required `data.type === 'chat'`. Because web omitted `type: 'chat'`, Android's `if (data.type === 'chat')` evaluated to `false`, silently dropping the message.
3. Both clients showed optimistic self-messages locally, deceiving users into thinking messages were sent when neither remote peer ever processed them.

---

## 2. Standardized Realtime Protocol Specification

In `packages/contracts/src/index.ts`, we codified the shared realtime protocol contracts:

```typescript
export const TC_TOPIC_CHAT = 'tc-chat';
export const TC_TOPIC_REACTION = 'tc-reaction';
export const TC_TOPIC_NOTES = 'tc-notes';
export const TC_TOPIC_FILES = 'tc-files';

export interface ChatMessagePayload {
  id: string;
  text: string;
  timestamp: number;
  senderName?: string;
  senderIdentity?: string;
}

export interface HandRaisePayload {
  type: 'hand_raise';
  raised: boolean;
}

export interface ReactionEmojiPayload {
  type: 'reaction';
  emoji: string;
}

export type ReactionPayload = HandRaisePayload | ReactionEmojiPayload;
```

---

## 3. Native Android Implementation Fix

In `apps/mobile/src/screens/MeetingScreen.tsx`:

### 1. Updated Send Implementation
```typescript
const handleSendChat = async () => {
  const text = chatInput.trim();
  if (!text || !roomRef.current) return;

  const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newMsg: ChatMessage = {
    id: msgId,
    sender: displayName,
    text,
    timestamp: Date.now(),
    isSelf: true,
    status: 'sending',
  };

  setChatMessages((prev) => [...prev, newMsg]);
  setChatInput('');

  try {
    const payload = JSON.stringify({
      id: msgId,
      text,
      timestamp: newMsg.timestamp,
      senderName: displayName,
      senderIdentity: roomRef.current.localParticipant.identity,
    });
    const data = new TextEncoder().encode(payload);
    await roomRef.current.localParticipant.publishData(data, {
      reliable: true,
      topic: TC_TOPIC_CHAT, // Explicit shared topic
    });

    setChatMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, status: 'sent' } : m))
    );
  } catch (err) {
    console.warn('Failed to publish chat data:', err);
    setChatMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, status: 'error' } : m))
    );
  }
};
```

### 2. Updated Receive Implementation
```typescript
room.on(
  RoomEvent.DataReceived,
  (payload: Uint8Array, participant?: RemoteParticipant, _kind?: any, topic?: string) => {
    if (!isMounted) return;
    try {
      const str = new TextDecoder().decode(payload);
      const data = JSON.parse(str);

      // Handle Chat with topic matching or payload fallback
      if (topic === TC_TOPIC_CHAT || (!topic && data.text && (data.id || data.type === 'chat'))) {
        const msgId = typeof data.id === 'string' ? data.id : `msg_${Date.now()}_${Math.random()}`;
        const senderName =
          data.senderName || data.sender || participant?.name || participant?.identity || 'Participant';
        const senderIdentity = participant?.identity || data.senderIdentity;

        setChatMessages((prev) => {
          // Robust deduplication by message ID
          if (prev.some((m) => m.id === msgId)) return prev;
          return [
            ...prev,
            {
              id: msgId,
              sender: senderName,
              senderIdentity,
              text: data.text,
              timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
              isSelf: false,
              status: 'sent',
            },
          ];
        });

        if (!showChat) {
          setUnreadChatCount((c) => c + 1);
        }
      }
    } catch (e) {
      console.warn('Failed to parse incoming data message:', e);
    }
  }
);
```

---

## 4. Verification & Hardening

1. **Bidirectional Compatibility:**
   - Laptop Web publishes `{ id, text, timestamp }` on `tc-chat` -> Android receives and displays message with sender's name.
   - Android publishes `{ id, text, timestamp, senderName }` on `tc-chat` -> Laptop Web receives and displays message under `tc-chat` topic handler.
2. **Deduplication:** Both clients check `prev.some((m) => m.id === msgId)` preventing duplicate bubble rendering.
3. **Delivery Status Transparency:** Messages display `'sending'` while `publishData` is pending, `'sent'` upon promise resolution, and `'error'` with retry option on failure.
4. **Android Keyboard Safety:** `KeyboardAvoidingView` combined with `onContentSizeChange` ensures that when the Android software keyboard opens, the chat text input and newest messages remain 100% visible and accessible.
