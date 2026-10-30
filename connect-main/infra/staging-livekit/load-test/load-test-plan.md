# TATHASTU CONNECT — WEBRTC STAGING LOAD TEST PROCEDURE & ACCEPTANCE CRITERIA
**Target SFU:** Self-Hosted LiveKit Cluster (Mumbai `in-bom`)  
**Objective:** Empirically validate sustained concurrent load capacity (50, 100, 200, 500 CCU) with full 1080p simulcast and Opus audio before claiming production readiness.

---

## 1. Load Testing Tooling & Setup

We utilize the official `livekit-cli` load generator deployed on a separate testing VM in the same Mumbai region to generate synthetic WebRTC traffic without artificially bottlenecking testing clients:

```bash
# Installation on test generator VM
curl -sSL https://get.livekit.io/cli | bash
```

### Test Command Structure
```bash
# Example: 100 Concurrent Participants across 25 rooms (4 participants per room)
livekit-cli load-test \
  --url wss://connect-staging-node1.aitathastu.com \
  --api-key $STAGING_LIVEKIT_API_KEY \
  --api-secret $STAGING_LIVEKIT_API_SECRET \
  --room-prefix bench-room- \
  --num-rooms 25 \
  --publishers-per-room 4 \
  --subscribers-per-room 4 \
  --video-resolution 1080p \
  --video-codec h264 \
  --simulcast \
  --duration 30m
```

---

## 2. Load Testing Phases & Sizing Gates

### Phase 1: 50 CCU Sustained Test (30 Minutes)
* **Topology:** 10 rooms × 5 participants
* **Target Load:** ~100 Mbps egress, ~28,000 PPS
* **Acceptance Criteria:**
  * Node CPU utilization: < 30% average
  * Node RAM usage: < 2.5 GB
  * Packet Loss across all streams: < 0.2%
  * Server UDP drop count (`netstat -su`): **0**

### Phase 2: 100 CCU Sustained Test (30 Minutes)
* **Topology:** 25 rooms × 4 participants
* **Target Load:** ~200 Mbps egress, ~56,000 PPS
* **Acceptance Criteria:**
  * Node CPU utilization: < 50% average
  * Node RAM usage: < 4.0 GB
  * Packet Loss: < 0.5%
  * Server UDP drop count: **0**

### Phase 3: 200 CCU Sustained Stress Test (45 Minutes)
* **Topology:** 50 rooms × 4 participants
* **Target Load:** ~400 Mbps egress, ~112,000 PPS
* **Acceptance Criteria:**
  * Requires Tier 3 Sizing (2× Dedicated 16GB nodes)
  * Cluster CPU utilization: < 65% average
  * Packet Loss: < 1.0%
  * Server UDP drops: **0**
  * Live user concurrent test: Active speaker switch delay < 400ms

### Phase 4: 500 CCU Peak Enterprise Test (60 Minutes)
* **Topology:** 100 rooms × 5 participants
* **Target Load:** ~1.0 Gbps egress, ~282,000 PPS
* **Acceptance Criteria:**
  * Requires Tier 4 Sizing (4× Dedicated 16GB nodes + HA Redis)
  * Cluster CPU utilization: < 75% average
  * NIC throughput: Sustained > 1.0 Gbps without interface queue drops
  * Packet Loss: < 1.0%
  * Zero OOM kills or LiveKit panic restarts

---

## 3. Real-Time Telemetry Data Collection

During each load test run, capture the following metrics every 10 seconds:

```bash
# 1. Host Network Interface PPS and Drops
sar -n DEV 5 120

# 2. Kernel UDP Socket Receive/Send Buffer Errors
watch -n 5 "netstat -su | grep -E 'receive errors|buffer errors'"

# 3. LiveKit SFU Prometheus Metrics
curl -s http://127.0.0.1:6789/metrics | grep -E 'livekit_room_count|livekit_participant_count|livekit_bytes_out|livekit_packet_loss'

# 4. Redis Operations and Memory Usage
redis-cli -h 192.168.10.5 -a $STAGING_REDIS_PASSWORD info stats | grep instantaneous_ops_per_sec
```

---

## 4. Pass/Fail Decision Matrix

If **ANY** of the following conditions occur, the load tier is marked **FAILED**:
1. Server UDP buffer overflow (`RcvbufErrors > 0`).
2. Mean packet loss exceeding 1.5% under non-saturated network conditions.
3. LiveKit server process restart, OOM event, or SIGSEGV.
4. Active room freeze duration exceeding 1.0 second.
5. Signaling handshake timeout (> 3 seconds) for new incoming participants.
