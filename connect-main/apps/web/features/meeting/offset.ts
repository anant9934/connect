/** MM:SS (or H:MM:SS) for a position in a recording, from milliseconds. */
export const formatOffset = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** Milliseconds into a recording for something that happened at `at`, or null if outside it. */
export function offsetInRecording(at: string, startedAt: string, endedAt: string): number | null {
  const t = Date.parse(at);
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(t) || !Number.isFinite(start) || t < start || t > end) return null;
  return t - start;
}
