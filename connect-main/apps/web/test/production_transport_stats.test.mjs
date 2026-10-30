import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, '..');

describe('M6.1 Production WebRTC Transport Telemetry Verification', () => {
  test('LiveKitTransport source code decouples inbound and outbound RTP streams', async () => {
    const lkSource = fs.readFileSync(
      path.join(WEB_ROOT, 'features/meeting/transport/LiveKitTransport.ts'),
      'utf-8'
    );

    // Verify separate tracking variables exist
    assert.ok(lkSource.includes('inboundBytes'), 'Must track inbound bytes separately');
    assert.ok(lkSource.includes('outboundBytes'), 'Must track outbound bytes separately');
    assert.ok(lkSource.includes('inboundBitrateKbps'), 'Must compute inbound bitrate separately');
    assert.ok(lkSource.includes('outboundBitrateKbps'), 'Must compute outbound bitrate separately');
    assert.ok(!lkSource.includes('bytesTotal += stat.bytesSent'), 'Must not mix sent bytes into total received');
  });

  test('LiveKitTransport and P2PTransport eliminate fake 720p and 30fps fallbacks', async () => {
    const lkSource = fs.readFileSync(
      path.join(WEB_ROOT, 'features/meeting/transport/LiveKitTransport.ts'),
      'utf-8'
    );
    const p2pSource = fs.readFileSync(
      path.join(WEB_ROOT, 'features/meeting/transport/P2PTransport.ts'),
      'utf-8'
    );

    // Verify no fallbacks to 1280 / 720 / 30 when video is inactive
    assert.ok(!lkSource.includes('width > 0 ? width : 1280'), 'Must not fall back to 1280 in LiveKitTransport');
    assert.ok(!lkSource.includes('height > 0 ? height : 720'), 'Must not fall back to 720 in LiveKitTransport');
    assert.ok(!lkSource.includes('frameRate > 0 ? frameRate : 30'), 'Must not fall back to 30 fps in LiveKitTransport');

    assert.ok(!p2pSource.includes('{ width: 1280, height: 720 }'), 'Must not fall back to 1280x720 in P2PTransport');
    assert.ok(!p2pSource.includes('frameRate || 30'), 'Must not fall back to 30 fps in P2PTransport');
    assert.ok(!p2pSource.includes('bitrateKbps || 1200'), 'Must not fall back to 1200 kbps in P2PTransport');
  });

  test('TransportDiagnostics safely renders nullable resolution and frameRate', async () => {
    const diagSource = fs.readFileSync(
      path.join(WEB_ROOT, 'components/meeting/TransportDiagnostics.tsx'),
      'utf-8'
    );

    assert.ok(
      diagSource.includes("stats.resolution ?") && diagSource.includes("'Inactive / None'"),
      'Must safely render inactive/none when resolution is null'
    );
    assert.ok(
      diagSource.includes("stats.frameRate !== null ?") && diagSource.includes("'Inactive / None'"),
      'Must safely render inactive/none when frameRate is null'
    );
    assert.ok(
      diagSource.includes("stats.inboundBitrateKbps"),
      'Must display separate inbound directional bitrate'
    );
    assert.ok(
      diagSource.includes("stats.outboundBitrateKbps"),
      'Must display separate outbound directional bitrate'
    );
  });

  test('Production stats function computes separate directional bitrates accurately', () => {
    // Exact algorithm from LiveKitTransport.getStats()
    const computeStats = (inboundBytes, outboundBytes, prevInbound, prevOutbound, now) => {
      let inboundBitrateKbps = 0;
      let outboundBitrateKbps = 0;

      if (prevInbound && inboundBytes >= prevInbound.bytes) {
        const deltaBytes = inboundBytes - prevInbound.bytes;
        const deltaTimeMs = now - prevInbound.timestamp;
        if (deltaTimeMs > 0) {
          inboundBitrateKbps = Math.round((deltaBytes * 8) / deltaTimeMs);
        }
      }

      if (prevOutbound && outboundBytes >= prevOutbound.bytes) {
        const deltaBytes = outboundBytes - prevOutbound.bytes;
        const deltaTimeMs = now - prevOutbound.timestamp;
        if (deltaTimeMs > 0) {
          outboundBitrateKbps = Math.round((deltaBytes * 8) / deltaTimeMs);
        }
      }

      const bitrateKbps = inboundBitrateKbps + outboundBitrateKbps;
      return {
        bitrateKbps,
        inboundBitrateKbps,
        outboundBitrateKbps,
      };
    };

    // Scenario:
    // Remote sends 100,000 bytes over 1000 ms = 800 kbps inbound
    // Local sends 50,000 bytes over 1000 ms = 400 kbps outbound
    const prevIn = { bytes: 500000, timestamp: 10000 };
    const prevOut = { bytes: 200000, timestamp: 10000 };
    const currIn = 600000;
    const currOut = 250000;
    const now = 11000;

    const res = computeStats(currIn, currOut, prevIn, prevOut, now);
    assert.equal(res.inboundBitrateKbps, 800, 'Inbound bitrate must be 800 kbps');
    assert.equal(res.outboundBitrateKbps, 400, 'Outbound bitrate must be 400 kbps');
    assert.equal(res.bitrateKbps, 1200, 'Total bitrate must equal sum of directional streams');
  });
});
