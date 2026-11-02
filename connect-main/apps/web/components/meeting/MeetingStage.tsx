'use client';

import React, { useState, useEffect } from 'react';
import {
  LocalParticipant,
  Participant,
  TrackPublication,
  ConnectionState,
} from 'livekit-client';
import { Clock, LayoutGrid, User, Share2, Monitor } from 'lucide-react';
import { ConnectionStatus } from './ConnectionStatus';
import { ScreenShareStage } from './ScreenShareStage';
import { ParticipantGrid } from './ParticipantGrid';
import { ParticipantTile } from './ParticipantTile';
import { MeetingControls } from './MeetingControls';
import { InviteDialog } from './InviteDialog';
import { ChatPanel } from './ChatPanel';
import { ParticipantsPanel } from './ParticipantsPanel';
import { NotesPanel } from './NotesPanel';
import { ClassroomPanel } from './ClassroomPanel';
import { FilesPanel } from './FilesPanel';
import { TransportDiagnostics } from './TransportDiagnostics';
import { ChatMessage } from '@/features/chat/types';
import { InteractionStatus } from '@/features/chat/useMeetingInteraction';
import { AdmissionRequest, RoomModeration } from '@/features/rooms/types';
import { TransportParticipant, TransportTrackPublication, MediaTransport } from '@/features/meeting/transport';

interface MeetingStageProps {
  roomCode: string;
  connectionState: ConnectionState;
  localParticipant: LocalParticipant | TransportParticipant | any;
  remoteParticipants: (Participant | TransportParticipant | any)[];
  screenSharePub: TrackPublication | TransportTrackPublication | any;
  screenShareParticipant: Participant | TransportParticipant | any;
  isHost: boolean;
  moderation: RoomModeration;
  interaction: {
    status: InteractionStatus;
    actionError: string | null;
    canAnnounce: boolean;
    hasOlder: boolean;
    loadingOlder: boolean;
    onLoadOlder: () => void;
    onRetry: (message: ChatMessage) => void;
    syncTick: number;
    sendHint: () => void;
  };
  isLocked: boolean;
  isMicMuted: boolean;
  isVideoMuted: boolean;
  isMicBlocked?: boolean;
  isVideoBlocked?: boolean;
  onRequestDeviceHelp?: (device: 'camera' | 'microphone') => void;
  transport?: MediaTransport | null;
  isScreenSharing: boolean;
  activePanel: 'chat' | 'participants' | 'notes' | 'files' | 'classroom' | null;
  unreadChatCount: number;
  chatMessages: ChatMessage[];
  pendingAdmissions: AdmissionRequest[];
  raisedHands: Set<string>;
  reactions: Record<string, string>;
  isLocalHandRaised: boolean;
  broadcastNotesRevision?: (rev: number) => void;
  externalNotesRevision?: number;
  broadcastFileUploaded?: (fileId: string, filename: string) => void;
  externalFileEvent?: { action: string; fileId: string; filename: string };
  captureMode?: 'detail' | 'motion';
  onToggleCaptureMode?: () => void;
  onSendMessage: (text: string, kind: 'chat' | 'announcement') => void;
  onSendReaction: (emoji: string) => void;
  onToggleHandRaise: () => void;
  onTogglePanel: (panel: 'chat' | 'participants' | 'notes' | 'files' | 'classroom') => void;
  onClosePanel: () => void;
  onToggleMic: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleLock: () => void;
  onRemoveParticipant: (identity: string) => Promise<void>;
  onMuteParticipant: (identity: string) => Promise<void>;
  onAdmitGuest: (requestID: string) => Promise<void>;
  onDenyGuest: (requestID: string) => Promise<void>;
  onLeave: () => void;
  onEndMeetingForEveryone: () => void;
}

