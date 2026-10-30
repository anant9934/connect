'use client';

import React from 'react';
import { MeetingFile } from '@/features/files/types';
import { getDownloadUrl } from '@/features/files/api';

interface FileCardProps {
  file: MeetingFile;
  roomCode: string;
  participantIdentity?: string;
  canDelete?: boolean;
  onDelete?: (fileId: string) => void;
}

export const FileCard: React.FC<FileCardProps> = ({
  file,
  roomCode,
  participantIdentity,
  canDelete,
  onDelete,
}) => {
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFormatBadge = (type: string) => {
    switch (type.toLowerCase()) {
      case 'pdf':
        return { label: 'PDF', bg: '#FFE5DF', text: '#FF6B6B' };
      case 'pptx':
        return { label: 'PPTX', bg: '#FFF2BE', text: '#8A6400' };
      case 'png':
      case 'jpeg':
      case 'webp':
        return { label: 'IMG', bg: '#EEE8FF', text: '#7658E8' };
      case 'txt':
        return { label: 'TXT', bg: '#E9E8E4', text: '#737373' };
      default:
        return { label: 'DOC', bg: '#E9E8E4', text: '#737373' };
    }
  };

  const badge = getFormatBadge(file.fileType);
  const downloadUrl = getDownloadUrl(roomCode, file.id, participantIdentity);

  return (
    <div className="p-3.5 rounded-xl border border-[#E9E8E4] bg-white hover:border-[#7658E8]/40 transition-colors shadow-sm">
      <div className="flex items-start justify-between space-x-3">
        {/* Badge & Filename */}
        <div className="flex items-start space-x-3 min-w-0">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs shrink-0"
            style={{ backgroundColor: badge.bg, color: badge.text }}
          >
            {badge.label}
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-[#1C1C1C] truncate" title={file.originalFilename}>
              {file.originalFilename}
            </h4>
            <div className="flex items-center space-x-2 mt-1">
              <span className="text-xs text-[#737373]">{formatBytes(file.sizeBytes)}</span>

              {/* Security scan state pill */}
              {file.scanStatus === 'available' && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#DFF5E8] text-[#1B7A43] font-medium">
                  Ready
                </span>
              )}
              {(file.scanStatus === 'quarantined' || file.scanStatus === 'scanning') && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#FFF2BE] text-[#8A6400] font-medium">
                  Verifying…
                </span>
              )}
              {file.scanStatus === 'rejected' && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#FFE5DF] text-[#FF6B6B] font-medium">
                  Rejected
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-1 shrink-0">
          {file.scanStatus === 'available' && (
            <a
              href={downloadUrl}
              download={file.sanitizedFilename}
              className="p-1.5 rounded-lg text-[#7658E8] hover:bg-[#EEE8FF] transition-colors"
              title="Download file"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </a>
          )}

          {canDelete && onDelete && (
            <button
              onClick={() => onDelete(file.id)}
              className="p-1.5 rounded-lg text-[#737373] hover:text-[#FF6B6B] hover:bg-[#FFE5DF]/40 transition-colors"
              title="Delete file"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
