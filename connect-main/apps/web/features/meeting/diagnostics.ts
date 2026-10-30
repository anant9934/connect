/**
 * Realtime Media Diagnostics for Tathastu Meet Web
 * Tracks WebRTC peer connections, track subscriptions, audio playback eligibility, and transport stats.
 */

export interface WebDiagnosticEvent {
  timestamp: string;
  epochMs: number;
  category: 'room' | 'track' | 'media' | 'audio' | 'permissions' | 'screenshare';
  event: string;
  participantIdentity?: string;
  trackSid?: string;
  source?: string;
  kind?: string;
  isSubscribed?: boolean;
  isMuted?: boolean;
  details?: Record<string, any>;
  error?: string;
}

class WebDiagnosticsManager {
  private events: WebDiagnosticEvent[] = [];
  private readonly maxEvents = 500;

  log(
    category: WebDiagnosticEvent['category'],
    event: string,
    payload?: Partial<Omit<WebDiagnosticEvent, 'timestamp' | 'epochMs' | 'category' | 'event'>>
  ): void {
    const entry: WebDiagnosticEvent = {
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

    if (process.env.NODE_ENV !== 'production' || (typeof window !== 'undefined' && (window as any).__TC_ENABLE_TEST_DIAGNOSTICS)) {
      console.log(
        '[WEB_MEDIA_DIAG][%s][%s]',
        category.toUpperCase(),
        event,
        payload || ''
      );
    }
  }

  getRecentEvents(limit: number = 100): WebDiagnosticEvent[] {
    return this.events.slice(-limit);
  }

  clear(): void {
    this.events = [];
  }
}

export const webDiagnostics = new WebDiagnosticsManager();
