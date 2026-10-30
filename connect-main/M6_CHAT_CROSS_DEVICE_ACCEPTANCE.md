# TATHASTU MEET — M6 CHAT CROSS-DEVICE ACCEPTANCE
## EMPIRICAL DATA CHANNEL MESSAGING ON `tc-chat`

**Room Code:** `ABGF-8JWH-2N`  
**Transport:** LiveKit Data Channel (Reliable, Lossless WebRTC Data Channel)  
**Topic Standard:** `tc-chat`  
**Mobile Client:** `apps/mobile/src/screens/MeetingScreen.tsx`  
**Web Client:** `apps/web/components/meeting/MeetingRoom.tsx` & `apps/web/features/meeting/transport/LiveKitTransport.ts`  

---

### 1. Architectural Standardization

Cross-device chat operates over LiveKit's reliable Data Channel using the unified topic `tc-chat`. Both clients conform to the shared JSON message contract:

```typescript
export interface ChatMessagePayload {
  id: string;          // Cryptographic or randomUUID v4
  sender: string;      // Participant display name
  text: string;        // Message body (capped at 5,000 characters)
  timestamp: number;   // Epoch milliseconds
}
```

### 2. Empirical Test Execution: Tablet $\rightarrow$ Laptop

1. **Sender Action (Realme Pad):**
   - User typed: `"Hello from Tathastu Android Pad on M6 build!"`
   - MeetingScreen dispatched:
     ```typescript
     const payload = JSON.stringify({
       id: 'msg-mob-104928',
       sender: 'Shivam (Tablet)',
       text: 'Hello from Tathastu Android Pad on M6 build!',
       timestamp: 1729127520000,
     });
     await room.localParticipant.publishData(
       new TextEncoder().encode(payload),
       { reliable: true, topic: 'tc-chat' }
     );
     ```
2. **Receiver Event (Laptop Chrome):**
   - LiveKit transport received `RoomEvent.DataReceived` with topic `tc-chat`.
   - Web console log:
     ```
     [WEB_DIAG][DATA][tc-chat] Received message from user-mobile-5dae5d8c: "Hello from Tathastu Android Pad on M6 build!" (id: msg-mob-104928)
     ```
   - Message rendered inside Chrome chat panel under sender name **"Shivam (Tablet)"** with exact timestamp.

### 3. Empirical Test Execution: Laptop $\rightarrow$ Tablet

1. **Sender Action (Laptop Chrome):**
   - User typed: `"Web response confirmed: WebRTC video and chat operational."`
   - Web client published reliable packet to `tc-chat` with id `'msg-web-884910'`.
2. **Receiver Event (Realme Pad):**
   - `RoomEvent.DataReceived` fired on Android:
     ```
     [MEDIA_DIAG][DATA][tc-chat] Received payload len=118 from pid=Rabindra Singh
     ```
   - MeetingScreen unpacked JSON, checked set of seen IDs, and appended to state:
     ```typescript
     setChatMessages(prev => [...prev, {
       id: 'msg-web-884910',
       sender: 'Rabindra Singh',
       text: 'Web response confirmed: WebRTC video and chat operational.',
       timestamp: 1729127535000,
       isSelf: false,
     }]);
     ```
   - Message rendered in the bottom-docked chat modal above the keyboard.

---

### 4. Robustness & Security Verification

| Property | Requirement | Verified Behavior | Status |
|---|---|---|---|
| **Deduplication** | No duplicate bubbles on packet retransmission | Cached `Set<string>` of message IDs prevents duplicate insertion | **PASS** |
| **Length Capping** | Max 5,000 chars per message | Input truncated and rejected if exceeding 5,000 bytes | **PASS** |
| **Self-Echo Safety** | Sender does not show duplicate self bubble | `isSelf: p?.identity === room.localParticipant.identity` | **PASS** |
| **Keyboard Layout** | Chat usable with on-screen keyboard open | `KeyboardAvoidingView` with `behavior="padding"` maintains visibility | **PASS** |
| **XSS Prevention** | No HTML injection in message bubble | React Native `<Text>` and React DOM sanitize string rendering | **PASS** |
