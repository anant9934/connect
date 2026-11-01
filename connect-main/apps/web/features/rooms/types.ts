export interface Room {
  id: string;
  publicCode: string;
  status: string;
  isLocked: boolean;
  waitingRoomEnabled?: boolean;
  maxParticipants: number;
  createdAt: string;
  title?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  timeZone?: string;
  hasPasscode?: boolean;
  hostIdentity?: string;
  participantsCanPublish?: boolean;
  coHostPermissions?: Record<string, boolean>;
}

export interface Participant {
  identity: string;
  displayName: string;
  role: string;
  isGuest: boolean;
  joinedAt: string;
}

export interface CreateRoomResponse {
  room: Room;
  inviteUrl: string;
}

export interface JoinRoomResponse {
  room: Room;
  participant: Participant;
  isHost: boolean;
}

export interface TokenResponse {
  token: string;
  livekitUrl: string;
}

export interface ParticipantsResponse {
  participants: Participant[];
}

export interface AdmissionRequest {
  id: string;
  identity: string;
  displayName: string;
  status: 'pending' | 'admitted' | 'denied';
  requestedAt: string;
}

export interface MeetingHistoryItem {
  id: string;
  public_code: string;
  host_user_id: string;
  status: string;
  created_at: string;
  ended_at?: string;
  duration_seconds: number;
  participant_count: number;
  is_locked: boolean;
  waiting_room_enabled?: boolean;
}


export interface RoomModeration {
  permissions: Record<string, boolean>;
  roles: Record<string, string>;
  participantsCanPublish: boolean;
  coHostPermissions: Record<string, boolean>;
  error: string | null;
  onGrantCoHost: (identity: string) => void;
  onRevokeCoHost: (identity: string) => void;
  onTransferHost: (identity: string) => void;
  onMuteAll: () => void;
  onUpdatePermissions: (coHost: Record<string, boolean>, participantsCanPublish: boolean) => void;
}
