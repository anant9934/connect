export type ScanStatus = 'pending' | 'quarantined' | 'scanning' | 'available' | 'rejected' | 'deleted';

export interface MeetingFile {
  id: string;
  roomId: string;
  originalFilename: string;
  sanitizedFilename: string;
  fileType: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  scanStatus: ScanStatus;
  scanResult?: string;
  uploadedByIdentity: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileListResponse {
  files: MeetingFile[];
}

export interface FileUploadResponse {
  file: MeetingFile;
}
