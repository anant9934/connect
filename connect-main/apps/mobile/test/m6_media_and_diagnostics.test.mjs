import test from 'node:test';
import assert from 'node:assert/strict';

test('M6 Media Diagnostics & Pipeline Telemetry', async (t) => {
  await t.test('Bitrate calculation uses true delta formula instead of cumulative bytes', () => {
    const calculateBitrateKbps = (currentBytes, prevBytes, currentEpochMs, prevEpochMs) => {
      const deltaBytes = currentBytes - prevBytes;
      const deltaTimeMs = currentEpochMs - prevEpochMs;
      if (deltaTimeMs <= 0 || deltaBytes < 0) return 0;
      return Math.round((deltaBytes * 8) / deltaTimeMs);
    };

    // Scenario: Stream has sent 2,000,000 bytes over the call.
    // Over the last 1,000 ms, exactly 125,000 bytes (1,000,000 bits = 1000 kbps) were sent.
    const prevBytes = 1875000;
    const currentBytes = 2000000;
    const prevTime = 10000;
    const currentTime = 11000;

    const bitrate = calculateBitrateKbps(currentBytes, prevBytes, currentTime, prevTime);
    assert.equal(bitrate, 1000, 'Calculated bitrate must equal exactly 1000 kbps');

    // Flawed legacy calculation would have been: (2000000 * 8) / 1000 = 16000 kbps (16x error)
    const legacyCumulative = Math.round((currentBytes * 8) / 1000);
    assert.notEqual(bitrate, legacyCumulative, 'True delta bitrate must not equal cumulative bytes formula');
  });

  await t.test('Diagnostic ring buffer caps at maximum entries and preserves chronological order', () => {
    class DiagnosticRingBuffer {
      constructor(max = 10) {
        this.max = max;
        this.events = [];
      }
      log(event) {
        this.events.push(event);
        if (this.events.length > this.max) {
          this.events.shift();
        }
      }
      getEvents() {
        return [...this.events];
      }
    }

    const ring = new DiagnosticRingBuffer(5);
    for (let i = 1; i <= 8; i++) {
      ring.log({ id: i, event: `event_${i}` });
    }

    const events = ring.getEvents();
    assert.equal(events.length, 5, 'Ring buffer must cap at max capacity');
    assert.equal(events[0].id, 4, 'Oldest retained event must be event 4');
    assert.equal(events[4].id, 8, 'Newest retained event must be event 8');
  });

  await t.test('Room status mapping strictly isolates real backend availability', () => {
    const mapRoomStatus = (apiResponse) => {
      if (!apiResponse) return { state: 'network_error', canJoin: false };
      if (apiResponse.ended) return { state: 'room_ended', canJoin: false };
      if (apiResponse.locked) return { state: 'room_locked', canJoin: false };
      if (apiResponse.inWaitingRoom) return { state: 'waiting_room', canJoin: false };
      if (apiResponse.id || apiResponse.code) return { state: 'ready', canJoin: true };
      return { state: 'not_found', canJoin: false };
    };

    assert.deepEqual(mapRoomStatus({ id: 'room-1', code: 'ABGF-8JWH-2N' }), { state: 'ready', canJoin: true });
    assert.deepEqual(mapRoomStatus({ id: 'room-1', ended: true }), { state: 'room_ended', canJoin: false });
    assert.deepEqual(mapRoomStatus({ id: 'room-1', locked: true }), { state: 'room_locked', canJoin: false });
    assert.deepEqual(mapRoomStatus(null), { state: 'network_error', canJoin: false });
  });

  await t.test('Chat protocol enforces 5000 character cap and valid JSON structure', () => {
    const serializeChat = (id, sender, text) => {
      if (!text || typeof text !== 'string') throw new Error('Invalid text');
      const capped = text.slice(0, 5000);
      return JSON.stringify({
        id,
        sender,
        text: capped,
        timestamp: Date.now()
      });
    };

    const validPayload = serializeChat('msg-1', 'Rabindra', 'Hello from WebRTC test');
    const parsed = JSON.parse(validPayload);
    assert.equal(parsed.id, 'msg-1');
    assert.equal(parsed.sender, 'Rabindra');
    assert.equal(parsed.text, 'Hello from WebRTC test');
    assert.ok(typeof parsed.timestamp === 'number');

    // Huge message
    const hugeText = 'A'.repeat(6000);
    const cappedPayload = serializeChat('msg-2', 'Tablet', hugeText);
    const parsedCapped = JSON.parse(cappedPayload);
    assert.equal(parsedCapped.text.length, 5000, 'Payload must be capped at 5000 characters');
  });

  await t.test('Media track state transitions differentiate publication vs subscription', () => {
    const evaluateParticipantVideo = (hasPub, isSubscribed, isMuted, isTrackActive) => {
      if (!hasPub) return 'NO_TRACK_PUBLISHED';
      if (isMuted) return 'CAMERA_MUTED';
      if (!isSubscribed) return 'SUBSCRIPTION_PENDING';
      if (!isTrackActive) return 'FRAME_RECEIVE_STALLED';
      return 'VIDEO_RENDERING';
    };

    assert.equal(evaluateParticipantVideo(false, false, false, false), 'NO_TRACK_PUBLISHED');
    assert.equal(evaluateParticipantVideo(true, false, true, false), 'CAMERA_MUTED');
    assert.equal(evaluateParticipantVideo(true, false, false, false), 'SUBSCRIPTION_PENDING');
    assert.equal(evaluateParticipantVideo(true, true, false, false), 'FRAME_RECEIVE_STALLED');
    assert.equal(evaluateParticipantVideo(true, true, false, true), 'VIDEO_RENDERING');
  });
});
