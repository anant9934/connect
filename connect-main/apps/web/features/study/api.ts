import { apiFetch } from '@/lib/api/client';

export interface SummaryTopic { title: string; at?: string; points?: string[] }
export interface ExtractedQuestion { question: string; answer?: string; at?: string; answered: boolean }
export interface LectureSummary {
  title: string;
  overview: string;
  keyConcepts: string[];
  takeaways: string[];
  actionItems: string[];
  topics?: SummaryTopic[];
  definitions?: { term: string; meaning: string }[];
  revisionNotes?: string[];
  questions?: ExtractedQuestion[];
  unresolved?: string[];
  source?: { roomId: string; recordingStartedAt?: string };
}
export interface QuizQuestion { question: string; options: string[]; correctIndex: number; explanation: string; difficulty: string; conceptTag: string }
export interface PracticeQuiz { courseTitle: string; topic: string; questions: QuizQuestion[] }
export interface FlashcardSet { deckTitle: string; cards: { front: string; back: string; concept: string }[] }

export interface Artifact {
  id: string;
  artifactType: 'lecture_summary' | 'practice_quiz' | 'flashcard_deck' | 'study_plan';
  title: string;
  content: LectureSummary | PracticeQuiz | FlashcardSet;
  visibility: 'faculty_only' | 'published' | 'archived';
  humanReviewed: boolean;
  createdAt: string;
}

const base = (org: string) => `/api/v1/organizations/${encodeURIComponent(org)}/ai`;

export const listArtifacts = async (org: string) =>
  (await apiFetch<{ artifacts: Artifact[] | null }>(`${base(org)}/artifacts?limit=100`, { method: 'GET' })).artifacts ?? [];
export const summariseMeeting = (org: string, roomId: string) =>
  apiFetch<{ artifact: Artifact }>(`${base(org)}/summaries/from-meeting`, { method: 'POST', body: JSON.stringify({ roomId }) });
export const updateArtifact = (org: string, id: string, title: string, content: unknown) =>
  apiFetch(`${base(org)}/artifacts/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ title, content }) });
export const publishArtifact = (org: string, id: string, visibility: 'published' | 'faculty_only' | 'archived') =>
  apiFetch(`${base(org)}/artifacts/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ visibility }) });
export const generateQuiz = (org: string, courseTitle: string, topic: string) =>
  apiFetch(`${base(org)}/quizzes/generate`, { method: 'POST', body: JSON.stringify({ courseTitle, topic, questionCount: 8 }) });
export const generateFlashcards = (org: string, deckTitle: string, notesText: string) =>
  apiFetch(`${base(org)}/flashcards/generate`, { method: 'POST', body: JSON.stringify({ deckTitle, notesText }) });

/** "MM:SS" or "H:MM:SS" to seconds, or null. */
export function parseTimestamp(at: string | undefined): number | null {
  if (!at || !/^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(at)) return null;
  return at.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
}

/** Where a timestamp in a summary opens the meeting's replay, at that second. */
export const replayLink = (roomId: string, at: string | undefined) => {
  const seconds = parseTimestamp(at);
  return seconds === null ? null : `/history/${encodeURIComponent(roomId)}?t=${seconds}#replay`;
};

/** Notes text for flashcards and quizzes, from a summary. */
export const summaryAsNotes = (s: LectureSummary) =>
  [s.overview, ...(s.definitions ?? []).map((d) => `${d.term}: ${d.meaning}`), ...(s.revisionNotes ?? []), ...s.keyConcepts].join('\n');
