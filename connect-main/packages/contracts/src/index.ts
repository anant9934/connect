/**
 * @tathastu/contracts
 * Shared data contracts, API DTOs, and federation boundaries for Tathastu Connect.
 */

// --- HEALTH & SYSTEM RESPONSES ---

export interface HealthResponse {
  status: 'ok' | 'degraded';
}

export interface SystemStatusResponse {
  status: 'operational' | 'maintenance';
  service: string;
  version: string;
  timestamp: string;
}

// --- SAFE STANDARDIZED ERROR FORMAT ---

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
    timestamp: string;
  };
}

// --- COLLABORATION NETWORK DOMAIN ---

export type CollaborationNodeType = 'researcher' | 'mentor' | 'project' | 'topic';

export interface CollaborationNode {
  id: string;
  title: string;
  type: CollaborationNodeType;
  specialty: string;
  status: 'online' | 'active' | 'in_call' | 'standby';
  matchedSkills: string[];
}

// --- AI TATHASTU FEDERATION BOUNDARY ---
/**
 * Proposed short-lived assertion token claims exchanged when AI Tathastu
 * discovers an intentional collaboration match between researchers/mentors.
 *
 * Security Principles:
 * 1. Must NEVER include full private database profiles in redirect URLs.
 * 2. Must be cryptographically signed (Ed25519 or ES256).
 * 3. Short TTL (typically 120 - 300 seconds).
 * 4. Must enforce replay protection via nonce / jti.
 */
export interface TathastuFederationAssertion {
  iss: string;             // Issuer: e.g. "https://auth.aitathastu.internal"
  aud: string;             // Audience: e.g. "tathastu-connect-service"
  sub: string;             // Subject: Authenticated Tathastu Principal ID
  exp: number;             // Expiration timestamp (Unix epoch seconds)
  nbf: number;             // Not before (Unix epoch seconds)
  iat: number;             // Issued at (Unix epoch seconds)
  jti: string;             // Unique cryptographic UUID preventing replay
  purpose: 'collab_session' | 'mentor_sync' | 'peer_review';
  contextRef: string;      // Ephemeral encrypted or hashed reference to intent context
  recommendedTopics?: string[]; // Narrowly scoped, sanitized topic tags
}

// --- FUTURE WEBRTC & REALTIME SESSION CONTRACTS (PHASE 2 BOUNDARY) ---

export interface RealtimeTokenRequest {
  roomName: string;
  participantIdentity: string;
  // Note: All role/permission attributes are derived strictly server-side,
  // NEVER accepted from untrusted client payloads.
}

export interface RealtimeTokenResponse {
  token: string;
  serverUrl: string;
  expiresInSec: number;
}

// --- SHARED REALTIME MESSAGING CONTRACTS (LIVEKIT DATA CHANNELS) ---

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

export interface NotesSyncPayload {
  revision: number;
}

export interface FilesSyncPayload {
  action: 'uploaded' | 'deleted';
  fileId: string;
  filename: string;
}

