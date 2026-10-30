/**
 * Realtime Media Diagnostics & WebRTC Telemetry for Tathastu Meet Android
 * Captures granular track publication, subscription, RTP metrics, and WebRTC lifecycle events.
 * Fully privacy-safe and bounded for production release-candidate testing.
 */

export interface DiagnosticEvent {
  timestamp: string;
  epochMs: number;
  category: 'room' | 'track' | 'media' | 'audio' | 'permission' | 'screenshare';
  event: string;
  participantIdentity?: string;
  trackSid?: string;
  source?: string;
  kind?: string;
  isSubscribed?: boolean;
  isMuted?: boolean;
  attempt?: number;
  cameraOff?: boolean;
  facing?: string;
  next?: boolean;
  isScreenSharing?: boolean;
  route?: string;
  details?: Record<string, any>;
  error?: string;
  [key: string]: any;
}

export interface MediaMetricsSnapshot {
  timestamp: number;
  inboundBitrateKbps: number;
  outboundBitrateKbps: number;
  totalBitrateKbps: number;
  rttMs: number;
  jitterMs: number;
  packetsLost: number;
  inboundFps: number | null;
  outboundFps: number | null;
  inboundResolution: { width: number; height: number } | null;
  outboundResolution: { width: number; height: number } | null;
  candidateType: string;
  isRelayed: boolean;
}

class MediaDiagnosticsManager {
  private events: DiagnosticEvent[] = [];
  private readonly maxEvents = 300;
  private consoleLoggingEnabled = __DEV__; // In release, suppress noisy logcat spam unless requested

  private prevInbound: { bytes: number; timestamp: number } | null = null;
  private prevOutbound: { bytes: number; timestamp: number } | null = null;
  private latestMetrics: MediaMetricsSnapshot = {
    timestamp: Date.now(),
    inboundBitrateKbps: 0,
    outboundBitrateKbps: 0,
    totalBitrateKbps: 0,
    rttMs: 0,
    jitterMs: 0,
    packetsLost: 0,
    inboundFps: null,
    outboundFps: null,
    inboundResolution: null,
    outboundResolution: null,
    candidateType: 'unknown',
    isRelayed: false,
  };

  setConsoleLoggingEnabled(enabled: boolean): void {
    this.consoleLoggingEnabled = enabled;
  }

  log(
    category: DiagnosticEvent['category'],
    event: string,
    payload?: Partial<Omit<DiagnosticEvent, 'timestamp' | 'epochMs' | 'category' | 'event'>>
  ): void {
    const entry: DiagnosticEvent = {
      timestamp: new Date().toISOString(),
      epochMs: Date.now(),
      category,
      event,
      ...payload,
    };

    this.events.push(entry);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    if (this.consoleLoggingEnabled || payload?.error || event.includes('Failed') || event.includes('Error')) {
      let safeDetails = '';
      if (payload?.details) {
        try {
          safeDetails = JSON.stringify(payload.details, (key, value) => {
            if (
              ['token', 'guesttoken', 'authtoken', 'password', 'secret', 'text', 'credentials', 'displayname', 'name'].includes(
                key.toLowerCase()
              )
            ) {
              return '[REDACTED]';
            }
            return value;
          });
        } catch {
          safeDetails = '[unserializable]';
        }
      }

      const summary = `[MEDIA_DIAG][${category.toUpperCase()}][${event}] ${
        payload?.trackSid ? `sid=${payload.trackSid} ` : ''
      }${payload?.source ? `src=${payload.source} ` : ''}${
        payload?.participantIdentity ? `pid=${payload.participantIdentity} ` : ''
      }${payload?.error ? `ERR=${payload.error} ` : ''}${safeDetails}`;
      console.warn(summary);
    }
  }

