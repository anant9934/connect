'use client';

import React, { useState } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  Users,
  MessageSquare,
  Link as LinkIcon,
  PhoneOff,
  Lock,
  Unlock,
  AlertOctagon,
  MoreHorizontal,
  FileText,
  Paperclip,
  Hand,
  Smile,
  X,
  AlertCircle,
} from 'lucide-react';
import { ReactionPicker } from './ReactionPicker';

interface MeetingControlsProps {
  isMicMuted: boolean;
  isVideoMuted: boolean;
  isMicBlocked?: boolean;
  isVideoBlocked?: boolean;
  isScreenSharing: boolean;
  isHost: boolean;
  isLocked: boolean;
  participantCount: number;
  activePanel: 'chat' | 'participants' | 'notes' | 'files' | null;
  unreadChatCount: number;
  isHandRaised: boolean;
  onToggleMic: () => void;
  onToggleVideo: () => void;
  onRequestDeviceHelp?: (device: 'camera' | 'microphone') => void;
  onToggleScreenShare: () => void;
  onTogglePanel: (panel: 'chat' | 'participants' | 'notes' | 'files') => void;
  onOpenInvite: () => void;
  onToggleLock: () => void;
  onSendReaction: (emoji: string) => void;
  onToggleHandRaise: () => void;
  onLeave: () => void;
  onEndMeetingForEveryone: () => void;
}

