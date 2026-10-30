export interface MeetingNote {
  id: string;
  roomId: string;
  title: string;
  content: string;
  revision: number;
  createdByIdentity: string;
  updatedByIdentity: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateNoteRequest {
  title: string;
  content: string;
  expectedRevision: number;
}

export interface NoteResponse {
  note: MeetingNote;
}
