'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getNotes, updateNotes } from '@/features/notes/api';
import { MeetingNote } from '@/features/notes/types';

interface NotesPanelProps {
  roomCode: string;
  participantIdentity?: string;
  onClose: () => void;
  broadcastRevision?: (rev: number) => void;
  externalRevision?: number;
}

export const NotesPanel: React.FC<NotesPanelProps> = ({
  roomCode,
  participantIdentity,
  onClose,
  broadcastRevision,
  externalRevision,
}) => {
  const [title, setTitle] = useState('Meeting Notes');
  const [content, setContent] = useState('');
  const [revision, setRevision] = useState(1);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [remoteConflictAlert, setRemoteConflictAlert] = useState(false);

  const isSavingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load
  const loadNotes = useCallback(async () => {
    try {
      const note = await getNotes(roomCode, participantIdentity);
      setTitle(note.title || 'Meeting Notes');
      setContent(note.content || '');
      setRevision(note.revision);
      setIsDirty(false);
      setStatus('saved');
      setRemoteConflictAlert(false);
      setLastSaved(new Date(note.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setStatus('error');
      setErrorMessage('Could not load meeting notes.');
    }
  }, [roomCode, participantIdentity]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // Handle incoming remote revision updates
  useEffect(() => {
    if (externalRevision && externalRevision > revision) {
      if (!isDirty) {
        // Safe to pull latest revision automatically
        loadNotes();
      } else {
        // User has unsaved edits: alert them without silently clobbering
        setRemoteConflictAlert(true);
      }
    }
  }, [externalRevision, revision, isDirty, loadNotes]);

  // Save changes
  const handleSave = async (overrideTitle?: string, overrideContent?: string) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setStatus('saving');
    setErrorMessage('');

    const targetTitle = overrideTitle !== undefined ? overrideTitle : title;
    const targetContent = overrideContent !== undefined ? overrideContent : content;

    try {
      const updated = await updateNotes(
        roomCode,
        {
          title: targetTitle,
          content: targetContent,
          expectedRevision: revision,
        },
        participantIdentity
      );

      setRevision(updated.revision);
      setIsDirty(false);
      setStatus('saved');
      setRemoteConflictAlert(false);
      setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

      if (broadcastRevision) {
        broadcastRevision(updated.revision);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('Someone else updated') || message.includes('conflict')) {
        setStatus('conflict');
        setErrorMessage('Someone else updated these notes. Please reload or merge changes.');
      } else {
        setStatus('error');
        setErrorMessage('Could not save your changes. Try again.');
      }
    } finally {
      isSavingRef.current = false;
    }
  };

  // Debounced auto-save on change
  const handleContentChange = (newText: string) => {
    setContent(newText);
    setIsDirty(true);
    setStatus('idle');

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      handleSave(title, newText);
    }, 1200);
  };

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    setIsDirty(true);
    setStatus('idle');

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      handleSave(newTitle, content);
    }, 1200);
  };

  return (
    <div className="flex flex-col h-full bg-white text-[#1C1C1C] border-l border-[#E9E8E4]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#E9E8E4] bg-[#FAFAF8]">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#7658E8]" />
          <h2 className="font-semibold text-base text-[#1C1C1C]">Notes</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#EEE8FF] text-[#7658E8] font-mono font-medium">
            r{revision}
          </span>
        </div>
        <div className="flex items-center space-x-3">
          {/* Status Indicator */}
          <div className="text-xs text-[#737373]">
            {status === 'saving' && <span className="text-[#7658E8]">Saving…</span>}
            {status === 'saved' && <span>Saved {lastSaved && `at ${lastSaved}`}</span>}
            {status === 'conflict' && <span className="text-[#FF6B6B] font-medium">Conflict</span>}
            {status === 'error' && <span className="text-[#FF6B6B]">Error saving</span>}
            {status === 'idle' && isDirty && <span className="text-[#737373]">Unsaved</span>}
          </div>

          <button
            onClick={onClose}
            aria-label="Close notes panel"
            className="p-1 rounded-md text-[#737373] hover:text-[#1C1C1C] hover:bg-[#E9E8E4]/50 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Conflict Warning Banner */}
      {(status === 'conflict' || remoteConflictAlert) && (
        <div className="bg-[#FFF2BE] px-4 py-3 border-b border-[#E9E8E4] flex items-center justify-between">
          <div className="text-xs text-[#8A6400]">
            <strong>Update notice:</strong> Another participant updated notes.
          </div>
          <button
            onClick={loadNotes}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-white border border-[#E9E8E4] text-[#1C1C1C] hover:bg-[#FAFAF8] shadow-sm"
          >
            Reload latest
          </button>
        </div>
      )}

      {/* Editable Title */}
      <div className="px-5 pt-4 pb-2">
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Meeting title or heading…"
          maxLength={200}
          className="w-full text-base font-bold text-[#1C1C1C] placeholder-[#737373]/60 bg-transparent border-none outline-none focus:ring-0 px-0"
        />
      </div>

      {/* Editable Content */}
      <div className="flex-1 px-5 py-2 overflow-hidden flex flex-col">
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="Write shared meeting notes, decisions, and action items here…"
          className="w-full flex-1 resize-none bg-transparent text-sm leading-relaxed text-[#1C1C1C] placeholder-[#737373]/60 border-none outline-none focus:ring-0 font-sans"
        />
      </div>

      {/* Footer Controls */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-[#E9E8E4] bg-[#FAFAF8] text-xs text-[#737373]">
        <div>
          {content.length > 0 ? `${content.split(/\s+/).filter(Boolean).length} words` : 'Empty note'}
        </div>
        <div className="flex items-center space-x-2">
          {status === 'error' && (
            <button
              onClick={() => handleSave()}
              className="px-3 py-1 text-xs font-medium rounded bg-[#FFE5DF] text-[#FF6B6B] hover:bg-[#FFE5DF]/80"
            >
              Retry
            </button>
          )}
          <button
            onClick={() => handleSave()}
            disabled={status === 'saving' || !isDirty}
            className="px-3 py-1.5 rounded-lg bg-[#7658E8] text-white font-medium hover:bg-[#6344D4] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
