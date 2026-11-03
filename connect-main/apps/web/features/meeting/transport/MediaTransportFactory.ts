import { MediaTransport } from './types';
import { LiveKitTransport } from './LiveKitTransport';
import { P2PTransport } from './P2PTransport';

export interface TransportFactoryOptions {
  roomCode: string;
  guestToken?: string;
  forceLiveKit?: boolean;
}

export class MediaTransportFactory {
  /**
   * Evaluates feature flags, browser capabilities, and room eligibility
   * to instantiate either the P2PTransport or LiveKitTransport.
   */
  static async createTransport(options: TransportFactoryOptions): Promise<MediaTransport> {
    if (typeof window !== 'undefined' && (window as any).__TC_MOCK_TRANSPORT_FACTORY) {
      return (window as any).__TC_MOCK_TRANSPORT_FACTORY(options);
    }

    if (options.forceLiveKit) {
      return new LiveKitTransport();
    }

    // 1. Check feature flags
    const hybridEnabled =
      process.env.NEXT_PUBLIC_HYBRID_MEDIA_ENABLED === 'true' ||
      process.env.NEXT_PUBLIC_P2P_PILOT_ENABLED === 'true';

    if (!hybridEnabled) {
      return new LiveKitTransport();
    }

    // 2. Check browser WebRTC support
    if (
      typeof window === 'undefined' ||
      typeof RTCPeerConnection === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return new LiveKitTransport();
    }

    // 3. Probe backend 1:1 eligibility and configuration
    try {
      const headers: Record<string, string> = {};
      if (options.guestToken) {
        headers['X-Guest-Token'] = options.guestToken;
      }

      const res = await fetch(`/api/v1/rooms/${options.roomCode}/p2p/config`, {
        headers,
        credentials: 'same-origin',
      });

      if (res.ok) {
        const config = await res.json();
        if (config.p2pEligible && config.hybridEnabled) {
          return new P2PTransport();
        }
      }
    } catch (err) {
      console.warn('Failed to verify P2P eligibility; falling back to LiveKit SFU:', err);
    }

    // Default to existing LiveKit Cloud SFU
    return new LiveKitTransport();
  }
}
