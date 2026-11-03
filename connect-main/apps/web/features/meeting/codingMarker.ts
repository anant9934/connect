/**
 * In-class coding problems are announced through the meeting chat as an announcement whose
 * body starts with a marker. Only hosts and co-hosts can post announcements (enforced by the
 * API), and the marker only points at a lab assignment: students still load it through the lab
 * API, which applies its own authorization and hides hidden test cases.
 */

const MARKER = /^\[\[tc-coding:([0-9a-f-]{36}):([0-9a-f-]{36})\]\]\s*([\s\S]*)$/i;

export interface CodingAnnouncement {
  orgId: string;
  assignmentId: string;
  title: string;
}

export function parseCodingMarker(text: string): CodingAnnouncement | null {
  const m = MARKER.exec(text.trim());
  if (!m) return null;
  return { orgId: m[1], assignmentId: m[2], title: m[3].trim() || 'Coding problem' };
}

export function buildCodingMarker(orgId: string, assignmentId: string, title: string): string {
  return `[[tc-coding:${orgId}:${assignmentId}]] ${title.trim()}`;
}

/** Human-readable text for chat bubbles and banners. */
export function displayMessageText(text: string): string {
  const coding = parseCodingMarker(text);
  return coding ? `💻 New coding problem: ${coding.title}` : text;
}
