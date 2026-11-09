// What someone typed into a join box: a room code, an 11-digit meeting number, or a pasted
// meeting link. Numbers resolve to the room's code, which every other route uses.
export type JoinTarget = { kind: 'code'; code: string } | { kind: 'number'; number: string } | { kind: 'invalid' };

const CODE_CHARS = /^[0-9A-HJKMNP-TV-Z]{6,16}$/;

export function parseJoinInput(raw: string): JoinTarget {
  let text = raw.trim();
  if (!text) return { kind: 'invalid' };
  const link = text.match(/\/room\/([^/?#\s]+)/i);
  if (link) text = decodeURIComponent(link[1]);
  const digits = text.replace(/[\s-]/g, '');
  if (/^[0-9]{11}$/.test(digits)) return { kind: 'number', number: digits };
  // Crockford codes never use O, I or L; people type them for 0 and 1.
  const compact = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!CODE_CHARS.test(compact)) return { kind: 'invalid' };
  const code = compact.length === 10 ? `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}` : compact;
  return { kind: 'code', code };
}

/** True for an 11-digit meeting number, with or without spaces. */
export const isMeetingNumber = (value: string) => /^[0-9\s-]+$/.test(value) && value.replace(/\D/g, '').length === 11;