export const MeetingControls: React.FC<MeetingControlsProps> = ({
  isMicMuted,
  isVideoMuted,
  isMicBlocked = false,
  isVideoBlocked = false,
  isScreenSharing,
  isHost,
  isLocked,
  participantCount,
  activePanel,
  unreadChatCount,
  isHandRaised,
  onToggleMic,
  onToggleVideo,
  onRequestDeviceHelp,
  onToggleScreenShare,
  onTogglePanel,
  onOpenInvite,
  onToggleLock,
  onSendReaction,
  onToggleHandRaise,
  onLeave,
  onEndMeetingForEveryone,
}) => {
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  return (
    <>
      {/* Primary Fixed Bottom Toolbar */}
      <footer
        id="meeting-toolbar"
        className="w-full shrink-0 bg-white border-t border-[#E5E5E3] z-20 select-none px-3 sm:px-6 py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] shadow-[0_-4px_20px_rgba(0,0,0,0.04)]"
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-1.5 sm:gap-4">
          {/* Desktop Left: Quick Invite & Host Lock */}
          <div className="hidden md:flex items-center gap-2 min-w-0">
            <button
              onClick={onOpenInvite}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FAFAF8] hover:bg-[#F2F2F0] text-[#1C1C1C] text-xs font-medium transition-colors border border-[#E5E5E3] shadow-xs active:scale-95"
              aria-label="Invite participants"
            >
              <LinkIcon className="w-3.5 h-3.5 text-[#7658E8]" />
              <span>Invite</span>
            </button>

            {isHost && (
              <button
                onClick={onToggleLock}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors border shadow-xs active:scale-95 ${
                  isLocked
                    ? 'bg-[#FFF2BE] border-[#F0DF95] text-[#9A6700]'
                    : 'bg-[#FAFAF8] border-[#E5E5E3] text-[#1C1C1C] hover:bg-[#F2F2F0]'
                }`}
                title={isLocked ? 'Unlock meeting for new participants' : 'Lock meeting'}
              >
                {isLocked ? <Lock className="w-3.5 h-3.5 text-[#B45309]" /> : <Unlock className="w-3.5 h-3.5 text-[#666664]" />}
                <span>{isLocked ? 'Locked' : 'Unlocked'}</span>
              </button>
            )}
          </div>

          {/* Core AV & Actions (Centered on Desktop, Full Width on Mobile) */}
          <div className="flex-1 md:flex-initial flex items-center justify-between sm:justify-center gap-1.5 sm:gap-2.5">
            {/* 1. Microphone Toggle — MUST ALWAYS BE VISIBLE */}
            <div className="relative">
              <button
                id="toolbar-mic-btn"
                onClick={isMicBlocked && onRequestDeviceHelp ? () => onRequestDeviceHelp('microphone') : onToggleMic}
                className={`min-w-[46px] min-h-[46px] p-2.5 sm:p-3 rounded-2xl transition-all shadow-xs border flex items-center justify-center active:scale-95 ${
                  isMicMuted || isMicBlocked
                    ? 'bg-[#FFE5DF] border-[#F8C8BF] text-[#D32F2F] hover:bg-[#FCD8D1]'
                    : 'bg-[#FAFAF8] sm:bg-white border-[#E5E5E3] text-[#1C1C1C] hover:bg-[#F2F2F0]'
                }`}
                aria-label={
                  isMicBlocked
                    ? 'Microphone blocked — tap for help'
                    : isMicMuted
                    ? 'Unmute microphone'
                    : 'Mute microphone'
                }
                title={
                  isMicBlocked
                    ? 'Microphone blocked — tap for help'
                    : isMicMuted
                    ? 'Unmute microphone'
                    : 'Mute microphone'
                }
              >
                {isMicMuted || isMicBlocked ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              {isMicBlocked && (
                <span
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-black flex items-center justify-center shadow-xs pointer-events-none"
                  title="Microphone permission blocked"
                >
                  <AlertCircle className="w-3 h-3 text-black" />
                </span>
              )}
            </div>

            {/* 2. Camera Toggle — MUST ALWAYS BE VISIBLE */}
            <div className="relative">
              <button
                id="toolbar-camera-btn"
                onClick={isVideoBlocked && onRequestDeviceHelp ? () => onRequestDeviceHelp('camera') : onToggleVideo}
                className={`min-w-[46px] min-h-[46px] p-2.5 sm:p-3 rounded-2xl transition-all shadow-xs border flex items-center justify-center active:scale-95 ${
                  isVideoMuted || isVideoBlocked
                    ? 'bg-[#FFE5DF] border-[#F8C8BF] text-[#D32F2F] hover:bg-[#FCD8D1]'
                    : 'bg-[#FAFAF8] sm:bg-white border-[#E5E5E3] text-[#1C1C1C] hover:bg-[#F2F2F0]'
                }`}
                aria-label={
                  isVideoBlocked
                    ? 'Camera blocked — tap for help'
                    : isVideoMuted
                    ? 'Turn on camera'
                    : 'Turn off camera'
                }
                title={
                  isVideoBlocked
                    ? 'Camera blocked — tap for help'
                    : isVideoMuted
                    ? 'Turn on camera'
                    : 'Turn off camera'
                }
              >
                {isVideoMuted || isVideoBlocked ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </button>
              {isVideoBlocked && (
                <span
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-black flex items-center justify-center shadow-xs pointer-events-none"
                  title="Camera permission blocked"
                >
                  <AlertCircle className="w-3 h-3 text-black" />
                </span>
              )}
            </div>

            {/* 3. Screen Share (Desktop only; on mobile accessible via More Sheet) */}
            <button
              id="toolbar-screen-share-btn"
              onClick={onToggleScreenShare}
              className={`hidden md:flex min-w-[46px] min-h-[46px] p-3 rounded-2xl transition-all shadow-xs border items-center justify-center active:scale-95 ${
                isScreenSharing
                  ? 'bg-[#7658E8] border-[#7658E8] text-white ring-2 ring-[#EEE8FF]'
                  : 'bg-white border-[#E5E5E3] text-[#1C1C1C] hover:bg-[#F2F2F0]'
              }`}
              aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
              title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
            >
              <Monitor className="w-5 h-5" />
            </button>

            {/* 4. Desktop Reactions Picker */}
            <div className="hidden sm:block">
              <ReactionPicker
                isHandRaised={isHandRaised}
                onSendReaction={onSendReaction}
                onToggleHand={onToggleHandRaise}
              />
            </div>

            {/* 5. Realtime Chat Toggle */}
            <button
              id="toolbar-chat-btn"
              onClick={() => onTogglePanel('chat')}
              className={`relative min-w-[46px] min-h-[46px] p-2.5 sm:p-3 rounded-2xl transition-all shadow-xs border flex items-center justify-center active:scale-95 ${
                activePanel === 'chat'
                  ? 'bg-[#EEE8FF] border-[#D4C7FE] text-[#7658E8]'
                  : 'bg-[#FAFAF8] sm:bg-white border-[#E5E5E3] text-[#1C1C1C] hover:bg-[#F2F2F0]'
              }`}
              aria-label="Toggle chat"
              title="Chat messages"
            >
              <MessageSquare className="w-5 h-5" />
              {unreadChatCount > 0 && activePanel !== 'chat' && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-[#7658E8] text-[10px] font-bold text-white shadow-xs animate-pulse">
                  {unreadChatCount}
                </span>
              )}
            </button>

            {/* 6. Participants Panel Toggle (Desktop) */}
            <button
              onClick={() => onTogglePanel('participants')}
              className={`hidden md:flex relative min-w-[46px] min-h-[46px] p-3 rounded-2xl transition-all shadow-xs border items-center justify-center active:scale-95 ${
                activePanel === 'participants'
                  ? 'bg-[#EEE8FF] border-[#D4C7FE] text-[#7658E8]'
                  : 'bg-white border-[#E5E5E3] text-[#1C1C1C] hover:bg-[#F2F2F0]'
              }`}
              aria-label="Toggle participants list"
              title="Participants"
            >
              <Users className="w-5 h-5" />
              {participantCount > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-[#7658E8] text-[10px] font-bold text-white shadow-xs">
                  {participantCount}
                </span>
              )}
            </button>

            {/* 7. Notes Panel (Desktop) */}
            <button
              onClick={() => onTogglePanel('notes')}
              className={`hidden lg:flex relative min-w-[46px] min-h-[46px] p-3 rounded-2xl transition-all shadow-xs border items-center justify-center active:scale-95 ${
                activePanel === 'notes'
                  ? 'bg-[#EEE8FF] border-[#D4C7FE] text-[#7658E8]'
                  : 'bg-white border-[#E5E5E3] text-[#1C1C1C] hover:bg-[#F2F2F0]'
              }`}
              aria-label="Toggle notes"
              title="Meeting notes"
            >
              <FileText className="w-5 h-5" />
            </button>

            {/* 8. Files Panel (Desktop) */}
            <button
              onClick={() => onTogglePanel('files')}
              className={`hidden lg:flex relative min-w-[46px] min-h-[46px] p-3 rounded-2xl transition-all shadow-xs border items-center justify-center active:scale-95 ${
                activePanel === 'files'
                  ? 'bg-[#DFF5E8] border-[#A8E5C1] text-[#1B7A43]'
                  : 'bg-white border-[#E5E5E3] text-[#1C1C1C] hover:bg-[#F2F2F0]'
              }`}
              aria-label="Toggle files"
              title="Meeting files"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            {/* 9. Mobile More Options Button */}
            <button
              id="toolbar-more-btn"
              onClick={() => setShowMoreSheet(true)}
              className="md:hidden relative min-w-[46px] min-h-[46px] p-2.5 sm:p-3 rounded-2xl transition-all shadow-xs border border-[#E5E5E3] bg-[#FAFAF8] text-[#1C1C1C] hover:bg-[#F2F2F0] flex items-center justify-center active:scale-95"
              aria-label="More options"
              title="More options"
            >
              <MoreHorizontal className="w-5 h-5" />
              {isHandRaised && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#B45309]" />
              )}
            </button>

            {/* 10. Leave Meeting Action — MUST ALWAYS BE VISIBLE */}
            <button
              id="toolbar-leave-btn"
              onClick={onLeave}
              className="min-h-[46px] px-3 sm:px-4 py-2.5 rounded-2xl bg-[#FFE5DF] hover:bg-[#FCD8D1] border border-[#F8C8BF] text-[#D32F2F] font-semibold text-xs transition-all shadow-xs flex items-center gap-1.5 active:scale-95 shrink-0"
              aria-label="Leave meeting"
              title="Leave meeting"
            >
              <PhoneOff className="w-4 h-4 text-[#D32F2F]" />
              <span className="font-semibold">Leave</span>
            </button>
          </div>

          {/* Desktop Right: Host Moderation Actions */}
          <div className="hidden md:flex items-center gap-2 min-w-0">
            {isHost && (
              <button
                onClick={() => setShowEndConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FFE5DF] hover:bg-[#FCD8D1] border border-[#F8C8BF] text-[#D32F2F] text-xs font-semibold transition-colors shadow-xs active:scale-95"
              >
                <AlertOctagon className="w-3.5 h-3.5" />
                <span>End for all</span>
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Mobile More Options Bottom Sheet */}
      {showMoreSheet && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          {/* Backdrop tap dismiss */}
          <div className="absolute inset-0" onClick={() => setShowMoreSheet(false)} />

          <div className="relative w-full sm:max-w-md bg-white border border-[#E5E5E3] rounded-t-3xl sm:rounded-3xl p-5 text-[#1C1C1C] shadow-2xl z-10 max-h-[85vh] max-h-[85dvh] overflow-y-auto space-y-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]">
            {/* Sheet Handle and Header */}
            <div className="flex items-center justify-between pb-2 border-b border-[#F2F2F0]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#7658E8]" />
                <h3 className="font-semibold text-sm text-[#1C1C1C]">Meeting Options</h3>
              </div>
              <button
                onClick={() => setShowMoreSheet(false)}
                className="p-1.5 rounded-lg text-[#666664] hover:text-[#1C1C1C] hover:bg-[#F2F2F0]"
                aria-label="Close options"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Grid of Mobile Options */}
            <div className="grid grid-cols-2 gap-2.5">
              {/* Participants */}
              <button
                onClick={() => {
                  onTogglePanel('participants');
                  setShowMoreSheet(false);
                }}
                className={`p-3 rounded-2xl border text-left flex items-center gap-3 transition-colors min-h-[48px] ${
                  activePanel === 'participants'
                    ? 'bg-[#EEE8FF] border-[#D4C7FE] text-[#7658E8]'
                    : 'bg-[#FAFAF8] border-[#E5E5E3] hover:bg-[#F2F2F0]'
                }`}
              >
                <Users className="w-5 h-5 text-[#7658E8] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">Participants</div>
                  <div className="text-[10px] text-[#666664]">{participantCount} in room</div>
                </div>
              </button>

              {/* Hand Raise */}
              <button
                onClick={() => {
                  onToggleHandRaise();
                  setShowMoreSheet(false);
                }}
                className={`p-3 rounded-2xl border text-left flex items-center gap-3 transition-colors min-h-[48px] ${
                  isHandRaised
                    ? 'bg-[#FFF2BE] border-[#F0DF95] text-[#9A6700]'
                    : 'bg-[#FAFAF8] border-[#E5E5E3] hover:bg-[#F2F2F0]'
                }`}
              >
                <Hand className="w-5 h-5 text-[#B45309] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">{isHandRaised ? 'Lower Hand' : 'Raise Hand'}</div>
                  <div className="text-[10px] text-[#666664]">{isHandRaised ? 'Hand is raised' : 'Request to speak'}</div>
                </div>
              </button>

              {/* Meeting Notes */}
              <button
                onClick={() => {
                  onTogglePanel('notes');
                  setShowMoreSheet(false);
                }}
                className={`p-3 rounded-2xl border text-left flex items-center gap-3 transition-colors min-h-[48px] ${
                  activePanel === 'notes'
                    ? 'bg-[#EEE8FF] border-[#D4C7FE] text-[#7658E8]'
                    : 'bg-[#FAFAF8] border-[#E5E5E3] hover:bg-[#F2F2F0]'
                }`}
              >
                <FileText className="w-5 h-5 text-[#7658E8] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">Notes</div>
                  <div className="text-[10px] text-[#666664]">Live collaboration</div>
                </div>
              </button>

              {/* Files */}
              <button
                onClick={() => {
                  onTogglePanel('files');
                  setShowMoreSheet(false);
                }}
                className={`p-3 rounded-2xl border text-left flex items-center gap-3 transition-colors min-h-[48px] ${
                  activePanel === 'files'
                    ? 'bg-[#DFF5E8] border-[#A8E5C1] text-[#1B7A43]'
                    : 'bg-[#FAFAF8] border-[#E5E5E3] hover:bg-[#F2F2F0]'
                }`}
              >
                <Paperclip className="w-5 h-5 text-[#1B7A43] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">Shared Files</div>
                  <div className="text-[10px] text-[#666664]">View & upload</div>
                </div>
              </button>

              {/* Screen Share */}
              <button
                onClick={() => {
                  onToggleScreenShare();
                  setShowMoreSheet(false);
                }}
                className={`p-3 rounded-2xl border text-left flex items-center gap-3 transition-colors min-h-[48px] ${
                  isScreenSharing
                    ? 'bg-[#7658E8] text-white border-[#7658E8]'
                    : 'bg-[#FAFAF8] border-[#E5E5E3] hover:bg-[#F2F2F0]'
                }`}
              >
                <Monitor className={`w-5 h-5 shrink-0 ${isScreenSharing ? 'text-white' : 'text-[#7658E8]'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">Screen Share</div>
                  <div className={`text-[10px] ${isScreenSharing ? 'text-white/80' : 'text-[#666664]'}`}>
                    {isScreenSharing ? 'Sharing now' : 'Present screen'}
                  </div>
                </div>
              </button>

              {/* Invite */}
              <button
                onClick={() => {
                  onOpenInvite();
                  setShowMoreSheet(false);
                }}
                className="p-3 rounded-2xl border border-[#E5E5E3] bg-[#FAFAF8] hover:bg-[#F2F2F0] text-left flex items-center gap-3 transition-colors min-h-[48px]"
              >
                <LinkIcon className="w-5 h-5 text-[#7658E8] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">Invite Link</div>
                  <div className="text-[10px] text-[#666664]">Share meeting</div>
                </div>
              </button>
            </div>

            {/* Quick Reactions Bar in Sheet */}
            <div className="pt-2 border-t border-[#F2F2F0]">
              <label className="text-[11px] font-medium text-[#666664] block mb-2">Send Reaction</label>
              <div className="flex items-center justify-around gap-1 p-1 bg-[#FAFAF8] rounded-2xl border border-[#E5E5E3]">
                {['👍', '❤️', '👏', '🎉', '💡', '👋'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      onSendReaction(emoji);
                      setShowMoreSheet(false);
                    }}
                    className="p-2 text-xl hover:scale-125 active:scale-95 transition-transform"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Host Administration Options */}
            {isHost && (
              <div className="pt-2 border-t border-[#F2F2F0] space-y-2">
                <label className="text-[11px] font-medium text-[#666664] block">Host Controls</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      onToggleLock();
                      setShowMoreSheet(false);
                    }}
                    className="p-2.5 rounded-xl border border-[#E5E5E3] bg-[#FAFAF8] hover:bg-[#F2F2F0] text-xs font-medium flex items-center gap-2"
                  >
                    {isLocked ? <Unlock className="w-4 h-4 text-[#B45309]" /> : <Lock className="w-4 h-4 text-[#666664]" />}
                    <span>{isLocked ? 'Unlock Room' : 'Lock Room'}</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowEndConfirm(true);
                      setShowMoreSheet(false);
                    }}
                    className="p-2.5 rounded-xl border border-[#F8C8BF] bg-[#FFE5DF] hover:bg-[#FCD8D1] text-[#D32F2F] text-xs font-semibold flex items-center gap-2"
                  >
                    <AlertOctagon className="w-4 h-4 text-[#D32F2F]" />
                    <span>End for All</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Host End Meeting Confirmation Modal */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-sm bg-white border border-[#E5E5E3] rounded-3xl p-6 text-[#1C1C1C] space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-[#FFE5DF] border border-[#F8C8BF] text-[#D32F2F] flex items-center justify-center mx-auto">
              <AlertOctagon className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-semibold text-base text-[#1C1C1C]">End meeting for everyone?</h3>
              <p className="text-xs text-[#666664] leading-relaxed">
                This will immediately disconnect all participants and close the room.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 min-h-[44px] py-2.5 px-3 rounded-xl bg-[#F2F2F0] hover:bg-[#EAEAE8] text-xs font-medium text-[#1C1C1C] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowEndConfirm(false);
                  onEndMeetingForEveryone();
                }}
                className="flex-1 min-h-[44px] py-2.5 px-3 rounded-xl bg-[#D32F2F] hover:bg-[#B71C1C] text-xs font-semibold text-white transition-colors shadow-xs"
              >
                End for everyone
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
