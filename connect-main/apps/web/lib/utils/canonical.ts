/**
 * Canonical domain utilities for Tathastu Meet.
 * Enforces https://connect-mauve-nine.vercel.app as the canonical public origin in production,
 * while preserving local development (localhost / 127.0.0.1).
 */

export const CANONICAL_ORIGIN = 'https://connect-mauve-nine.vercel.app';
export const LEGACY_ORIGIN = 'https://connect-mauve-nine.vercel.app';

/**
 * Returns the canonical public origin for the application.
 * In development (localhost or 127.0.0.1), preserves the active development origin.
 * In production or preview deployments, defaults to the canonical domain https://connect-mauve-nine.vercel.app.
 */
export function getCanonicalOrigin(): string {
  // 1. Explicit override if specified in environment
  if (process.env.NEXT_PUBLIC_APP_ORIGIN) {
    return process.env.NEXT_PUBLIC_APP_ORIGIN.replace(/\/+$/, '');
  }

  // 2. Client-side evaluation
  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return origin;
    }
    // Any production/preview web host canonicalizes to the official domain
    return CANONICAL_ORIGIN;
  }

  // 3. Server-side development check
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000';
  }

  return CANONICAL_ORIGIN;
}

/**
 * Returns a full canonical meeting invitation URL for a given room code.
 */
export function getMeetingInviteUrl(roomCode: string): string {
  const origin = getCanonicalOrigin();
  return `${origin}/room/${encodeURIComponent(roomCode)}`;
}
