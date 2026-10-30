'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { listFiles, uploadFile, deleteFile } from '@/features/files/api';
import { MeetingFile } from '@/features/files/types';
import { FileCard } from './FileCard';

interface FilesPanelProps {
  roomCode: string;
  participantIdentity?: string;
  isHost?: boolean;
  onClose: () => void;
  broadcastFileUploaded?: (fileId: string, filename: string) => void;
  externalFileEvent?: { action: string; fileId: string; filename: string };
}

const ALLOWED_EXTENSIONS = ['.pdf', '.pptx', '.png', '.jpg', '.jpeg', '.webp', '.txt'];
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export const FilesPanel: React.FC<FilesPanelProps> = ({
  roomCode,
  participantIdentity,
  isHost,
  onClose,
  broadcastFileUploaded,
  externalFileEvent,
}) => {
  const [files, setFiles] = useState<MeetingFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchFiles = useCallback(async () => {
    try {
      const list = await listFiles(roomCode, participantIdentity);
      setFiles(list);
    } catch {
      // Non-blocking error
    } finally {
      setIsLoading(false);
    }
  }, [roomCode, participantIdentity]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Refresh on incoming LiveKit file notification
  useEffect(() => {
    if (externalFileEvent) {
      fetchFiles();
    }
  }, [externalFileEvent, fetchFiles]);

  // Validate and handle file upload
  const handleUpload = async (file: File) => {
    setUploadError(null);

    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setUploadError('Supported file types: PDF, PPTX, PNG, JPEG, WebP, TXT.');
      return;
    }

    if (file.size > MAX_BYTES) {
      setUploadError('File size exceeds 25 MB limit.');
      return;
    }

    setIsUploading(true);
    try {
      const uploaded = await uploadFile(roomCode, file, participantIdentity);
      setFiles((prev) => [uploaded, ...prev]);

      if (broadcastFileUploaded) {
        broadcastFileUploaded(uploaded.id, uploaded.sanitizedFilename);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed. Try again.';
      setUploadError(msg);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDelete = async (fileId: string) => {
    try {
      await deleteFile(roomCode, fileId, participantIdentity);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch {
      // Non-blocking
    }
  };

  return (
    <div className="flex flex-col h-full bg-white text-[#1C1C1C] border-l border-[#E9E8E4]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#E9E8E4] bg-[#FAFAF8]">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#2DBE74]" />
          <h2 className="font-semibold text-base text-[#1C1C1C]">Files</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#DFF5E8] text-[#1B7A43] font-medium">
            {files.length}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close files panel"
          className="p-1 rounded-md text-[#737373] hover:text-[#1C1C1C] hover:bg-[#E9E8E4]/50 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Upload Dropzone */}
      <div className="p-4 border-b border-[#E9E8E4] bg-[#FAFAF8]">
        <div
          onDragEnter={onDrag}
          onDragLeave={onDrag}
          onDragOver={onDrag}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
            dragActive
              ? 'border-[#7658E8] bg-[#EEE8FF]/40'
              : 'border-[#E9E8E4] hover:border-[#7658E8]/50 hover:bg-white'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.pptx,.png,.jpg,.jpeg,.webp,.txt"
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
            className="hidden"
          />

          <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-[#EEE8FF] flex items-center justify-center text-[#7658E8]">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>

          <div className="text-xs font-medium text-[#1C1C1C]">
            {isUploading ? 'Uploading & verifying…' : 'Share a file with the meeting'}
          </div>
          <div className="text-[11px] text-[#737373] mt-0.5">
            PDF, PPTX, PNG, JPEG, WebP, TXT up to 25 MB
          </div>
        </div>

        {uploadError && (
          <div className="mt-2 text-xs text-[#FF6B6B] bg-[#FFE5DF] px-3 py-1.5 rounded-lg">
            {uploadError}
          </div>
        )}
      </div>

      {/* Files List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {isLoading ? (
          <div className="text-center py-8 text-xs text-[#737373]">Loading files…</div>
        ) : files.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-10 h-10 mx-auto rounded-full bg-[#FAFAF8] border border-[#E9E8E4] flex items-center justify-center text-[#737373] mb-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-xs font-medium text-[#1C1C1C]">No files shared yet</div>
            <div className="text-[11px] text-[#737373] mt-0.5">
              Files uploaded here are available to meeting participants.
            </div>
          </div>
        ) : (
          files.map((file) => (
            <FileCard
              key={file.id}
              file={file}
              roomCode={roomCode}
              participantIdentity={participantIdentity}
              canDelete={isHost || file.uploadedByIdentity === participantIdentity}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
};