export const MeetingStage: React.FC<MeetingStageProps> = ({
  roomCode,
  connectionState,
  localParticipant,
  remoteParticipants,
  screenSharePub,
  screenShareParticipant,
  isHost,
  moderation,
  interaction,
  isLocked,
  isMicMuted,
  isVideoMuted,
  isMicBlocked = false,
  isVideoBlocked = false,
  onRequestDeviceHelp,
  transport = null,
  isScreenSharing,
  activePanel,
  unreadChatCount,
  chatMessages,
  pendingAdmissions,
  raisedHands,
  reactions,
  isLocalHandRaised,
  broadcastNotesRevision,
  externalNotesRevision,
  broadcastFileUploaded,
  externalFileEvent,
  captureMode = 'detail',
  onToggleCaptureMode,
  onSendMessage,
  onSendReaction,
  onToggleHandRaise,
  onTogglePanel,
  onClosePanel,
  onToggleMic,
  onToggleVideo,
  onToggleScreenShare,
  onToggleLock,
  onRemoveParticipant,
  onMuteParticipant,
  onAdmitGuest,
  onDenyGuest,
  onLeave,
  onEndMeetingForEveryone,
}) => {
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'gallery' | 'speaker' | 'presentation'>('gallery');
  const prevLayoutRef = React.useRef<'gallery' | 'speaker'>('gallery');
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Auto-switch to presentation mode when screen share arrives, and restore previous layout when it ends
  useEffect(() => {
    if (screenSharePub) {
      if (layoutMode !== 'presentation') {
        prevLayoutRef.current = layoutMode;
        setLayoutMode('presentation');
      }
    } else {
      if (layoutMode === 'presentation') {
        setLayoutMode(prevLayoutRef.current);
      }
    }
  }, [screenSharePub, layoutMode]);

  // Meeting duration timer
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const totalParticipants = (localParticipant ? 1 : 0) + remoteParticipants.length;

  // Resolve active speaker for speaker view
  const allParticipantsList: Participant[] = [];
  if (localParticipant) allParticipantsList.push(localParticipant);
  allParticipantsList.push(...remoteParticipants);

  const activeSpeaker =
    (selectedSpeakerId
      ? allParticipantsList.find((p) => p.identity === selectedSpeakerId)
      : null) ||
    allParticipantsList.find((p) => p.isSpeaking) ||
    remoteParticipants[0] ||
    localParticipant;

  const otherParticipants = allParticipantsList.filter(
    (p) => p.identity !== activeSpeaker?.identity
  );

  return (
    <div className="relative w-full h-screen h-[100dvh] max-h-[100dvh] bg-[#FAFAF8] flex flex-col overflow-hidden text-[#1C1C1C] meeting-stage-viewport">
      {/* Top Bar: Light-First Navigation */}
      <header className="h-13 sm:h-14 px-3 sm:px-4 bg-white border-b border-[#E5E5E3] flex items-center justify-between z-20 shrink-0 shadow-xs">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#EEE8FF] text-[#7658E8] flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
            TC
          </div>
          <span className="font-mono text-xs text-[#1C1C1C] font-semibold bg-[#FAFAF8] px-2 sm:px-2.5 py-1 rounded-lg border border-[#E5E5E3] shrink-0">
            {roomCode}
          </span>
          <ConnectionStatus connectionState={connectionState} />
          {/* Integrated WebRTC Transport Diagnostics in header layout zone */}
          {transport && <TransportDiagnostics transport={transport} inline={true} />}
        </div>

        <div className="flex items-center gap-3">
          {/* Duration Counter */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-[#666664] font-mono bg-[#FAFAF8] px-2.5 py-1 rounded-lg border border-[#E5E5E3]">
            <Clock className="w-3.5 h-3.5 text-[#7658E8]" />
            <span>{formatTimer(elapsedSeconds)}</span>
          </div>

          {/* Layout Mode Switcher */}
          <div className="hidden md:flex items-center p-1 bg-[#FAFAF8] rounded-xl border border-[#E5E5E3]">
            <button
              onClick={() => setLayoutMode('gallery')}
              className={`p-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                layoutMode === 'gallery'
                  ? 'bg-white text-[#7658E8] shadow-xs'
                  : 'text-[#666664] hover:text-[#1C1C1C]'
              }`}
              title="Gallery view"
              aria-label="Gallery view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="text-[11px]">Grid</span>
            </button>
            <button
              onClick={() => setLayoutMode('speaker')}
              className={`p-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                layoutMode === 'speaker'
                  ? 'bg-white text-[#7658E8] shadow-xs'
                  : 'text-[#666664] hover:text-[#1C1C1C]'
              }`}
              title="Speaker view"
              aria-label="Speaker view"
            >
              <User className="w-3.5 h-3.5" />
              <span className="text-[11px]">Speaker</span>
            </button>
            {screenSharePub && (
              <button
                onClick={() => setLayoutMode('presentation')}
                className={`p-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                  layoutMode === 'presentation'
                    ? 'bg-white text-[#7658E8] shadow-xs'
                    : 'text-[#666664] hover:text-[#1C1C1C]'
                }`}
                title="Presentation view"
                aria-label="Presentation view"
              >
                <Monitor className="w-3.5 h-3.5" />
                <span className="text-[11px]">Stage</span>
              </button>
            )}
          </div>

          {/* Quick Invite Button */}
          <button
            onClick={() => setShowInviteDialog(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-[#F2F2F0] text-xs font-medium text-[#1C1C1C] border border-[#E5E5E3] transition-colors shadow-xs"
          >
            <Share2 className="w-3.5 h-3.5 text-[#7658E8]" />
            <span>Invite</span>
          </button>
        </div>
      </header>

      {/* Main Presentation Stage */}
      <div className="flex-1 min-h-0 min-w-0 relative flex overflow-hidden">
        {/* Stage Center */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col md:flex-row relative p-1.5 sm:p-3 overflow-hidden bg-[#FAFAF8]">
          {/* 1. Screen Share Focused Mode */}
          {screenSharePub ? (
            <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2.5 w-full h-full overflow-hidden">
              <div className="flex-1 min-h-0 w-full h-full min-h-[200px] sm:min-h-[300px]">
                <ScreenShareStage
                  publication={screenSharePub}
                  participant={screenShareParticipant}
                  isLocal={screenShareParticipant?.identity === localParticipant?.identity}
                />
              </div>
              <ParticipantGrid
                localParticipant={localParticipant}
                remoteParticipants={remoteParticipants}
                raisedHands={raisedHands}
                reactions={reactions}
                isCompactStrip
              />
            </div>
          ) : layoutMode === 'speaker' && activeSpeaker ? (
            /* 2. Speaker Focused Mode */
            <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2.5 w-full h-full overflow-hidden">
              <div className="flex-1 min-h-0 w-full h-full min-h-[200px] sm:min-h-[300px]">
                <ParticipantTile
                  participant={activeSpeaker}
                  isLocal={activeSpeaker.identity === localParticipant?.identity}
                  isHost={isHost && activeSpeaker.identity === localParticipant?.identity}
                  isHandRaised={raisedHands.has(activeSpeaker.identity)}
                  reaction={reactions[activeSpeaker.identity] || null}
                />
              </div>
              {otherParticipants.length > 0 && (
                <div className="flex md:flex-col gap-2.5 overflow-x-auto md:overflow-y-auto p-1.5 w-full md:w-64 max-h-full shrink-0">
                  {otherParticipants.map((p) => (
                    <div
                      key={p.identity}
                      className="w-40 sm:w-44 md:w-full aspect-video shrink-0 rounded-2xl overflow-hidden shadow-xs cursor-pointer"
                      onClick={() => setSelectedSpeakerId(p.identity)}
                    >
                      <ParticipantTile
                        participant={p}
                        isLocal={p.identity === localParticipant?.identity}
                        isHost={isHost && p.identity === localParticipant?.identity}
                        isHandRaised={raisedHands.has(p.identity)}
                        reaction={reactions[p.identity] || null}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* 3. Gallery Grid Mode (Default) */
            <div className="w-full h-full min-h-0 min-w-0">
              <ParticipantGrid
                localParticipant={localParticipant}
                remoteParticipants={remoteParticipants}
                raisedHands={raisedHands}
                reactions={reactions}
                onSelectSpeaker={(identity) => {
                  setSelectedSpeakerId(identity);
                  setLayoutMode('speaker');
                }}
              />
            </div>
          )}
        </div>

        {/* Right-Side Panel: Shared Drawer (Chat / Participants) */}
        {activePanel === 'chat' && (
          <aside className="absolute inset-0 sm:relative sm:inset-auto w-full sm:w-80 md:w-96 bg-white border-l border-[#E5E5E3] flex flex-col shrink-0 z-30 shadow-lg animate-in slide-in-from-right duration-150">
            <ChatPanel
              messages={chatMessages}
              status={interaction.status}
              actionError={interaction.actionError}
              canAnnounce={interaction.canAnnounce}
              hasOlder={interaction.hasOlder}
              loadingOlder={interaction.loadingOlder}
              onLoadOlder={interaction.onLoadOlder}
              onRetry={interaction.onRetry}
              onSendMessage={onSendMessage}
              onClose={onClosePanel}
            />
          </aside>
        )}

        {activePanel === 'participants' && (
          <aside className="absolute inset-0 sm:relative sm:inset-auto w-full sm:w-80 md:w-96 bg-white border-l border-[#E5E5E3] flex flex-col shrink-0 z-30 shadow-lg animate-in slide-in-from-right duration-150">
            <ParticipantsPanel
              localParticipant={localParticipant}
              remoteParticipants={remoteParticipants}
              isHost={isHost}
              moderation={moderation}
              isLocked={isLocked}
              pendingAdmissions={pendingAdmissions}
              raisedHands={raisedHands}
              onToggleLock={onToggleLock}
              onMuteParticipant={onMuteParticipant}
              onRemoveParticipant={onRemoveParticipant}
              onDecideAdmission={(requestId, decision) => {
                if (decision === 'admitted') {
                  onAdmitGuest(requestId);
                } else {
                  onDenyGuest(requestId);
                }
              }}
              onClose={onClosePanel}
            />
          </aside>
        )}

        {/* Notes Panel (Single Right Drawer) */}
        {activePanel === 'classroom' && (
          <aside className="absolute inset-0 sm:relative sm:inset-auto w-full sm:w-80 md:w-96 bg-white border-l border-[#E5E5E3] flex flex-col shrink-0 z-30 shadow-lg animate-in slide-in-from-right duration-150">
            <ClassroomPanel
              roomCode={roomCode}
              selfIdentity={localParticipant?.identity || ''}
              syncTick={interaction.syncTick}
              onChanged={interaction.sendHint}
              onClose={onClosePanel}
            />
          </aside>
        )}

        {activePanel === 'notes' && (
          <aside className="absolute inset-0 sm:relative sm:inset-auto w-full sm:w-80 md:w-96 bg-white border-l border-[#E5E5E3] flex flex-col shrink-0 z-30 shadow-lg animate-in slide-in-from-right duration-150">
            <NotesPanel
              roomCode={roomCode}
              participantIdentity={localParticipant?.identity}
              onClose={onClosePanel}
              broadcastRevision={broadcastNotesRevision}
              externalRevision={externalNotesRevision}
            />
          </aside>
        )}

        {/* Files Panel (Single Right Drawer) */}
        {activePanel === 'files' && (
          <aside className="absolute inset-0 sm:relative sm:inset-auto w-full sm:w-80 md:w-96 bg-white border-l border-[#E5E5E3] flex flex-col shrink-0 z-30 shadow-lg animate-in slide-in-from-right duration-150">
            <FilesPanel
              roomCode={roomCode}
              participantIdentity={localParticipant?.identity}
              isHost={isHost}
              onClose={onClosePanel}
              broadcastFileUploaded={broadcastFileUploaded}
              externalFileEvent={externalFileEvent}
            />
          </aside>
        )}
      </div>

      {/* Bottom Controls Toolbar */}
      <MeetingControls
        isMicMuted={isMicMuted}
        isVideoMuted={isVideoMuted}
        isMicBlocked={isMicBlocked}
        isVideoBlocked={isVideoBlocked}
        onRequestDeviceHelp={onRequestDeviceHelp}
        isScreenSharing={isScreenSharing}
        isHost={isHost}
        isLocked={isLocked}
        participantCount={totalParticipants}
        activePanel={activePanel}
        unreadChatCount={unreadChatCount}
        isHandRaised={isLocalHandRaised}
        onToggleMic={onToggleMic}
        onToggleVideo={onToggleVideo}
        onToggleScreenShare={onToggleScreenShare}
        onTogglePanel={onTogglePanel}
        onOpenInvite={() => setShowInviteDialog(true)}
        onToggleLock={onToggleLock}
        onSendReaction={onSendReaction}
        onToggleHandRaise={onToggleHandRaise}
        onLeave={onLeave}
        onEndMeetingForEveryone={onEndMeetingForEveryone}
      />

      {/* Invite Modal */}
      <InviteDialog
        roomCode={roomCode}
        isOpen={showInviteDialog}
        onClose={() => setShowInviteDialog(false)}
      />
    </div>
  );
};