  async samplePeerConnectionStats(pcs: any[]): Promise<MediaMetricsSnapshot> {
    const now = Date.now();
    let rttMs = 0;
    let jitterMs = 0;
    let packetsLost = 0;
    let inboundBytes = 0;
    let outboundBytes = 0;
    let inFps: number | null = null;
    let outFps: number | null = null;
    let inWidth: number | null = null;
    let inHeight: number | null = null;
    let outWidth: number | null = null;
    let outHeight: number | null = null;
    let candidateType = 'unknown';
    let isRelayed = false;

    for (const pc of pcs) {
      if (!pc || typeof pc.getStats !== 'function') continue;
      try {
        const stats = await pc.getStats();
        if (!stats) continue;

        // Iterate stats map/report
        const iterateStats = (stat: any) => {
          if (!stat) return;
          if (stat.type === 'candidate-pair' && (stat.state === 'succeeded' || stat.nominated)) {
            if (typeof stat.currentRoundTripTime === 'number') {
              rttMs = Math.round(stat.currentRoundTripTime * 1000);
            }
          }
          if (stat.type === 'local-candidate') {
            if (stat.candidateType) candidateType = stat.candidateType;
            if (stat.candidateType === 'relay') isRelayed = true;
          }
          if (stat.type === 'inbound-rtp') {
            if (typeof stat.bytesReceived === 'number') {
              inboundBytes += stat.bytesReceived;
            }
            if (stat.kind === 'video') {
              if (typeof stat.jitter === 'number') {
                jitterMs = Math.round(stat.jitter * 1000);
              }
              if (typeof stat.packetsLost === 'number') {
                packetsLost += stat.packetsLost;
              }
              if (typeof stat.framesPerSecond === 'number' && stat.framesPerSecond > 0) {
                inFps = Math.round(stat.framesPerSecond);
              }
              if (typeof stat.frameWidth === 'number' && stat.frameWidth > 0 && typeof stat.frameHeight === 'number') {
                inWidth = stat.frameWidth;
                inHeight = stat.frameHeight;
              }
            }
          }
          if (stat.type === 'outbound-rtp') {
            if (typeof stat.bytesSent === 'number') {
              outboundBytes += stat.bytesSent;
            }
            if (stat.kind === 'video') {
              if (typeof stat.framesPerSecond === 'number' && stat.framesPerSecond > 0) {
                outFps = Math.round(stat.framesPerSecond);
              }
              if (typeof stat.frameWidth === 'number' && stat.frameWidth > 0 && typeof stat.frameHeight === 'number') {
                outWidth = stat.frameWidth;
                outHeight = stat.frameHeight;
              }
            }
          }
        };

        if (typeof stats.forEach === 'function') {
          stats.forEach(iterateStats);
        } else if (typeof stats === 'object') {
          Object.values(stats).forEach(iterateStats);
        }
      } catch (err) {
        // Suppress individual stat extraction errors
      }
    }

    // Successive byte counter delta calculation
    let inBitrate = 0;
    let outBitrate = 0;

    if (this.prevInbound && inboundBytes >= this.prevInbound.bytes) {
      const deltaBytes = inboundBytes - this.prevInbound.bytes;
      const deltaTimeMs = now - this.prevInbound.timestamp;
      if (deltaTimeMs > 0 && deltaTimeMs < 10000) {
        inBitrate = Math.round((deltaBytes * 8) / deltaTimeMs);
      }
    }
    this.prevInbound = { bytes: inboundBytes, timestamp: now };

    if (this.prevOutbound && outboundBytes >= this.prevOutbound.bytes) {
      const deltaBytes = outboundBytes - this.prevOutbound.bytes;
      const deltaTimeMs = now - this.prevOutbound.timestamp;
      if (deltaTimeMs > 0 && deltaTimeMs < 10000) {
        outBitrate = Math.round((deltaBytes * 8) / deltaTimeMs);
      }
    }
    this.prevOutbound = { bytes: outboundBytes, timestamp: now };

    this.latestMetrics = {
      timestamp: now,
      inboundBitrateKbps: inBitrate,
      outboundBitrateKbps: outBitrate,
      totalBitrateKbps: inBitrate + outBitrate,
      rttMs,
      jitterMs,
      packetsLost,
      inboundFps: inFps,
      outboundFps: outFps,
      inboundResolution: inWidth && inHeight ? { width: inWidth, height: inHeight } : null,
      outboundResolution: outWidth && outHeight ? { width: outWidth, height: outHeight } : null,
      candidateType,
      isRelayed,
    };

    return this.latestMetrics;
  }

  getLatestMetrics(): MediaMetricsSnapshot {
    return this.latestMetrics;
  }

  getRecentEvents(limit: number = 50): DiagnosticEvent[] {
    return this.events.slice(-limit);
  }

  clear(): void {
    this.events = [];
    this.prevInbound = null;
    this.prevOutbound = null;
  }

  getSummary(): {
    totalEvents: number;
    publishedTracks: number;
    subscribedTracks: number;
    errorsCount: number;
  } {
    let published = 0;
    let subscribed = 0;
    let errors = 0;

    for (const ev of this.events) {
      if (ev.event === 'LocalTrackPublished' || ev.event === 'TrackPublished') published++;
      if (ev.event === 'TrackSubscribed') subscribed++;
      if (ev.error || ev.event.includes('Failed') || ev.event.includes('Error')) errors++;
    }

    return {
      totalEvents: this.events.length,
      publishedTracks: published,
      subscribedTracks: subscribed,
      errorsCount: errors,
    };
  }

  generateSanitizedExport(metadata: Record<string, any> = {}): string {
    const summary = this.getSummary();
    const metrics = this.latestMetrics;
    const sanitizedEvents = this.events.map((e) => ({
      time: new Date(e.epochMs).toLocaleTimeString(),
      category: e.category,
      event: e.event,
      source: e.source,
      kind: e.kind,
      error: e.error,
    }));

    const report = {
      appId: 'com.aitathastu.connect',
      generatedAt: new Date().toISOString(),
      metadata,
      summary,
      currentMetrics: {
        bitrateKbps: metrics.totalBitrateKbps,
        inboundKbps: metrics.inboundBitrateKbps,
        outboundKbps: metrics.outboundBitrateKbps,
        rttMs: metrics.rttMs,
        jitterMs: metrics.jitterMs,
        packetsLost: metrics.packetsLost,
        inboundFps: metrics.inboundFps ?? 'N/A',
        outboundFps: metrics.outboundFps ?? 'N/A',
        inboundResolution: metrics.inboundResolution ? `${metrics.inboundResolution.width}x${metrics.inboundResolution.height}` : 'N/A',
        outboundResolution: metrics.outboundResolution ? `${metrics.outboundResolution.width}x${metrics.outboundResolution.height}` : 'N/A',
        candidateType: metrics.candidateType,
        isRelayed: metrics.isRelayed,
      },
      recentEvents: sanitizedEvents.slice(-40),
    };

    return JSON.stringify(report, null, 2);
  }
}

export const mediaDiagnostics = new MediaDiagnosticsManager();
